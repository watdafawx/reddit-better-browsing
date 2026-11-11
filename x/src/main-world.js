/* Runs in the PAGE's JS world so it can control X's own video players.
   Settings arrive from the content script via <html data-xbb-video='{"mode":"volume","volume":40,"one":true}'>.
   The content script marks the video it wants playing with data-xbb-pick; with one-at-a-time on (or
   autoplay off), X's own play() calls on any other video are swallowed unless the user just clicked. */
(() => {
  if (window.__xbbMainWorld) return;
  window.__xbbMainWorld = true;

  const root = document.documentElement;
  const P = HTMLMediaElement.prototype;
  const origPlay = P.play;
  const mutedDesc = Object.getOwnPropertyDescriptor(P, 'muted');
  const volDesc = Object.getOwnPropertyDescriptor(P, 'volume');
  const autoDesc = Object.getOwnPropertyDescriptor(P, 'autoplay');
  const setMuted = (el, v) => mutedDesc.set.call(el, v);
  const setVol = (el, v) => volDesc.set.call(el, v);

  const PLAYER = '[data-testid="videoPlayer"]';
  let lastGesture = 0, lastTarget = null;
  const gesture = () => Date.now() - lastGesture < 1200;
  // A recent click/key on this video's own player (the video, its controls). Clicking elsewhere on the
  // page is a gesture too, but X's mute/pause right after it is not the user's choice.
  const userOn = el => {
    if (!gesture() || !lastTarget) return false;
    if (lastTarget === el) return true;
    const p = el.closest(PLAYER);
    return !!p && p.contains(lastTarget);
  };

  // Parse the settings attribute only when it changes
  let cfg = {};
  const readCfg = () => { try { cfg = JSON.parse(root.dataset.xbbVideo || '{}'); } catch { cfg = {}; } };
  readCfg();
  new MutationObserver(readCfg).observe(root, { attributes: true, attributeFilter: ['data-xbb-video'] });

  const ours = el => !!el.closest?.('.xbb-root');
  // Only real tweet videos: GIFs (looping /tweet_video/ files in the same player) keep X's own handling
  const isGif = el => el.hasAttribute('data-xbb-gif') || /\/tweet_video\//.test(el.currentSrc || el.src || '');
  const active = el => {
    const m = cfg.mode;
    return !!m && m !== 'default' && el instanceof HTMLVideoElement && !ours(el) && !!el.closest(PLAYER) && !isGif(el);
  };
  // Volume the user last chose with the browser controls on any video (until the page reloads)
  let sessionVol = null;
  const level = () => sessionVol ?? Math.max(0, Math.min(1, (cfg.volume || 0) / 100));

  // Videos that had to start muted because the browser blocked audible autoplay; unmute on first interaction.
  const waiting = new Set();
  const onGesture = e => {
    lastGesture = Date.now();
    lastTarget = e.type === 'keydown' ? (document.activeElement || e.target) : e.target;
    if (cfg.mode !== 'volume' || !level()) return;
    for (const v of waiting) {
      if (v.isConnected && !v.paused && !v.dataset.xbbUserAudio) { setVol(v, level()); setMuted(v, false); }
      waiting.delete(v);
    }
  };
  ['pointerdown', 'keydown', 'touchstart'].forEach(t => window.addEventListener(t, onGesture, true));

  function applyAudio(el) {
    if (el.dataset.xbbUserAudio) return;
    if (cfg.mode === 'muted') setMuted(el, true);
    else if (cfg.mode === 'volume' || cfg.mode === 'off') {
      setVol(el, level());
      setMuted(el, !level());
    }
  }

  // With one-at-a-time (or autoplay off), only the picked video, or one the user just started, may play.
  const gated = el => cfg.mode === 'off' || cfg.one;
  const mayPlay = el => gesture() || el.hasAttribute('data-xbb-pick') || el.dataset.xbbAllowed;

  P.play = function () {
    if (!active(this)) return origPlay.apply(this, arguments);
    if (gated(this) && !mayPlay(this)) return Promise.resolve();   // swallow X's autoplay
    if (gesture()) this.dataset.xbbAllowed = '1';
    applyAudio(this);
    const el = this;
    return origPlay.call(this).catch(err => {
      if (err && err.name === 'NotAllowedError' && !el.muted) {
        setMuted(el, true); // browser refuses sound before the first click: start muted, unmute on first gesture
        waiting.add(el);
        return origPlay.call(el);
      }
      throw err;
    });
  };

  // X mutes new videos and keeps its own mute state. With browser controls on, X's own mute button is
  // hidden, so a mute or volume write from the page is never the user's; theirs come from the browser
  // controls (volumechange below). Without browser controls, a write right after a click on the player counts.
  const nativeOn = () => root.classList.contains('xbb-native');
  const userWrite = el => {
    if (!active(el)) return true;
    if (nativeOn() || !userOn(el)) return false;
    el.dataset.xbbUserAudio = '1';
    waiting.delete(el);
    return true;
  };
  Object.defineProperty(P, 'muted', {
    configurable: true, enumerable: true,
    get() { return mutedDesc.get.call(this); },
    set(v) { if (userWrite(this)) setMuted(this, v); }
  });
  Object.defineProperty(P, 'volume', {
    configurable: true, enumerable: true,
    get() { return volDesc.get.call(this); },
    set(v) { if (userWrite(this)) setVol(this, v); }
  });
  // The autoplay attribute bypasses play(); neuter it when autoplay is gated.
  Object.defineProperty(P, 'autoplay', {
    configurable: true, enumerable: true,
    get() { return autoDesc.get.call(this); },
    set(v) { if (v && active(this) && gated(this)) return; autoDesc.set.call(this, v); }
  });

  // React sets `muted` as a property on mount, before play(); re-apply our level when playback starts.
  // Before the page has had a click, unmuting would make the browser pause the video: wait for the click.
  const activated = () => !!navigator.userActivation?.hasBeenActive;
  document.addEventListener('playing', e => {
    const v = e.target;
    if (!active(v)) return;
    if (!activated() && v.muted && cfg.mode === 'volume') { waiting.add(v); return; }
    if (waiting.has(v) && activated()) waiting.delete(v);
    if (!waiting.has(v)) applyAudio(v);
  }, true);

  // Safety net: a playing video that is muted though the user never muted it gets our level back.
  // Only after the page has had a click or key press (unmuting before that pauses the video).
  setInterval(() => {
    if (cfg.mode !== 'volume' || !level() || document.hidden || !activated()) return;
    for (const v of document.querySelectorAll('video')) {
      if (v.paused || !v.muted || v.dataset.xbbUserAudio || !active(v)) continue;
      waiting.delete(v);
      setVol(v, level());
      setMuted(v, false);
    }
  }, 600);

  // The browser's own controls change volume/mute without going through the setters above. A change on
  // this player that differs from our level is the user's: keep it for this video, and a volume they
  // set (not a mute) becomes the level for the videos after it.
  document.addEventListener('volumechange', e => {
    const v = e.target;
    if (!active(v) || v.dataset.xbbUserAudio || !userOn(v)) return;
    const want = cfg.mode === 'muted' ? null : level();
    const same = want === null ? v.muted : v.muted === (want === 0) && Math.abs(v.volume - want) < 0.01;
    if (same) return;
    v.dataset.xbbUserAudio = '1';
    waiting.delete(v);
    if (!v.muted && v.volume > 0 && cfg.mode !== 'muted') sessionVol = v.volume;
  }, true);
})();
