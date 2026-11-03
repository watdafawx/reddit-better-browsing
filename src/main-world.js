/* Runs in the PAGE's JS world so it can control Reddit's own players (including ones inside shadow DOM).
   Settings arrive from the content script via <html data-rbe-video='{"mode":"volume","volume":10}'>. */
(() => {
  if (window.__rbeMainWorld) return;
  window.__rbeMainWorld = true;

  const P = HTMLMediaElement.prototype;
  const origPlay = P.play;
  const mutedDesc = Object.getOwnPropertyDescriptor(P, 'muted');
  const volDesc = Object.getOwnPropertyDescriptor(P, 'volume');
  const setMuted = (el, v) => mutedDesc.set.call(el, v);
  const setVol = (el, v) => volDesc.set.call(el, v);

  let lastGesture = 0;
  const gesture = () => Date.now() - lastGesture < 1200 || !!(navigator.userActivation && navigator.userActivation.isActive && Date.now() - lastGesture < 5000);
  // Parse the settings attribute only when it changes (the setters below run on every volume/mute write)
  let cfgCache = {};
  const readCfg = () => { try { cfgCache = JSON.parse(document.documentElement.dataset.rbeVideo || '{}'); } catch { cfgCache = {}; } };
  readCfg();
  new MutationObserver(readCfg).observe(document.documentElement, { attributes: true, attributeFilter: ['data-rbe-video'] });
  const cfg = () => cfgCache;
  const active = el => { const m = cfgCache.mode; return !!m && m !== 'default' && el instanceof HTMLVideoElement && !el.closest?.('.rbe-root'); };

  // Videos that had to start muted because the browser blocked audible autoplay; unmute on first interaction.
  const waitingForGesture = new Set();
  const onGesture = () => {
    lastGesture = Date.now();
    const c = cfg();
    if (c.mode !== 'volume' || !c.volume) return;
    for (const v of waitingForGesture) {
      if (!v.isConnected) { waitingForGesture.delete(v); continue; }
      if (!v.paused && !v.dataset.rbeUserAudio) { setVol(v, c.volume / 100); setMuted(v, false); }
      waitingForGesture.delete(v);
    }
  };
  ['pointerdown', 'keydown', 'touchstart'].forEach(t => window.addEventListener(t, onGesture, true));

  function applyAudio(el, c) {
    if (el.dataset.rbeUserAudio) return;
    if (c.mode === 'muted') setMuted(el, true);
    else if (c.mode === 'volume' || c.mode === 'off') {
      setVol(el, Math.max(0, Math.min(1, (c.volume || 0) / 100)));
      setMuted(el, !c.volume);
    }
  }

  P.play = function () {
    if (!active(this)) return origPlay.apply(this, arguments);
    const c = cfg();
    const user = gesture();
    if (c.mode === 'off' && !user && !this.dataset.rbeAllowed) {
      return Promise.resolve();               // swallow autoplay
    }
    if (user) this.dataset.rbeAllowed = '1';
    applyAudio(this, c);
    const el = this;
    return origPlay.call(this).catch(err => {
      if (err && err.name === 'NotAllowedError' && !el.muted) {
        setMuted(el, true);                    // browser refuses sound before first click → start muted
        waitingForGesture.add(el);
        return origPlay.call(el);
      }
      throw err;
    });
  };

  // Stop Reddit from overriding our audio level; accept changes that come from the user's own clicks.
  Object.defineProperty(P, 'muted', {
    configurable: true, enumerable: true,
    get() { return mutedDesc.get.call(this); },
    set(v) {
      if (active(this) && !this.dataset.rbeUserAudio) {
        if (gesture()) { this.dataset.rbeUserAudio = '1'; waitingForGesture.delete(this); }
        else return;                            // ignore page-initiated (un)mute
      }
      setMuted(this, v);
    }
  });
  Object.defineProperty(P, 'volume', {
    configurable: true, enumerable: true,
    get() { return volDesc.get.call(this); },
    set(v) {
      if (active(this) && !this.dataset.rbeUserAudio) {
        if (gesture()) this.dataset.rbeUserAudio = '1';
        else return;
      }
      setVol(this, v);
    }
  });

  // Native autoplay attribute bypasses play(); neuter it when autoplay is off.
  const autoDesc = Object.getOwnPropertyDescriptor(P, 'autoplay');
  Object.defineProperty(P, 'autoplay', {
    configurable: true, enumerable: true,
    get() { return autoDesc.get.call(this); },
    set(v) { if (v && active(this) && cfg().mode === 'off') return; autoDesc.set.call(this, v); }
  });
})();
