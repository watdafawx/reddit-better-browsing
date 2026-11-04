/* Core helpers: settings, one shared DOM observer, DOM builder, fetch */
(() => {
  const listeners = new Set();
  // Last known settings in the page's localStorage, so the first video gets the right audio
  // before the async storage read finishes.
  const SNAP = 'igb-settings-snapshot';
  let snap = null;
  try { snap = JSON.parse(localStorage.getItem(SNAP) || 'null'); } catch {}
  IGB.settings = IGB.mergeSettings(snap);
  IGB.onSettings = fn => { listeners.add(fn); fn(IGB.settings); };

  const publish = s => {
    IGB.settings = s;
    try { localStorage.setItem(SNAP, JSON.stringify(s)); } catch {}
    listeners.forEach(fn => { try { fn(s); } catch (e) { console.error('[IGB]', e); } });
  };
  IGB.ready = IGB.loadSettings().then(s => {
    if (JSON.stringify(s) !== JSON.stringify(IGB.settings)) publish(s);
  });
  IGB.api?.storage?.onChanged.addListener(async (changes, area) => {
    if (area === 'sync' && changes.settings) publish(await IGB.loadSettings());
  });

  // One MutationObserver for everything; each subscriber runs at most once per `delay` ms.
  const subs = [];
  IGB.onDomChange = (fn, delay = 250) => subs.push({ fn, delay, t: 0 });
  new MutationObserver(() => {
    for (const s of subs) {
      if (s.t) continue;
      s.t = setTimeout(() => { s.t = 0; try { s.fn(); } catch (e) { console.error('[IGB]', e); } }, s.delay);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  IGB.h = function h(tag, props, ...kids) {
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

  // Firefox: page-context fetch so cookies behave like Instagram's own requests.
  const pageFetch = (typeof content !== 'undefined' && content && content.fetch) ? content.fetch.bind(content) : fetch.bind(globalThis);
  IGB.getJSON = async function (path) {
    const r = await pageFetch(location.origin + path, {
      credentials: 'include',
      headers: { Accept: 'application/json', 'X-IG-App-ID': '936619743392459', 'X-Requested-With': 'XMLHttpRequest' }
    });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + path);
    return r.json();
  };
})();
