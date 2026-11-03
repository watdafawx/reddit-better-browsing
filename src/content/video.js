/* Video autoplay / volume control (isolated world side) */
(() => {
  let lastGesture = 0;
  ['pointerdown', 'keydown', 'touchstart'].forEach(t => window.addEventListener(t, () => { lastGesture = Date.now(); }, true));
  const gesture = () => Date.now() - lastGesture < 1200;

  const seen = new WeakSet();
  const io = new IntersectionObserver(entries => {
    const s = RBE.settings;
    for (const e of entries) {
      const v = e.target;
      if (!e.isIntersecting && s.videoPauseOffscreen && !v.paused) { v.pause(); v.dataset.rbePausedOffscreen = '1'; }
      else if (e.isIntersecting && v.dataset.rbePausedOffscreen && s.videoMode !== 'off') { delete v.dataset.rbePausedOffscreen; v.play().catch(() => {}); }
    }
  }, { threshold: 0.15 });

  function guard(v) {
    if (seen.has(v)) return;
    seen.add(v);
    io.observe(v);
    v.addEventListener('play', () => {
      const s = RBE.settings;
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

  // For videos we create ourselves (viewer / lightbox)
  RBE.setupOwnVideo = function (v, { autoplay = true } = {}) {
    const s = RBE.settings;
    v.playsInline = true;
    v.loop = !!s.videoLoop;
    v.controls = true;
    const vol = Math.max(0, Math.min(1, (+s.videoVolume || 0) / 100));
    if (s.videoMode === 'muted') v.muted = true;
    else if (s.videoMode === 'volume' || s.videoMode === 'off') { v.volume = vol; v.muted = vol === 0; }
    const wantsPlay = autoplay && s.videoMode !== 'off';
    if (wantsPlay) {
      v.dataset.rbeWantPlay = '1'; // hls.js retries play once the stream is ready
      v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
    }
    io.observe(v);
  };

  // hls.js (~400 KB) is loaded on first use by asking the background to inject it into this tab.
  let hlsLoad = null;
  RBE.loadHls = () => {
    if (globalThis.Hls) return Promise.resolve(true);
    return hlsLoad || (hlsLoad = RBE.api.runtime.sendMessage({ type: 'rbe:loadHls' })
      .then(r => { if (r?.error) console.warn('[RBE] hls.js load failed', r.error); return !!globalThis.Hls; }, () => false)
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
        if (v.dataset.rbeWantPlay) v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
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
