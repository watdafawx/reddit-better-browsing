/* Floating quick bar: NSFW / video / spoilers toggles and the settings button */
(() => {
  const h = (...a) => RBE.h(...a);
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
        h('button', { class: 'rbe-qb-btn', title: 'Settings', onclick: () => RBE.openSettingsPanel?.() }, '⚙️')
      ]].flat().filter(Boolean));
  }

  RBE.onSettings(s => {
    if (s.quickBar && !bar && document.body) build();
    else if (!s.quickBar && bar) { bar.remove(); bar = null; }
    render();
  });
  document.addEventListener('DOMContentLoaded', () => { if (RBE.settings.quickBar && !bar) build(); });
})();
