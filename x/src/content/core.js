/* Core helpers: settings, one shared DOM observer, DOM builder, icons */
(() => {
  const listeners = new Set();
  // Last known settings in the page's localStorage, so the first video gets the right audio
  // before the async storage read finishes.
  const SNAP = 'xbb-settings-snapshot';
  let snap = null;
  try { snap = JSON.parse(localStorage.getItem(SNAP) || 'null'); } catch {}
  XBB.settings = XBB.mergeSettings(snap);
  XBB.onSettings = fn => { listeners.add(fn); fn(XBB.settings); };

  const publish = s => {
    XBB.settings = s;
    try { localStorage.setItem(SNAP, JSON.stringify(s)); } catch {}
    listeners.forEach(fn => { try { fn(s); } catch (e) { console.error('[XBB]', e); } });
  };
  XBB.ready = XBB.loadSettings().then(s => {
    if (JSON.stringify(s) !== JSON.stringify(XBB.settings)) publish(s);
  });
  XBB.api?.storage?.onChanged.addListener(async (changes, area) => {
    if (area === 'sync' && changes.settings) publish(await XBB.loadSettings());
  });

  // One MutationObserver for everything; each subscriber runs at most once per `delay` ms.
  const subs = [];
  XBB.onDomChange = (fn, delay = 250) => subs.push({ fn, delay, t: 0 });
  new MutationObserver(() => {
    for (const s of subs) {
      if (s.t) continue;
      s.t = setTimeout(() => { s.t = 0; try { s.fn(); } catch (e) { console.error('[XBB]', e); } }, s.delay);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  XBB.h = function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat(Infinity)) {
      if (k == null || k === false) continue;
      el.append(k instanceof Node ? k : document.createTextNode(String(k)));
    }
    return el;
  };

  // Line icons (24px grid, 2px stroke, currentColor), drawn to sit next to X's own action icons
  const ICONS = {
    link: '<path d="M10.5 13.5a4.6 4.6 0 0 0 6.5 0l3-3a4.6 4.6 0 0 0-6.5-6.5L12 5.5"/><path d="M13.5 10.5a4.6 4.6 0 0 0-6.5 0l-3 3a4.6 4.6 0 0 0 6.5 6.5l1.5-1.5"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    // retweet arrows with a heart in the middle
    likeRetweet: '<path d="m17 2 3.5 3.5L17 9"/><path d="M3.5 11V9.5A4 4 0 0 1 7.5 5.5h13"/><path d="m7 22-3.5-3.5L7 15"/><path d="M20.5 13v1.5a4 4 0 0 1-4 4h-13"/>' +
      '<path d="M12 15.2s-3.2-1.9-3.2-4.2a1.7 1.7 0 0 1 3.2-.8 1.7 1.7 0 0 1 3.2.8c0 2.3-3.2 4.2-3.2 4.2Z" stroke-width="1.5"/>'
  };
  XBB.icon = name => {
    const s = document.createElement('span');
    s.className = 'xbb-ico';
    s.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
    return s;
  };
  // Change one setting: read-modify-write so keys changed elsewhere are kept
  XBB.saveSetting = async (key, value) => {
    const cur = (await XBB.api.storage.sync.get('settings')).settings || {};
    cur[key] = value;
    await XBB.api.storage.sync.set({ settings: cur });
  };
})();
