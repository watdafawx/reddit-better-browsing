/* Runs in the PAGE's JS world so it can control Instagram's own players.
   Settings arrive from the content script via <html data-igb-video='{"mode":"volume","volume":40}'>.
   While our lightbox is open (<html data-igb-lb>), page videos are not allowed to start. */
(() => {
  if (window.__igbMainWorld) return;
  window.__igbMainWorld = true;

  const root = document.documentElement;
  const P = HTMLMediaElement.prototype;
  const origPlay = P.play;
  const mutedDesc = Object.getOwnPropertyDescriptor(P, 'muted');
  const volDesc = Object.getOwnPropertyDescriptor(P, 'volume');
  const autoDesc = Object.getOwnPropertyDescriptor(P, 'autoplay');
  const setMuted = (el, v) => mutedDesc.set.call(el, v);
  const setVol = (el, v) => volDesc.set.call(el, v);

  let lastGesture = 0, lastTarget = null;
  const gesture = () => Date.now() - lastGesture < 1200;
  // A recent click/key on this video's own player (the video, its controls, or Instagram's buttons
  // around it). Clicking "Reels" in the sidebar is a gesture too, but Instagram's mute right after
  // it is not the user's choice.
  const userOn = el => {
    if (!gesture() || !lastTarget) return false;
    if (lastTarget === el || lastTarget === document.body) return lastTarget === el || document.activeElement === el;
    let p = el;
    for (let i = 0; i < 7 && p; i++, p = p.parentElement) if (p.contains(lastTarget)) return true;
    return false;
  };

  // Parse the settings attribute only when it changes (the setters below run on every volume/mute write)
  let cfg = {};
  const readCfg = () => { try { cfg = JSON.parse(root.dataset.igbVideo || '{}'); } catch { cfg = {}; } };
  readCfg();
  new MutationObserver(readCfg).observe(root, { attributes: true, attributeFilter: ['data-igb-video'] });

  const ours = el => !!el.closest?.('.igb-root');
  // Grid tiles (explore, profile, reels tab) play silent previews inside a link: leave them alone.
  // Feed videos sit inside a link too, but within an <article>.
  const tile = el => !!el.closest?.('a[href]') && !el.closest('article, [role="dialog"]');
  const active = el => {
    const m = cfg.mode;
    return !!m && m !== 'default' && el instanceof HTMLVideoElement && !ours(el) && !tile(el);
  };

  // Videos that had to start muted because the browser blocked audible autoplay; unmute on first interaction.
  const waiting = new Set();
  const onGesture = e => {
    lastGesture = Date.now();
    lastTarget = e.type === 'keydown' ? (document.activeElement || e.target) : e.target;
    if (cfg.mode !== 'volume' || !cfg.volume) return;
    for (const v of waiting) {
      if (v.isConnected && !v.paused && !v.dataset.igbUserAudio) { setVol(v, cfg.volume / 100); setMuted(v, false); }
      waiting.delete(v);
    }
  };
  ['pointerdown', 'keydown', 'touchstart'].forEach(t => window.addEventListener(t, onGesture, true));

  function applyAudio(el) {
    if (el.dataset.igbUserAudio) return;
    if (cfg.mode === 'muted') setMuted(el, true);
    else if (cfg.mode === 'volume' || cfg.mode === 'off') {
      setVol(el, Math.max(0, Math.min(1, (cfg.volume || 0) / 100)));
      setMuted(el, !cfg.volume);
    }
  }

  P.play = function () {
    if (root.hasAttribute('data-igb-lb') && this instanceof HTMLVideoElement && !ours(this)) return Promise.resolve();
    if (!active(this)) return origPlay.apply(this, arguments);
    const user = gesture();
    if (cfg.mode === 'off' && !user && !this.dataset.igbAllowed) return Promise.resolve(); // swallow autoplay
    if (user) this.dataset.igbAllowed = '1';
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

  // Instagram mutes every new video and keeps its own mute state. Page-initiated changes are
  // ignored; ones from a click/key on that video's player are the user's and stick.
  // With browser controls on (not on stories), Instagram's own mute/volume buttons are hidden, so a
  // write from the page is never the user's: Instagram mutes a reel when you click it to resume, and
  // that used to stick. The user's changes come from the browser controls (volumechange below).
  const nativeOn = () => root.classList.contains('igb-native') && !location.pathname.startsWith('/stories/');
  const userWrite = el => {
    if (!active(el)) return true;
    if (nativeOn() || !userOn(el)) return false;
    el.dataset.igbUserAudio = '1';
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
  // The autoplay attribute bypasses play(); neuter it when autoplay is off.
  Object.defineProperty(P, 'autoplay', {
    configurable: true, enumerable: true,
    get() { return autoDesc.get.call(this); },
    set(v) { if (v && active(this) && cfg.mode === 'off') return; autoDesc.set.call(this, v); }
  });

  // React sets `muted` as a property on mount, before play(); re-apply our level when playback starts.
  // A video still waiting for a click is fine to unmute once the page has had one.
  const activated = () => !!navigator.userActivation?.hasBeenActive;
  document.addEventListener('playing', e => {
    const v = e.target;
    if (!active(v)) return;
    if (waiting.has(v) && activated()) waiting.delete(v);
    if (!waiting.has(v)) applyAudio(v);
  }, true);

  // Safety net (Reels kept coming up muted): a playing video that is muted though the user never
  // muted it gets our level back. Only after the page has had a click or key press: unmuting
  // before that makes the browser pause the video.
  setInterval(() => {
    if (cfg.mode !== 'volume' || !cfg.volume || document.hidden || !activated()) return;
    for (const v of document.querySelectorAll('video')) {
      if (v.paused || !v.muted || v.dataset.igbUserAudio || !active(v)) continue;
      waiting.delete(v);
      setVol(v, cfg.volume / 100);
      setMuted(v, false);
    }
  }, 600);
  // The browser's own controls change volume/mute without going through the setters above.
  // A change on this player that differs from our level is the user's: keep it from then on.
  document.addEventListener('volumechange', e => {
    const v = e.target;
    if (!active(v) || v.dataset.igbUserAudio || !userOn(v)) return;
    const want = cfg.mode === 'muted' ? null : Math.max(0, Math.min(1, (cfg.volume || 0) / 100));
    const ours = want === null ? v.muted : v.muted === (want === 0) && Math.abs(v.volume - want) < 0.01;
    if (!ours) { v.dataset.igbUserAudio = '1'; waiting.delete(v); }
  }, true);
})();
