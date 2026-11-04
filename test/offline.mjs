// Offline smoke test: loads dist/chrome into Chromium and answers every reddit.com request from
// fixtures below, so it never touches live Reddit. Run: npm test (after npm run build).
import { chromium } from 'playwright';
import os from 'os'; import path from 'path'; import fs from 'fs'; import crypto from 'crypto';

const ext = path.resolve(process.argv[2] || 'dist/chrome');
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'rbe-'));
const ctx = await chromium.launchPersistentContext(prof, {
  headless: false,
  args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  viewport: { width: 1400, height: 900 },
});

const post = (id, extra = {}) => ({ name: 't3_' + id, id, title: 'Post ' + id, author: 'alice', author_fullname: 't2_a', subreddit: 'test',
  subreddit_name_prefixed: 'r/test', permalink: `/r/test/comments/${id}/post_${id}/`, created_utc: Date.now() / 1000 - 3600, score: 42, num_comments: 3,
  is_self: true, selftext_html: '<div class="md"><p>Body <span class="md-spoiler-text">secret</span> <img src=x onerror=alert(1)><script>bad()</script><a href="javascript:alert(2)" onclick="x()">js</a></p></div>', ...extra });
const comment = (id, body, replies = '') => ({ kind: 't1', data: { name: 't1_' + id, id, author: 'bob', author_fullname: 't2_b', body_html: body, score: 5,
  created_utc: Date.now() / 1000 - 60, permalink: `/r/test/comments/aaa/post/${id}/`, replies } });
const thread = id => {
  const p = id === 'vvv' ? post(id, { is_video: true, is_self: false, selftext_html: null,
    secure_media: { reddit_video: { hls_url: 'https://v.redd.it/x/HLSPlaylist.m3u8', fallback_url: 'https://v.redd.it/x/DASH_480.mp4', width: 640, height: 360 } } }) : post(id);
  const kids = [];
  for (let i = 0; i < 60; i++) kids.push(comment('c' + i, `<div class="md"><p>Comment ${i} <a href="/r/test/comments/bbb/x/">link</a> <img src="https://evil.com/x.png"></p></div>`,
    i === 0 ? { data: { children: [comment('r0', '<div class="md"><p>reply</p></div>')] } } : ''));
  kids.push({ kind: 'more', data: { count: 2, children: ['m1', 'm2'], parent_id: 't3_' + id } });
  return [{ data: { children: [{ kind: 't3', data: p }] } }, { data: { children: kids } }];
};
const feed = `<!doctype html><html><head><title>fixture</title></head><body>
<header style="height:48px"><button aria-label="Open chat">chat</button></header>
<shreddit-feed>
${['aaa', 'bbb', 'vvv', 'ccc'].map(id => `<article><shreddit-post id="t3_${id}" permalink="/r/test/comments/${id}/post_${id}/" post-type="${id === 'vvv' ? 'video' : 'text'}" post-title="Post ${id}" style="display:block;height:220px;border:1px solid #ccc;margin:8px">
<a slot="full-post-link" href="/r/test/comments/${id}/post_${id}/">Post ${id}</a><div slot="text-body">body ${id}</div></shreddit-post></article>`).join('\n')}
</shreddit-feed>
<div style="height:2000px"></div></body></html>`;

const reqs = [];
const fixtures = async route => {
  const u = new URL(route.request().url());
  reqs.push({ t: Date.now(), u: u.pathname + u.search });
  const json = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  let m;
  if ((m = u.pathname.match(/\/comments\/([a-z0-9]+)\/[^/]*\.json$/))) return json(thread(m[1]));
  if (u.pathname.startsWith('/api/morechildren')) return json({ json: { data: { things: [comment('m1', '<p>more1</p>'), comment('m2', '<p>more2</p>')].map(c => ({ ...c, data: { ...c.data, parent_id: 't3_aaa' } })) } } });
  if (u.pathname.startsWith('/api/user_data_by_account_ids')) return json({});
  if (u.pathname.endsWith('/about.json')) return json({ data: {} });
  if (u.pathname.startsWith('/api/me')) return json({ data: {} });
  if (u.pathname.endsWith('.m3u8')) return route.fulfill({ status: 404, body: '' });
  if (u.pathname.endsWith('.mp4')) return route.fulfill({ status: 404, body: '' });
  if (u.pathname.startsWith('/r/test')) return route.fulfill({ status: 200, contentType: 'text/html', body: feed });
  return route.fulfill({ status: 404, body: '' });
};
await ctx.route(/reddit\.com|redd\.it|redditstatic/, fixtures);

