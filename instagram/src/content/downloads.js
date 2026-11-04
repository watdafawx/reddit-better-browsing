/* Download / open-in-tab buttons: a small bar over the media under the mouse (feed, post and reel
   pages, stories), the same buttons in the lightbox, and Alt+S for whatever is current. */
(() => {
  const h = IGB.h;

  // ---------- saving ----------
  const pad = n => String(n).padStart(2, '0');
  function fileName(d, i) {
    const item = d.items[i];
    const ext = (new URL(item.src).pathname.match(/\.(jpe?g|png|webp|heic|mp4|mov)$/i)?.[1] || (item.type === 'video' ? 'mp4' : 'jpg')).toLowerCase();
    const t = new Date((d.taken || 0) * 1000);
    const date = d.taken ? `${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}` : '';
    const base = (IGB.settings.downloadName || '{user}_{code}_{n}')
      .replace(/\{user\}/g, d.user).replace(/\{code\}/g, d.code).replace(/\{n\}/g, i + 1).replace(/\{date\}/g, date)
      .replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/^[._ ]+|[. ]+$/g, '') || 'instagram';
    return `${base}.${ext}`;
  }
  // Fetch as a blob so the browser saves it under our name; if the CDN refuses, open it instead.
  async function save(url, name) {
    try {
      const r = await fetch(url, { credentials: 'omit' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const u = URL.createObjectURL(await r.blob());
      const a = h('a', { href: u, download: name, style: { display: 'none' } });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 60000);
    } catch (e) {
      console.warn('[IGB] download failed, opening instead', e);
      window.open(url, '_blank', 'noopener');
    }
  }
  IGB.downloadItems = async (d, idxs) => {
    for (const i of idxs) if (d.items[i]?.src) await save(d.items[i].src, fileName(d, i));
  };
  const openItem = (d, i) => d.items[i]?.src && window.open(d.items[i].src, '_blank', 'noopener');

  // ---------- link for Discord ----------
  // Discord shows no preview for instagram.com links; an embed-fixer domain serves the same path with
  // the tags Discord reads (InstaFix and its forks). The domain is a setting because they come and go.
  const embedHost = () => (IGB.settings.embedHost || 'kkinstagram.com').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '') || 'kkinstagram.com';
  IGB.embedUrl = (code, reel) => `https://${embedHost()}/${reel ? 'reel' : 'p'}/${code}/`;
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return; } catch {}
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }, text);
    document.body.append(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (!ok) throw new Error('clipboard blocked');
  }
  const embedButton = post => h('button', {
    class: 'igb-tool igb-embed-btn', title: 'Copy link for Discord (shows the post or video in the chat)', 'aria-label': 'Copy link for Discord',
    onclick: async e => {
      e.preventDefault(); e.stopPropagation();
      const code = post.code();
      if (!code) return;
      const url = IGB.embedUrl(code, post.reel);
      try { await copyText(url); IGB.toast?.('Copied ' + url); }
      catch (err) { IGB.toast?.('Could not copy: ' + url); }
    }
  }, IGB.icon('link'));

  // Buttons for one post. getIdx() is read at click time (carousels move).
  // post: { code(), art(), reel } for the link and "Not interested" buttons, or null (stories).
  function buttons(getData, getIdx, multi, post) {
    const s = IGB.settings;
    const run = fn => async e => {
      e.preventDefault(); e.stopPropagation();
      const b = e.currentTarget; b.classList.add('busy');
      try { const d = await getData(); await fn(d, Math.min(getIdx(), d.items.length - 1)); }
      catch (err) { console.warn('[IGB]', err); }
      finally { b.classList.remove('busy'); }
    };
    const tool = (cls, label, icon, onclick) => h('button', { class: 'igb-tool ' + cls, type: 'button', title: label, 'aria-label': label, onclick }, IGB.icon(icon));
    return [
      s.downloadTools ? tool('igb-dl', 'Download (Alt+S)', 'download', run((d, i) => IGB.downloadItems(d, [i]))) : '',
      s.downloadTools && multi ? tool('igb-dl-all', 'Download all in this post', 'downloadAll', run(d => IGB.downloadItems(d, d.items.map((_, i) => i)))) : '',
      s.downloadTools ? tool('igb-open', 'Open in a new tab', 'open', run(openItem)) : '',
      s.embedLink && post ? embedButton(post) : '',
      s.notInterested && post && IGB.notInterestedButton ? IGB.notInterestedButton(post.code, post.art) : '',
      post?.reelsTab && IGB.autoScrollButton ? IGB.autoScrollButton() : ''
    ].filter(Boolean);
  }
  const anyTools = () => IGB.settings.downloadTools || IGB.settings.notInterested || IGB.settings.embedLink;
  // Lightbox: post data is already loaded
  IGB.mediaTools = (d, getIdx) => anyTools()
    ? h('span', { class: 'igb-tools-inline' }, buttons(() => Promise.resolve(d), getIdx, d.items.length > 1, d.code ? { code: () => d.code, reel: d.items.length === 1 && d.items[0].type === 'video' } : null)) : '';

  // ---------- what's under the mouse ----------
  const onStory = () => location.pathname.startsWith('/stories/');
  const storyId = () => location.pathname.match(/^\/stories\/[^/]+\/(\d+)/)?.[1] || null;
  // Right after a story opens, the URL is /stories/<user>/ and Instagram adds the story id a moment later.
  async function storyPost() {
    for (let i = 0; i < 30 && !storyId(); i++) await new Promise(r => setTimeout(r, 100));
    const id = storyId();
    if (!id) throw new Error('story id not in the URL yet');
    return IGB.getPostById(id);
  }
  const isMedia = e => (e.tagName === 'IMG' || e.tagName === 'VIDEO') && e.getBoundingClientRect().width > 200;
  function contextAt(x, y) {
    const els = document.elementsFromPoint(x, y);
    const media = els.find(isMedia);
    if (!media || media.closest('.igb-root')) return null;
    if (media.closest('a[href]') && !media.closest('article, [role="dialog"]')) return null; // grid tile: lightbox has buttons
    const art = media.closest('article');
    if (art) {
      const code = IGB.articleCode(art);
      return code && { key: code, media, get: () => IGB.getPost(code), idx: () => IGB.activeSlide(art), multi: !!art.querySelector('[aria-current="step"]'), post: { code: () => code, art: () => art, reel: !!art.querySelector('video') && !art.querySelector('[aria-current="step"]') } };
    }
    if (onStory()) return { key: 'story:' + (storyId() || ''), media, get: storyPost, idx: () => 0, multi: false };
    const code = IGB.codeOf(location.pathname);
    const scope = media.closest('[role="dialog"], main') || document.body;
    // Reels tab: the URL follows the reel on screen
    const reel = /^\/reels?\//.test(location.pathname);
    if (code) return { key: code, media, get: () => IGB.getPost(code), idx: () => IGB.activeSlide(scope), multi: !!scope.querySelector('[aria-current="step"]'), post: { code: () => IGB.codeOf(location.pathname) || code, reel, reelsTab: location.pathname.startsWith('/reels/') } };
    return null;
  }

  // With the mouse on no post: the post (or reel, or story) in the middle of the window
  function centerContext() {
    const mid = innerHeight / 2;
    const dist = r => (r.top <= mid && r.bottom >= mid ? 0 : Math.min(Math.abs(r.top - mid), Math.abs(r.bottom - mid)));
    let best = null, bd = Infinity;
    for (const m of document.querySelectorAll('img, video')) {
      if (!isMedia(m) || m.closest('.igb-root')) continue;
      const r = m.getBoundingClientRect();
      if (r.bottom < 60 || r.top > innerHeight - 60 || r.right < 0 || r.left > innerWidth) continue;
      const d = dist(r);
      if (d < bd) { bd = d; best = r; }
    }
    if (!best) return null;
    return contextAt(Math.min(Math.max(best.left + best.width / 2, 1), innerWidth - 1), Math.min(Math.max(mid, best.top + 5, 1), best.bottom - 5, innerHeight - 1));
  }

  // One floating bar beside the post under the mouse, or else the one in the middle of the window
  const GAP = 8;
  let bar = null, cur = null, mx = -1, my = -1, raf = 0, dirty = false;
  function place() {
    raf = 0;
    if (!anyTools() || document.documentElement.hasAttribute('data-igb-lb')) return hide();
    // Mouse on the column: leave it where it is, but redraw it after a settings change (the
    // auto-scroll switch) and drop it after a page change
    if (bar && cur && cur.path === location.pathname && bar.contains(document.elementFromPoint(mx, my))) {
      if (dirty) { dirty = false; bar.replaceChildren(...buttons(cur.get, cur.idx, cur.multi, cur.post)); }
      return;
    }
    let c = mx >= 0 ? contextAt(mx, my) : null;
    // The bar sits just outside the media's right edge: keep it while the mouse crosses the gap
    if (!c && cur?.media.isConnected && cur.path === location.pathname) {
      const r = cur.media.getBoundingClientRect();
      if (mx >= r.left && mx <= r.right + GAP + 40 && my >= r.top && my <= r.bottom) c = cur;
    }
    if (!c) c = centerContext();
    if (!c) return hide();
    if (!bar) { bar = h('div', { class: 'igb-root igb-tools' }); document.body.append(bar); }
    if (dirty || !cur || cur.key !== c.key || cur.media !== c.media || cur.path !== location.pathname) {
      dirty = false;
      bar.replaceChildren(...buttons(c.get, c.idx, c.multi, c.post));
      if (IGB.settings.downloadTools) c.get().catch(() => {}); // warm the data so the click is instant
    }
    cur = c;
    c.path = location.pathname;
    // A column beside the media's top-right corner, off the picture; inside the edge only if
    // there's no room on the right (media running to the window edge).
    const r = c.media.getBoundingClientRect();
    bar.hidden = false;
    bar.classList.toggle('igb-on-dark', onStory());
    const w = bar.offsetWidth || 36;
    const x = r.right + GAP + w <= innerWidth ? r.right + GAP : r.right - w - GAP;
    bar.style.transform = `translate(${Math.round(x)}px, ${Math.round(Math.max(r.top, 0) + GAP)}px)`;
  }
  function hide() { if (bar) bar.hidden = true; cur = null; }
  addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; if (!raf) raf = requestAnimationFrame(place); }, { passive: true });
  const schedule = () => { if (!raf) raf = requestAnimationFrame(place); };
  addEventListener('scroll', schedule, { passive: true, capture: true });
  addEventListener('resize', schedule, { passive: true });
  addEventListener('mouseleave', () => { mx = my = -1; schedule(); });
  IGB.onDomChange(schedule, 300);
  IGB.onSettings(() => { dirty = true; schedule(); });

  // Alt+S: download what's current (lightbox item, story, or the media under the mouse)
  addEventListener('keydown', e => {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.code !== 'KeyS') return;
    if (e.target.closest?.('input, textarea, [contenteditable="true"]')) return;
    e.preventDefault(); e.stopPropagation();
    const lb = IGB.lightboxItem?.();
    if (lb) return IGB.downloadItems(lb.data, [lb.ii]);
    if (onStory()) return storyPost().then(d => IGB.downloadItems(d, [0]), err => console.warn('[IGB]', err));
    const c = contextAt(mx, my);
    if (c) c.get().then(d => IGB.downloadItems(d, [Math.min(c.idx(), d.items.length - 1)]), err => console.warn('[IGB]', err));
  }, true);
})();
