/* Shared by all three sites: the settings form (each site's popup/popup.html + popup.js) in a shadow-DOM
   panel over the page. build.js puts this once at the top of the userscript; each site makes its own:
     bbPanel({ cls, html, css, mount(root, close), onToggle(open) }) -> toggle()
   cls: the host's classes (the tests find the panel by them). Esc, the ✕ and a click on the backdrop close it. */
const bbPanel = ({ cls, html, css, mount, onToggle }) => {
  let host = null;
  const onKey = e => { if (e.key === 'Escape' && host) { e.preventDefault(); e.stopImmediatePropagation(); toggle(); } };
  function toggle() {
    if (host) {
      host.remove(); host = null; removeEventListener('keydown', onKey, true);
      onToggle?.(false);
      return;
    }
    host = document.createElement('div');
    host.className = cls;
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483600;background:rgba(0,0,0,.45);display:flex;align-items:flex-start;justify-content:center;padding-top:7vh';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${css}
      :host { all: initial; }
      .panel { border-radius: 12px; overflow: auto; max-height: 86vh; box-shadow: 0 12px 40px rgba(0,0,0,.4); }
      .panel > div { min-height: 0; background: var(--bg); }
      .x { margin-left: 8px; border: 0; background: none; color: var(--weak); font-size: 18px; cursor: pointer; }
    </style><div class="panel"><div>${html}</div></div>`;
    const x = document.createElement('button');
    x.className = 'x'; x.title = 'Close (Esc)'; x.textContent = '✕'; x.onclick = toggle;
    root.querySelector('header').append(x);
    host.addEventListener('click', e => { if (e.composedPath()[0] === host) toggle(); });   // clicks inside the shadow root also report target === host
    // keep the site's own key handlers (shortcuts) away from the form's text fields
    ['keydown', 'keyup', 'keypress'].forEach(t => host.addEventListener(t, e => e.stopPropagation()));
    document.documentElement.append(host);
    addEventListener('keydown', onKey, true);
    mount(root, toggle);
    onToggle?.(true);
  }
  return toggle;
};
