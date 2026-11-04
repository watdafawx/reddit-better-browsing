/* Lightbox: grid tiles and feed photos open full screen. Wheel / arrows step through a post's
   slides and on into the next posts; Esc, Back or a click beside the media closes it. */
(() => {
  const h = IGB.h;
  const CODE_RE = /\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/;
  const codeOf = href => (href && href.match(CODE_RE)?.[1]) || null;

  // ---------- data ----------
  // Shortcode → numeric media id (base64 alphabet). Private-post codes are longer; the id is in the first 11.
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  IGB.mediaId = code => { let n = 0n; for (const c of code.slice(0, 11)) n = n * 64n + BigInt(ALPHA.indexOf(c)); return n.toString(); };

  const biggest = list => (list || []).reduce((b, c) => (!b || c.width * c.height > b.width * b.height ? c : b), null);
  const one = m => {
    const img = biggest(m.image_versions2?.candidates)?.url || '';
    const vid = biggest(m.video_versions)?.url;
    return vid ? { type: 'video', src: vid, poster: img } : { type: 'image', src: img };
  };
  function normalize(it) {
    if (!it) throw new Error('no media in response');
    return {
      code: it.code || String(it.pk || ''),
      user: it.user?.username || '',
      caption: it.caption?.text || '',
      likes: it.like_count, comments: it.comment_count,
      taken: it.taken_at || 0,
      items: (it.carousel_media?.length ? it.carousel_media : [it]).map(one)
    };
  }
  // One request per post, cached for the page. Failures are not cached.
  // Posts are addressed by shortcode; stories by their numeric id (it's in the story URL).
  const cache = new Map();
  IGB.getPostById = id => {
    let p = cache.get(id);
    if (!p) {
      p = IGB.getJSON(`/api/v1/media/${id}/info/`).then(j => normalize(j.items?.[0]));
      cache.set(id, p);
      p.catch(() => cache.delete(id));
    }
    return p;
  };
  IGB.getPost = code => IGB.getPostById(IGB.mediaId(code));
  IGB.codeOf = codeOf;

  // ---------- what's on the page ----------
  const isGridTile = a => !a.closest('article, [role="dialog"], .igb-root') && codeOf(a.getAttribute('href')) && a.querySelector('img, video');
  const tileThumb = a => a.querySelector('img')?.currentSrc || a.querySelector('img')?.src || '';
  function gridEntries() {
    return [...document.querySelectorAll('a[href]')].filter(a => isGridTile(a) && a.getBoundingClientRect().width > 60)
      .map(a => ({ code: codeOf(a.getAttribute('href')), el: a, thumb: tileThumb(a) }));
  }
  function articleCode(art) {
    const t = art.querySelector('a[href] time')?.closest('a');
    return codeOf(t?.getAttribute('href')) || [...art.querySelectorAll('a[href]')].map(a => codeOf(a.getAttribute('href'))).find(Boolean) || null;
  }
  const bigImgs = art => [...art.querySelectorAll('img')].filter(i => i.getBoundingClientRect().width > 200);
  function feedEntries() {
    return [...document.querySelectorAll('article')].map(art => {
      const code = articleCode(art);
      const img = bigImgs(art).find(i => { const r = i.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; });
      return code && { code, el: art, thumb: img?.currentSrc || '' };
    }).filter(Boolean);
  }
  const dedupe = list => { const seen = new Set(); return list.filter(e => !seen.has(e.code) && seen.add(e.code)); };
  // Active carousel slide: Instagram marks its dot with aria-current (language-independent)
  function activeSlide(art) {
    const dot = art.querySelector('[aria-current="step"], [aria-current="true"]');
    return dot ? [...dot.parentElement.children].indexOf(dot) : 0;
  }

  // ---------- lightbox ----------
  let lb = null;

  function open(source, list, pi, ii = 0) {
    if (lb) close();
    list = dedupe(list);
    if (!list.length) return;
    const stage = h('div', { class: 'igb-lb-stage' });
    const dots = h('div', { class: 'igb-lb-dots' });
    const bar = h('div', { class: 'igb-lb-bar' });
    const el = h('div', { class: 'igb-root igb-lb', role: 'dialog', 'aria-modal': 'true', tabindex: '-1' },
      h('button', { class: 'igb-lb-close', title: 'Close (Esc)', onclick: () => close() }, '✕'),
      stage, dots, bar);
    stage.append(
      h('button', { class: 'igb-lb-nav igb-lb-prev', title: 'Previous (←)', onclick: e => { e.stopPropagation(); step(-1); } }, '‹'),
      h('button', { class: 'igb-lb-nav igb-lb-next', title: 'Next (→)', onclick: e => { e.stopPropagation(); step(1); } }, '›'));
    lb = { source, list, pi, ii, el, stage, dots, bar, media: null, pushed: false };

    // Page videos stop and may not restart while we're open (main-world.js checks this attribute)
    document.documentElement.setAttribute('data-igb-lb', '');
    document.querySelectorAll('video').forEach(v => { if (!v.paused) v.pause(); });

    el.addEventListener('click', e => { if (e.target === el || e.target === stage || e.target === bar) close(); });
    el.addEventListener('wheel', onWheel, { passive: false });
    document.body.append(el);
    el.focus({ preventScroll: true });
    try { history.pushState({ ...(history.state || {}), igbLb: 1 }, ''); lb.pushed = true; } catch {}
    render();
  }

  function close(fromPop) {
    if (!lb) return;
    const { el, pushed } = lb;
    lb = null;
    IGB.destroyVideos(el);
    el.remove();
    document.documentElement.removeAttribute('data-igb-lb');
    if (pushed && !fromPop && history.state?.igbLb) history.back();
  }
  addEventListener('popstate', () => { if (lb && !history.state?.igbLb) close(true); });

  function setMedia(node) {
    if (lb.media) { IGB.destroyVideos(lb.media); lb.media.remove(); }
    lb.media = node;
    lb.el.classList.remove('igb-zoom');
    lb.stage.querySelector('.igb-lb-next').before(node);
  }

  function render() {
    const entry = lb.list[lb.pi];
    const cached = entry.data;
    if (cached) return draw(entry);
    // Show the thumbnail we already have at once, swap in full quality when the API answers
    setMedia(entry.thumb ? h('img', { src: entry.thumb, alt: '' }) : h('div', { class: 'igb-spin' }));
    drawBar(entry, null);
    const want = entry;
    IGB.getPost(entry.code).then(d => {
      want.data = d;
      if (lb && lb.list[lb.pi] === want) draw(want);
    }, err => {
      if (!lb || lb.list[lb.pi] !== want) return;
      console.warn('[IGB] post load failed', want.code, err);
      if (!want.thumb) setMedia(h('div', { class: 'igb-lb-msg' }, 'Could not load this post. ', h('a', { href: `/p/${want.code}/` }, 'Open it on Instagram')));
    });
    prefetch();
  }

  function draw(entry) {
    const d = entry.data;
    if (lb.ii < 0) lb.ii = d.items.length - 1;
    lb.ii = Math.min(lb.ii, d.items.length - 1);
    const item = d.items[lb.ii];
    if (item.type === 'video') {
      const v = h('video', { src: item.src, poster: item.poster || null, preload: 'auto' });
      setMedia(v);
      IGB.setupOwnVideo(v);
    } else {
      // keep the low-res image up until the full one has decoded, so there's no blank flash
      const img = h('img', { alt: '', src: lb.ii === (entry.thumbIdx || 0) && entry.thumb ? entry.thumb : item.src });
      img.addEventListener('click', e => { e.stopPropagation(); lb.el.classList.toggle('igb-zoom'); });
      setMedia(img);
      if (img.src !== item.src) {
        const full = new Image();
        full.onload = () => { if (lb && lb.media === img) img.src = item.src; };
        full.src = item.src;
      }
    }
    lb.dots.replaceChildren(...(d.items.length > 1 ? d.items.map((_, i) => h('i', { class: i === lb.ii ? 'on' : null })) : []));
    drawBar(entry, d);
    prefetch();
  }

  function drawBar(entry, d) {
    const s = IGB.settings;
    const cap = d && s.lightboxCaption && d.caption ? h('div', { class: 'igb-lb-cap clamp', title: 'Click to expand', onclick: e => e.currentTarget.classList.toggle('clamp') }, d.caption) : h('div', { class: 'igb-lb-cap' });
    lb.bar.replaceChildren(
      d?.user ? h('a', { class: 'igb-lb-user', href: `/${d.user}/` }, d.user) : '',
      cap,
      h('div', { class: 'igb-lb-meta' },
        d?.likes != null ? h('span', null, '♥ ' + d.likes.toLocaleString()) : '',
        h('span', null, `${lb.pi + 1} / ${lb.list.length}`),
        d && IGB.mediaTools ? IGB.mediaTools(d, () => lb?.ii ?? 0) : '',
        h('a', { href: `/p/${entry.code}/`, onclick: () => close(true) }, 'Open post')));
  }

  // Warm the next posts' data and the next image, so stepping feels instant
  function prefetch() {
    const { list, pi } = lb;
    [pi + 1, pi + 2, pi - 1].forEach(i => list[i] && IGB.getPost(list[i].code).then(d => { list[i].data = d; }, () => {}));
    const d = list[pi].data;
    const next = d?.items[lb.ii + 1] || list[pi + 1]?.data?.items[0];
    if (next?.type === 'image') new Image().src = next.src;
  }

  // Bring more posts in: Instagram loads (and drops) posts as the page scrolls
  function refill() {
    const fresh = lb.source === 'grid' ? gridEntries() : feedEntries();
    const have = new Set(lb.list.map(e => e.code));
    const added = fresh.filter(e => !have.has(e.code));
    lb.list.push(...added);
    return added.length;
  }

  function goPost(pi, ii = 0) {
    if (pi < 0) return;
    if (pi >= lb.list.length) {
      const last = lb.list[lb.list.length - 1].el;
      if (last?.isConnected) last.scrollIntoView({ block: 'end' });
      if (!refill()) { setTimeout(() => lb && refill() && drawBar(lb.list[lb.pi], lb.list[lb.pi].data), 1200); return; }
    }
    lb.pi = pi; lb.ii = ii;
    const el = lb.list[pi].el;
    if (el?.isConnected) el.scrollIntoView({ block: 'center' }); // keeps Instagram loading what comes next
    if (pi >= lb.list.length - 3) setTimeout(() => lb && refill(), 800);
    render();
  }

  function step(dir) {
    if (!lb) return;
    const d = lb.list[lb.pi].data;
    const n = lb.ii + dir;
    if (d && n >= 0 && n < d.items.length) { lb.ii = n; draw(lb.list[lb.pi]); return; }
    goPost(lb.pi + dir, dir < 0 ? -1 : 0);
  }

  let wheelAt = 0;
  function onWheel(e) {
    if (lb.el.classList.contains('igb-zoom')) return;      // zoomed: wheel scrolls the image
    if (e.target.closest('.igb-lb-bar')) return;           // long captions scroll
    e.preventDefault();
    if (Math.abs(e.deltaY) + Math.abs(e.deltaX) < 4 || Date.now() - wheelAt < 220) return;
    wheelAt = Date.now();
    step((Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) > 0 ? 1 : -1);
  }

  addEventListener('keydown', e => {
    if (!lb || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest?.('input, textarea, [contenteditable="true"]')) return;
    const k = e.key;
    let used = true;
    if (k === 'Escape') close();
    else if (k === 'ArrowRight' || k === 'l') step(1);
    else if (k === 'ArrowLeft' || k === 'h') step(-1);
    else if (k === 'ArrowDown' || k === 'j' || k === 'PageDown') goPost(lb.pi + 1);
    else if (k === 'ArrowUp' || k === 'k' || k === 'PageUp') goPost(lb.pi - 1);
    else if (k === ' ' && lb.media?.tagName === 'VIDEO') lb.media.paused ? lb.media.play() : lb.media.pause();
    else if (k === 'd' && lb.list[lb.pi].data && IGB.downloadItems) IGB.downloadItems(lb.list[lb.pi].data, [lb.ii]);
    else used = false;
    if (used) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  // ---------- opening ----------
  let feedTimer = 0;
  addEventListener('click', e => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || lb) return;
    const t = e.target;
    if (!(t instanceof Element) || t.closest('.igb-root')) return;
    const s = IGB.settings;

    const a = t.closest('a[href]');
    if (a && s.lightboxGrid && isGridTile(a)) {
      e.preventDefault(); e.stopPropagation();
      const list = gridEntries();
      const code = codeOf(a.getAttribute('href'));
      let pi = list.findIndex(x => x.code === code);
      if (pi < 0) { list.unshift({ code, el: a, thumb: tileThumb(a) }); pi = 0; }
      open('grid', list, pi);
      return;
    }

    // Feed photo: single click opens; a double click (Instagram's like) cancels it
    const art = s.lightboxFeed && !a && t.closest('article');
    if (!art || t.tagName === 'VIDEO') return;
    const ctl = t.closest('button, [role="button"]');
    if (ctl && ctl.getBoundingClientRect().width < 150) return;   // chevrons, tags, like button
    const inside = r => e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if ([...art.querySelectorAll('video')].some(v => inside(v.getBoundingClientRect()))) return;
    const img = bigImgs(art).find(i => inside(i.getBoundingClientRect()));
    if (!img) return;
    const code = articleCode(art);
    if (!code) return;
    clearTimeout(feedTimer);
    feedTimer = setTimeout(() => {
      const list = feedEntries();
      let pi = list.findIndex(x => x.code === code);
      if (pi < 0) { list.unshift({ code, el: art }); pi = 0; }
      const slide = activeSlide(art);
      Object.assign(list[pi], { thumb: img.currentSrc || img.src, thumbIdx: slide });
      open('feed', list, pi, slide);
    }, 260);
  }, true);
  addEventListener('dblclick', () => clearTimeout(feedTimer), true);

  IGB.lightboxItem = () => lb && lb.list[lb.pi].data ? { data: lb.list[lb.pi].data, ii: lb.ii } : null;
  IGB.articleCode = articleCode;
  IGB.activeSlide = activeSlide;
  IGB.openLightbox = open;
  IGB.closeLightbox = close;
})();
