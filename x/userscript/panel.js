/* Userscript only: the popup's settings form in an in-page panel (no extension pages to iframe).
   settings.js calls XBB.openSettings from Alt+W and the sidebar gear.
   XBB_PANEL_HTML and XBB_PANEL_CSS are filled in by build.js from popup.html / popup.css. */
(() => {
  let host = null;
  function toggle() {
    if (host) { host.remove(); host = null; return; }
    host = XBB.h('div', { class: 'xbb-root xbb-settings', style: { position: 'fixed', inset: '0', zIndex: '2147483600', background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '8vh' } });
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${XBB_PANEL_CSS}
      :host { all: initial; }
      .panel { border-radius: 12px; overflow: auto; max-height: 84vh; box-shadow: 0 12px 40px rgba(0,0,0,.4); }
      .panel > div { background: var(--bg); }
      .x { margin-left: 8px; border: 0; background: none; color: var(--weak); font-size: 18px; cursor: pointer; }
    </style><div class="panel"><div>${XBB_PANEL_HTML}</div></div>`;
    root.querySelector('header').append(XBB.h('button', { class: 'x', title: 'Close (Alt+W)', onclick: toggle }, '✕'));
    host.addEventListener('click', e => { if (e.composedPath()[0] === host) toggle(); });   // clicks inside the shadow root also report target === host
    document.body.append(host);
    XBB.mountSettings(root);
  }
  XBB.openSettings = toggle;
})();
