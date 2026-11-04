/* Userscript only: the popup's settings form in an in-page panel. Alt+W opens and closes it.
   PANEL_HTML and PANEL_CSS are filled in by build.js from popup.html / popup.css. */
(() => {
  let host = null;
  function toggle() {
    if (host) { host.remove(); host = null; return; }
    host = IGB.h('div', { class: 'igb-root', style: { position: 'fixed', inset: '0', zIndex: '2147483600', background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '8vh' } });
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${PANEL_CSS}
      :host { all: initial; }
      .panel { border-radius: 12px; overflow: auto; max-height: 84vh; box-shadow: 0 12px 40px rgba(0,0,0,.4); }
      .panel > div { background: var(--bg); }
      .x { margin-left: 8px; border: 0; background: none; color: var(--weak); font-size: 18px; cursor: pointer; }
    </style><div class="panel"><div>${PANEL_HTML}</div></div>`;
    root.querySelector('header').append(IGB.h('button', { class: 'x', title: 'Close (Alt+W)', onclick: toggle }, '✕'));
    host.addEventListener('click', e => { if (e.target === host) toggle(); });
    document.body.append(host);
    IGB.mountSettings(root);
  }
  addEventListener('keydown', e => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyW') { e.preventDefault(); e.stopPropagation(); toggle(); }
    else if (host && e.key === 'Escape') toggle();
  }, true);
})();
