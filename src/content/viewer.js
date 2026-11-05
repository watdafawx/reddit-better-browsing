/* In-page post + comments viewer (side panel / modal / inline) */
(() => {
  const h = (...a) => RBE.h(...a);
  const SORTS = [['confidence', 'Best'], ['top', 'Top'], ['new', 'New'], ['controversial', 'Controversial'], ['old', 'Old'], ['qa', 'Q&A']];

  // ---------- data ----------
  function jsonUrl(permalink, sort) {
    const u = new URL(permalink, location.origin);
    const path = u.pathname.replace(/\/+$/, '');
    return `${path}.json?raw_json=1&sr_detail=1&limit=500&depth=12&sort=${encodeURIComponent(sort)}`;
  }
  // Short-lived cache: hover prefetch, the lightbox comment panel and the viewer share one request.
  const THREAD_TTL = 90e3, THREAD_MAX = 25;
  const threads = new Map(); // url -> { at, p }
  function loadThread(permalink, sort) {
    const url = jsonUrl(permalink, sort);
    const hit = threads.get(url);
    if (hit && Date.now() - hit.at < THREAD_TTL) return hit.p;
    const p = RBE.getJSON(url).then(j => {
      const post = j[0].data.children[0].data;
      RBE.cachePost(post);
      return { post, comments: j[1].data.children };
    });
    threads.set(url, { at: Date.now(), p });
    p.catch(() => { if (threads.get(url)?.p === p) threads.delete(url); }); // never cache failures
    if (threads.size > THREAD_MAX) threads.delete(threads.keys().next().value);
    return p;
  }

  // Prefetch a post's thread when the pointer rests on it or presses it, so the viewer opens instantly.
  // One prefetch in flight at a time to stay well clear of Reddit's rate limit.
  let prefetching = false, hoverTimer = 0, hoverKey = '';
  function prefetch(permalink) {
    const m = RBE.settings.viewerMode;
    if (!permalink || m === 'off' || m === 'lightbox' || !RBE.isCommentsUrl(permalink)) return;
    const url = jsonUrl(permalink, RBE.settings.commentSort);
    const hit = threads.get(url);
    if (hit && Date.now() - hit.at < THREAD_TTL) return;
    if (prefetching) return;
    prefetching = true;
    loadThread(permalink, RBE.settings.commentSort).catch(() => {}).finally(() => { prefetching = false; });
  }
  function targetLink(e) {
    for (const n of e.composedPath()) {
      if (n.nodeType !== 1) continue;
      if (n.classList?.contains('rbe-root') && !n.classList.contains('rbe-viewer')) return '';
      if (n.tagName === 'A' && n.href && RBE.isCommentsUrl(n.href)) return new URL(n.href).pathname;
      if (n.tagName === 'SHREDDIT-POST') return n.getAttribute('permalink') || '';
    }
    return '';
  }
  document.addEventListener('pointerover', e => {
    if (e.pointerType === 'touch') return;
    const link = targetLink(e);
    if (link === hoverKey) return;
    hoverKey = link;
    clearTimeout(hoverTimer);
    if (link) hoverTimer = setTimeout(() => prefetch(link), 300);
  }, { passive: true });
  document.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const link = targetLink(e);
    if (link) { prefetching = false; prefetch(link); } // the click is coming: don't wait behind a hover prefetch
  }, { capture: true, passive: true });
  const isFocused = permalink => /\/comments\/[a-z0-9]+\/[^/]*\/[a-z0-9]+\/?$/i.test(new URL(permalink, location.origin).pathname);

  // ---------- post rendering ----------
  function blurWrap(node, d) {
    const s = RBE.settings;
    const nsfw = d.over_18 && s.nsfwMode === 'blur';
    const spoil = d.spoiler && !s.revealSpoilers;
    if (!nsfw && !spoil) return node;
    const w = h('div', { class: 'rbe-nsfw-blur' }, node, h('div', { class: 'rbe-blur-label' }, nsfw ? 'NSFW — click to show' : 'Spoiler — click to show'));
    w.addEventListener('click', e => {
      if (w.classList.contains('rbe-unblurred')) return;
      e.preventDefault(); e.stopPropagation(); w.classList.add('rbe-unblurred');
    }, true);
    return w;
  }

  function renderMedia(d, { skipVisual = false } = {}) {
    const { items, kind } = RBE.extractMedia(d);
    if (!items.length) return null;
    if (skipVisual && kind !== 'link' && kind !== 'embed') return null;
    let node;
    const openLb = i => RBE.openLightbox({ postData: d, index: i, scope: 'post' });
    if (kind === 'gallery' || kind === 'image') {
      if (items.length === 1) {
        const it = items[0];
        node = it.type === 'mp4'
          ? h('video', { class: 'rbe-media rbe-media-single', src: it.src, poster: it.thumb || null, loop: true, muted: true, playsinline: true })
          : h('img', { class: 'rbe-media rbe-media-single', src: it.src, loading: 'lazy', onclick: () => openLb(0) });
        if (it.type === 'mp4') { node.muted = true; node.play().catch(() => {}); node.addEventListener('click', () => openLb(0)); }
      } else {
        node = h('div', { class: 'rbe-gallery' },
          items.map((it, i) => h('figure', { onclick: () => openLb(i) },
            h('img', { class: 'rbe-media', src: it.type === 'mp4' ? it.thumb : (it.w > 1400 ? (it.thumb || it.src) : it.src), loading: 'lazy' }),
            h('span', { class: 'rbe-gallery-n' }, `${i + 1}/${items.length}`),
            it.caption ? h('figcaption', null, it.caption) : null)));
        // gallery: use full-res images (thumbs are tiny for big ones) once visible
        node.querySelectorAll('img').forEach((img, i) => { if (items[i].type === 'image') img.src = items[i].src; });
      }
    } else if (kind === 'video') {
      const it = items[0];
      const v = h('video', { class: 'rbe-media rbe-video', poster: it.poster || it.thumb || null });
      if (it.type === 'rvideo') RBE.attachRedditVideo(v, it); else v.src = it.src;
      if (it.w && it.h) v.style.aspectRatio = `${it.w} / ${it.h}`;
      RBE.setupOwnVideo(v);
      node = v;
    } else if (kind === 'embed') {
      const it = items[0];
      node = h('div', { class: 'rbe-embed', style: { aspectRatio: it.w && it.h ? `${it.w} / ${it.h}` : '16 / 9' } },
        h('iframe', { src: it.src, allow: 'autoplay; fullscreen; encrypted-media; picture-in-picture', allowfullscreen: true, loading: 'lazy', referrerpolicy: 'no-referrer-when-downgrade' }));
    } else if (kind === 'link') {
      const it = items[0];
      node = h('a', { class: 'rbe-linkcard', href: it.url, target: '_blank', rel: 'noopener noreferrer' },
        it.thumb ? h('img', { src: it.thumb, loading: 'lazy' }) : null,
        h('div', null, h('div', { class: 'rbe-linkcard-domain' }, it.domain || new URL(it.url).hostname), h('div', { class: 'rbe-linkcard-url' }, it.url)));
      return node;
    }
    return node ? blurWrap(node, d) : null;
  }

  function renderPost(d, opts = {}) {
    const src = (d.crosspost_parent_list && d.crosspost_parent_list[0]) || d;
    const flair = d.link_flair_text ? h('span', { class: 'rbe-flair', style: d.link_flair_background_color ? { background: d.link_flair_background_color, color: d.link_flair_text_color === 'light' ? '#fff' : '#111' } : null }, d.link_flair_text) : null;
    const body = src.selftext_html ? h('div', { class: 'md rbe-post-body', html: RBE.sanitize(src.selftext_html) }) : null;
    if (body && RBE.settings.revealSpoilers) body.querySelectorAll('.md-spoiler-text').forEach(x => x.classList.add('revealed'));
    let poll = null;
    if (src.poll_data) {
      const total = src.poll_data.total_vote_count || 0;
      poll = h('div', { class: 'rbe-poll' }, src.poll_data.options.map(o => {
        const pct = total && o.vote_count != null ? Math.round(o.vote_count / total * 100) : null;
        return h('div', { class: 'rbe-poll-opt' }, h('span', { class: 'rbe-poll-bar', style: { width: (pct || 0) + '%' } }), h('span', null, o.text), pct != null ? h('b', null, pct + '%') : null);
      }), h('div', { class: 'rbe-muted' }, RBE.num(total) + ' votes'));
    }
    return h('article', { class: 'rbe-post' },
      opts.inline ? null : h('div', { class: 'rbe-post-meta' },
        RBE.subAvatar(d.subreddit, { size: 24 }, d.sr_detail),
        h('a', { href: `/${d.subreddit_name_prefixed}/`, class: 'rbe-sub' }, d.subreddit_name_prefixed), ' · ',
        h('a', { href: `/user/${d.author}/`, class: 'rbe-author' }, 'u/' + d.author), ' · ',
        h('span', { title: new Date(d.created_utc * 1000).toLocaleString() }, RBE.ago(d.created_utc)),
        d.over_18 ? h('span', { class: 'rbe-tag nsfw' }, 'NSFW') : null,
        d.spoiler ? h('span', { class: 'rbe-tag' }, 'Spoiler') : null,
        d.stickied ? h('span', { class: 'rbe-tag mod' }, 'Pinned') : null),
      opts.inline ? null : h('h1', { class: 'rbe-post-title' }, d.title, ' ', flair),
      src !== d ? h('div', { class: 'rbe-muted rbe-xpost' }, 'Crossposted from ', h('a', { href: src.permalink }, src.subreddit_name_prefixed), ' by u/' + src.author) : null,
      renderMedia(d, { skipVisual: opts.inline }),
      body, poll,
      h('div', { class: 'rbe-post-stats' },
        h('span', null, '▲ ', RBE.num(d.score), d.upvote_ratio ? ` (${Math.round(d.upvote_ratio * 100)}%)` : ''),
        h('span', null, '💬 ', RBE.num(d.num_comments)),
        h('a', { href: 'https://www.reddit.com' + d.permalink, target: '_blank', rel: 'noopener', class: 'rbe-muted' }, 'Open on Reddit ↗'),
        h('button', { class: 'rbe-linkbtn', onclick: e => { navigator.clipboard.writeText('https://www.reddit.com' + d.permalink); e.target.textContent = 'Copied'; } }, 'Copy link'),
        RBE.embedButton(() => d.permalink, 'rbe-linkbtn')));
  }

  // ---------- comments ----------
  function renderComments(list, ctx, container) {
    for (const c of list) {
      if (c.kind === 't1') container.append(renderComment(c.data, ctx));
      else if (c.kind === 'more') container.append(renderMore(c.data, ctx));
    }
  }

  function renderComment(c, ctx) {
    const kids = h('div', { class: 'rbe-c-kids' });
    const isOp = c.author === ctx.post.author;
    const node = h('div', { class: 'rbe-c', 'data-id': c.name },
      h('div', { class: 'rbe-c-line', title: 'Collapse', onclick: () => toggle() }),
      h('div', { class: 'rbe-c-main' },
        h('div', { class: 'rbe-c-head', onclick: e => { if (!e.target.closest('a')) toggle(); } },
          RBE.userAvatar(c.author, c.author_fullname, { size: 22 }),
          h('a', { class: 'rbe-author' + (isOp ? ' op' : '') + (c.distinguished === 'moderator' ? ' mod' : '') + (c.distinguished === 'admin' ? ' admin' : ''), href: `/user/${c.author}/` }, c.author),
          isOp ? h('span', { class: 'rbe-tag op' }, 'OP') : null,
          c.distinguished === 'moderator' ? h('span', { class: 'rbe-tag mod' }, 'MOD') : null,
          c.author_flair_text ? h('span', { class: 'rbe-flair small' }, c.author_flair_text) : null,
          h('span', { class: 'rbe-muted' }, ' · ', c.score_hidden ? '[score hidden]' : RBE.num(c.score) + ' pts', ' · ',
            h('span', { title: new Date(c.created_utc * 1000).toLocaleString() }, RBE.ago(c.created_utc)), c.edited ? ' · edited' : ''),
          c.stickied ? h('span', { class: 'rbe-tag mod' }, 'Pinned') : null,
          h('span', { class: 'rbe-c-count rbe-muted' })),
        h('div', { class: 'md rbe-c-body', html: RBE.sanitize(c.body_html) }),
        h('div', { class: 'rbe-c-foot' },
          h('a', { href: 'https://www.reddit.com' + c.permalink, target: '_blank', rel: 'noopener' }, 'Reply on Reddit ↗'),
          h('button', { class: 'rbe-linkbtn', onclick: () => ctx.viewer && ctx.viewer.push(c.permalink) }, 'Focus thread')),
        kids));
    if (RBE.settings.revealSpoilers) node.querySelectorAll('.md-spoiler-text').forEach(x => x.classList.add('revealed'));
    node.querySelectorAll('.rbe-inline-img').forEach(img => img.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      RBE.openLightbox({ postData: { name: 'c_' + c.id, title: c.author + ': comment image', url: img.src, post_hint: 'image' }, scope: 'post' });
    }));
    function toggle() {
      const collapsed = node.classList.toggle('collapsed');
      if (collapsed) {
        const n = node.querySelectorAll('.rbe-c').length;
        node.querySelector('.rbe-c-count').textContent = n ? ` (+${n})` : '';
      }
    }
    if (c.replies && c.replies.data) renderComments(c.replies.data.children, ctx, kids);
    if (RBE.settings.collapseAutoMod && c.author === 'AutoModerator') toggle();
    return node;
  }

  function renderMore(m, ctx) {
    if (!m.children || !m.children.length || m.count === 0) {
      // "continue this thread"
      const parentId = (m.parent_id || '').replace(/^t1_/, '');
      return h('button', { class: 'rbe-more', onclick: () => ctx.viewer ? ctx.viewer.push(ctx.post.permalink + parentId + '/') : window.open(ctx.post.permalink + parentId + '/') }, 'Continue this thread →');
    }
    const btn = h('button', { class: 'rbe-more' }, `Load ${m.count} more repl${m.count === 1 ? 'y' : 'ies'}`);
    btn.addEventListener('click', async () => {
      btn.disabled = true; btn.textContent = 'Loading…';
      try {
        const ids = m.children.slice(0, 100), rest = m.children.slice(100);
        const j = await RBE.getJSON(`/api/morechildren.json?api_type=json&raw_json=1&link_id=${ctx.post.name}&sort=${ctx.sort}&children=${ids.join(',')}`);
        const things = j.json?.data?.things || [];
        const byName = new Map();
        const frag = document.createDocumentFragment();
        for (const t of things) {
          const el = t.kind === 't1' ? renderComment(t.data, ctx) : renderMore(t.data, ctx);
          if (t.kind === 't1') byName.set(t.data.name, el);
          const parent = byName.get(t.data.parent_id);
          if (parent) parent.querySelector(':scope > .rbe-c-main > .rbe-c-kids').append(el);
          else frag.append(el);
        }
        if (rest.length) frag.append(renderMore({ ...m, children: rest, count: rest.length }, ctx));
        btn.replaceWith(frag);
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Failed — retry'; console.warn('[RBE]', e);
      }
    });
    return btn;
  }

  function renderCommentSection(data, ctx, onSort) {
    const list = h('div', { class: 'rbe-comments' });
    const sel = h('select', { class: 'rbe-select', onchange: e => onSort(e.target.value) },
      SORTS.map(([v, l]) => h('option', { value: v, selected: v === ctx.sort ? true : null }, l)));
    const head = h('div', { class: 'rbe-comments-head' },
      h('b', null, RBE.num(data.post.num_comments) + ' comments'), h('span', { class: 'rbe-grow' }), 'Sort ', sel);
    const focus = isFocused(ctx.permalink)
      ? h('div', { class: 'rbe-focus-note' }, 'Showing a single thread. ', h('button', { class: 'rbe-linkbtn', onclick: () => ctx.viewer && ctx.viewer.push(data.post.permalink) }, 'View all comments'))
      : null;
    renderComments(data.comments, ctx, list);
    if (!list.children.length) list.append(h('div', { class: 'rbe-muted rbe-empty' }, 'No comments yet.'));
    return h('section', null, head, focus, list);
  }

  // ---------- keep the feed still when the viewer closes ----------
  // Closing the side panel widens the feed (posts reflow) and history.back() can restore an
  // old scroll position. Pin a visible post to its current screen position until things settle.
  function visibleRect(el) {
    if (!el || !el.isConnected) return null;
    const r = el.getBoundingClientRect();
    return r.height && r.bottom > 0 && r.top < window.innerHeight ? r : null;
  }
  function capturePin(prefer) {
    const el = visibleRect(prefer) ? prefer : [...document.querySelectorAll('shreddit-post')].find(p => visibleRect(p));
    return el ? { el, top: el.getBoundingClientRect().top } : null;
  }
  function holdPin(pin) {
    if (!pin) return;
    const end = performance.now() + 700;
    const evs = ['wheel', 'touchstart', 'keydown', 'pointerdown'];
    let stopped = false;
    const cancel = () => { stopped = true; };
    evs.forEach(t => window.addEventListener(t, cancel, { capture: true, passive: true }));
    const tick = () => {
      if (!stopped && pin.el.isConnected) {
        const d = pin.el.getBoundingClientRect().top - pin.top;
        if (Math.abs(d) > 1) window.scrollTo({ top: window.scrollY + d, behavior: 'instant' });
        if (performance.now() < end) return requestAnimationFrame(tick);
      }
      evs.forEach(t => window.removeEventListener(t, cancel, true));
    };
    requestAnimationFrame(tick);
  }

  // ---------- panel viewer (side / modal) ----------
  let current = null;
  let historyPushed = false, swallowPop = false, savedScrollMode = null;

  class Panel {
    constructor(mode) {
      this.mode = mode;
      this.stack = [];
      RBE.loadHls?.();
      this.body = h('div', { class: 'rbe-v-body' });
      this.backBtn = h('button', { class: 'rbe-btn', title: 'Back', onclick: () => this.pop() }, '←');
      this.extLink = h('a', { class: 'rbe-btn', target: '_blank', rel: 'noopener', title: 'Open on Reddit' }, '↗');
      const head = h('div', { class: 'rbe-v-head' },
        this.backBtn,
        h('button', { class: 'rbe-btn', title: 'Previous post (K)', onclick: () => this.feedStep(-1) }, '▲'),
        h('button', { class: 'rbe-btn', title: 'Next post (J)', onclick: () => this.feedStep(1) }, '▼'),
        this.headTitle = h('div', { class: 'rbe-v-title' }),
        RBE.embedButton(() => this.permalink),
        this.extLink,
        h('button', { class: 'rbe-btn', title: 'Close (Esc)', onclick: () => closeViewer() }, '✕'));
      this.panel = h('div', { class: 'rbe-v-panel' }, head, this.body);
      if (mode === 'side') {
        const grip = h('div', { class: 'rbe-v-grip', title: 'Drag to resize' });
        this.panel.prepend(grip);
        this.initResize(grip);
        this.root = h('div', { class: 'rbe-root rbe-viewer side' }, this.panel);
        this.applySideGeometry();
        document.documentElement.classList.add('rbe-side-open');
      } else {
        this.root = h('div', { class: 'rbe-root rbe-viewer modal' }, this.panel);
        this.root.addEventListener('click', e => { if (e.target === this.root) closeViewer(); });
        document.documentElement.classList.add('rbe-noscroll', 'rbe-modal-open');
      }
      document.documentElement.append(this.root);
    }
    applySideGeometry() {
      const header = document.querySelector('reddit-header-large, reddit-header-small, header[class*="header" i], shreddit-app > header');
      const top = header ? Math.max(0, Math.round(header.getBoundingClientRect().bottom)) : 0;
      document.documentElement.style.setProperty('--rbe-side-top', top + 'px');
      document.documentElement.style.setProperty('--rbe-side-w', Math.min(85, Math.max(25, RBE.settings.sideWidth)) + 'vw');
    }
    initResize(grip) {
      grip.addEventListener('pointerdown', e => {
        e.preventDefault(); grip.setPointerCapture(e.pointerId);
        const move = ev => {
          const pct = Math.min(85, Math.max(25, (1 - ev.clientX / window.innerWidth) * 100));
          document.documentElement.style.setProperty('--rbe-side-w', pct + 'vw');
          this.pct = pct;
        };
        const up = async () => {
          grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up);
          if (this.pct) {
            const { settings = {} } = await RBE.api.storage.sync.get('settings');
            settings.sideWidth = Math.round(this.pct);
            RBE.api.storage.sync.set({ settings });
          }
        };
        grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up);
      });
    }
    async show(permalink, postEl, sort) {
      this.permalink = permalink;
      this.postEl = postEl || this.postEl;
      this.sort = sort || RBE.settings.commentSort;
      this.backBtn.hidden = this.stack.length < 2;
      this.extLink.href = 'https://www.reddit.com' + new URL(permalink, location.origin).pathname;
      document.querySelectorAll('.rbe-active').forEach(x => x.classList.remove('rbe-active'));
      this.postEl?.classList.add('rbe-active');
      RBE.destroyVideos(this.body);
      this.body.replaceChildren(h('div', { class: 'rbe-loading' }, h('div', { class: 'rbe-spinner' })));
      this.body.scrollTop = 0;
      const token = this.token = Symbol();
      try {
        const data = await loadThread(permalink, this.sort);
        if (token !== this.token) return;
        this.headTitle.textContent = data.post.subreddit_name_prefixed;
        const ctx = { post: data.post, sort: this.sort, viewer: this, permalink };
        this.body.replaceChildren(renderPost(data.post), renderCommentSection(data, ctx, s => this.show(permalink, null, s)));
      } catch (e) {
        if (token !== this.token) return;
        console.warn('[RBE]', e);
        this.body.replaceChildren(h('div', { class: 'rbe-error' }, 'Couldn’t load this post. ',
          h('a', { href: permalink }, 'Open it normally'), h('div', { class: 'rbe-muted' }, String(e.message || e))));
      }
    }
    push(permalink) { this.stack.push(permalink); this.show(permalink); }
    pop() { if (this.stack.length > 1) { this.stack.pop(); this.show(this.stack[this.stack.length - 1]); } }
    feedStep(dir) {
      const posts = [...document.querySelectorAll('shreddit-post')].filter(p => p.offsetParent !== null && p.getAttribute('permalink'));
      let i = posts.indexOf(this.postEl);
      if (i === -1) i = dir > 0 ? -1 : posts.length;
      const next = posts[i + dir];
      if (!next) { RBE.toast(dir > 0 ? 'Scroll the feed to load more' : 'First post'); return; }
      if (this.mode === 'side') next.scrollIntoView({ block: 'center', behavior: 'smooth' });
      this.stack = [next.getAttribute('permalink')];
      this.show(this.stack[0], next);
    }
    destroy() {
      const pin = capturePin(this.postEl);
      this.token = null;
      RBE.destroyVideos(this.root);
      this.root.remove();
      document.querySelectorAll('.rbe-active').forEach(x => x.classList.remove('rbe-active'));
      document.documentElement.classList.remove('rbe-side-open', 'rbe-modal-open');
      if (!RBE.lightboxOpen()) document.documentElement.classList.remove('rbe-noscroll');
      holdPin(pin);
    }
  }

  // ---------- inline ----------
  async function toggleInline(permalink, postEl) {
    const anchor = postEl || null;
    if (!anchor) return false;
    const existing = anchor.nextElementSibling;
    if (existing && existing.classList.contains('rbe-inline')) { RBE.destroyVideos(existing); existing.remove(); anchor.classList.remove('rbe-active'); return true; }
    const box = h('div', { class: 'rbe-root rbe-inline' }, h('div', { class: 'rbe-loading' }, h('div', { class: 'rbe-spinner' })));
    anchor.after(box);
    anchor.classList.add('rbe-active');
    const close = () => { RBE.destroyVideos(box); box.remove(); anchor.classList.remove('rbe-active'); };
    const load = async sort => {
      try {
        const data = await loadThread(permalink, sort);
        const ctx = { post: data.post, sort, viewer: null, permalink };
        box.replaceChildren(
          h('div', { class: 'rbe-inline-bar' }, h('button', { class: 'rbe-linkbtn', onclick: close }, '▲ Collapse'), h('span', { class: 'rbe-grow' }),
            h('button', { class: 'rbe-linkbtn', onclick: () => { close(); openPanel('side', permalink, anchor); } }, 'Open in side panel')),
          renderPost(data.post, { inline: true }),
          renderCommentSection(data, ctx, load),
          h('div', { class: 'rbe-inline-bar' }, h('button', { class: 'rbe-linkbtn', onclick: () => { close(); anchor.scrollIntoView({ block: 'start' }); } }, '▲ Collapse comments')));
      } catch (e) {
        box.replaceChildren(h('div', { class: 'rbe-error' }, 'Couldn’t load. ', h('a', { href: permalink }, 'Open normally')));
      }
    };
    load(RBE.settings.commentSort);
    return true;
  }

  // ---------- public ----------
  function openPanel(mode, permalink, postEl) {
    if (current && current.mode !== mode) closeViewer(true);
    if (!current) {
      current = new Panel(mode);
      if (RBE.settings.historyBack && !historyPushed) {
        // Stop the browser jumping back to the old scroll position when we pop this entry
        savedScrollMode = history.scrollRestoration;
        history.scrollRestoration = 'manual';
        history.pushState(Object.assign({}, history.state, { rbeViewer: 1 }), '');
        historyPushed = true;
      }
    }
    current.stack = [permalink];
    current.show(permalink, postEl);
  }

  RBE.openViewer = function (permalink, postEl, mode) {
    mode = mode || RBE.settings.viewerMode;
    if (mode === 'lightbox') {
      // feed posts open in the lightbox; anything else (search results, links in comments) uses the modal
      if (postEl && postEl.tagName === 'SHREDDIT-POST' && RBE.openLightbox) {
        RBE.openLightbox({ postId: RBE.postIdOf(postEl), postEl, scope: 'feed' });
        return;
      }
      mode = 'modal';
    }
    if (mode === 'inline') {
      if (postEl && postEl.tagName === 'SHREDDIT-POST') return toggleInline(permalink, postEl);
      mode = 'modal'; // non-feed links (search results etc.) fall back to modal
    }
    openPanel(mode, permalink, postEl);
  };
  // Comment section for another UI (the lightbox side panel). Thread links open in the modal.
  RBE.renderCommentsInto = async function (container, permalink, sort) {
    sort = sort || RBE.settings.commentSort;
    container.replaceChildren(h('div', { class: 'rbe-loading' }, h('div', { class: 'rbe-spinner' })));
    const token = container._rbeToken = Symbol();
    try {
      const data = await loadThread(permalink, sort);
      if (container._rbeToken !== token) return null;
      const viewer = { push: p => { RBE.closeLightbox?.(); RBE.openViewer(p, null, 'modal'); } };
      const ctx = { post: data.post, sort, viewer, permalink };
      container.replaceChildren(renderCommentSection(data, ctx, s => RBE.renderCommentsInto(container, permalink, s)));
      return data.post;
    } catch (e) {
      if (container._rbeToken !== token) return null;
      container.replaceChildren(h('div', { class: 'rbe-muted' }, 'Couldn’t load comments. ', h('a', { href: 'https://www.reddit.com' + permalink, target: '_blank', rel: 'noopener' }, 'Open on Reddit ↗')));
      return null;
    }
  };
  RBE.viewerOpen = () => !!current;
  RBE.viewerPush = p => current && current.push(p);

  function closeViewer(skipHistory) {
    if (!current) return;
    current.destroy();
    current = null;
    if (historyPushed && !skipHistory) {
      historyPushed = false;
      if (history.state && history.state.rbeViewer) { swallowPop = true; history.back(); }
    }
  }
  RBE.closeViewer = closeViewer;

  // Browser Back closes the viewer instead of navigating
  window.addEventListener('popstate', e => {
    if (savedScrollMode && !(history.state && history.state.rbeViewer)) { history.scrollRestoration = savedScrollMode; savedScrollMode = null; }
    if (swallowPop) { swallowPop = false; e.stopImmediatePropagation(); return; }
    if (current) { historyPushed = false; closeViewer(true); e.stopImmediatePropagation(); }
  }, true);

  // Keyboard
  window.addEventListener('keydown', e => {
    if (!current || RBE.lightboxOpen()) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeViewer(); }
    else if (e.key === 'j') { e.preventDefault(); e.stopImmediatePropagation(); current.feedStep(1); }
    else if (e.key === 'k') { e.preventDefault(); e.stopImmediatePropagation(); current.feedStep(-1); }
    else if (e.key === 'Backspace' && current.stack.length > 1) { e.preventDefault(); current.pop(); }
  }, true);

  // Side panel: a click outside it (not on a post or a control) closes it.
  // Runs on document, after main.js's window handler, so clicks that open another post are already handled.
  const CONTROLS = 'a, button, input, textarea, select, label, summary, video, iframe, [role="button"], [role="menu"], [role="dialog"], faceplate-dropdown-menu, faceplate-hovercard, shreddit-post-overflow-menu';
  document.addEventListener('click', e => {
    if (!current || current.mode !== 'side' || e.button !== 0 || e.defaultPrevented || RBE.lightboxOpen()) return;
    const path = e.composedPath();
    if (path.some(n => n.nodeType === 1 && (n.classList?.contains('rbe-root') || n.matches?.(CONTROLS)))) return;
    const sel = window.getSelection && String(window.getSelection());
    if (sel && sel.length > 2) return; // user was selecting text
    closeViewer();
  }, true);

  window.addEventListener('resize', () => current && current.mode === 'side' && current.applySideGeometry());
})();
