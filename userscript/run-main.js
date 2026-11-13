/* Shared by all three sites: runMain(fn) runs a site's page-world hooks (its main-world files) in the
   page's own JS world. build.js puts this once at the top of the userscript.
   With @inject-into auto a manager may put the whole script in its content realm instead: Firefox does that
   when a nonce CSP (X, Reddit) blocks inline <script>s without the nonce ('unsafe-inline' is ignored once a
   nonce is present). There `window.wrappedJSObject` exists, so the hooks go to the page as a <script>
   carrying a nonce taken from one of the page's own scripts. In the page world (Chrome, Firefox without
   CSP) they simply run. */
const runMain = fn => {
  if (typeof window.wrappedJSObject === 'undefined') { fn(); return; }
  const root = document.documentElement, flag = 'data-bb-main';
  const src = '(' + fn + ')();document.documentElement.setAttribute("' + flag + '","1");';
  const put = nonce => {
    const s = document.createElement('script');
    if (nonce) s.nonce = nonce;
    s.textContent = src; root.append(s); s.remove();
    const ok = root.hasAttribute(flag); root.removeAttribute(flag); return ok;
  };
  const nonceOf = () => { for (const s of document.querySelectorAll('script')) if (s.nonce) return s.nonce; return ''; };
  const n = nonceOf();
  if (put(n) || n) return;
  const mo = new MutationObserver(() => { const m = nonceOf(); if (m) { mo.disconnect(); put(m); } });
  mo.observe(document, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', () => mo.disconnect(), { once: true });
};
