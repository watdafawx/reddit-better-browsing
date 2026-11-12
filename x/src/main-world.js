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
  // Remember the audio state our own writes leave, so the volumechange they cause is never taken
  // for the user's (that made a video we had to mute stay muted for good).
  const mine = new WeakMap();
  const note = el => mine.set(el, [mutedDesc.get.call(el), volDesc.get.call(el)]);
  const setMuted = (el, v) => { mutedDesc.set.call(el, v); note(el); };
  const setVol = (el, v) => { volDesc.set.call(el, v); note(el); };
  const isMine = el => { const m = mine.get(el); return !!m && m[0] === el.muted && Math.abs(m[1] - el.volume) < 0.01; };

  // ---------- debug log: off unless localStorage 'bb-debug' is '1' (then reload). Every play, pause and
  // audio change of a page video, with who did it: "by page" = the site's own code (with where it was
  // called from), "we ..." = these hooks; a bare "event pause" with no call before it comes from the
  // content script ([BB content] lines) or the browser itself.
  const DBG = (() => { try { return localStorage.getItem('bb-debug') === '1'; } catch { return false; } })();
  const caller = () => { const l = (new Error().stack || '').split('\n').filter(s => s && s !== 'Error'); return l.slice(2, 4).map(s => s.trim().replace(/^at /, '').slice(-80)).join(' < '); };
  const dbg = DBG ? (el, what) => {
    if (!el.dataset.bbDbg) el.dataset.bbDbg = Math.random().toString(36).slice(2, 6);
    const ua = navigator.userActivation;
    let pol = '-'; try { if (navigator.getAutoplayPolicy) pol = navigator.getAutoplayPolicy(el); } catch {}
    console.log(`[BB page ${(performance.now() / 1000).toFixed(2)}] ${el.dataset.bbDbg} ${what} | ${el.paused ? 'paused' : 'playing'} ${mutedDesc.get.call(el) ? 'muted' : 'sound'} vol=${volDesc.get.call(el).toFixed(2)} activated=${ua?.hasBeenActive ? 1 : 0}${ua?.isActive ? '+' : ''} policy=${pol}`);
  } : () => {};
  const watched = new WeakSet();
  const watch = DBG ? el => {
    if (!(el instanceof HTMLVideoElement) || watched.has(el)) return;
    watched.add(el);
    ['play', 'playing', 'pause', 'volumechange', 'emptied', 'ended'].forEach(t => el.addEventListener(t, () => dbg(el, 'event ' + t)));
  } : () => {};
  if (DBG) {
    console.log('[BB page] hooks loaded at ' + (performance.now() / 1000).toFixed(2) + 's');
    const origPause = P.pause;
    P.pause = function () { if (this instanceof HTMLVideoElement) { watch(this); dbg(this, 'pause() by page: ' + caller()); } return origPause.apply(this, arguments); };
    new MutationObserver(() => document.querySelectorAll('video').forEach(watch)).observe(document, { childList: true, subtree: true });
  }
  const activated = () => !!navigator.userActivation?.hasBeenActive;
  // May this video make sound now? Unmuting a playing video when it may not makes the browser pause it,
  // X then restarts it and the browser only lets it play muted: play, stop, play silent.
  const canSound = el => {
    try { if (navigator.getAutoplayPolicy) return navigator.getAutoplayPolicy(el) === 'allowed'; } catch {}
    return activated();
  };

  const PLAYER = '[data-testid="videoPlayer"]';
  let lastGesture = 0, lastTarget = null;
  const gesture = () => Date.now() - lastGesture < 1200;
  // A recent click/key on this video's own player (the video, its controls). Clicking elsewhere on the
  // page is a gesture too, but X's mute/pause right after it is not the user's choice.
  // Firefox never shows the page a click on a video's own controls, only the pointer resting on it and the
  // page's user activation: that counts as the user's too.
  let hover = null;
  ['mousemove', 'pointerover', 'mouseover'].forEach(t => window.addEventListener(t, e => { hover = e.target; }, { capture: true, passive: true }));
  const on = (el, t) => { if (!t) return false; if (t === el) return true; const p = el.closest(PLAYER); return !!p && p.contains(t); };
  const userOn = el => (gesture() && on(el, lastTarget)) || (!!navigator.userActivation?.isActive && on(el, hover));

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
    // focus moves by script too (X focuses things itself): only a focus with user activation is yours
    if (e.type === 'focusin' && !navigator.userActivation?.isActive) return;
    lastGesture = Date.now();
    lastTarget = e.type === 'keydown' ? (document.activeElement || e.target) : e.target;
    if (cfg.mode !== 'volume' || !level() || !activated()) return;
    for (const v of waiting) {
      if (v.isConnected && v.paused) continue;   // the playing handler unmutes it when it starts again
      if (v.isConnected && !v.dataset.xbbUserAudio) { dbg(v, 'we unmute: first ' + e.type); setVol(v, level()); setMuted(v, false); }
      waiting.delete(v);
    }
  };
  ['pointerdown', 'keydown', 'touchstart', 'focusin'].forEach(t => window.addEventListener(t, onGesture, true));

  function applyAudio(el) {
    if (el.dataset.xbbUserAudio) return;
    if (cfg.mode === 'muted') setMuted(el, true);
    else if (cfg.mode === 'volume' || cfg.mode === 'off') {
      setVol(el, level());
      // a playing muted video stays muted until it may make sound (unmuting it now would pause it)
      if (level() && el.muted && !el.paused && !canSound(el)) { dbg(el, 'we keep it muted until sound is allowed'); waiting.add(el); return; }
      if (DBG && el.muted === !!level()) dbg(el, 'we set ' + (level() ? 'sound' : 'muted'));
      setMuted(el, !level());
    }
  }

  // With one-at-a-time (or autoplay off), only the picked video, or one the user just started, may play.
  const gated = el => cfg.mode === 'off' || cfg.one;
  // Only the pick, or a video you just clicked yourself. Not "any video, for a while after any click": X
  // calls play() on its other videos after a key press or click, and once they were let through they were
  // let through for good, so X and our own pausing took turns in a tight loop (CPU spikes).
  const mayPlay = el => el.hasAttribute('data-xbb-pick') || userOn(el);

  P.play = function () {
    if (!active(this)) return origPlay.apply(this, arguments);
    if (DBG) { watch(this); dbg(this, 'play() by page: ' + caller() + (gated(this) && !mayPlay(this) ? ' -> SWALLOWED (not the pick)' : '')); }
    if (gated(this) && !mayPlay(this)) return Promise.resolve();   // swallow X's autoplay
    applyAudio(this);
    const el = this;
    return origPlay.call(this).catch(err => {
      dbg(el, 'play() refused: ' + err?.name);
      if (err && err.name === 'NotAllowedError' && !el.muted) {
        dbg(el, 'we retry muted');
        setMuted(el, true); // browser refuses sound before the first click: start muted, unmute on first gesture
        waiting.add(el);
        return origPlay.call(el).catch(e => { if (e?.name !== 'AbortError') throw e; });
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
    set(v) { const ok = userWrite(this); if (DBG && active(this)) { watch(this); dbg(this, 'page sets muted=' + v + (ok ? ' (yours)' : ' -> IGNORED') + ': ' + caller()); } if (ok) setMuted(this, v); }
  });
  Object.defineProperty(P, 'volume', {
    configurable: true, enumerable: true,
    get() { return volDesc.get.call(this); },
    set(v) { const ok = userWrite(this); if (DBG && active(this)) { watch(this); dbg(this, 'page sets volume=' + (+v).toFixed(2) + (ok ? ' (yours)' : ' -> IGNORED') + ': ' + caller()); } if (ok) setVol(this, v); }
  });
  // The autoplay attribute bypasses play(); neuter it when autoplay is gated.
  Object.defineProperty(P, 'autoplay', {
    configurable: true, enumerable: true,
    get() { return autoDesc.get.call(this); },
    set(v) { if (v && active(this) && gated(this)) return; autoDesc.set.call(this, v); }
  });

  // React sets `muted` as a property on mount, before play(); re-apply our level when playback starts.
  // Before the page has had a click, unmuting would make the browser pause the video: wait for the click.
  document.addEventListener('playing', e => {
    const v = e.target;
    if (!active(v)) return;
    if (v.muted && cfg.mode === 'volume' && !canSound(v)) { waiting.add(v); return; }
    if (waiting.has(v) && activated()) waiting.delete(v);
    if (!waiting.has(v)) applyAudio(v);
  }, true);

  // Safety net: a playing video that is muted though the user never muted it gets our level back.
  // Only after the page has had a click or key press (unmuting before that pauses the video).
  setInterval(() => {
    if (cfg.mode !== 'volume' || !level() || document.hidden || !activated()) return;
    for (const v of document.querySelectorAll('video')) {
      if (v.paused || !v.muted || v.dataset.xbbUserAudio || !active(v) || !canSound(v)) continue;
      waiting.delete(v);
      dbg(v, 'we unmute: safety net');
      setVol(v, level());
      setMuted(v, false);
    }
  }, 600);

  // The browser's own controls change volume/mute without going through the setters above. A change on
  // this player that differs from our level is the user's: keep it for this video, and a volume they
  // set (not a mute) becomes the level for the videos after it.
  document.addEventListener('volumechange', e => {
    const v = e.target;
    if (!active(v) || v.dataset.xbbUserAudio || isMine(v) || !userOn(v)) return;
    const want = cfg.mode === 'muted' ? null : level();
    const same = want === null ? v.muted : v.muted === (want === 0) && Math.abs(v.volume - want) < 0.01;
    if (same) return;
    dbg(v, 'audio change taken as yours (browser controls)');
    v.dataset.xbbUserAudio = '1';
    waiting.delete(v);
    if (!v.muted && v.volume > 0 && cfg.mode !== 'muted') sessionVol = v.volume;
  }, true);
})();
