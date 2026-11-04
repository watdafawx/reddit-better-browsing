/* Native controls on Instagram's videos, offscreen pause, audio settings for the page world */
(() => {
  const root = document.documentElement;
  // Grid previews (explore, profile) are silent loops inside a link: not real players.
  // Feed videos are inside a link too, but within an <article>.
  const isTile = v => !!v.closest('a[href]') && !v.closest('article, [role="dialog"]');
  const isStory = () => location.pathname.startsWith('/stories/'); // taps on the overlay = next/prev story
  const ours = v => !!v.closest('.igb-root');
  const visible = new Set();   // videos currently on screen; only those need work

  IGB.onSettings(s => {
    root.dataset.igbVideo = JSON.stringify({ mode: s.videoMode, volume: +s.videoVolume || 0 });
    root.classList.toggle('igb-native', !!s.nativeControls);
    visible.forEach(prep);
  });

  // Instagram lays a transparent overlay (its play button, mute button, tag icon, double-tap like)
  // over every <video>, so the browser's own controls can't be clicked. Find whatever sits on top of
  // the video and mark the sibling subtree that holds it; CSS then makes it click-through and hides it.
  function markOverlay(v) {
    const vr = v.getBoundingClientRect();
    if (vr.width < 80 || vr.height < 80) return;
    const pts = [[0.5, 0.5], [0.5, 0.92], [0.92, 0.92], [0.08, 0.92]];
    for (const [fx, fy] of pts) {
      const x = vr.left + vr.width * fx, y = vr.top + vr.height * fy;
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
      for (const e of document.elementsFromPoint(x, y)) {
        if (e === v || e.contains(v)) break;           // reached the video or its ancestors
        if (e.closest('.igb-root, .igb-ov')) continue;
        // climb to the child of the lowest common ancestor of `e` and the video
        let o = e, depth = 0;
        while (o.parentElement && !o.parentElement.contains(v)) o = o.parentElement;
        let a = o.parentElement;
        for (let p = v; p && p !== a; p = p.parentElement) depth++;
        if (!a || depth > 12) continue;                // something unrelated (header, dialog)
        const or = o.getBoundingClientRect(), er = e.getBoundingClientRect();
        const r = or.width * or.height ? or : er;
        // must stay within the video's box (with slack), so we never hide captions or action bars
        if (r.top < vr.top - 8 || r.bottom > vr.bottom + 8 || r.left < vr.left - 8 || r.right > vr.right + 8) continue;
        o.classList.add('igb-ov');
      }
    }
  }

  function prep(v) {
    if (ours(v) || isTile(v)) return;
    const s = IGB.settings;
    const on = s.nativeControls && !isStory();
    if (on) {
      if (!v.controls) v.controls = true;
      v.loop = !!s.videoLoop;
      v.dataset.igbNative = '1';
      unlink(v);
      markOverlay(v);
    } else if (v.dataset.igbNative) {
      v.controls = false;
      delete v.dataset.igbNative;
      relink(v);
    }
  }

  // Feed videos are wrapped in a link to the reel, so every click on the controls would open the
  // reel page. Park the href while our controls are on, and keep clicks on the video away from
  // Instagram's router (bubble phase, after the browser controls have handled them).
  function unlink(v) {
    const a = v.closest('a[href]');
    if (a) { a.dataset.igbHref = a.getAttribute('href'); a.removeAttribute('href'); }
    if (!v._igbClick) {
      v._igbClick = e => { if (v.dataset.igbNative) e.stopPropagation(); };
      v.addEventListener('click', v._igbClick);
    }
  }
  function relink(v) {
    const a = v.closest('a[data-igb-href]');
    if (a && !a.hasAttribute('href')) a.setAttribute('href', a.dataset.igbHref);
  }

  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      const v = e.target;
      if (e.isIntersecting) { visible.add(v); prep(v); }
      else {
        visible.delete(v);
        if (IGB.settings.videoPauseOffscreen && !v.paused && !ours(v) && !isTile(v)) v.pause();
      }
    }
  }, { threshold: 0.15 });

  const seen = new WeakSet();
  function scan() {
    document.querySelectorAll('video').forEach(v => { if (!seen.has(v)) { seen.add(v); io.observe(v); } });
    for (const v of visible) v.isConnected ? prep(v) : visible.delete(v);
  }
  IGB.onDomChange(scan, 300);
  // Instagram re-renders overlays on hover/pause without adding videos; re-check what's on screen.
  setInterval(() => { if (!document.hidden) visible.forEach(prep); }, 1500);
  addEventListener('scroll', () => { clearTimeout(scan.t); scan.t = setTimeout(() => visible.forEach(prep), 150); }, { passive: true, capture: true });

  // For videos we create ourselves (lightbox)
  IGB.setupOwnVideo = function (v) {
    const s = IGB.settings;
    v.playsInline = true;
    v.controls = true;
    v.loop = !!s.videoLoop;
    const vol = Math.max(0, Math.min(1, (+s.videoVolume || 0) / 100));
    if (s.videoMode === 'muted') v.muted = true;
    else if (s.videoMode !== 'default') { v.volume = vol; v.muted = vol === 0; }
    if (s.videoMode === 'off') return;
    v.play().catch(err => {
      if (err?.name !== 'NotAllowedError') return;   // e.g. load error: nothing to do with sound
      // Browser blocks sound before the first click on the page: start muted, unmute on the first click
      v.muted = true;
      v.play().catch(() => {});
      addEventListener('pointerdown', () => { if (v.isConnected && vol) v.muted = false; }, { once: true, capture: true });
    });
  };
  IGB.destroyVideos = el => el.querySelectorAll('video').forEach(v => { v.pause(); v.removeAttribute('src'); v.load(); });
})();
