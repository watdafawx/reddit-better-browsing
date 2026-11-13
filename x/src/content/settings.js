/* Settings without leaving X: a gear entry in X's left sidebar and Alt+W, both opening the settings
   form in a panel over the page (XBB.openSettings, made in build.js with userscript/panel.js). */
(() => {
  const LABEL = 'Better Browsing';

  XBB.settingsOpen = () => !!document.querySelector('.xbb-settings');

  addEventListener('keydown', e => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyW') { e.preventDefault(); e.stopPropagation(); XBB.openSettings(); }
  }, true);

  // ---------- sidebar entry ----------
  // Clone one of X's own left-nav links so ours matches the current look (icons only or icons with labels),
  // then swap the icon, label and behaviour. Found by href, never by class name.
  const GEAR = '<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" fill="none" stroke="currentColor" stroke-width="2"/>' +
    '<path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.1-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.1 1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>';
  function addGear() {
    if (!XBB.settings.settingsGear) { document.querySelectorAll('.xbb-gear').forEach(g => g.remove()); return; }
    const nav = document.querySelector('nav[aria-label="Primary"], header nav[role="navigation"]');
    if (!nav || nav.querySelector(':scope > .xbb-gear')) return;
    // Clone a plain entry (Bookmarks, else Explore) so ours matches the current look
    const src = nav.querySelector(':scope > a[href="/i/bookmarks"]') || nav.querySelector(':scope > a[href="/explore"]') || nav.querySelector(':scope > a[href]');
    if (!src) return;
    const gear = src.cloneNode(true);
    gear.classList.add('xbb-gear');
    gear.removeAttribute('data-testid');
    gear.removeAttribute('aria-label');
    gear.setAttribute('href', '#');
    gear.setAttribute('role', 'button');
    gear.setAttribute('title', LABEL + ' settings (Alt+W)');
    gear.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); XBB.openSettings(); });
    const svg = gear.querySelector('svg');
    if (svg) { svg.innerHTML = GEAR; svg.setAttribute('aria-label', LABEL); svg.setAttribute('viewBox', '0 0 24 24'); }
    const walk = document.createTreeWalker(gear, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) if (walk.currentNode.textContent.trim() && !walk.currentNode.parentElement.closest('svg')) walk.currentNode.textContent = LABEL;
    [...nav.querySelectorAll(':scope > a')].pop().after(gear);   // after the last link (Profile), before More
  }
  XBB.onSettings(addGear);
  XBB.onDomChange(addGear, 600);
})();
