/* Settings form: every [data-key] input maps to one key of storage.sync `settings`.
   The popup mounts it on its own document; the userscript mounts it inside an in-page panel. */
IGB.mountSettings = async function (root) {
  const inputs = [...root.querySelectorAll('[data-key]')];
  const s = await IGB.loadSettings();

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
    const cur = (await IGB.api.storage.sync.get('settings')).settings || {};
    cur[key] = value;
    await IGB.api.storage.sync.set({ settings: cur });
    if (saved) { saved.classList.add('on'); clearTimeout(t); t = setTimeout(() => saved.classList.remove('on'), 900); }
  }
  for (const el of inputs) el.addEventListener(el.type === 'range' ? 'input' : 'change', () => {
    const v = el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.value;
    const out = el.parentElement.querySelector('output');
    if (out) out.textContent = el.value;
    save(el.dataset.key, v);
  });
};
if (location.protocol.endsWith('extension:')) IGB.mountSettings(document);
