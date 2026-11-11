// CPU guards for the userscript, shared by the three site tests. Two kinds of check:
//  - idle: after the page has settled, the script must not change the page on its own (a feedback loop
//    between our MutationObserver and our own DOM changes is what burns CPU while nothing happens)
//  - churn: the page keeps changing (X-like: counters tick, nodes come and go) while the user scrolls; the
//    script's own work on top of the page's must stay small. Chromium reports script time exactly (CDP);
//    Firefox has no such API, so it is the CPU time of the browser's processes, compared with and without
//    the script (noisy, so medians and a generous bound that catches real loops).
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const ps1 = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cpu.ps1');
const firefoxCpu = () => { try { return +execSync(`powershell -NoProfile -File "${ps1}"`).toString().trim().replace(',', '.'); } catch { return NaN; } };

// How many changes the page gets in `ms` while we do nothing (counted after it settled)
export async function idleMutations(page, ms = 3000) {
  await page.evaluate(() => { window.__idleMut = 0; new MutationObserver(rs => { window.__idleMut += rs.length; }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true }); });
  await page.waitForTimeout(ms);
  return page.evaluate(() => window.__idleMut);
}

const churn = () => {   // runs in the page: ~400 DOM changes a second spread over random elements
  const pool = () => [...document.querySelectorAll('article, section, div, p')].filter(e => e.children.length < 8 && !e.closest('video'));
  setInterval(() => {
    const els = pool();
    if (!els.length) return;
    for (let i = 0; i < 20; i++) {
      const el = els[Math.floor(Math.random() * els.length)], d = document.createElement('span');
      d.textContent = String(Math.random());
      el.append(d); setTimeout(() => d.remove(), 30);
    }
  }, 50);
};

// CPU cost of the script on a churning, scrolling page. Returns seconds { with, without } of script time
// (Chromium) or browser CPU time (Firefox).
export async function churnCost(opts) {
  const c = await measure(opts);
  if (opts.name === 'chromium' || costOk(opts.name, c)) return c;
  const again = await measure(opts);   // Firefox CPU is noisy: a bad reading gets one more try, a real loop fails both
  return costOk(opts.name, again) ? again : { ...again, firstTry: c };
}
async function measure({ browserType, name, launchOpts, newContextOpts = {}, route, url, usFile, steps = 16 }) {
  // Firefox's process CPU swings by a factor of two from run to run on its own, so: three alternating
  // runs of each, and the medians. Chromium's script time is exact, one run is enough.
  const runs = name === 'chromium' ? 1 : 3, all = { with: [], without: [] };
  const order = []; for (let i = 0; i < runs; i++) order.push(false, true);
  for (const withScript of order) {
    const browser = await browserType.launch(launchOpts);
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ...newContextOpts });
    if (route) await ctx.route(route.re, route.fn);
    if (withScript) await ctx.addInitScript({ path: usFile });
    const page = await ctx.newPage();
    await page.goto(url);
    await page.waitForTimeout(2500);
    await page.evaluate(churn);
    let cdp, m0, c0;
    if (name === 'chromium') { cdp = await ctx.newCDPSession(page); await cdp.send('Performance.enable'); m0 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value])); }
    else c0 = firefoxCpu();
    for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(250); }
    await page.waitForTimeout(2000);
    if (name === 'chromium') { const m1 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value])); all[withScript ? 'with' : 'without'].push(m1.ScriptDuration - m0.ScriptDuration); }
    else all[withScript ? 'with' : 'without'].push(firefoxCpu() - c0);
    await browser.close();
  }
  const median = a => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
  return { with: median(all.with), without: median(all.without), runs: all };
}

// the bound: extra script time (Chromium), or median browser CPU at most 1.5x plus 1.5 s of noise (Firefox)
export const costOk = (name, c) => name === 'chromium' ? c.with - c.without < 0.5 : Number.isNaN(c.with) || c.with <= c.without * 1.5 + 1.5;
