/* Image lightbox: wheel to move between images (and on to the next post), click outside to close */
(() => {
  const h = (...a) => RBE.h(...a);
  let lb = null; // current instance

  // Which feed posts the lightbox steps through: all | media (images + videos) | images
  const which = () => RBE.settings.lightboxPosts || 'all';
  const isVideoPostEl = el => /video/i.test(el.getAttribute('post-type') || '') || !!el.querySelector('shreddit-player-2, shreddit-player');
  function wantPostEl(el) {
    const w = which();
    if (w === 'images') return RBE.isMediaPostEl(el);
    if (w === 'media') return RBE.isMediaPostEl(el) || isVideoPostEl(el);
    return !!el.getAttribute('permalink');
  }
  const MEDIA_TYPES = { images: ['image', 'mp4'], media: ['image', 'mp4', 'rvideo', 'embed'], all: ['image', 'mp4', 'rvideo', 'embed'] };
  // Lightbox items for a post from the API: its media, or a text card for text/link posts
  function postItems(d) {
    const { items } = RBE.extractMedia(d);
    const media = items.filter(i => MEDIA_TYPES[which()]?.includes(i.type) ?? true);
    if (media.length) return media;
    if (which() !== 'all') return [];
    return [{ type: 'text', link: items.find(i => i.type === 'link') || null }];
  }
  // Post body HTML (API data, or what the feed card shows)
  function bodyHtml(e) {
    const d = e.data || {};
    const src = (d.crosspost_parent_list && d.crosspost_parent_list[0]) || d;
    if (src.selftext_html) return RBE.sanitize(src.selftext_html);
    const slot = e.el?.querySelector('[slot="text-body"]');
    return slot ? RBE.sanitize(slot.innerHTML) : '';
  }

  function collectFeed() {
    const seen = new Set(), out = [];
    document.querySelectorAll('shreddit-post').forEach(el => {
      if (!wantPostEl(el)) return;
      if (RBE.settings.nsfwMode === 'hide' && RBE.isNsfwEl(el)) return;
      const id = RBE.postIdOf(el);
      if (!id || seen.has(id)) return;
      seen.add(id);
      out.push({ id, el });
    });
    return out;
  }

  // Image URLs from a feed post's own markup (used when Reddit's JSON API refuses us)
  function bestSrc(img) {
    const set = img.getAttribute('srcset') || img.getAttribute('data-lazy-srcset') || '';
    let best = img.getAttribute('src') || img.getAttribute('data-lazy-src') || '', bw = 0;
    set.split(',').forEach(part => {
      const [u, w] = part.trim().split(/\s+/);
      const n = parseInt(w) || 0;
      if (u && n >= bw) { bw = n; best = u; }
    });
    return best.replace(/&amp;/g, '&');
  }
  function fullRes(u) {
    // preview.redd.it/<file>?width=... -> i.redd.it/<file> (original size)
    const m = u.match(/^https?:\/\/preview\.redd\.it\/([^?]+\.(?:jpe?g|png|webp|gif))/i);
    return m ? 'https://i.redd.it/' + m[1] : u;
  }
  function domItems(el) {
    const out = [], seen = new Set();
    const add = u => {
      if (!u || u.startsWith('data:')) return;
      const full = fullRes(u), key = full.split('?')[0];
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ type: 'image', src: full, thumb: u });
    };
    const player = which() !== 'images' && el.querySelector('shreddit-player-2, shreddit-player');
    const hls = player && (player.getAttribute('src') || '');
    if (hls) return [{ type: 'rvideo', hls: hls.replace(/&amp;/g, '&'), fallback: '', poster: player.getAttribute('poster') || '' }];
    const gallery = el.querySelector('gallery-carousel');
    if (gallery) gallery.querySelectorAll('li img').forEach(i => add(bestSrc(i)));
    const href = el.getAttribute('content-href') || '';
    if (!out.length && /i\.redd\.it|\.(jpe?g|png|webp|gif)(\?|$)/i.test(href)) add(href);
    if (!out.length) el.querySelectorAll('img').forEach(i => { const s = bestSrc(i); if (/\/\/(i|preview)\.redd\.it\//.test(s)) add(s); });
    if (!out.length && which() === 'all') {
      const link = href && !/reddit\.com\//.test(href) ? { type: 'link', url: href, domain: new URL(href, location.origin).hostname } : null;
      return [{ type: 'text', link }];
    }
    return out;
  }

  RBE.openLightbox = function ({ postId, postData, postEl, index = 0, scope }) {
    if (lb) lb.close();
    const s = RBE.settings;
    scope = scope || s.lightboxScope;
    let entries;
    if (scope === 'feed' && !postData) {
      entries = collectFeed();
      if (!entries.some(e => e.id === postId)) {
        if (postEl) {
          // clicked post isn't one the lightbox would step to (e.g. a text post in "images only"): slot it in place
          const all = [...document.querySelectorAll('shreddit-post')];
          const at = all.indexOf(postEl);
          const after = entries.findIndex(e => all.indexOf(e.el) > at);
          entries.splice(after === -1 ? entries.length : after, 0, { id: postId, el: postEl, forceText: true });
        } else entries = [{ id: postId }];
      }
    } else {
      if (postData) RBE.cachePost(postData);
      entries = [{ id: postId || postData.name }];
    }
    const start = Math.max(0, entries.findIndex(e => e.id === (postId || postData?.name)));
    lb = (s.lightboxStyle === 'strip' ? new Strip(entries, start, index, scope) : new Stepper(entries, start, index, scope));
    return lb;
  };
  RBE.lightboxOpen = () => !!lb;
  RBE.closeLightbox = () => lb && lb.close();

  // ---------------- shared ----------------
  class Base {
    constructor(entries, pi, ii, scope) {
      this.entries = entries; this.pi = pi; this.ii = ii; this.scope = scope;
      this.root = h('div', { class: 'rbe-root rbe-lb', tabindex: '-1' });
      if (RBE.settings.lightboxPosts !== 'images') RBE.loadHls?.();
      this.onKey = this.onKey.bind(this);
      document.documentElement.append(this.root);
      document.documentElement.classList.add('rbe-noscroll');
      // Page videos stop and may not restart while we're open (main-world.js watches this attribute)
      document.documentElement.setAttribute('data-rbe-lb', '');
      document.querySelectorAll('video').forEach(v => { if (!v.closest('.rbe-root') && !v.paused) v.pause(); });
      this.startPi = pi;
      this.savedScroll = window.scrollY;
      window.addEventListener('keydown', this.onKey, true);
      this.root.focus({ preventScroll: true });
    }
    async items(pi) {
      const e = this.entries[pi];
      if (!e) return [];
      if (!e.items) {
        try {
          // prefetch a window of posts in one request
          const ids = this.entries.slice(Math.max(0, pi - 2), pi + 8).map(x => x.id);
          await RBE.getPosts(ids);
          const d = await RBE.getPost(e.id);
          e.data = d;
          e.items = d ? postItems(d) : [];
        } catch (err) {
          console.warn('[RBE]', err);
        }
        // API blocked or empty: read the images from the post on the page
        if (!e.items?.length && e.el) {
          const items = domItems(e.el);
          if (items.length) {
            e.items = items;
            e.data = e.data || {
              title: e.el.getAttribute('post-title') || '',
              permalink: e.el.getAttribute('permalink'),
              subreddit_name_prefixed: e.el.getAttribute('subreddit-prefixed-name') || '',
              author: e.el.getAttribute('author') || '',
              created_utc: Date.parse(e.el.getAttribute('created-timestamp') || '') / 1000 || 0,
            };
          }
        }
        if (!e.items?.length && e.forceText && (e.data || e.el)) {
          e.items = [{ type: 'text', link: null }];
          e.data = e.data || { title: e.el?.getAttribute('post-title') || '', permalink: e.el?.getAttribute('permalink') };
        }
        if (!e.items?.length) { e.items = null; return []; } // don't cache: a retry may work
      }
      return e.items;
    }
    async moreFeed() {
      if (this.scope !== 'feed') return false;
      const before = this.entries.length;
      window.scrollTo(0, document.documentElement.scrollHeight);   // make Reddit load more posts behind the overlay
      for (let i = 0; i < 12; i++) {
        await new Promise(r => setTimeout(r, 400));
        const fresh = collectFeed();
        const have = new Set(this.entries.map(e => e.id));
        fresh.forEach(f => { if (!have.has(f.id)) this.entries.push(f); });
        if (this.entries.length > before) return true;
      }
      return false;
    }
    onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); this.close(); }
    }
    openPost() {
      const e = this.entries[this.pi];
      const link = e?.data?.permalink || e?.el?.getAttribute('permalink');
      if (!link) return;
      this.close();
      // in lightbox post mode, comments open in the modal (otherwise we'd reopen the lightbox)
      const mode = RBE.settings.viewerMode === 'lightbox' ? 'modal' : undefined;
      if (RBE.openViewer && RBE.settings.viewerMode !== 'off') RBE.openViewer(link, e.el, mode);
      else location.href = link;
    }
    close() {
      window.removeEventListener('keydown', this.onKey, true);
      RBE.destroyVideos(this.root);
      this.root.remove();
      document.documentElement.removeAttribute('data-rbe-lb');
      if (!document.querySelector('.rbe-modal-open, .rbe-viewer.modal')) document.documentElement.classList.remove('rbe-noscroll');
      // moreFeed() scrolls the page behind the overlay to load posts; undo that.
      // Land on the post being viewed if it changed, else where the user was.
      const cur = this.entries[this.pi]?.el;
      if (this.pi !== this.startPi && cur?.isConnected) cur.scrollIntoView({ block: 'center', behavior: 'instant' });
      else window.scrollTo({ top: this.savedScroll, behavior: 'instant' });
      if (lb === this) lb = null;
    }
    mediaEl(item, cls, e) {
      if (item.type === 'rvideo') {
        const v = h('video', { class: cls + ' rbe-lb-video', poster: item.poster || null });
        RBE.attachRedditVideo(v, item);
        RBE.setupOwnVideo(v);
        return v;
      }
      if (item.type === 'embed') {
        return h('div', { class: cls + ' rbe-lb-embed', style: { aspectRatio: item.w && item.h ? `${item.w} / ${item.h}` : '16 / 9' } },
          h('iframe', { src: item.src, allow: 'autoplay; fullscreen; encrypted-media; picture-in-picture', allowfullscreen: true, referrerpolicy: 'no-referrer-when-downgrade' }));
      }
      if (item.type === 'text') {
        const d = e?.data || {}, body = e ? bodyHtml(e) : '';
        const l = item.link;
        return h('div', { class: 'rbe-lb-textcard' },
          h('h2', { dir: 'auto' }, d.title || ''),
          l ? h('a', { class: 'rbe-linkcard', href: l.url, target: '_blank', rel: 'noopener noreferrer' },
            l.thumb ? h('img', { src: l.thumb }) : null,
            h('div', null, h('div', { class: 'rbe-linkcard-domain' }, l.domain || ''), h('div', { class: 'rbe-linkcard-url' }, l.url))) : null,
          body ? h('div', { class: 'md rbe-lb-body', dir: 'auto', html: body }) : (l ? null : h('div', { class: 'rbe-muted' }, 'No text.')));
      }
      if (item.type === 'mp4') {
        const v = h('video', { class: cls + (cls === 'rbe-lb-media' ? ' rbe-lb-video' : ''), src: item.src, poster: item.thumb || null, loop: true, playsinline: true, muted: true });
        v.muted = true; v.autoplay = true; v.play().catch(() => {});
        return v;
      }
      const img = h('img', { class: cls, src: item.src, alt: item.caption || '', draggable: 'false', decoding: 'async' });
      img.addEventListener('error', function onErr() {
        // full-size URL failed: try the smaller preview before giving up
        if (item.thumb && img.getAttribute('src') !== item.thumb) { img.src = item.thumb; return; }
        img.removeEventListener('error', onErr);
        if (!img.isConnected) return;
        img.replaceWith(h('div', { class: 'rbe-lb-err' }, 'Image failed to load. ', h('a', { href: item.src, target: '_blank', rel: 'noopener' }, 'Open original ↗')));
      });
      return img;
    }
  }

  // ---------------- step mode ----------------
  class Stepper extends Base {
    constructor(...a) {
      super(...a);
      this.root.classList.add('step');
      this.stage = h('div', { class: 'rbe-lb-stage' });
      this.title = h('a', { class: 'rbe-lb-title', href: '#', title: 'Open post', onclick: e => { e.preventDefault(); this.openPost(); } });
      this.meta = h('span', { class: 'rbe-lb-meta' });
      this.counter = h('span', { class: 'rbe-lb-count' });
      this.orig = h('a', { class: 'rbe-btn', target: '_blank', rel: 'noopener', title: 'Open original' }, '↗');
      this.caption = h('div', { class: 'rbe-lb-caption' });
      this.film = h('div', { class: 'rbe-lb-film' });
      this.sideOn = RBE.settings.lightboxText !== false;
      this.side = h('aside', { class: 'rbe-lb-side' });
      const bar = h('div', { class: 'rbe-lb-bar' },
        this.subIcon = h('span', { class: 'rbe-lb-subicon' }),
        h('div', { class: 'rbe-lb-info' }, this.title, this.meta),
        this.counter, this.orig,
        RBE.embedButton(() => { const e = this.entries[this.pi]; return e?.data?.permalink || e?.el?.getAttribute('permalink'); }),
        h('button', { class: 'rbe-btn', title: 'Show/hide post text (T)', onclick: () => this.toggleSide() }, '📝'),
        h('button', { class: 'rbe-btn', title: 'Open post + comments', onclick: () => this.openPost() }, '💬'),
        h('button', { class: 'rbe-btn', title: 'Close (Esc)', onclick: () => this.close() }, '✕'));
      const prev = h('button', { class: 'rbe-lb-nav prev', title: 'Previous', onclick: () => this.step(-1) }, '‹');
      const next = h('button', { class: 'rbe-lb-nav next', title: 'Next', onclick: () => this.step(1) }, '›');
      this.stageWrap = h('div', { class: 'rbe-lb-stagewrap' }, this.stage, prev, next);
      this.root.append(bar, h('div', { class: 'rbe-lb-main' }, this.stageWrap, this.side), this.caption, this.film);
      this.root.addEventListener('click', e => { if (e.target === this.root || e.target === this.stage || e.target === this.stageWrap) this.close(); });
      this.root.addEventListener('wheel', e => this.onWheel(e), { passive: false });
      this.initPanZoom();
      this.show();
    }
    toggleSide() { this.sideOn = !this.sideOn; this.sidePost = null; this.renderSide(); }
    renderSide() {
      const e = this.entries[this.pi], item = this.curItem;
      const d = e?.data || {};
      const body = e && item && item.type !== 'text' ? bodyHtml(e) : '';
      const permalink = d.permalink || e?.el?.getAttribute('permalink');
      const comments = RBE.settings.lightboxComments !== false && permalink && RBE.renderCommentsInto;
      const show = this.sideOn && !!item && (!!body || !!comments);
      this.side.hidden = !show;
      if (!show) { this.sidePost = null; return this.side.replaceChildren(); }
      if (this.sidePost === permalink) return; // same post (e.g. next image in a gallery): keep panel + scroll
      this.sidePost = permalink;
      const flair = d.link_flair_text ? h('span', { class: 'rbe-flair' }, d.link_flair_text) : null;
      const commentBox = comments ? h('div', { class: 'rbe-lb-comments' }) : null;
      this.side.replaceChildren(...[
        h('div', { class: 'rbe-lb-who' },
          RBE.subAvatar(d.subreddit || (d.subreddit_name_prefixed || '').replace(/^r\//, ''), { size: 28 }, d.sr_detail),
          h('div', null,
            h('a', { href: '/' + (d.subreddit_name_prefixed || ''), class: 'rbe-lb-who-sub' }, d.subreddit_name_prefixed || ''),
            d.author ? h('div', { class: 'rbe-lb-who-user' }, RBE.userAvatar(d.author, d.author_fullname, { size: 16 }), h('a', { href: '/user/' + d.author + '/' }, 'u/' + d.author)) : null)),
        item.type !== 'text' ? h('h3', { dir: 'auto' }, d.title || '', ' ', flair) : null,
        body ? h('div', { class: 'md rbe-lb-body', dir: 'auto', html: body }) : null,
        d.score != null ? h('div', { class: 'rbe-lb-stats' }, `▲ ${RBE.num(d.score)}  ·  💬 ${RBE.num(d.num_comments)}`) : null,
        commentBox].filter(Boolean));
      this.side.scrollTop = 0;
      if (commentBox) RBE.renderCommentsInto(commentBox, permalink);
    }
    // Text areas scroll natively until they hit an end; then the wheel steps posts
    scrollsNatively(e) {
      const el = e.target.closest?.('.rbe-lb-side, .rbe-lb-textcard');
      if (!el || el.scrollHeight <= el.clientHeight + 1) return false;
      return e.deltaY > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0;
    }
    onWheel(e) {
      if (!e.ctrlKey && this.zoom <= 1 && this.scrollsNatively(e)) { this.acc = 0; this.lastStep = Date.now(); return; }
      e.preventDefault();
      if (e.ctrlKey || this.zoom > 1) { this.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); return; }
      if (e.target.closest('.rbe-lb-film')) { this.film.scrollLeft += e.deltaY; return; }
      this.acc = (this.acc || 0) + e.deltaY;
      const now = Date.now();
      if (Math.abs(this.acc) < 30 || now - (this.lastStep || 0) < 160) return;
      this.lastStep = now;
      const dir = this.acc > 0 ? 1 : -1;
      this.acc = 0;
      this.step(dir);
    }
    onKey(e) {
      super.onKey(e);
      if (!this.root.isConnected) return;
      const k = e.key;
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'd', 'j'].includes(k)) { e.preventDefault(); e.stopImmediatePropagation(); this.step(1); }
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'a', 'k'].includes(k)) { e.preventDefault(); e.stopImmediatePropagation(); this.step(-1); }
      else if (k === 'c' || k === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); this.openPost(); }
      else if (k === 't') { e.preventDefault(); e.stopImmediatePropagation(); this.toggleSide(); }
    }
    async step(dir) {
      if (this.busy) return;
      this.busy = true;
      try {
        let pi = this.pi, ii = this.ii + dir;
        let items = await this.items(pi);
        for (let guard = 0; guard < 30; guard++) {
          if (ii >= 0 && ii < items.length) break;
          pi += dir;
          if (pi >= this.entries.length && !(await this.moreFeed())) { RBE.toast('End of loaded feed'); return; }
          if (pi < 0) { RBE.toast('First image'); return; }
          items = await this.items(pi);
          ii = dir > 0 ? 0 : items.length - 1;
        }
        if (pi !== this.pi) this.entries[this.pi]?.el?.classList.remove('rbe-lb-current');
        this.pi = pi; this.ii = ii;
        await this.show();
      } finally { this.busy = false; }
    }
    async show() {
      const items = await this.items(this.pi);
      if (!items.length) {
        // Don't auto-skip: that can run off the feed and scroll the page to the bottom
        const e = this.entries[this.pi], link = e?.data?.permalink || e?.el?.getAttribute('permalink');
        this.media = null;
        this.stage.replaceChildren(h('div', { class: 'rbe-lb-err' }, 'Couldn’t load this post. ',
          link ? h('a', { href: link, onclick: ev => { ev.preventDefault(); this.openPost(); } }, 'Open post') : null));
        this.counter.textContent = ''; this.caption.hidden = true; this.film.hidden = true;
        this.curItem = null; this.renderSide();
        return;
      }
      this.ii = Math.min(this.ii, items.length - 1);
      const item = items[this.ii], e = this.entries[this.pi], d = e.data || {};
      RBE.destroyVideos(this.stage);
      this.resetZoom();
      this.curItem = item;
      this.media = this.mediaEl(item, 'rbe-lb-media', e);
      this.stage.replaceChildren(this.media);
      this.root.classList.toggle('is-text', item.type === 'text');
      this.renderSide();
      // landing on a long text card: don't let leftover wheel momentum skip past it
      if (item.type === 'text') this.lastStep = Date.now() + 250;
      this.title.textContent = d.title || '';
      const subName = d.subreddit || (d.subreddit_name_prefixed || '').replace(/^r\//, '');
      if (this.subIcon.dataset.sub !== subName) {
        this.subIcon.dataset.sub = subName;
        this.subIcon.replaceChildren(subName ? RBE.subAvatar(subName, { size: 32 }, d.sr_detail) : '');
      }
      this.meta.textContent = [d.subreddit_name_prefixed, d.author && 'u/' + d.author, d.created_utc && RBE.ago(d.created_utc)].filter(Boolean).join(' · ');
      this.counter.textContent = [items.length > 1 && `${this.ii + 1}/${items.length}`, this.entries.length > 1 && `post ${this.pi + 1}/${this.entries.length}`].filter(Boolean).join('  ·  ');
      this.orig.href = item.src || item.link?.url || 'https://www.reddit.com' + (d.permalink || e.el?.getAttribute('permalink') || '');
      this.caption.textContent = item.caption || '';
      this.caption.hidden = !item.caption;
      // filmstrip
      this.film.hidden = !(RBE.settings.lightboxFilmstrip && items.length > 1);
      if (!this.film.hidden) {
        this.film.replaceChildren(...items.map((it, i) => h('img', {
          src: it.thumb || it.src, class: i === this.ii ? 'on' : '', loading: 'lazy',
          onclick: ev => { ev.stopPropagation(); this.ii = i; this.show(); }
        })));
        this.film.children[this.ii]?.scrollIntoView({ inline: 'center', block: 'nearest' });
      }
      // highlight + keep the feed in sync
      e.el?.classList.add('rbe-lb-current');
      // preload next
      const nx = items[this.ii + 1];
      if (nx && nx.type === 'image') { const p = new Image(); p.src = nx.src; }
      else if (!nx) this.items(this.pi + 1).then(n => { if (n[0]?.type === 'image') { const p = new Image(); p.src = n[0].src; } }).catch(() => {});
    }
    // ---- zoom & pan ----
    initPanZoom() {
      this.zoom = 1; this.tx = 0; this.ty = 0;
      let down = null;
      this.stage.addEventListener('pointerdown', e => {
        if (e.target !== this.media || this.media.tagName !== 'IMG') return;
        down = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty, moved: false };
        this.media.setPointerCapture(e.pointerId);
      });
      this.stage.addEventListener('pointermove', e => {
        if (!down) return;
        const dx = e.clientX - down.x, dy = e.clientY - down.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) down.moved = true;
        if (this.zoom > 1 && down.moved) { this.tx = down.tx + dx; this.ty = down.ty + dy; this.applyZoom(); }
      });
      this.stage.addEventListener('pointerup', e => {
        if (!down) return;
        const wasClick = !down.moved; down = null;
        if (wasClick && e.target === this.media) {
          if (this.zoom > 1) this.resetZoom(); else this.zoomBy(2.2, e.clientX, e.clientY);
        }
      });
    }
    zoomBy(f, cx, cy) {
      if (!this.media || this.media.tagName !== 'IMG') return;
      const nz = Math.min(8, Math.max(1, this.zoom * f));
      const r = this.stage.getBoundingClientRect();
      const ox = cx - (r.left + r.width / 2), oy = cy - (r.top + r.height / 2);
      this.tx = ox - (ox - this.tx) * (nz / this.zoom);
      this.ty = oy - (oy - this.ty) * (nz / this.zoom);
      this.zoom = nz;
      if (nz === 1) { this.tx = 0; this.ty = 0; }
      this.applyZoom();
    }
    resetZoom() { this.zoom = 1; this.tx = 0; this.ty = 0; this.applyZoom(); }
    applyZoom() {
      this.root.classList.toggle('zoomed', this.zoom > 1);
      if (!this.media || this.media.tagName !== 'IMG') return;
      this.media.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.zoom})`;
    }
    close() { this.entries[this.pi]?.el?.classList.remove('rbe-lb-current'); super.close(); }
  }

  // ---------------- strip mode (vertical scrolling) ----------------
  class Strip extends Base {
    constructor(...a) {
      super(...a);
      this.root.classList.add('strip');
      this.col = h('div', { class: 'rbe-lb-col' });
      this.sentinel = h('div', { class: 'rbe-lb-sentinel' }, 'Loading…');
      this.col.append(this.sentinel);
      const close = h('button', { class: 'rbe-btn rbe-lb-close', title: 'Close (Esc)', onclick: () => this.close() }, '✕');
      this.root.append(this.col, close);
      this.root.addEventListener('click', e => { if (e.target === this.root || e.target === this.col || e.target.classList.contains('rbe-lb-post')) this.close(); });
      this.next = this.pi;
      this.firstJump = true;
      this.io = new IntersectionObserver(es => { if (es.some(x => x.isIntersecting)) this.loadMore(); }, { root: this.root, rootMargin: '1200px' });
      this.io.observe(this.sentinel);
    }
    async loadMore() {
      if (this.loading) return;
      this.loading = true;
      try {
        for (let n = 0; n < 4; n++) {
          if (this.next >= this.entries.length && !(await this.moreFeed())) { this.sentinel.textContent = this.scope === 'feed' ? 'End of loaded feed' : ''; this.io.disconnect(); return; }
          const pi = this.next++;
          const items = await this.items(pi);
          if (!items.length) continue;
          const ent = this.entries[pi], d = ent.data || {};
          const isText = items[0].type === 'text';
          const body = !isText && RBE.settings.lightboxText !== false ? bodyHtml(ent) : '';
          const sec = h('section', { class: 'rbe-lb-post' },
            h('a', { class: 'rbe-lb-title', href: '#', onclick: e => { e.preventDefault(); this.pi = pi; this.openPost(); } }, d.title || ''),
            h('div', { class: 'rbe-lb-meta' }, [d.subreddit_name_prefixed, items.length > 1 && items.length + ' items'].filter(Boolean).join(' · ')),
            body ? h('div', { class: 'md rbe-lb-body' , html: body }) : null,
            items.map(it => h('figure', null, this.mediaEl(it, 'rbe-lb-media', ent), it.caption ? h('figcaption', null, it.caption) : null)));
          if (it_isFirst(this)) sec.classList.add('first');
          this.col.insertBefore(sec, this.sentinel);
          if (this.firstJump) {
            this.firstJump = false;
            const fig = sec.querySelectorAll('figure')[this.ii];
            if (fig && this.ii > 0) requestAnimationFrame(() => fig.scrollIntoView({ block: 'start' }));
          }
        }
      } finally { this.loading = false; }
      function it_isFirst(self) { return !self.col.querySelector('.rbe-lb-post'); }
    }
    close() { this.io?.disconnect(); super.close(); }
  }
})();
