// node build.js  ->  dist/chrome, dist/firefox (Reddit), dist/instagram-chrome, dist/instagram-firefox,
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

// Instagram as a single userscript (Tampermonkey / Violentmonkey). It must run in the page itself
// (@grant none) at document-start, so the audio patch is in place before Instagram's player loads.
{
  const ig = 'instagram/src', man = JSON.parse(fs.readFileSync('instagram/manifest.base.json', 'utf8'));
  const read = f => fs.readFileSync(f, 'utf8');
  const icon = 'data:image/png;base64,' + fs.readFileSync(`${ig}/icons/icon48.png`).toString('base64');
  const popup = read(`${ig}/popup/popup.html`);
  const panelHtml = popup.slice(popup.indexOf('<header>'), popup.indexOf('</main>') + 7).replace('../icons/icon48.png', icon);
  const panelCss = read(`${ig}/popup/popup.css`).replace(/:root/g, ':host').replace(/^body \{/m, '.panel > div {');
  const parts = [
    `${ig}/main-world.js`, `${ig}/content/defaults.js`, 'instagram/userscript/shim.js', `${ig}/content/core.js`,
    `${ig}/content/video.js`, `${ig}/content/lightbox.js`, `${ig}/content/notinterested.js`, `${ig}/content/captions.js`, `${ig}/content/downloads.js`, `${ig}/content/settings.js`, `${ig}/popup/popup.js`
  ];
  const header = `// ==UserScript==
// @name         ${man.name}
// @namespace    instagram-better-browsing
// @version      ${man.version}
// @description  ${man.description} Settings: Alt+W.
// @match        https://www.instagram.com/*
// @run-at       document-start
// @grant        none
// @inject-into  page
// @noframes
// @license      MIT
// ==/UserScript==
`;
  const body = [
    `const PANEL_HTML = ${JSON.stringify(panelHtml)};`,
    `const PANEL_CSS = ${JSON.stringify(panelCss)};`,
    ...parts.map(f => `// ---- ${path.basename(f)} ----\n${read(f)}`),
    `// ---- panel.js ----\n${read('instagram/userscript/panel.js')}`,
    `// ---- content.css ----\n(() => { const s = document.createElement('style'); s.id = 'igb-css'; s.textContent = ${JSON.stringify(read(`${ig}/content/content.css`))}; (document.head || document.documentElement).append(s); })();`
  ].join('\n\n');
  // Some managers run document-start scripts before <html> exists; everything here needs it.
  const wrapped = `(() => {\nconst start = () => {\n${body}\n};\n` +
    `if (document.documentElement) start();\n` +
    `else new MutationObserver((_, o) => { if (document.documentElement) { o.disconnect(); start(); } }).observe(document, { childList: true });\n})();\n`;
  fs.writeFileSync(path.join('dist', 'instagram-better-browsing.user.js'), `${header}\n${wrapped}`);
  console.log('built dist/instagram-better-browsing.user.js');
}
