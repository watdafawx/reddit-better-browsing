/* Settings without leaving Instagram: a gear entry in Instagram's left sidebar and Alt+W, both opening
   the settings form in a panel over the page (IGB.openSettings, made in build.js with userscript/panel.js). */
(() => {
  const LABEL = 'Better Browsing';

  IGB.settingsOpen = () => !!document.querySelector('.igb-settings');

  addEventListener('keydown', e => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyW') { e.preventDefault(); e.stopPropagation(); IGB.openSettings(); }
  }, true);

  // ---------- sidebar entry ----------
  // Instagram's sidebar is a list of identical wrappers (Home, Reels, Messages, Search, ...). Clone the
  // Search one so ours matches the current look (collapsed icons or icons with labels), then swap the
  // icon, label and behaviour. Class names are generated, so nothing here depends on them.
  const GEAR = '<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" fill="none" stroke="currentColor" stroke-width="2"/>' +
    '<path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.1-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.1 1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>';
  function addGear() {
    if (!IGB.settings.settingsGear) { document.querySelectorAll('.igb-gear').forEach(g => g.remove()); return; }
    const explore = document.querySelector('a[href="/explore/"]'), reels = document.querySelector('a[href="/reels/"]');
    if (!explore || !reels) return;
    let list = explore.parentElement;
    while (list && !list.contains(reels)) list = list.parentElement;
    if (!list || list.querySelector(':scope > .igb-gear')) return;
    const src = [...list.children].find(c => c.contains(explore));
    const gear = src.cloneNode(true);
    gear.classList.add('igb-gear');
    const a = gear.querySelector('a[href="/explore/"]');
    a.setAttribute('href', '#');
    a.setAttribute('role', 'button');
    a.setAttribute('title', LABEL + ' settings (Alt+W)');
    a.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); IGB.openSettings(); });
    const svg = a.querySelector('svg');
    if (svg) { svg.innerHTML = `<title>${LABEL}</title>` + GEAR; svg.setAttribute('aria-label', LABEL); svg.setAttribute('viewBox', '0 0 24 24'); }
    const walk = document.createTreeWalker(a, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) if (walk.currentNode.textContent.trim() && !walk.currentNode.parentElement.closest('svg')) walk.currentNode.textContent = LABEL;
    // after the last entry (the profile link)
    list.append(gear);
  }
  IGB.onSettings(addGear);
  IGB.onDomChange(addGear, 600);
})();
