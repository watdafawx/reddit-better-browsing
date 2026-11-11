/* Userscript only: stand-in for the extension storage API, kept in the page's localStorage. */
(() => {
  const KEY = 'xbb-userscript-settings';
  const subs = new Set();
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
  XBB.api = {
    storage: {
      sync: {
        get: async () => ({ settings: read().settings }),
        set: async obj => {
          const cur = Object.assign(read(), obj);
          localStorage.setItem(KEY, JSON.stringify(cur));
          subs.forEach(fn => fn({ settings: { newValue: cur.settings } }, 'sync'));
        }
      },
      onChanged: { addListener: fn => subs.add(fn) }
    }
  };
  // Another tab changed the settings
  addEventListener('storage', e => { if (e.key === KEY) subs.forEach(fn => fn({ settings: {} }, 'sync')); });
})();
