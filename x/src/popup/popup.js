/* Settings form: every [data-key] input maps to one key of storage.sync `settings`.
   Mounted by the userscript's settings panel (userscript/panel.js) on its shadow root. */
XBB.mountSettings = async function (root) {
  const inputs = [...root.querySelectorAll('[data-key]')];
  const s = await XBB.loadSettings();

  for (const el of inputs) {
    const v = s[el.dataset.key];
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
    const out = el.parentElement.querySelector('output');
    if (out) out.textContent = el.value;
  }

  let t = 0;
  const saved = root.querySelector('#saved');
  async function save(key, value) {
    // read-modify-write so we never clobber keys changed elsewhere
    const cur = (await XBB.api.storage.sync.get('settings')).settings || {};
    cur[key] = value;
    await XBB.api.storage.sync.set({ settings: cur });
    if (saved) { saved.classList.add('on'); clearTimeout(t); t = setTimeout(() => saved.classList.remove('on'), 900); }
  }
  for (const el of inputs) el.addEventListener(el.type === 'range' ? 'input' : 'change', () => {
    const v = el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.value;
    const out = el.parentElement.querySelector('output');
    if (out) out.textContent = el.value;
    save(el.dataset.key, v);
  });
};