const logs = [];
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning' || /RBE/.test(m.text())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
page.on('dialog', d => { logs.push('[DIALOG!] ' + d.message()); d.dismiss(); });
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
sw.on('console', m => logs.push('[sw] ' + m.text()));

const r = {};
await page.goto('https://www.reddit.com/r/test/');
await page.waitForTimeout(1500);
r.themeStyle = await page.evaluate(() => !!document.getElementById('rbe-theme'));
r.quickbar = await page.evaluate(() => !!document.getElementById('rbe-qb'));
r.gear = await page.evaluate(() => !!document.querySelector('.rbe-nav-gear'));
r.snapshot = await page.evaluate(() => !!localStorage.getItem('rbe-settings-snapshot'));
r.videoAttr = await page.evaluate(() => document.documentElement.dataset.rbeVideo);

// hover → prefetch
const a = await page.locator('shreddit-post#t3_aaa').boundingBox();
const hoverAt = Date.now();
await page.mouse.move(a.x + 200, a.y + 100);
await page.waitForTimeout(700);
r.prefetch = reqs.filter(q => q.t >= hoverAt && /comments/.test(q.u)).map(q => q.u);

// click → viewer, should reuse prefetch
const n0 = reqs.length, c0 = Date.now();
await page.mouse.click(a.x + 200, a.y + 100);
await page.waitForSelector('.rbe-viewer .rbe-comments', { timeout: 10000 });
r.openMs = Date.now() - c0;
r.reqsOnOpen = reqs.slice(n0).filter(q => /comments/.test(q.u)).length;
r.commentCount = await page.evaluate(() => document.querySelectorAll('.rbe-viewer .rbe-c').length);
r.sanitize = await page.evaluate(() => ({
  body: document.querySelector('.rbe-post-body').innerHTML,
  evilImg: document.querySelectorAll('.rbe-viewer img[src*="evil"]').length,
  link: document.querySelector('.rbe-c-body a')?.getAttribute('href'),
  target: document.querySelector('.rbe-c-body a')?.getAttribute('target'),
}));
r.cv = await page.evaluate(() => getComputedStyle(document.querySelector('.rbe-comments > .rbe-c')).contentVisibility);
// load more
await page.click('.rbe-viewer .rbe-more');
await page.waitForTimeout(500);
r.afterMore = await page.evaluate(() => document.querySelectorAll('.rbe-viewer .rbe-c').length);
// collapse
await page.click('.rbe-viewer .rbe-c .rbe-c-line');
r.collapsed = await page.evaluate(() => document.querySelector('.rbe-viewer .rbe-c').classList.contains('collapsed') && document.querySelector('.rbe-viewer .rbe-c-count').textContent);
// sort change → new request
const n1 = reqs.length;
await page.selectOption('.rbe-viewer .rbe-select', 'new');
await page.waitForTimeout(500);
r.sortReq = reqs.slice(n1).map(q => q.u).filter(u => /sort=new/.test(u)).length;
// J → next post
await page.keyboard.press('j');
await page.waitForTimeout(500);
r.afterJ = await page.evaluate(() => document.querySelector('.rbe-v-head .rbe-btn[title="Open on Reddit"]').href);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
r.closed = await page.evaluate(() => !document.querySelector('.rbe-viewer'));

