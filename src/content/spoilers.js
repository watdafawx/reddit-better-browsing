/* Spoiler / blur auto-reveal */
(() => {
  function revealBlurred(c) {
    if (c.dataset.rbeRevealed) return;
    c.dataset.rbeRevealed = '1';
    // Reddit's blurred container reveals when its overlay is clicked; do that without bubbling to the post link.
    const sr = c.shadowRoot;
    const btn = sr && (sr.querySelector('[class*="overlay" i] button, button, [role="button"], .overlay, [class*="blur" i]'));
    try {
      if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles: false, cancelable: true, composed: false }));
    } catch {}
    c.removeAttribute('blurred');
    c.setAttribute('mode', 'revealed');
    c.querySelectorAll('[slot="revealed"]').forEach(x => { x.hidden = false; x.style.display = ''; });
  }

  RBE.revealAll = function (force) {
    const s = RBE.settings;
    document.querySelectorAll('.md-spoiler-text:not(.revealed), span[class*="spoiler" i]:not(.revealed)').forEach(el => {
      el.classList.add('revealed'); el.setAttribute('data-revealed', 'true'); el.removeAttribute('aria-hidden');
    });
    document.querySelectorAll('shreddit-blurred-container:not([data-rbe-revealed])').forEach(c => {
      const reason = (c.getAttribute('reason') || '').toLowerCase();
      if (force || (reason === 'spoiler' && s.revealSpoilers) || (reason === 'nsfw' && s.nsfwMode === 'show') || (!reason && s.revealSpoilers)) revealBlurred(c);
    });
    document.querySelectorAll('.rbe-root .md-spoiler-text').forEach(el => el.classList.add('revealed'));
  };

  const run = () => { const s = RBE.settings; if (s.revealSpoilers || s.nsfwMode === 'show') RBE.revealAll(false); };
  RBE.onDomChange(run, 250);
  RBE.onSettings(run);

  // Click-to-reveal for spoilers inside our own viewer
  document.addEventListener('click', e => {
    const sp = e.target.closest?.('.rbe-root .md-spoiler-text:not(.revealed)');
    if (sp) { sp.classList.add('revealed'); e.preventDefault(); e.stopPropagation(); }
  }, true);
})();
