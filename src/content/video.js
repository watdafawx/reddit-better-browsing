/* Video autoplay / volume control (isolated world side) */
(() => {
  let lastGesture = 0;
  ['pointerdown', 'keydown', 'touchstart'].forEach(t => window.addEventListener(t, () => { lastGesture = Date.now(); }, true));
  const gesture = () => Date.now() - lastGesture < 1200;

  // Tab hidden or window unfocused: pause everything that plays, and let nothing start meanwhile
  const known = new Set();         // every <video> guard() has seen, including those inside players' shadow roots
  let blurred = false;
  const away = () => !!RBE.settings.videoPauseOnHide && (document.hidden || blurred);
  const pauseAway = () => {
    if (!away()) return;
    for (const v of known) { if (!v.isConnected) known.delete(v); else if (!v.paused && document.pictureInPictureElement !== v) v.pause(); }
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseAway(); });
  addEventListener('blur', () => setTimeout(() => { if (!document.hasFocus()) { blurred = true; pauseAway(); } }));
  addEventListener('focus', () => { blurred = false; });

  const seen = new WeakSet();
  const io = new IntersectionObserver(entries => {
    const s = RBE.settings;
    for (const e of entries) {
      const v = e.target;
      if (!e.isIntersecting && s.videoPauseOffscreen && !v.paused) { v.pause(); v.dataset.rbePausedOffscreen = '1'; }
      else if (e.isIntersecting && v.dataset.rbePausedOffscreen && s.videoMode !== 'off' && !away()) { delete v.dataset.rbePausedOffscreen; v.play().catch(() => {}); }
    }
  }, { threshold: 0.15 });

  function guard(v) {
    if (seen.has(v)) return;
    seen.add(v);
    known.add(v);
    io.observe(v);
    v.addEventListener('play', () => {
      const s = RBE.settings;
      if (away() && !gesture()) { v.pause(); return; }
      if (s.videoMode === 'off' && !gesture() && !v.dataset.rbeAllowed) v.pause();
      if (gesture()) v.dataset.rbeAllowed = '1';
    });
  }

  // Walk into (open) shadow roots of Reddit's player components to find <video>s.
  function scan(root, depth = 0) {
    if (!root || depth > 4) return;
    root.querySelectorAll('video').forEach(guard);
    root.querySelectorAll('shreddit-player, shreddit-player-2, shreddit-media-player, media-player, shreddit-async-loader, shreddit-embed').forEach(h => h.shadowRoot && scan(h.shadowRoot, depth + 1));
  }

  function publish(s) {
    document.documentElement.dataset.rbeVideo = JSON.stringify({ mode: s.videoMode, volume: +s.videoVolume || 0 });
  }
  RBE.onSettings(publish);

  RBE.onDomChange(() => scan(document), 300);
  // safety net for players that swap videos inside shadow roots (no light-DOM mutation); skip in background tabs
  setInterval(() => { if (!document.hidden) scan(document); }, 3000);

  // play() that only falls back to muted when the browser really blocked audible autoplay.
  // Any other rejection (AbortError when hls.js swaps in its MediaSource while play() is pending,
  // NotSupportedError before a source exists) is not a sound problem; muting there silenced
  // Reddit videos in the lightbox/viewer even though the stream has audio.
  function tryPlay(v) {
    return v.play().catch(err => {
      if (err && err.name === 'NotAllowedError' && !v.muted) { v.muted = true; return v.play().catch(() => {}); }
    });
  }

  // Browser controls on our own videos, or none: then a click plays/pauses (and does not reach the page behind)
  function ownControls(v) {
    const on = RBE.settings.nativeControls !== false;
    v.controls = on;
    if (!v._rbeToggle) {
      v._rbeToggle = e => { if (v.controls) return; e.preventDefault(); e.stopPropagation(); if (v.paused) tryPlay(v); else v.pause(); };
      v.addEventListener('click', v._rbeToggle);
    }
  }
  RBE.onSettings(() => document.querySelectorAll('video[data-rbe-own]').forEach(ownControls));

  // For videos we create ourselves (viewer / lightbox)
  RBE.setupOwnVideo = function (v, { autoplay = true } = {}) {
    const s = RBE.settings;
    v.playsInline = true;
    v.loop = !!s.videoLoop;
    v.dataset.rbeOwn = '1';
    ownControls(v);
    const vol = Math.max(0, Math.min(1, (+s.videoVolume || 0) / 100));
    if (s.videoMode === 'muted') v.muted = true;
    else if (s.videoMode === 'volume' || s.videoMode === 'off') { v.volume = vol; v.muted = vol === 0; }
    const wantsPlay = autoplay && s.videoMode !== 'off';
    if (wantsPlay) {
      v.dataset.rbeWantPlay = '1'; // hls.js retries play once the stream is ready
      tryPlay(v);
    }
    io.observe(v);
  };

  // hls.js (~400 KB) runs on first use: build.js wraps it in the function RBE_LOAD_HLS.
  let hlsLoad = null;
  RBE.loadHls = () => {
    if (globalThis.Hls) return Promise.resolve(true);
    return hlsLoad || (hlsLoad = Promise.resolve().then(() => RBE_LOAD_HLS())
      .then(() => !!globalThis.Hls, e => { console.warn('[RBE] hls.js load failed', e); return false; })
      .then(ok => { if (!ok) hlsLoad = null; return ok; }));
  };

  // Attach a Reddit video (HLS with audio; falls back to silent MP4)
  RBE.attachRedditVideo = function (v, item) {
    if (item.hls && !globalThis.Hls) {
      RBE.loadHls().then(() => { if (!v._rbeDead) attach(v, item); });
      return;
    }
    attach(v, item);
  };
  function attach(v, item) {
    const fallback = () => {
      v._rbeHls?.destroy(); v._rbeHls = null;
      if (item.fallback && v.getAttribute('src') !== item.fallback) { v.src = item.fallback; if (v.dataset.rbeWantPlay) v.play().catch(() => {}); }
    };
    // Prefer hls.js: newer Chrome claims native HLS support but stalls at 0:00 on Reddit's streams
    if (item.hls && globalThis.Hls && Hls.isSupported()) {
      const hls = new Hls({ capLevelToPlayerSize: true, startLevel: -1 });
      hls.on(Hls.Events.ERROR, (_, data) => { if (data.fatal) { console.warn('[RBE] hls error', data.type, data.details); fallback(); } });
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (v.dataset.rbeWantPlay) tryPlay(v);
      });
      hls.loadSource(item.hls);
      hls.attachMedia(v);
      v._rbeHls = hls;
      return;
    }
    if (item.hls && v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = item.hls;
      v.addEventListener('error', fallback, { once: true });
      return;
    }
    v.src = item.fallback;
  }
  RBE.destroyVideos = root => root.querySelectorAll('video').forEach(v => { v._rbeDead = true; v.pause(); v._rbeHls?.destroy(); v.removeAttribute('src'); v.load(); });
})();
