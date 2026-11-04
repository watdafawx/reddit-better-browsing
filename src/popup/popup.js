/* Settings form. The extension popup (and the settings frame on reddit.com) mounts it on its own
   document; the userscript mounts it inside an in-page panel (opts: toTab, close, noAccounts). */
RBE.mountSettings = function (root, opts = {}) {
const api = RBE.api;
// opened from the gear on reddit.com: fill the frame instead of the fixed popup size
if (root === document && new URLSearchParams(location.search).has('embed')) document.documentElement.classList.add('embed');
let settings;
const $ = s => root.querySelector(s);
const $$ = s => [...root.querySelectorAll(s)];
const close = opts.close || (() => window.close());
// Account switching swaps Reddit's cookies, which only the extension can do
if (opts.noAccounts) { $('#tabs [data-tab="accounts"]')?.remove(); $('section[data-panel="accounts"]')?.remove(); }

const getPath = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
const setPath = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };

let saveT;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(async () => {
    const { customCss, ...rest } = settings;
    await api.storage.sync.set({ settings: rest });
    $('#saved').classList.add('show'); setTimeout(() => $('#saved').classList.remove('show'), 900);
  }, 150);
}

// tabs
$$('#tabs button').forEach(b => b.addEventListener('click', () => {
  $$('#tabs button').forEach(x => x.classList.toggle('on', x === b));
  $$('section').forEach(s => s.classList.toggle('on', s.dataset.panel === b.dataset.tab));
  try { localStorage.rbeTab = b.dataset.tab; } catch {}
  if (b.dataset.tab === 'accounts') loadAccounts();
}));
try { const t = localStorage.rbeTab; if (t) $(`#tabs [data-tab="${t}"]`)?.click(); } catch {}

function bind() {
  $$('[data-key]').forEach(el => {
    const key = el.dataset.key;
    const val = getPath(settings, key);
    if (el.classList.contains('seg')) {
      const sync = () => el.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.value === getPath(settings, key)));
      sync();
      el.querySelectorAll('button').forEach(b => b.onclick = () => { setPath(settings, key, b.value); sync(); save(); });
      return;
    }
    const out = el.parentElement.querySelector('output');
    if (el.type === 'checkbox') el.checked = !!val;
    else el.value = val;
    if (out) out.textContent = el.value;
    el.oninput = () => {
      const v = el.type === 'checkbox' ? el.checked : (el.type === 'range' || el.type === 'number') ? Number(el.value) : el.value;
      setPath(settings, key, v);
      if (out) out.textContent = el.value;
      save();
    };
  });
}

function themes() {
  const box = $('#themes');
  box.replaceChildren();
  for (const [name, t] of Object.entries(RBE.THEMES)) {
    const sw = t ? [t.bg, t.card, t.text, t.accent] : ['#fff', '#0e1113', '#ff4500', '#d93a00'];
    const b = document.createElement('button');
    b.className = 'theme' + (settings.theme === name ? ' on' : '');
    b.innerHTML = `<div class="sw">${sw.map(c => `<i style="background:${c}"></i>`).join('')}</div><div class="nm">${name === 'default' ? 'Reddit' : name}</div>`;
    b.onclick = () => { settings.theme = name; themes(); save(); };
    box.append(b);
  }
  $('#accentPick').value = settings.accent || (RBE.THEMES[settings.theme]?.accent) || '#ff4500';
}

$('#accentPick').addEventListener('input', e => { settings.accent = e.target.value; save(); });
$('#accentReset').addEventListener('click', () => { settings.accent = ''; themes(); save(); });

let cssT;
$('#customCss').addEventListener('input', e => {
  clearTimeout(cssT);
  cssT = setTimeout(() => api.storage.local.set({ customCss: e.target.value }), 300);
});

$('#exportBtn').onclick = () => {
  const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'reddit-better-browsing-settings.json' });
  a.click();
};
$('#importBtn').onclick = () => {
  const inp = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' });
  inp.onchange = async () => {
    try {
      const data = JSON.parse(await inp.files[0].text());
      const { customCss = '', ...rest } = data;
      await api.storage.sync.set({ settings: rest });
      await api.storage.local.set({ customCss });
      location.reload();
    } catch (e) { alert('Invalid settings file'); }
  };
  inp.click();
};
$('#resetBtn').onclick = async () => {
  if (!confirm('Reset all settings to defaults?')) return;
  await api.storage.sync.remove('settings');
  await api.storage.local.remove('customCss');
  location.reload();
};

// ---------- active tab helpers ----------
async function redditTab() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  return tab && /^https:\/\/([a-z]+\.)?reddit\.com\//.test(tab.url || '') ? tab : (tab && tab.url === undefined ? tab : null);
}
async function toTab(msg) {
  if (opts.toTab) return opts.toTab(msg);
  const tab = await redditTab();
  if (!tab) throw new Error('Open a Reddit tab first');
  const r = await api.tabs.sendMessage(tab.id, msg);
  if (r && r.error) throw new Error(r.error);
  return r;
}

$('#revealNow').onclick = () => toTab({ type: 'rbe:revealAll' }).then(() => close()).catch(e => alert(e.message));

// ---------- accounts ----------
async function loadAccounts() {
  const list = $('#acctList');
  const status = $('#acctStatus');
  let me = null;
  try { me = (await toTab({ type: 'rbe:me' })).name; status.textContent = me ? `Logged in as u/${me}` : 'Not logged in on this tab.'; }
  catch { status.textContent = 'Open a Reddit tab to switch accounts.'; }
  const r = await api.runtime.sendMessage({ type: 'acct:list' });
  const accounts = r.accounts || [];
  list.replaceChildren(...accounts.map(a => {
    const row = document.createElement('div');
    row.className = 'acct' + (a.name === me ? ' on' : '');
    const b = document.createElement('b'); b.textContent = 'u/' + a.name;
    const sw = document.createElement('button'); sw.textContent = a.name === me ? 'Current' : 'Switch';
    sw.disabled = a.name === me;
    sw.onclick = async () => { sw.textContent = 'Switching…'; try { await toTab({ type: 'rbe:switch', name: a.name }); close(); } catch (e) { alert(e.message); sw.textContent = 'Switch'; } };
    const x = document.createElement('button'); x.className = 'x'; x.textContent = '✕'; x.title = 'Forget';
    x.onclick = async () => { await api.runtime.sendMessage({ type: 'acct:remove', name: a.name }); loadAccounts(); };
    row.append(b, sw, x);
    return row;
  }));
  $('#acctSave').hidden = !me || accounts.some(a => a.name === me);
}
if (!opts.noAccounts) $('#acctSave').onclick = () => toTab({ type: 'rbe:save' }).then(loadAccounts).catch(e => alert(e.message));
if (!opts.noAccounts) $('#acctAdd').onclick = () => toTab({ type: 'rbe:add' }).then(() => close()).catch(e => alert(e.message));

// ---------- init ----------
RBE.loadSettings().then(s => {
  settings = s;
  $('#customCss').value = s.customCss || '';
  delete settings.customCss;
  bind(); themes();
  if ($('#tabs .on')?.dataset.tab === 'accounts') loadAccounts();
});
};
if (location.protocol.endsWith('extension:')) RBE.mountSettings(document);
