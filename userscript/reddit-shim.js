/* Userscript only (Reddit): stand-in for the extension APIs. Settings live in the page's
   localStorage; hls.js comes from inside the script (RBE_LOAD_HLS, added by build.js) instead of
   the background page; account switching needs cookie access, so it stays an extension feature. */
(() => {
  const KEY = 'rbe-userscript-storage';
  const subs = new Set();
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
  const write = all => localStorage.setItem(KEY, JSON.stringify(all));
  const keyList = keys => keys == null ? null : Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys);
  const notify = (changes, name) => subs.forEach(fn => { try { fn(changes, name); } catch (e) { console.error('[RBE]', e); } });

  const area = name => ({
    async get(keys) {
      const all = read()[name] || {};
      const ks = keyList(keys);
      if (!ks) return { ...all };
      const out = {};
      for (const k of ks) if (k in all) out[k] = all[k];
      return out;
    },
    async set(obj) {
      const all = read(), a = all[name] = all[name] || {}, changes = {};
      for (const [k, v] of Object.entries(obj)) { changes[k] = { oldValue: a[k], newValue: v }; a[k] = v; }
      write(all);
      notify(changes, name);
    },
    async remove(keys) {
      const all = read(), a = all[name] = all[name] || {}, changes = {};
      for (const k of keyList(keys) || []) { changes[k] = { oldValue: a[k] }; delete a[k]; }
      write(all);
      notify(changes, name);
    }
  });

  RBE.userscript = true;
  RBE.api = {
    storage: { sync: area('sync'), local: area('local'), onChanged: { addListener: fn => subs.add(fn) } },
    runtime: {
      getURL: p => p,
      onMessage: { addListener() {} },
      async sendMessage(msg) {
        if (msg?.type === 'rbe:loadHls') {
          try { RBE_LOAD_HLS(); return globalThis.Hls ? { ok: true } : { error: 'hls.js did not load' }; }
          catch (e) { return { error: String(e?.message || e) }; }
        }
        return { error: 'Account switching needs the browser extension (it swaps Reddit’s login cookies).' };
      }
    }
  };
  // Another tab changed the settings
  addEventListener('storage', e => {
    if (e.key !== KEY) return;
    notify({ settings: {} }, 'sync');
    notify({ customCss: {} }, 'local');
  });
})();
