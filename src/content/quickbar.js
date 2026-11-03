/* Floating quick bar: NSFW / video / spoilers / viewer toggles + account switcher */
(() => {
  const h = (...a) => RBE.h(...a);
  const send = msg => RBE.api.runtime.sendMessage(msg).then(r => { if (r && r.error) throw new Error(r.error); return r; });

  // ---------- accounts ----------
  RBE.accounts = {
    async me() {
      try { const j = await RBE.getJSON('/api/me.json?raw_json=1'); return j?.data?.name || null; } catch { return null; }
    },
    list: () => send({ type: 'acct:list' }).then(r => r.accounts || []),
    async saveCurrent() {
      const name = await this.me();
      if (!name) throw new Error('Log in first, then save.');
      await send({ type: 'acct:save', name });
      return name;
    },
    async switchTo(name, defer) {
      const me = await this.me();
      if (me) await send({ type: 'acct:save', name: me }).catch(() => {});   // refresh the current account's saved session
      await send({ type: 'acct:switch', name });
      setTimeout(() => location.reload(), defer ? 120 : 0);
    },
    async addAnother(defer) {
      const me = await this.me();
      await send({ type: 'acct:fresh', saveAs: me });
      setTimeout(() => { location.href = 'https://www.reddit.com/login/'; }, defer ? 120 : 0);
    },
    remove: name => send({ type: 'acct:remove', name })
  };

  // ---------- settings helpers ----------
  async function patch(fn) {
    const { settings = {} } = await RBE.api.storage.sync.get('settings');
    const s = RBE.mergeSettings(settings);
    fn(s);
    delete s.customCss;
    await RBE.api.storage.sync.set({ settings: s });
    return s;
  }
  const cycle = (arr, v) => arr[(arr.indexOf(v) + 1) % arr.length];
  const NSFW_MODES = ['reddit', 'blur', 'hide', 'show'];
  const NSFW_LABEL = { reddit: 'NSFW: Reddit default', blur: 'NSFW: blurred', hide: 'NSFW: hidden', show: 'NSFW: shown' };
  const VIDEO_MODES = ['volume', 'muted', 'off', 'default'];
  RBE.cycleNsfw = () => patch(s => { s.nsfwMode = cycle(NSFW_MODES, s.nsfwMode); }).then(s => RBE.toast(NSFW_LABEL[s.nsfwMode]));
  RBE.cycleVideo = () => patch(s => { s.videoMode = cycle(VIDEO_MODES, s.videoMode); }).then(s => RBE.toast('Video: ' + videoLabel(s)));
  RBE.toggleSpoilers = () => patch(s => { s.revealSpoilers = !s.revealSpoilers; }).then(s => { RBE.toast(s.revealSpoilers ? 'Spoilers: auto-reveal' : 'Spoilers: hidden'); if (s.revealSpoilers) RBE.revealAll(false); });
  const videoLabel = s => ({ volume: `autoplay ${s.videoVolume}%`, muted: 'autoplay muted', off: 'no autoplay', default: 'Reddit default' })[s.videoMode];

  // ---------- bar UI ----------
  let bar;
  function build() {
    bar = h('div', { class: 'rbe-root rbe-qb', id: 'rbe-qb' });
    document.documentElement.append(bar);
    render();
  }
  function render() {
    if (!bar) return;
    const s = RBE.settings;
    const collapsed = bar.classList.contains('collapsed');
    const nsfwIcon = { reddit: '🔞', blur: '🌫️', hide: '🚫', show: '👁️' }[s.nsfwMode];
    const vidIcon = { volume: '🔉', muted: '🔇', off: '⏸️', default: '🎬' }[s.videoMode];
    bar.replaceChildren(...[
      h('button', { class: 'rbe-qb-btn rbe-qb-toggle', title: collapsed ? 'Show quick bar' : 'Hide quick bar', onclick: () => { bar.classList.toggle('collapsed'); render(); } }, collapsed ? '⚙' : '‹'),
      collapsed ? null : [
        h('button', { class: 'rbe-qb-btn', title: NSFW_LABEL[s.nsfwMode] + ' (Alt+N to cycle)', onclick: RBE.cycleNsfw }, nsfwIcon),
        h('button', { class: 'rbe-qb-btn', title: 'Video: ' + videoLabel(s) + ' (Alt+V)', onclick: RBE.cycleVideo }, vidIcon),
        h('button', { class: 'rbe-qb-btn' + (s.revealSpoilers ? ' on' : ''), title: (s.revealSpoilers ? 'Spoilers auto-revealed' : 'Spoilers hidden') + ' (Alt+S)', onclick: RBE.toggleSpoilers }, s.revealSpoilers ? '🔓' : '🔒'),
        h('button', { class: 'rbe-qb-btn', title: 'Accounts', onclick: e => accountMenu(e.currentTarget) }, '👤'),
        h('button', { class: 'rbe-qb-btn', title: 'Settings', onclick: () => RBE.openSettingsPanel?.() }, '⚙️')
      ]].flat().filter(Boolean));
  }
  async function accountMenu(anchor) {
    document.getElementById('rbe-acct-menu')?.remove();
    const menu = h('div', { class: 'rbe-root rbe-menu', id: 'rbe-acct-menu' }, h('div', { class: 'rbe-muted' }, 'Loading…'));
    document.documentElement.append(menu);
    const r = anchor.getBoundingClientRect();
    menu.style.left = r.left + 'px'; menu.style.bottom = (window.innerHeight - r.top + 8) + 'px';
    const off = e => { if (!menu.contains(e.target) && e.target !== anchor) { menu.remove(); window.removeEventListener('pointerdown', off, true); } };
    window.addEventListener('pointerdown', off, true);
    const [me, list] = await Promise.all([RBE.accounts.me(), RBE.accounts.list().catch(() => [])]);
    const rows = list.map(a => h('div', { class: 'rbe-menu-row' + (a.name === me ? ' on' : '') },
      h('button', { class: 'rbe-menu-item', disabled: a.name === me ? true : null, onclick: () => { menu.querySelector('.rbe-muted').textContent = 'Switching…'; RBE.accounts.switchTo(a.name).catch(err => RBE.toast(err.message)); } },
        (a.name === me ? '● ' : '') + 'u/' + a.name),
      h('button', { class: 'rbe-menu-x', title: 'Forget this account', onclick: async () => { await RBE.accounts.remove(a.name); menu.remove(); accountMenu(anchor); } }, '✕')));
    const saved = list.some(a => a.name === me);
    menu.replaceChildren(
      h('div', { class: 'rbe-muted' }, me ? 'Logged in as u/' + me : 'Not logged in'),
      ...rows,
      me && !saved ? h('button', { class: 'rbe-menu-item accent', onclick: async () => { try { const n = await RBE.accounts.saveCurrent(); RBE.toast('Saved u/' + n); menu.remove(); } catch (err) { RBE.toast(err.message); } } }, '＋ Save current account') : null,
      h('button', { class: 'rbe-menu-item', onclick: () => RBE.accounts.addAnother().catch(err => RBE.toast(err.message)) }, '＋ Log in another account'),
      h('div', { class: 'rbe-muted small' }, 'Saved sessions stay on this computer. Logging out on Reddit ends that saved session.'));
  }
  RBE.openAccountMenu = () => { if (!bar || bar.classList.contains('collapsed')) { bar?.classList.remove('collapsed'); render(); } const b = bar?.querySelector('[title="Accounts"]'); if (b) accountMenu(b); };

  RBE.onSettings(s => {
    if (s.quickBar && !bar && document.body) build();
    else if (!s.quickBar && bar) { bar.remove(); bar = null; }
    render();
  });
  document.addEventListener('DOMContentLoaded', () => { if (RBE.settings.quickBar && !bar) build(); });
})();
