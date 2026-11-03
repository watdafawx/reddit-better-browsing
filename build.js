// node build.js  ->  dist/chrome, dist/firefox and a zip of each (no dependencies, Node 22+)
const fs = require('fs'), path = require('path'), zlib = require('zlib');

const base = JSON.parse(fs.readFileSync('manifest.base.json', 'utf8'));
const targets = {
  chrome: m => ({ ...m, background: { service_worker: 'background.js' } }),
  firefox: m => ({ ...m, background: { scripts: ['background.js'] },
    browser_specific_settings: { gecko: { id: 'reddit-better-browsing@local', strict_min_version: '128.0' } } })
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
for (const [name, fn] of Object.entries(targets)) {
  const out = path.join('dist', name);
  fs.cpSync('src', out, { recursive: true });
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(fn(base), null, 2) + '\n');
  zipDir(out, path.join('dist', `reddit-better-browsing-${name}.zip`));
  console.log('built', out, '+ zip');
}
