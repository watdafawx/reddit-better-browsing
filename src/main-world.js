/* Runs in the PAGE's JS world so it can control Reddit's own players (including ones inside shadow DOM).
   Settings arrive from the content script via <html data-rbe-video='{"mode":"volume","volume":10}'>. */
(() => {
  if (window.__rbeMainWorld) return;
  window.__rbeMainWorld = true;

  const P = HTMLMediaElement.prototype;
  const origPlay = P.play;
  const mutedDesc = Object.getOwnPropertyDescriptor(P, 'muted');
  const volDesc = Object.getOwnPropertyDescriptor(P, 'volume');
  // Remember the audio state our own writes leave, so the volumechange they cause is never taken
  // for the user's (that made a video we had to mute stay muted for good).
  const mine = new WeakMap();
  const note = el => mine.set(el, [mutedDesc.get.call(el), volDesc.get.call(el)]);
  const setMuted = (el, v) => { mutedDesc.set.call(el, v); note(el); };
  const setVol = (el, v) => { volDesc.set.call(el, v); note(el); };
  const isMine = el => { const m = mine.get(el); return !!m && m[0] === el.muted && Math.abs(m[1] - el.volume) < 0.01; };

  let lastGesture = 0, lastTarget = null;
  const gesture = () => Date.now() - lastGesture < 1200 || !!(navigator.userActivation && navigator.userActivation.isActive && Date.now() - lastGesture < 5000);
  // A recent click/key on THIS video's own player (the video, its controls, across shadow DOM).
  // A click elsewhere doesn't make Reddit's mute of a player the user's choice. Clicks on the rest
  // of the post (upvote, comments, title, Join) used to count because the walk up from the video
  // reaches the shared <article>; that made Reddit's mute of the video stick, so a video that
  // started with sound went back to muted. Inside a shadow root only that same root counts; in the
  // light DOM the player's own container is at most a couple of levels up.
  const userOn = el => {
    if (!gesture() || !lastTarget) return false;
    const root = el.getRootNode();
    if (root !== document) return lastTarget === el || lastTarget === root.host || !!root.contains?.(lastTarget);
    let p = el;
    for (let i = 0; i < 3 && p; i++, p = p.parentElement) if (p.contains(lastTarget)) return true;
    return false;
  };
  const activated = () => !!navigator.userActivation?.hasBeenActive;
  // May this video make sound now? Unmuting a playing video when it may not makes the browser pause it,
  // the page's player then restarts it and the browser only lets it play muted: play, stop, play silent.
  const canSound = el => {
    try { if (navigator.getAutoplayPolicy) return navigator.getAutoplayPolicy(el) === 'allowed'; } catch {}
    return activated();
  };
  // Parse the settings attribute only when it changes (the setters below run on every volume/mute write)
  let cfgCache = {};
  const readCfg = () => { try { cfgCache = JSON.parse(document.documentElement.dataset.rbeVideo || '{}'); } catch { cfgCache = {}; } };
  readCfg();
  new MutationObserver(readCfg).observe(document.documentElement, { attributes: true, attributeFilter: ['data-rbe-video'] });
  const cfg = () => cfgCache;
  const active = el => { const m = cfgCache.mode; return !!m && m !== 'default' && el instanceof HTMLVideoElement && !el.closest?.('.rbe-root'); };

  // Videos that had to start muted because the browser blocked audible autoplay; unmute on first interaction.
  const waitingForGesture = new Set();
  const onGesture = e => {
    lastGesture = Date.now();
    lastTarget = e.type === 'keydown' ? (document.activeElement || e.target) : e.target;
    const c = cfg();
    if (c.mode !== 'volume' || !c.volume || !activated()) return;
    for (const v of waitingForGesture) {
      if (!v.isConnected) { waitingForGesture.delete(v); continue; }
      if (v.paused) continue;               // the playing handler unmutes it when it starts again
      if (!v.dataset.rbeUserAudio) { setVol(v, c.volume / 100); setMuted(v, false); }
      waitingForGesture.delete(v);
    }
  };
  ['pointerdown', 'keydown', 'touchstart'].forEach(t => window.addEventListener(t, onGesture, true));

  function applyAudio(el, c) {
    if (el.dataset.rbeUserAudio) return;
    if (c.mode === 'muted') setMuted(el, true);
    else if (c.mode === 'volume' || c.mode === 'off') {
      setVol(el, Math.max(0, Math.min(1, (c.volume || 0) / 100)));
      // a playing muted video stays muted until it may make sound (unmuting it now would pause it)
      if (c.volume && el.muted && !el.paused && !canSound(el)) { waitingForGesture.add(el); return; }
      setMuted(el, !c.volume);
    }
  }

  // While our lightbox is open (<html data-rbe-lb>), Reddit's players behind it stay paused.
  const lbOpen = () => document.documentElement.hasAttribute('data-rbe-lb');
  const behindLb = el => lbOpen() && el instanceof HTMLVideoElement && !el.closest?.('.rbe-root');
  function pausePlayed() { for (const v of played) { if (!v.isConnected) played.delete(v); else if (!v.paused) v.pause(); } }
  new MutationObserver(() => { if (lbOpen()) pausePlayed(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-rbe-lb'] });
  // players inside shadow roots: catch anything that starts anyway (autoplay attribute, internal resume)
  document.addEventListener('play', e => { if (behindLb(e.target)) e.target.pause(); }, true);
  const played = new Set();   // for the safety net below (media events don't leave shadow roots)
  P.play = function () {
    if (behindLb(this)) return Promise.resolve();
    if (this instanceof HTMLVideoElement && !this.closest?.('.rbe-root')) { // so the lightbox can pause it, even inside shadow DOM
      if (played.size > 40) for (const v of played) if (!v.isConnected) played.delete(v);
      played.add(this);
    }
    if (!active(this)) return origPlay.apply(this, arguments);
    played.add(this);
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
        return origPlay.call(el).catch(e => { if (e?.name !== 'AbortError') throw e; });
      }
      throw err;
    });
  };

  const wantMuted = c => c.mode === 'muted' || !c.volume;
  const wantVol = c => Math.max(0, Math.min(1, (c.volume || 0) / 100));

  // Stop Reddit from overriding our audio level; accept changes that come from the user's own clicks.
  Object.defineProperty(P, 'muted', {
    configurable: true, enumerable: true,
    get() { return mutedDesc.get.call(this); },
    set(v) {
      if (active(this) && !this.dataset.rbeUserAudio) {
        if (!userOn(this)) return;               // ignore page-initiated (un)mute
        // Only a change that leaves the video away from our level needs protecting from the
        // safety net below. An unmute that lands on our level must not switch that net off.
        if (!!v !== wantMuted(cfg())) this.dataset.rbeUserAudio = '1';
        waitingForGesture.delete(this);
      }
      setMuted(this, v);
    }
  });
  Object.defineProperty(P, 'volume', {
    configurable: true, enumerable: true,
    get() { return volDesc.get.call(this); },
    set(v) {
      if (active(this) && !this.dataset.rbeUserAudio) {
        if (!userOn(this)) return;
        if (Math.abs(v - wantVol(cfg())) > 0.01) this.dataset.rbeUserAudio = '1';
      }
      setVol(this, v);
    }
  });

  // Re-apply our level when playback starts (players set `muted` on mount, before play()).
  // A video still waiting for a click is fine to unmute once the page has had one.
  document.addEventListener('playing', e => {
    const v = e.target;
    if (!active(v)) return;
    if (waitingForGesture.has(v) && activated()) waitingForGesture.delete(v);
    if (!waitingForGesture.has(v)) applyAudio(v, cfg());
  }, true);
  // The browser's own controls change volume/mute without the setters above: a change on this
  // player that differs from our level is the user's, and sticks.
  document.addEventListener('volumechange', e => {
    const v = e.target, c = cfg();
    if (!active(v) || v.dataset.rbeUserAudio || isMine(v) || !userOn(v)) return;
    const want = c.mode === 'muted' ? null : Math.max(0, Math.min(1, (c.volume || 0) / 100));
    const ours = want === null ? v.muted : v.muted === (want === 0) && Math.abs(v.volume - want) < 0.01;
    if (!ours) { v.dataset.rbeUserAudio = '1'; waitingForGesture.delete(v); }
  }, true);

  // Safety net: a playing video that is muted (or silent, e.g. volume left at 0) though the user
  // never changed its audio gets our level back. Only after the page has had a click or key press:
  // unmuting before that makes the browser pause it.
  // Videos inside shadow roots don't show up in querySelectorAll, so track what has played.
  document.addEventListener('play', e => { if (active(e.target)) played.add(e.target); }, true);
  setInterval(() => {
    const c = cfg();
    if (c.mode !== 'volume' || !c.volume || document.hidden || !activated()) return;
    const want = wantVol(c);
    for (const v of played) {
      if (!v.isConnected) { played.delete(v); continue; }
      if (v.paused || v.dataset.rbeUserAudio || !active(v) || !canSound(v)) continue;
      if (!v.muted && Math.abs(v.volume - want) < 0.01) continue;
      waitingForGesture.delete(v);
      setVol(v, want);
      setMuted(v, false);
    }
  }, 600);

  // Native autoplay attribute bypasses play(); neuter it when autoplay is off.
  const autoDesc = Object.getOwnPropertyDescriptor(P, 'autoplay');
  Object.defineProperty(P, 'autoplay', {
    configurable: true, enumerable: true,
    get() { return autoDesc.get.call(this); },
    set(v) { if (v && active(this) && cfg().mode === 'off') return; autoDesc.set.call(this, v); }
  });
})();
