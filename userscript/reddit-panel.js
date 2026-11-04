/* Userscript only (Reddit): the popup's settings form in an in-page panel (no extension page to
   frame). The nav-bar gear and the quick bar's ⚙️ open it through RBE.openSettingsInPage.
   RBE_PANEL_HTML and RBE_PANEL_CSS are filled in by build.js from popup.html / popup.css. */
(() => {
  let host = null;
  function onKey(e) { if (e.key === 'Escape' && host) { e.preventDefault(); e.stopImmediatePropagation(); toggle(); } }
  function toggle() {
    if (host) { host.remove(); host = null; removeEventListener('keydown', onKey, true); return; }
    host = RBE.h('div', { class: 'rbe-root rbe-us-settings', style: { position: 'fixed', inset: '0', zIndex: '2147483600', background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '7vh' } });
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${RBE_PANEL_CSS}
      :host { all: initial; }
      .panel { border-radius: 12px; overflow: auto; max-height: 86vh; box-shadow: 0 12px 40px rgba(0,0,0,.4); }
      .panel > div { min-height: 0; }
      .x { margin-left: 8px; border: 0; background: none; color: var(--weak); font-size: 18px; cursor: pointer; }
    </style><div class="panel"><div>${RBE_PANEL_HTML}</div></div>`;
    root.querySelector('header').append(RBE.h('button', { class: 'x', title: 'Close (Esc)', onclick: toggle }, '✕'));
    host.addEventListener('click', e => { if (e.composedPath()[0] === host) toggle(); });   // clicks inside the shadow root also report target === host
    // keep Reddit's own key handlers away from the form's text fields
    ['keydown', 'keyup', 'keypress'].forEach(t => host.addEventListener(t, e => e.stopPropagation()));
    document.documentElement.append(host);
    addEventListener('keydown', onKey, true);
    RBE.mountSettings(root, {
      noAccounts: true,
      close: toggle,
      toTab: async msg => {
        if (msg.type === 'rbe:revealAll') { RBE.revealAll(true); return { ok: true }; }
        throw new Error('Not available in the userscript');
      }
    });
  }
  RBE.openSettingsInPage = toggle;
})();
