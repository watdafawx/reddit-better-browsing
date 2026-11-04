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

  // Buttons for one post. getIdx() is read at click time (carousels move).
  function buttons(getData, getIdx, multi) {
    const run = fn => async e => {
      e.preventDefault(); e.stopPropagation();
      const b = e.currentTarget; b.classList.add('busy');
      try { const d = await getData(); await fn(d, Math.min(getIdx(), d.items.length - 1)); }
      catch (err) { console.warn('[IGB]', err); }
      finally { b.classList.remove('busy'); }
    };
    return [
      h('button', { class: 'igb-tool', title: 'Download (Alt+S)', onclick: run((d, i) => IGB.downloadItems(d, [i])) }, '⤓'),
      multi ? h('button', { class: 'igb-tool', title: 'Download all in this post', onclick: run(d => IGB.downloadItems(d, d.items.map((_, i) => i))) }, '⤓ All') : '',
      h('button', { class: 'igb-tool', title: 'Open in a new tab', onclick: run(openItem) }, '↗')
    ];
  }
  // Lightbox: post data is already loaded
  IGB.mediaTools = (d, getIdx) => IGB.settings.downloadTools
    ? h('span', { class: 'igb-tools-inline' }, buttons(() => Promise.resolve(d), getIdx, d.items.length > 1)) : '';

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
      return code && { key: code, media, get: () => IGB.getPost(code), idx: () => IGB.activeSlide(art), multi: !!art.querySelector('[aria-current="step"]') };
    }
    if (onStory()) return { key: 'story:' + (storyId() || ''), media, get: storyPost, idx: () => 0, multi: false };
    const code = IGB.codeOf(location.pathname);
    const scope = media.closest('[role="dialog"], main') || document.body;
    if (code) return { key: code, media, get: () => IGB.getPost(code), idx: () => IGB.activeSlide(scope), multi: !!scope.querySelector('[aria-current="step"]') };
    return null;
  }

  // One floating bar, moved over whichever media the mouse is on
  const GAP = 8;
  let bar = null, cur = null, mx = -1, my = -1, raf = 0;
  function place() {
    raf = 0;
    if (!IGB.settings.downloadTools || document.documentElement.hasAttribute('data-igb-lb')) return hide();
    if (bar && bar.contains(document.elementFromPoint(mx, my))) return;
    let c = contextAt(mx, my);
    // The bar sits just outside the media's right edge: keep it while the mouse crosses the gap
    if (!c && cur?.media.isConnected) {
      const r = cur.media.getBoundingClientRect();
      if (mx >= r.left && mx <= r.right + GAP + 40 && my >= r.top && my <= r.bottom) c = cur;
    }
    if (!c) return hide();
    if (!bar) { bar = h('div', { class: 'igb-root igb-tools' }); document.body.append(bar); }
    if (!cur || cur.key !== c.key || cur.media !== c.media) {
      bar.replaceChildren(...buttons(c.get, c.idx, c.multi));
      c.get().catch(() => {}); // warm the data so the click is instant
    }
    cur = c;
    // A column beside the media's top-right corner, off the picture; inside the edge only if
    // there's no room on the right (media running to the window edge).
    const r = c.media.getBoundingClientRect();
    bar.hidden = false;
    const w = bar.offsetWidth || 36;
    const x = r.right + GAP + w <= innerWidth ? r.right + GAP : r.right - w - GAP;
    bar.style.transform = `translate(${Math.round(x)}px, ${Math.round(Math.max(r.top, 0) + GAP)}px)`;
  }
  function hide() { if (bar) bar.hidden = true; cur = null; }
  addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; if (!raf) raf = requestAnimationFrame(place); }, { passive: true });
  addEventListener('scroll', () => { if (!raf && mx >= 0) raf = requestAnimationFrame(place); }, { passive: true, capture: true });

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
