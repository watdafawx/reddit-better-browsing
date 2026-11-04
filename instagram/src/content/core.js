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

  // Line icons in the style of Instagram's own (24px, 2px stroke, currentColor)
  const ICONS = {
    download: '<path d="M12 3.5v11m0 0-4.5-4.5m4.5 4.5 4.5-4.5"/><path d="M4 16.5v2A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5v-2"/>',
    downloadAll: '<rect x="7.5" y="2.5" width="14" height="14" rx="2.5"/><path d="M3 7v11.5A2.5 2.5 0 0 0 5.5 21H17"/><path d="M14.5 6v6.5m0 0-3-3m3 3 3-3"/>',
    open: '<path d="M14 3h7v7m0-7-9 9"/><path d="M19 14v4.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 3 18.5v-11A2.5 2.5 0 0 1 5.5 5H10"/>',
    link: '<path d="M10.5 13.5a4.6 4.6 0 0 0 6.5 0l3-3a4.6 4.6 0 0 0-6.5-6.5L12 5.5"/><path d="M13.5 10.5a4.6 4.6 0 0 0-6.5 0l-3 3a4.6 4.6 0 0 0 6.5 6.5l1.5-1.5"/>',
    notInterested: '<circle cx="12" cy="12" r="9.5"/><path d="m5.3 5.3 13.4 13.4"/>',
    autoScroll: '<rect x="5.5" y="2" width="13" height="14" rx="2.5"/><path d="m8 18.5 4 3 4-3"/>'
  };
  IGB.icon = name => {
    const s = document.createElement('span');
    s.className = 'igb-ico';
    s.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
    return s;
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
  // Change one setting: read-modify-write so keys changed elsewhere are kept
  IGB.saveSetting = async (key, value) => {
    const cur = (await IGB.api.storage.sync.get('settings')).settings || {};
    cur[key] = value;
    await IGB.api.storage.sync.set({ settings: cur });
  };
  // Form POST the way Instagram's web app sends them: CSRF token from the cookie, plus the
  // www-claim header Instagram keeps in sessionStorage.
  IGB.postForm = async function (path, data) {
    const csrf = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)?.[1] || '';
    let claim = '0';
    try { claim = sessionStorage.getItem('www-claim-v2') || '0'; } catch {}
    const r = await pageFetch(location.origin + path, {
      method: 'POST', credentials: 'include',
      headers: {
        Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded',
        'X-CSRFToken': csrf, 'X-IG-App-ID': '936619743392459', 'X-IG-WWW-Claim': claim, 'X-Requested-With': 'XMLHttpRequest'
      },
      body: new URLSearchParams(data).toString()
    });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + path);
    const j = await r.json().catch(() => ({}));
    if (j.status && j.status !== 'ok') throw new Error(j.message || 'status ' + j.status);
    return j;
  };
})();