// reopen aaa → cached
const n2 = reqs.length;
await page.mouse.click(a.x + 200, a.y + 100);
await page.waitForSelector('.rbe-viewer .rbe-comments');
r.reopenReqs = reqs.slice(n2).filter(q => /comments/.test(q.u)).length;
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// video post → hls.js injected on demand, attaches MediaSource (blob:)
const v = await page.locator('shreddit-post#t3_vvv').boundingBox();
await page.mouse.click(v.x + 200, v.y + 100);
await page.waitForSelector('.rbe-viewer video', { timeout: 10000 });
await page.waitForTimeout(2500);
r.video = await page.evaluate(() => { const el = document.querySelector('.rbe-viewer video'); return { src: (el.currentSrc || el.getAttribute('src') || '').slice(0, 30), vol: el.volume, muted: el.muted }; });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// Reddit's own players (shadow DOM): a mute right after a click elsewhere is Reddit's, not the user's;
// one right after a click on that player's own button is the user's and sticks
r.audio = await page.evaluate(() => {
  const host = document.createElement('div'); document.body.append(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<video style="width:300px;height:200px"></video><button id="mb">mute</button>';
  const v = root.querySelector('video');
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
  v.muted = true;
  const afterElsewhere = v.muted;
  root.getElementById('mb').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
  v.muted = true;
  return { afterElsewhere, afterOwn: v.muted, user: v.dataset.rbeUserAudio || null };
});
// a playing video that ended up muted (user never muted it) gets the volume back after a click
r.safety = await page.evaluate(() => new Promise(res => {
  document.body.insertAdjacentHTML('beforeend', '<video id="stuck" muted style="width:300px;height:200px"></video>');
  const v = document.getElementById('stuck');
  Object.defineProperty(v, 'paused', { get: () => false });
  v.dispatchEvent(new Event('play'));
  setTimeout(() => res({ muted: v.muted, vol: v.volume, active: navigator.userActivation.hasBeenActive }), 1000);
}));

// settings change through storage reaches the page (filtered onChanged)
await sw.evaluate(() => chrome.storage.sync.get('settings').then(({ settings = {} }) => chrome.storage.sync.set({ settings: { ...settings, theme: 'nord' } })));
await page.waitForTimeout(500);
r.themeApplied = await page.evaluate(() => document.documentElement.classList.contains('rbe-themed'));
await sw.evaluate(() => chrome.storage.local.set({ accounts: { x: { savedAt: 1, cookies: [] } } }));
await page.waitForTimeout(300);

// reload: snapshot gives theme before storage read
await page.reload();
r.themedAtDomStart = await page.evaluate(() => document.documentElement.classList.contains('rbe-themed'));

// extension popup still mounts the settings form (popup.js is shared with the userscript panel)
const idSrc = process.platform === 'win32' ? Buffer.from(ext, 'utf16le') : Buffer.from(ext);
const extId = [...crypto.createHash('sha256').update(idSrc).digest('hex').slice(0, 32)].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');
const pop = await ctx.newPage();
await pop.goto(`chrome-extension://${extId}/popup/popup.html`).catch(() => {});
await pop.waitForTimeout(600);
r.popup = await pop.evaluate(() => ({ themes: document.querySelectorAll('#themes .theme').length, accounts: !!document.querySelector('[data-tab="accounts"]'), checked: [...document.querySelectorAll('input[type=checkbox][data-key]')].some(i => i.checked) })).catch(e => ({ err: e.message }));

r.logs = logs;
await ctx.close();
fs.rmSync(prof, { recursive: true, force: true });

// ---------- the combined userscript (dist/better-browsing.user.js), no extension ----------
const usFile = path.resolve(path.dirname(ext), 'better-browsing.user.js');
r.us = { built: fs.existsSync(usFile) };
if (r.us.built) {
  const b2 = await chromium.launch();
  const c2 = await b2.newContext({ viewport: { width: 1400, height: 900 } });
  await c2.route(/reddit\.com|redd\.it|redditstatic/, fixtures);
  await c2.addInitScript({ path: usFile });
  const p2 = await c2.newPage();
  const usLogs = [];
  p2.on('pageerror', e => usLogs.push(e.message));
  p2.on('dialog', d => { usLogs.push('dialog ' + d.message()); d.dismiss(); });
  await p2.goto('https://www.reddit.com/r/test/');
  await p2.waitForTimeout(1500);
  Object.assign(r.us, await p2.evaluate(() => ({
    theme: !!document.getElementById('rbe-theme'), css: !!document.getElementById('rbe-css'),
    quickbar: !!document.getElementById('rbe-qb'), gear: !!document.querySelector('.rbe-nav-gear'),
    accountsBtn: !!document.querySelector('#rbe-qb [title="Accounts"]'), hlsBefore: !!window.Hls,
    videoAttr: document.documentElement.dataset.rbeVideo || ''
  })));
  const pb = await p2.locator('shreddit-post#t3_aaa').boundingBox();
  await p2.mouse.click(pb.x + 200, pb.y + 100);
  await p2.waitForSelector('.rbe-viewer .rbe-c', { timeout: 8000 }).catch(() => {});
  r.us.comments = await p2.evaluate(() => document.querySelectorAll('.rbe-viewer .rbe-c').length);
  await p2.keyboard.press('Escape');
  await p2.waitForTimeout(300);
  const vb = await p2.locator('shreddit-post#t3_vvv').boundingBox();
  await p2.mouse.click(vb.x + 200, vb.y + 100);
  await p2.waitForSelector('.rbe-viewer video', { timeout: 8000 }).catch(() => {});
  await p2.waitForTimeout(2000);
  Object.assign(r.us, await p2.evaluate(() => { const v = document.querySelector('.rbe-viewer video'); return { hlsAfter: typeof window.Hls === 'function', vol: v?.volume }; }));
  await p2.keyboard.press('Escape');
  await p2.waitForTimeout(300);
  await p2.click('.rbe-nav-gear').catch(() => {});
  await p2.waitForTimeout(500);
  // real clicks inside the panel (shadow DOM) must keep it open
  await p2.locator('.rbe-us-settings #tabs button[data-tab="video"]').click().catch(() => {});
  await p2.waitForTimeout(300);
  r.us.openAfterClick = await p2.evaluate(() => !!document.querySelector('.rbe-us-settings') && document.querySelector('.rbe-us-settings').shadowRoot.querySelector('#tabs .on')?.dataset.tab);
  Object.assign(r.us, await p2.evaluate(() => {
    const root = document.querySelector('.rbe-us-settings')?.shadowRoot;
    return { panelInputs: root?.querySelectorAll('[data-key]').length || 0, panelAccounts: !!root?.querySelector('[data-tab="accounts"]'), themes: root?.querySelectorAll('#themes .theme').length || 0 };
  }));
  await p2.evaluate(() => [...document.querySelector('.rbe-us-settings').shadowRoot.querySelectorAll('#themes .theme')].find(b => b.textContent === 'nord')?.click());
  await p2.waitForTimeout(800);
  r.us.saved = await p2.evaluate(() => JSON.parse(localStorage.getItem('rbe-userscript-storage') || '{}')?.sync?.settings?.theme);
  r.us.applied = await p2.evaluate(() => document.documentElement.classList.contains('rbe-themed'));
  await p2.keyboard.press('Escape');
  await p2.waitForTimeout(200);
  r.us.panelClosed = await p2.evaluate(() => !document.querySelector('.rbe-us-settings'));
  // image lightbox (gallery post, opened the way the viewer does)
  await p2.evaluate(() => RBE.openLightbox({ scope: 'post', index: 0, postData: { name: 't3_ggg', id: 'ggg', title: 'Gallery', author: 'a', subreddit_name_prefixed: 'r/test',
    permalink: '/r/test/comments/ggg/g/', created_utc: 1, is_gallery: true, gallery_data: { items: [{ media_id: 'm1' }, { media_id: 'm2' }] },
    media_metadata: { m1: { status: 'valid', e: 'Image', s: { u: 'https://i.redd.it/one.png', x: 800, y: 600 } }, m2: { status: 'valid', e: 'Image', s: { u: 'https://i.redd.it/two.png', x: 800, y: 600 } } } } }));
  await p2.waitForTimeout(800);
  r.us.lightbox = await p2.evaluate(() => { const lb = document.querySelector('.rbe-lb'); return lb && { fixed: getComputedStyle(lb).position === 'fixed', full: lb.getBoundingClientRect().width === innerWidth, img: [...lb.querySelectorAll('img')].some(i => /one\.png$/.test(i.src)), count: lb.querySelector('.rbe-lb-count')?.textContent }; });
  await p2.keyboard.press('Escape');
  r.us.errors = usLogs;
  await b2.close();
}

const checks = {
  'theme style injected': r.themeStyle,
  'quick bar shown': r.quickbar,
  'nav gear placed': r.gear,
  'settings snapshot saved': r.snapshot,
  'hover prefetches thread': r.prefetch.length === 1,
  'click reuses prefetch': r.reqsOnOpen === 0,
  'comments rendered': r.commentCount === 61,
  'unsafe html stripped': !/onerror|<script|javascript:/i.test(r.sanitize.body) && r.sanitize.evilImg === 0,
  'relative links absolutized': r.sanitize.link === 'https://www.reddit.com/r/test/comments/bbb/x/',
  'load more works': r.afterMore === 63,
  'collapse shows count': r.collapsed === ' (+1)',
  'sort refetches': r.sortReq === 1,
  'J goes to next post': /bbb/.test(r.afterJ),
  'Esc closes viewer': r.closed,
  'reopen uses cache': r.reopenReqs === 0,
  'video gets volume setting': r.video.vol === 0.1,
  'page mute after a click elsewhere ignored': r.audio.afterElsewhere === false,
  'mute after a click on the player sticks': r.audio.afterOwn === true && r.audio.user === '1',
  'video stuck muted gets unmuted after a click': r.safety.active && r.safety.muted === false && Math.abs(r.safety.vol - 0.1) < 0.01,
  'theme change applies': r.themeApplied,
  'no page errors or dialogs': !logs.some(l => /pageerror|DIALOG/.test(l)),
  'extension popup mounts settings form': r.popup.themes > 3 && r.popup.accounts && r.popup.checked,
  'userscript: theme, quick bar, gear; no accounts button': r.us.built && r.us.theme && r.us.css && r.us.quickbar && r.us.gear && !r.us.accountsBtn && /"mode":"volume"/.test(r.us.videoAttr),
  'userscript: viewer and comments': r.us.comments === 61,
  'userscript: hls.js loads on first video, volume applied': r.us.hlsBefore === false && r.us.hlsAfter === true && r.us.vol === 0.1,
  'userscript: gear opens settings panel (no accounts tab)': r.us.panelInputs > 20 && !r.us.panelAccounts && r.us.themes > 3,
  'userscript: settings change saved and applied live': r.us.saved === 'nord' && r.us.applied,
  'userscript: Esc closes panel, no page errors': r.us.panelClosed && r.us.errors?.length === 0,
  'userscript: clicks inside the settings panel keep it open': r.us.openAfterClick === 'video',
  'userscript: image lightbox opens with the gallery': !!r.us.lightbox?.fixed && r.us.lightbox.full && r.us.lightbox.img && r.us.lightbox.count === '1/2',
};
let failed = 0;
for (const [name, ok] of Object.entries(checks)) { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; }
if (failed) console.log('userscript details:', JSON.stringify(r.us));
if (failed) { console.log(JSON.stringify(r, null, 2)); process.exit(1); }
