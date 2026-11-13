// Runs every test: the userscript on each site in Chromium, and again in Firefox. The Reddit and Instagram
// tests run their first part in Chromium either way and only their second part in BROWSER. Run: npm run test:all
import { spawnSync } from 'child_process';

const node = (...args) => ['node', args];
const runs = [
  ['build', ...node('build.js')],
  ['X, Chromium', ...node('test/x-offline.mjs')],
  ['X, Firefox', ...node('test/x-offline.mjs'), { BROWSER: 'firefox' }],
  ['Reddit, Chromium', ...node('test/offline.mjs')],
  ['Reddit, Firefox', ...node('test/offline.mjs'), { BROWSER: 'firefox' }],
  ['Instagram, Chromium', ...node('test/instagram-offline.mjs')],
  ['Instagram, Firefox', ...node('test/instagram-offline.mjs'), { BROWSER: 'firefox' }],
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
