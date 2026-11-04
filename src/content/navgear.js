/* Settings gear in Reddit's top nav bar: opens the extension settings in a panel over the page */
(() => {
  const h = (...a) => RBE.h(...a);
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function gearIcon() {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG_NS, 'path');
    // outline style, like Reddit's own header icons
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.6');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('d', 'M19.14 12.94a7.5 7.5 0 0 0 .05-.94 7.5 7.5 0 0 0-.05-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.8a.5.5 0 0 0-.5.42l-.36 2.54c-.58.24-1.12.55-1.62.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.48a.5.5 0 0 0 .12.64l2.03 1.58a7.5 7.5 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.39 1.04.7 1.62.94l.36 2.54a.5.5 0 0 0 .5.42h3.8a.5.5 0 0 0 .5-.42l.36-2.54c.58-.24 1.12-.55 1.62-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z');
    svg.append(path);
    return svg;
  }

  // ---------- settings panel ----------
  let panel = null;
  function closePanel() {
    if (!panel) return;
    panel.remove(); panel = null;
    window.removeEventListener('keydown', onKey, true);
    gear?.classList.remove('on');
  }
  function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closePanel(); } }
  function openPanel(anchor) {
    if (RBE.openSettingsInPage) return RBE.openSettingsInPage();   // userscript: no extension page to frame
    if (panel) return closePanel();
    const frame = h('iframe', { class: 'rbe-settings-frame', src: RBE.api.runtime.getURL('popup/popup.html?embed=1'), title: 'Reddit Better Browsing settings' });
    const box = h('div', { class: 'rbe-settings-box' }, frame);
    panel = h('div', { class: 'rbe-root rbe-settings-ov' }, box);
    panel.addEventListener('click', e => { if (e.target === panel) closePanel(); });
    // place under the gear, kept on screen
    const r = anchor ? anchor.getBoundingClientRect() : null;
    if (r && r.bottom > 0) {
      box.style.top = Math.round(r.bottom + 8) + 'px';
      box.style.right = Math.max(8, Math.round(window.innerWidth - r.right - 8)) + 'px';
    } else {
      box.style.top = '64px'; box.style.right = '16px';
    }
    document.documentElement.append(panel);
    window.addEventListener('keydown', onKey, true);
    gear?.classList.add('on');
  }
  RBE.openSettingsPanel = () => openPanel(gear && gear.isConnected ? gear : null);

  // ---------- gear button in the nav bar ----------
  let gear = null;
  function makeGear() {
    const b = h('button', { class: 'rbe-root rbe-nav-gear', type: 'button', title: 'Reddit Better Browsing settings', 'aria-label': 'Reddit Better Browsing settings' });
    b.append(gearIcon());
    // keep Reddit's header handlers (menus that open on pointer/mouse down) from seeing our clicks
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'touchstart'].forEach(t => b.addEventListener(t, e => e.stopPropagation()));
    b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); openPanel(b); });
    return b;
  }

  // Search the light DOM and open shadow roots (Reddit's header uses web components)
  function deepFind(root, sel, depth = 0) {
    if (root.shadowRoot && depth === 0) { const x = deepFind(root.shadowRoot, sel, 1); if (x) return x; }
    const hit = root.querySelector(sel);
    if (hit || depth > 3) return hit;
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) { const x = deepFind(el.shadowRoot, sel, depth + 1); if (x) return x; }
    }
    return null;
  }
  // The gear goes right after the chat icon; the rest are fallbacks (gear goes before them)
  const CHAT = ['#header-action-item-chat-button', 'faceplate-tracker[noun="chat"]', 'a[href^="https://chat.reddit.com"]', 'button[aria-label*="chat" i]', 'a[aria-label*="chat" i]'];
  const FALLBACK = ['faceplate-tracker[noun="inbox"]', '#create-post', 'a[href="/submit"]', '#expand-user-drawer-button', '#login-button', 'faceplate-tracker[noun="login"]'];

  // Make the gear look like the chat button: same box size, padding, shape, color and icon size
  function matchStyle(ref) {
    const btn = ref.matches('button, a') ? ref : (ref.querySelector('button, a') || ref);
    const cs = getComputedStyle(btn);
    if (!parseFloat(cs.width)) return;
    Object.assign(gear.style, {
      width: cs.width, height: cs.height, padding: cs.padding, margin: cs.margin,
      borderRadius: cs.borderRadius, color: cs.color,
    });
    const icon = btn.querySelector('svg, icon-chat, [icon-name]');
    const size = icon ? Math.round(icon.getBoundingClientRect().width) : 0;
    const svg = gear.querySelector('svg');
    if (size >= 12 && size <= 32) { svg.setAttribute('width', size); svg.setAttribute('height', size); }
    gear.classList.add('matched');
  }

  // Climb out of the anchor's own wrappers (e.g. a dropdown, which would treat our clicks as its own)
  // until we reach the row that holds the other visible header buttons.
  function rowItem(anchor, header) {
    let item = anchor;
    while (item.parentElement && item.parentElement !== header) {
      const p = item.parentElement;
      const visibleSiblings = [...p.children].filter(c => c !== item && c !== gear && c.getBoundingClientRect().width > 8);
      if (visibleSiblings.length && !p.matches('faceplate-dropdown-menu, faceplate-tracker, activate-feature, details, label, button, a')) break;
      item = p;
    }
    return item;
  }

  function placeGear() {
    if (!RBE.settings.navGear) { gear?.remove(); return; }
    if (gear && gear.isConnected) return;
    const header = document.querySelector('reddit-header-large, reddit-header-small, header');
    if (!header) return;
    let chat = null, other = null;
    for (const sel of CHAT) { chat = deepFind(header, sel); if (chat) break; }
    if (!chat) for (const sel of FALLBACK) { other = deepFind(header, sel); if (other) break; }
    if (!chat && !other) return;
    gear = gear || makeGear();
    gear.classList.remove('left');
    if (chat) rowItem(chat, header).after(gear);
    else rowItem(other, header).before(gear);
    matchStyle(chat || other);
    // Reddit's right-hand header area has a fixed width; if we pushed something off screen, sit next to the logo instead
    requestAnimationFrame(() => {
      if (!gear.isConnected || !overflows(gear.parentElement)) return;
      const logo = deepFind(header, '#reddit-logo') || deepFind(header, 'a[aria-label*="Home" i]') || deepFind(header, 'a[href="/"]');
      if (logo) { gear.classList.add('left'); logo.after(gear); }
    });
  }
  function overflows(row) {
    if (!row) return false;
    if (row.scrollWidth > row.clientWidth + 1) return true;
    return [...row.children].some(c => c.getBoundingClientRect().right > window.innerWidth - 2);
  }

  let t = null;
  const schedule = () => { if (t) return; t = setTimeout(() => { t = null; placeGear(); }, 400); };
  RBE.onDomChange(placeGear, 400);
  RBE.onSettings(() => schedule());
})();
