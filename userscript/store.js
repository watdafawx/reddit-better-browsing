/* Shared by all three sites: the storage part of the extension API (`<site>.api.storage`), kept in the
   page's localStorage under one key. build.js puts this once at the top of the userscript.
   Layouts differ and must stay as they are, or users lose their settings: Reddit keeps both areas,
   { sync: {...}, local: {...} } (nested), Instagram and X keep only the sync area, flat. */
const bbStore = (key, nested = false) => {
  const subs = new Set();
  const readAll = () => { try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; } };
  const keyList = keys => keys == null ? null : Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys);
  const notify = (changes, name) => subs.forEach(fn => { try { fn(changes, name); } catch (e) { console.error('[BB]', e); } });
  // fn gets this area's object, changes it in place, returns the changes
  const change = (name, fn) => {
    const all = readAll(), a = nested ? (all[name] = all[name] || {}) : all;
    const changes = fn(a);
    localStorage.setItem(key, JSON.stringify(all));
    notify(changes, name);
  };
  const area = name => ({
    async get(keys) {
      const a = (nested ? readAll()[name] : readAll()) || {}, ks = keyList(keys);
      if (!ks) return { ...a };
      const out = {};
      for (const k of ks) if (k in a) out[k] = a[k];
      return out;
    },
    async set(obj) {
      change(name, a => {
        const changes = {};
        for (const [k, v] of Object.entries(obj)) { changes[k] = { oldValue: a[k], newValue: v }; a[k] = v; }
        return changes;
      });
    },
    async remove(keys) {
      change(name, a => {
        const changes = {};
        for (const k of keyList(keys) || []) { changes[k] = { oldValue: a[k] }; delete a[k]; }
        return changes;
      });
    }
  });
  // Another tab changed the settings
  addEventListener('storage', e => {
    if (e.key !== key) return;
    notify({ settings: {} }, 'sync');
    if (nested) notify({ customCss: {} }, 'local');
  });
  const storage = { sync: area('sync'), onChanged: { addListener: fn => subs.add(fn) } };
  if (nested) storage.local = area('local');
  return { storage };
};
