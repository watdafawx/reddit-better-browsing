// node build.js  ->  dist/chrome, dist/firefox (Reddit), dist/instagram-chrome, dist/instagram-firefox, dist/better-browsing.user.js,
// and a zip of each (no dependencies, Node 22+)
const fs = require('fs'), path = require('path'), zlib = require('zlib');

// Each extension: its source folder, base manifest, zip name, Firefox id, and whether it has a background script.
const extensions = [
  { src: 'src', manifest: 'manifest.base.json', out: '', zip: 'reddit-better-browsing', gecko: 'reddit-better-browsing@local', background: true },
  { src: 'instagram/src', manifest: 'instagram/manifest.base.json', out: 'instagram-', zip: 'instagram-better-browsing', gecko: 'instagram-better-browsing@local', background: false }
];
const targets = {
  chrome: (m, e) => e.background ? { ...m, background: { service_worker: 'background.js' } } : m,
  firefox: (m, e) => ({ ...m, ...(e.background ? { background: { scripts: ['background.js'] } } : {}),
    browser_specific_settings: { gecko: { id: e.gecko, strict_min_version: '128.0' } } })
};

// Minimal zip writer (deflate), forward-slash paths as Firefox requires.
function zipDir(dir, outFile) {
  const files = [];
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    .forEach(e => { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : files.push(p); });
  walk(dir);
  const local = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(path.relative(dir, f).split(path.sep).join('/'));
    const data = fs.readFileSync(f), comp = zlib.deflateRawSync(data), crc = zlib.crc32(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(name.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    local.push(h, name, comp); central.push(c, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  fs.writeFileSync(outFile, Buffer.concat([...local, cd, end]));
}

fs.rmSync('dist', { recursive: true, force: true });
for (const e of extensions) {
  const base = JSON.parse(fs.readFileSync(e.manifest, 'utf8'));
  for (const [name, fn] of Object.entries(targets)) {
    const out = path.join('dist', e.out + name);
    fs.cpSync(e.src, out, { recursive: true });
    fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(fn(base, e), null, 2) + '\n');
    zipDir(out, path.join('dist', `${e.zip}-${name}.zip`));
    console.log('built', out, '+ zip');
  }
}

// One userscript for both sites (Tampermonkey / Violentmonkey): dist/better-browsing.user.js.
// It runs in the page itself (@grant none) at document-start, so the audio patches are in place
// before Reddit's and Instagram's players load. Each site's part is its content scripts in manifest
// order, with a shim for the extension APIs right after defaults.js, and its popup form in a panel.
// Tampermonkey checks UPDATE_URL for a higher @version (see "Releasing the userscript" in CLAUDE.md).
const UPDATE_URL = 'https://github.com/watdafawx/reddit-better-browsing/releases/download/userscript/better-browsing.user.js';
{
  const read = f => fs.readFileSync(f, 'utf8');
  const rMan = JSON.parse(read('manifest.base.json')), igMan = JSON.parse(read('instagram/manifest.base.json'));
  // [main-world files, content files] from a manifest, as paths under srcDir
  const scripts = (man, srcDir) => {
    const cs = man.content_scripts;
    return [cs.filter(c => c.world === 'MAIN').flatMap(c => c.js), cs.filter(c => c.world !== 'MAIN').flatMap(c => c.js)]
      .map(list => [...new Set(list)].map(f => `${srcDir}/${f}`));
  };
  const cssFiles = (man, srcDir) => [...new Set(man.content_scripts.flatMap(c => c.css || []))].map(f => `${srcDir}/${f}`);
  const withShim = (list, shim) => { const i = list.findIndex(f => f.endsWith('/defaults.js')); return [...list.slice(0, i + 1), shim, ...list.slice(i + 1)]; };
  const join = files => files.map(f => `// ---- ${f} ----\n${read(f)}`).join('\n\n');
  const style = (id, files) => `(() => { const s = document.createElement('style'); s.id = '${id}'; s.textContent = ${JSON.stringify(files.map(read).join('\n'))}; (document.head || document.documentElement).append(s); })();`;
  const panel = srcDir => {
    const icon = 'data:image/png;base64,' + fs.readFileSync(`${srcDir}/icons/icon48.png`).toString('base64');
    const popup = read(`${srcDir}/popup/popup.html`);
    return {
      html: popup.slice(popup.indexOf('<header>'), popup.indexOf('</main>') + 7).replace('../icons/icon48.png', icon),
      css: read(`${srcDir}/popup/popup.css`).replace(/:root/g, ':host').replace(/^body \{/m, '.panel > div {')
    };
  };

  // Reddit. hls.js sits in a function that runs on first use, like the extension's on-demand
  // injection; the local exports/module/define make its UMD wrapper set globalThis.Hls.
  const [rMain, rContent] = scripts(rMan, 'src');
  const rPanel = panel('src');
  const reddit = `
const RBE_PANEL_HTML = ${JSON.stringify(rPanel.html)};
const RBE_PANEL_CSS = ${JSON.stringify(rPanel.css)};
const RBE_LOAD_HLS = () => { if (globalThis.Hls) return; (function () { var exports, module, define;
${read('src/vendor/hls.min.js')}
}).call(globalThis); };
if (!location.pathname.startsWith('/login')) {
${join(rMain)}
}
${join([...withShim(rContent, 'userscript/reddit-shim.js'), 'src/popup/popup.js', 'userscript/reddit-panel.js'])}
${style('rbe-css', cssFiles(rMan, 'src'))}`;

  // Instagram
  const [igMain, igContent] = scripts(igMan, 'instagram/src');
  const igPanel = panel('instagram/src');
  const instagram = `
const PANEL_HTML = ${JSON.stringify(igPanel.html)};
const PANEL_CSS = ${JSON.stringify(igPanel.css)};
${join([...igMain, ...withShim(igContent, 'instagram/userscript/shim.js'), 'instagram/src/popup/popup.js', 'instagram/userscript/panel.js'])}
${style('igb-css', cssFiles(igMan, 'instagram/src'))}`;

  // Version goes up whenever either extension's does (Tampermonkey compares it part by part). The last
  // part, userscriptRevision in package.json, is for changes to the script alone (header, icon):
  // bump it for those, set it back to 0 when either extension's version changes.
  const rev = JSON.parse(read('package.json')).userscriptRevision || 0;
  const version = `${rMan.version}.${igMan.version}.${rev}`;
  const header = `// ==UserScript==
// @name         Better Browsing (Reddit + Instagram)
// @namespace    better-browsing-watdafawx
// @version      ${version}
// @description  Reddit Better Browsing ${rMan.version} and Instagram Better Browsing ${igMan.version} in one script. Reddit settings: the gear in Reddit's top bar; Instagram settings: Alt+W.
// @match        https://*.reddit.com/*
// @match        https://www.instagram.com/*
// @exclude      https://old.reddit.com/*
// @run-at       document-start
// @grant        none
// @inject-into  page
// @noframes
// @updateURL    ${UPDATE_URL}
// @downloadURL  ${UPDATE_URL}
// @icon         ${'data:image/svg+xml;base64,' + fs.readFileSync('userscript/icon.svg').toString('base64')}
// @homepageURL  https://github.com/watdafawx/reddit-better-browsing
// @license      MIT
// ==/UserScript==
`;
  const site = `const host = location.hostname;
if (host === 'www.instagram.com') {${instagram}
} else if (/(^|\.)reddit\.com$/.test(host) && host !== 'old.reddit.com' && !location.pathname.startsWith('/media')) {${reddit}
}`;
  // Some managers run document-start scripts before <html> exists; everything here needs it.
  const wrapped = `(() => {\nconst start = () => {\n${site}\n};\n` +
    `if (document.documentElement) start();\n` +
    `else new MutationObserver((_, o) => { if (document.documentElement) { o.disconnect(); start(); } }).observe(document, { childList: true });\n})();\n`;
  fs.writeFileSync(path.join('dist', 'better-browsing.user.js'), `${header}\n${wrapped}`);
  console.log('built dist/better-browsing.user.js', version);
}
