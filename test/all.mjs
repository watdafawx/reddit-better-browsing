// Runs every test: the three sites in Chromium, and the userscript (the release) of each in Firefox too.
// The Reddit and Instagram extension builds can only be loaded in Chromium, so their runs in "firefox"
// mode repeat that part in Chromium and run the userscript part in Firefox. Run: npm run test:all
import { spawnSync } from 'child_process';

const node = (...args) => ['node', args];
const runs = [
  ['build (userscript + test extensions)', ...node('build.js', '--extensions')],
  ['X, Chromium', ...node('test/x-offline.mjs')],
  ['X, Firefox', ...node('test/x-offline.mjs'), { BROWSER: 'firefox' }],
  ['Reddit, Chromium (extension + userscript)', ...node('test/offline.mjs', 'dist/chrome')],
  ['Reddit userscript, Firefox', ...node('test/offline.mjs', 'dist/chrome'), { BROWSER: 'firefox' }],
  ['Instagram, Chromium (extension + userscript)', ...node('test/instagram-offline.mjs', 'dist/instagram-chrome')],
  ['Instagram userscript, Firefox', ...node('test/instagram-offline.mjs', 'dist/instagram-chrome'), { BROWSER: 'firefox' }],
];

let bad = 0;
for (const [name, cmd, args, env = {}] of runs) {
  const t0 = Date.now();
  const res = spawnSync(cmd, args, { encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 });
  const out = (res.stdout || '') + (res.stderr || '');
  const pass = (out.match(/^PASS/gm) || []).length, fail = out.split('\n').filter(l => /^FAIL/.test(l));
  const ok = res.status === 0 && !fail.length;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}: ${pass} passed, ${fail.length} failed (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  for (const l of fail) console.log('      ' + l.slice(0, 300));
  if (!ok && !fail.length) console.log(out.split('\n').slice(-15).join('\n'));
}
console.log(bad ? `\n${bad} run(s) failed` : '\nall runs passed');
process.exit(bad ? 1 : 0);
