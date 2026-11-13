// node build.js  ->  dist/better-browsing.user.js: ONE userscript (Tampermonkey / Violentmonkey) for Reddit,
// Instagram and X. No dependencies, Node 22+.
//
// It runs in the page itself (@grant none) at document-start, so the audio patches are in place before the
// sites' players load. Per site: its main-world files (run through runMain), then its content scripts in
// manifest order with `<site>.api` (storage, userscript/store.js) set right after defaults.js, then its
// popup.js form mounted in a panel (userscript/panel.js), then its CSS. userscript/*.js is shared by all
// three and goes in once, before the site switch.
// Tampermonkey checks UPDATE_URL for a higher @version (see "Userscript" in CLAUDE.md).
const fs = require('fs'), path = require('path');

const UPDATE_URL = 'https://github.com/watdafawx/reddit-better-browsing/releases/download/userscript/better-browsing.user.js';
const read = f => fs.readFileSync(f, 'utf8');
const SHARED = ['userscript/run-main.js', 'userscript/store.js', 'userscript/panel.js'];

// [main-world files, content files, css files] from a manifest, as paths under srcDir
function scripts(man, srcDir) {
  const cs = man.content_scripts, files = list => [...new Set(list)].map(f => `${srcDir}/${f}`);
  return [files(cs.filter(c => c.world === 'MAIN').flatMap(c => c.js)), files(cs.filter(c => c.world !== 'MAIN').flatMap(c => c.js)),
    files(cs.flatMap(c => c.css || []))];
}
const join = files => files.map(f => `// ---- ${f} ----\n${read(f)}`).join('\n\n');
const style = (id, files) => `(() => { const s = document.createElement('style'); s.id = '${id}'; s.textContent = ${JSON.stringify(files.map(read).join('\n'))}; (document.head || document.documentElement).append(s); })();`;
// The settings form: popup.html from <header> to </main> (icon inlined), popup.css for a shadow root
function panel(srcDir) {
  const icon = 'data:image/png;base64,' + fs.readFileSync(`${srcDir}/icons/icon48.png`).toString('base64');
  const html = read(`${srcDir}/popup/popup.html`);
  return {
    html: html.slice(html.indexOf('<header>'), html.indexOf('</main>') + 7).replace('../icons/icon48.png', icon),
    css: read(`${srcDir}/popup/popup.css`).replace(/:root/g, ':host').replace(/^body \{/m, '.panel > div {')
  };
}

// One site's part of the script. `api`: code that sets <ns>.api, inserted right after defaults.js.
// `extra`: constants the site's code uses. `main`: wraps the runMain call. `panelJs`: makes the panel.
function site({ srcDir, manifest, api, extra = '', main = s => s, panelJs, cssId }) {
  const [mainFiles, content, css] = scripts(JSON.parse(read(manifest)), srcDir);
  const p = panel(srcDir);
  const i = content.findIndex(f => f.endsWith('/defaults.js'));
  return `
const PANEL_HTML = ${JSON.stringify(p.html)};
const PANEL_CSS = ${JSON.stringify(p.css)};
${extra}
${main(`runMain(() => {\n${join(mainFiles)}\n});`)}
${join(content.slice(0, i + 1))}
${api}
${join([...content.slice(i + 1), `${srcDir}/popup/popup.js`])}
${panelJs}
${style(cssId, css)}`;
}

// Reddit. hls.js sits in a function that runs on first use (RBE.loadHls in video.js); the local
// exports/module/define make its UMD wrapper set globalThis.Hls.
const reddit = site({
  srcDir: 'src', manifest: 'manifest.base.json', cssId: 'rbe-css',
  api: `RBE.api = bbStore('rbe-userscript-storage', true);`,
  extra: `const RBE_LOAD_HLS = () => { if (globalThis.Hls) return; (function () { var exports, module, define;
${read('src/vendor/hls.min.js')}
}).call(globalThis); };`,
  main: s => `if (!location.pathname.startsWith('/login')) ${s}`,
  panelJs: `RBE.openSettingsInPage = bbPanel({ cls: 'rbe-root rbe-us-settings', html: PANEL_HTML, css: PANEL_CSS,
  mount: (root, close) => RBE.mountSettings(root, { close }),
  onToggle: open => document.querySelector('.rbe-nav-gear')?.classList.toggle('on', open) });`
});
const instagram = site({
  srcDir: 'instagram/src', manifest: 'instagram/manifest.base.json', cssId: 'igb-css',
  api: `IGB.api = bbStore('igb-userscript-settings');`,
  panelJs: `IGB.openSettings = bbPanel({ cls: 'igb-root igb-settings', html: PANEL_HTML, css: PANEL_CSS, mount: root => IGB.mountSettings(root) });`
});
const xsite = site({
  srcDir: 'x/src', manifest: 'x/manifest.base.json', cssId: 'xbb-css',
  api: `XBB.api = bbStore('xbb-userscript-settings');`,
  panelJs: `XBB.openSettings = bbPanel({ cls: 'xbb-root xbb-settings', html: PANEL_HTML, css: PANEL_CSS, mount: root => XBB.mountSettings(root) });`
});

// Version goes up whenever any part's does (Tampermonkey compares it part by part). The last part,
// userscriptRevision in package.json, is for changes to the script alone (header, icon, userscript/*):
// bump it for those, set it back to 0 when a part's version changes.
const ver = f => JSON.parse(read(f)).version;
const [rv, iv, xv] = ['manifest.base.json', 'instagram/manifest.base.json', 'x/manifest.base.json'].map(ver);
const version = `${rv}.${iv}.${xv}.${JSON.parse(read('package.json')).userscriptRevision || 0}`;
const header = `// ==UserScript==
// @name         Better Browsing (Reddit + Instagram)
// @namespace    better-browsing-watdafawx
// @version      ${version}
// @description  Reddit Better Browsing ${rv}, Instagram Better Browsing ${iv} and X Better Browsing ${xv} in one script. Reddit settings: the gear in Reddit's top bar; Instagram and X settings: Alt+W (also a gear in their sidebars).
// @match        https://*.reddit.com/*
// @match        https://www.instagram.com/*
// @match        https://x.com/*
// @exclude      https://old.reddit.com/*
// @run-at       document-start
// @grant        none
// @inject-into  auto
// @noframes
// @updateURL    ${UPDATE_URL}
// @downloadURL  ${UPDATE_URL}
// @icon         ${'data:image/svg+xml;base64,' + fs.readFileSync('userscript/icon.svg').toString('base64')}
// @homepageURL  https://github.com/watdafawx/reddit-better-browsing
// @license      MIT
// ==/UserScript==
`;
const sites = `const host = location.hostname;
if (host === 'www.instagram.com') {${instagram}
} else if (host === 'x.com') {${xsite}
} else if (/(^|\.)reddit\.com$/.test(host) && host !== 'old.reddit.com' && !location.pathname.startsWith('/media')) {${reddit}
}`;
// Some managers run document-start scripts before <html> exists; everything here needs it.
const body = `(() => {\n${join(SHARED)}\nconst start = () => {\n${sites}\n};\n` +
  `if (document.documentElement) start();\n` +
  `else new MutationObserver((_, o) => { if (document.documentElement) { o.disconnect(); start(); } }).observe(document, { childList: true });\n})();\n`;

fs.rmSync('dist', { recursive: true, force: true });
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync(path.join('dist', 'better-browsing.user.js'), `${header}\n${body}`);
console.log('built dist/better-browsing.user.js', version, Math.round(Buffer.byteLength(header + body) / 1024) + ' KB');
