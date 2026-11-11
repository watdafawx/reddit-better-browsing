/* Tweet videos: browser controls, and one video playing at a time.
   Which video plays: the one you started (until it scrolls away), else the one most in view. Pausing a
   video yourself sticks: it never restarts on its own while it is on screen, and nothing else starts
   in its place. No timers fight with X's player; the work runs on scroll/visibility changes and your clicks. */
(() => {
  const root = document.documentElement;
  const PLAYER = '[data-testid="videoPlayer"]';
  const ours = v => !!v.closest('.xbb-root');
  // GIFs sit in the same kind of player (a looping video from /tweet_video/): X keeps handling those
  const isGif = v => v.hasAttribute('data-xbb-gif') || /\/tweet_video\//.test(v.currentSrc || v.src || '');
  const managed = v => v instanceof HTMLVideoElement && !ours(v) && !!v.closest(PLAYER) && !isGif(v);

  const score = new Map();         // video -> how much of it is on screen (0..1, vertical)
  const userPaused = new WeakSet();
  const failed = new WeakSet();
  let pick = null;                 // the video that should be playing
  let chosen = null;               // a video the user started: keeps the pick while it stays on screen

  // ---------- user gestures (to tell your clicks from X's own play/pause calls) ----------
  let lastGesture = 0, lastTarget = null;
  const onGesture = e => { lastGesture = Date.now(); lastTarget = e.type === 'keydown' ? (document.activeElement || e.target) : e.target; };
  ['pointerdown', 'keydown', 'touchstart'].forEach(t => addEventListener(t, onGesture, true));
  const userOn = v => {
    if (Date.now() - lastGesture > 1500 || !lastTarget) return false;
    if (lastTarget === v) return true;
    const p = v.closest(PLAYER);
    return !!p && p.contains(lastTarget);
  };

  // ---------- native controls ----------
  function prep(v) {
    if (!managed(v)) return;
    const s = XBB.settings;
    if (s.nativeControls) {
      if (!v.controls) v.controls = true;
      v.loop = !!s.videoLoop;
      v.dataset.xbbNative = '1';
      if (!v._xbbClick) {
        // Clicks on the controls must not reach X, which would open the tweet
        v._xbbClick = e => { if (v.dataset.xbbNative) e.stopPropagation(); };
        v.addEventListener('click', v._xbbClick);
      }
    } else if (v.dataset.xbbNative) {
      v.controls = false;
      delete v.dataset.xbbNative;
    }
  }

  // ---------- picking ----------
  const sc = v => score.get(v) || 0;
  const quiet = v => { v._xbbQuiet = performance.now(); v.pause(); };   // a pause that is ours, not yours
  const isPip = v => document.pictureInPictureElement === v;

  function start(v) {
    if (failed.has(v)) return;
    // main-world.js's play() handles sound before the first click (starts muted, unmutes on the click)
    v.play().catch(err => { if (err?.name !== 'AbortError') failed.add(v); });
  }
  const setPick = v => {
    if (pick === v) return;
    pick?.removeAttribute('data-xbb-pick');
    pick = v;
    v?.setAttribute('data-xbb-pick', '');
  };

  function evaluate() {
    const s = XBB.settings;
    if (s.videoMode === 'default') { setPick(null); return; }
    const list = [];
    for (const v of [...score.keys()]) {
      if (!v.isConnected) { score.delete(v); if (pick === v) pick = null; if (chosen === v) chosen = null; continue; }
      if (managed(v)) list.push(v);
    }
    // gone from the screen: a pause of yours no longer counts, and offscreen videos pause
    for (const v of list) {
      if (sc(v) < 0.05) {
        userPaused.delete(v);
        if (s.videoPauseOffscreen && !v.paused && !isPip(v) && document.fullscreenElement !== v) quiet(v);
      }
    }
    if (chosen && sc(chosen) < 0.1) chosen = null;
    // you paused something that is still in view: stay quiet until it is gone
    const hush = list.some(v => userPaused.has(v) && sc(v) >= 0.35);

    let best = chosen;
    if (!best && !hush && s.videoMode !== 'off') {   // no autoplay: only a video you started is ever the pick
      const cand = list.filter(v => sc(v) >= 0.5 && !v.ended && !userPaused.has(v));
      const mid = innerHeight / 2, dist = v => { const r = v.getBoundingClientRect(); return Math.abs(r.top + r.height / 2 - mid); };
      // keep the current pick while it is still well in view, so scrolling a little never swaps videos
      if (pick && cand.includes(pick) && sc(pick) >= 0.35) best = pick;
      else best = cand.sort((a, b) => sc(b) - sc(a) || dist(a) - dist(b))[0] || null;
    }
    setPick(best);

    if (s.videoOneAtATime) for (const v of list) if (v !== best && !v.paused && !isPip(v)) quiet(v);
    if (s.videoMode === 'off' || hush) return;
    // autoplay: the pick; without one-at-a-time, every video that is well in view
    const targets = s.videoOneAtATime ? (best ? [best] : []) : list.filter(v => sc(v) >= 0.5);
    for (const v of targets) if (v.paused && !v.ended && !userPaused.has(v)) start(v);
  }
  let timer = 0;
  function schedule(ms = 120) { clearTimeout(timer); timer = setTimeout(evaluate, ms); }

  // ---------- events ----------
  document.addEventListener('play', e => {
    const v = e.target, s = XBB.settings;
    if (!managed(v)) return;
    if (userOn(v)) {                       // you started it: it wins, and everything else yields
      userPaused.delete(v);
      chosen = v;
      setPick(v);
      if (s.videoOneAtATime) for (const o of [...score.keys()]) if (o !== v && !o.paused && managed(o)) quiet(o);
    } else if (s.videoOneAtATime && s.videoMode !== 'default' && v !== pick) {
      quiet(v);                            // X started a second one on its own: not allowed
      schedule(0);
    }
  }, true);
  document.addEventListener('pause', e => {
    const v = e.target;
    if (!managed(v) || v.ended || performance.now() - (v._xbbQuiet || 0) < 400) return;
    if (userOn(v)) { userPaused.add(v); if (chosen === v) chosen = null; }
  }, true);
  document.addEventListener('ended', e => {
    if (e.target === chosen) chosen = null;
    if (e.target === pick) schedule(0);
  }, true);

  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      const r = e.boundingClientRect;
      score.set(e.target, e.isIntersecting && r.height ? e.intersectionRect.height / Math.min(r.height, innerHeight) : 0);
    }
    schedule();
  }, { threshold: [0, 0.05, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 1] });

  const seen = new WeakSet();
  function scan() {
    document.querySelectorAll('video').forEach(v => {
      if (seen.has(v) || ours(v) || !v.closest(PLAYER)) return;
      if (v.loop) v.setAttribute('data-xbb-gif', '');   // X loops GIFs itself; a real video only loops by our setting, applied below
      seen.add(v);
      if (!managed(v)) return;
      io.observe(v);
      score.set(v, score.get(v) || 0);
      prep(v);
    });
  }
  XBB.onDomChange(scan, 200);
  addEventListener('scroll', () => schedule(200), { passive: true, capture: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });
  XBB.onSettings(s => {
    root.dataset.xbbVideo = JSON.stringify({ mode: s.videoMode, volume: +s.videoVolume || 0, one: !!s.videoOneAtATime });
    root.classList.toggle('xbb-native', !!s.nativeControls);
    root.classList.toggle('xbb-light', !!s.lighterPage);
    for (const v of score.keys()) prep(v);
    schedule();
  });
  scan();
})();
