// Offline smoke test for the Instagram extension: loads dist/instagram-chrome into Chromium and answers
// every instagram.com / cdn request from fixtures below, so it never touches live Instagram.
// Run: npm run test:instagram (after npm run build).
import { chromium } from 'playwright';
import os from 'os'; import path from 'path'; import fs from 'fs'; import crypto from 'crypto';

const ext = path.resolve(process.argv[2] || 'dist/instagram-chrome');
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'igb-'));
const ctx = await chromium.launchPersistentContext(prof, {
  headless: false,
  args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--autoplay-policy=no-user-gesture-required'],
  viewport: { width: 1400, height: 900 },
});

// ---------- fixtures ----------
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const mediaId = code => { let n = 0n; for (const c of code.slice(0, 11)) n = n * 64n + BigInt(ALPHA.indexOf(c)); return n.toString(); };
const img = (name, w = 1080, h = 1350) => ({ candidates: [{ url: `https://cdn.example.test/${name}_small.jpg`, width: 320, height: 400 }, { url: `https://cdn.example.test/${name}_full.jpg`, width: w, height: h }] });
const posts = {
  PHOTOAAAAAA: { code: 'PHOTOAAAAAA', user: { username: 'alice' }, caption: { text: 'Carousel caption' }, like_count: 12,
    carousel_media: [{ image_versions2: img('a1') }, { image_versions2: img('a2') }, { image_versions2: img('a3') }] },
  VIDEOBBBBBB: { code: 'VIDEOBBBBBB', user: { username: 'bob' }, caption: { text: 'Video caption' }, like_count: 5,
    image_versions2: img('b1'), video_versions: [{ url: 'https://cdn.example.test/b_low.mp4', width: 360, height: 640 }, { url: 'https://cdn.example.test/b_high.mp4', width: 720, height: 1280 }] },
  SINGLECCCCC: { code: 'SINGLECCCCC', user: { username: 'carol' }, caption: { text: 'Single, see example.com/x. Thanks @dave #tag' }, like_count: 1, image_versions2: img('c1') },
};
const byId = Object.fromEntries(Object.values(posts).map(p => [mediaId(p.code), p]));

// Instagram-like behaviour: mute every video and play it, again a bit later
const igScript = `<script>
  function igMute() { document.querySelectorAll('video').forEach(v => { v.muted = true; v.volume = 1; v.play().catch(() => {}); }); }
  addEventListener('DOMContentLoaded', () => { igMute(); setTimeout(igMute, 400); });
  window.__igNav = 0; document.addEventListener('click', e => { if (e.target.closest('a[href]')) window.__igNav++; });
</script>`;
const feed = `<!doctype html><html><head><title>feed</title>${igScript}</head><body style="margin:0;background:#000;color:#fff">
<nav id="side" style="position:fixed;left:0;top:200px;width:60px"><div>
  <div><span><a href="/"><svg width="24" height="24" viewBox="0 0 24 24"><title>Home</title><path d="M2 2h20v20H2z"/></svg><span>Home</span></a></span></div>
  <div><span><a href="/reels/"><svg width="24" height="24" viewBox="0 0 24 24"><title>Reels</title><path d="M2 2h20v20H2z"/></svg><span>Reels</span></a></span></div>
  <div><span><a href="/explore/"><svg width="24" height="24" viewBox="0 0 24 24"><title>Search</title><path d="M2 2h20v20H2z"/></svg><span>Search</span></a></span></div>
</div></nav>
<main style="width:470px;margin:20px auto">
<article id="vid">
  <header><a href="/p/VIDEOBBBBBB/"><time>1h</time></a></header>
  <a href="/reels/VIDEOBBBBBB/" style="display:block">
    <div style="position:relative;width:468px;height:585px">
      <div style="position:absolute;inset:0"><video src="https://cdn.example.test/feed.mp4" playsinline style="width:100%;height:100%;display:block;background:#222"></video></div>
      <div><div aria-label="Video player" style="position:absolute;inset:0">
        <div role="presentation" style="position:absolute;inset:0"></div>
        <div role="button" aria-label="Audio is muted" style="position:absolute;right:8px;bottom:8px;width:28px;height:28px;background:#555"></div>
      </div></div>
    </div>
  </a>
</article>
<article id="photo">
  <header><a href="/p/PHOTOAAAAAA/"><time>2h</time></a></header>
  <div style="position:relative;width:468px;height:585px">
    <img src="https://cdn.example.test/a2_small.jpg" style="width:468px;height:585px;display:block">
    <div style="position:absolute;inset:0"></div>
    <div role="button" aria-label="Next" style="position:absolute;right:4px;top:280px;width:30px;height:30px;background:#777"></div>
  </div>
  <div><div aria-label="Go to slide 1"></div><div aria-label="Go to slide 2" aria-current="step"></div><div aria-label="Go to slide 3"></div></div>
</article>
<article id="single">
  <header><a href="/p/SINGLECCCCC/"><time>3h</time></a></header>
  <img src="https://cdn.example.test/c1_small.jpg" style="width:468px;height:585px;display:block">
</article>
</main><div style="height:1500px"></div></body></html>`;
const explore = `<!doctype html><html><head><title>explore</title>${igScript}</head><body style="margin:0">
<main style="display:grid;grid-template-columns:repeat(3,240px);gap:4px;padding:20px">
  <a href="/p/PHOTOAAAAAA/"><img src="https://cdn.example.test/a1_small.jpg" style="width:240px;height:300px;display:block"></a>
  <a href="/p/VIDEOBBBBBB/"><video id="tilevid" src="https://cdn.example.test/tile.mp4" muted style="width:240px;height:300px;display:block;background:#333"></video></a>
  <a href="/p/SINGLECCCCC/"><img src="https://cdn.example.test/c1_small.jpg" style="width:240px;height:300px;display:block"></a>
</main></body></html>`;
// Reels tab: a scroll-snap column, one reel per screen; the URL names the reel on screen
// Caption laid over the video: one line cut with "… more" in a role=button; a click opens it in place
const reel = n => `<div style="height:860px;scroll-snap-align:center;display:flex;align-items:center;justify-content:center">
  <div style="position:relative;width:420px;height:746px"><video id="r${n}" src="https://cdn.example.test/reel${n}.mp4" playsinline style="width:100%;height:100%;display:block;background:#222"></video>
    <div role="presentation" style="position:absolute;inset:0"></div>
    <div id="cap${n}" style="position:absolute;left:0;right:0;bottom:0;height:0"><div style="position:absolute;left:10px;bottom:20px;width:280px;padding:10px;color:#fff;font:14px/18px sans-serif">
      <a href="/user${n}/" style="color:#fff">user${n}</a>
      <div role="button" tabindex="0" class="capbtn" style="display:flex"><span style="white-space:nowrap;overflow:hidden;text-overflow:clip;width:200px">Line one of a long caption that is cut off here</span><span aria-hidden="true">… more</span></div>
    </div></div>
  </div></div>`;
const capScript = `<script>document.addEventListener('click', e => { const b = e.target.closest('.capbtn'); if (!b) return;
  const full = document.createElement('div'); full.className = 'capfull';
  full.innerHTML = '<span style="white-space:pre-line">Line one of a long caption that is cut off here\\nLinks: linktr.ee/foo, https://example.com/a?b=1. Mail me@mail.com <a href="/explore/tags/tag/">#tag</a></span>';
  b.replaceWith(full); });</script>`;
const reels = `<!doctype html><html><head><title>reels</title>${igScript}${capScript}</head><body style="margin:0;background:#000">
<main><div id="col" style="height:900px;overflow-y:auto;scroll-snap-type:y mandatory">${[1, 2, 3].map(reel).join('')}</div></main></body></html>`;

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const reqs = [];
const posted = [];
const fixtures = async route => {
  const u = new URL(route.request().url());
  reqs.push(u.pathname);
  let m;
  if (/^\/api\/v1\/discover\/explore_report(_undo)?\/$/.test(u.pathname)) {
    const rq = route.request();
    posted.push({ path: u.pathname, method: rq.method(), csrf: rq.headers()['x-csrftoken'], body: Object.fromEntries(new URLSearchParams(rq.postData() || '')) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' });
  }
  if ((m = u.pathname.match(/^\/api\/v1\/media\/(\d+)\/info\/$/))) {
    const hdr = route.request().headers()['x-ig-app-id'];
    const p = byId[m[1]];
    return route.fulfill({ status: p && hdr ? 200 : 404, contentType: 'application/json', body: JSON.stringify(p ? { items: [p] } : {}) });
  }
  if (u.pathname.endsWith('.jpg')) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
  if (u.pathname.endsWith('.mp4')) return route.fulfill({ status: 404, body: '' });
  if (u.pathname.startsWith('/explore')) return route.fulfill({ status: 200, contentType: 'text/html', body: explore });
  if (u.pathname.startsWith('/reels/')) return route.fulfill({ status: 200, contentType: 'text/html', body: reels });
  if (u.pathname === '/') return route.fulfill({ status: 200, contentType: 'text/html', body: feed });
  return route.fulfill({ status: 404, body: '' });
};
await ctx.route(/instagram\.com|example\.test/, fixtures);
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://www.instagram.com' });
await ctx.addCookies([{ name: 'csrftoken', value: 'testcsrf', domain: '.instagram.com', path: '/' }]);

const logs = [];
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error' || /IGB/.test(m.text())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => logs.push('[pageerror] ' + e.message));

const r = {};
const ok = {};
const check = (name, cond, detail) => { ok[name] = !!cond; r[name] = detail; };

// ---------- feed: native controls + audio ----------
await page.goto('https://www.instagram.com/');
await page.waitForTimeout(1500);
const feedState = await page.evaluate(() => {
  const v = document.querySelector('#vid video'), vr = v.getBoundingClientRect();
  const at = (fx, fy) => document.elementFromPoint(vr.left + vr.width * fx, vr.top + vr.height * fy);
  return {
    attr: document.documentElement.dataset.igbVideo,
    controls: v.controls, muted: v.muted, volume: v.volume, loop: v.loop,
    overlays: document.querySelectorAll('.igb-ov').length,
    centerIsVideo: at(.5, .5) === v, cornerIsVideo: at(.97, .97) === v,
    linkHref: v.closest('a')?.getAttribute('href') ?? null,
  };
});
check('settings attribute', /"mode":"volume"/.test(feedState.attr || ''), feedState.attr);
check('feed video native controls', feedState.controls && feedState.loop, feedState);
check('Instagram overlay click-through', feedState.overlays >= 1 && feedState.centerIsVideo && feedState.cornerIsVideo, feedState);
check('Instagram mute blocked, volume 40%', feedState.muted === false && Math.abs(feedState.volume - 0.4) < 0.01, feedState);
check('reel link parked', feedState.linkHref === null, feedState.linkHref);

// clicking the video (its controls) must not reach Instagram's router
const vb = await page.locator('#vid video').boundingBox();
await page.mouse.click(vb.x + vb.width / 2, vb.y + vb.height / 2);
await page.waitForTimeout(300);
const afterVidClick = await page.evaluate(() => ({ nav: window.__igNav, url: location.pathname, lb: !!document.querySelector('.igb-lb') }));
check('video click stays on page', afterVidClick.nav === 0 && afterVidClick.url === '/' && !afterVidClick.lb, afterVidClick);

// user changes volume on the player: sticks, and Instagram's next mute still blocked
await page.mouse.move(vb.x + vb.width / 2, vb.y + vb.height / 2);
await page.mouse.down(); await page.mouse.up();
await page.evaluate(() => { const v = document.querySelector('#vid video'); v.volume = 0.9; });
await page.evaluate(() => new Promise(r => setTimeout(r, 1500)));
await page.evaluate(() => { const v = document.querySelector('#vid video'); v.muted = true; });
const userVol = await page.evaluate(() => { const v = document.querySelector('#vid video'); return { volume: v.volume, muted: v.muted }; });
check('user volume kept, later page mute ignored', Math.abs(userVol.volume - 0.9) < 0.01 && userVol.muted === false, userVol);

// ---------- feed photo → lightbox at the active carousel slide ----------
const pb = await page.locator('#photo img').boundingBox();
await page.mouse.dblclick(pb.x + 100, pb.y + 100);
await page.waitForTimeout(500);
check('double click (like) does not open lightbox', !(await page.$('.igb-lb')), null);

await page.mouse.click(pb.x + 100, pb.y + 100);
await page.waitForSelector('.igb-lb .igb-lb-dots i', { timeout: 5000 });
await page.waitForTimeout(300);
const lbFeed = await page.evaluate(() => ({
  dots: document.querySelectorAll('.igb-lb-dots i').length,
  on: [...document.querySelectorAll('.igb-lb-dots i')].findIndex(i => i.classList.contains('on')),
  src: document.querySelector('.igb-lb-stage img')?.src,
  user: document.querySelector('.igb-lb-user')?.textContent,
  meta: document.querySelector('.igb-lb-meta')?.textContent,
  feedPaused: document.querySelector('#vid video').paused,
  lbAttr: document.documentElement.hasAttribute('data-igb-lb'),
}));
check('feed photo opens at active slide', lbFeed.dots === 3 && lbFeed.on === 1 && lbFeed.user === 'alice', lbFeed);
check('full-res image swapped in', /a2_full\.jpg$/.test(lbFeed.src || ''), lbFeed.src);
check('page videos paused while open', lbFeed.feedPaused && lbFeed.lbAttr, lbFeed);
const blocked = await page.evaluate(async () => { const v = document.querySelector('#vid video'); await v.play().catch(() => {}); return v.paused; });
check('page video cannot restart while open', blocked, blocked);

// ---------- explore grid → lightbox, stepping, closing ----------
await page.keyboard.press('Escape');
await page.goto('https://www.instagram.com/explore/');
await page.waitForTimeout(1200);
const tile = await page.evaluate(() => { const v = document.getElementById('tilevid'); return { controls: v.controls, muted: v.muted }; });
check('grid preview video left alone', !tile.controls && tile.muted, tile);

const histBefore = await page.evaluate(() => history.length);
await page.click('a[href="/p/PHOTOAAAAAA/"]');
await page.waitForSelector('.igb-lb .igb-lb-dots i', { timeout: 5000 });
const lbGrid = await page.evaluate(() => ({ url: location.pathname, nav: window.__igNav, meta: document.querySelector('.igb-lb-meta')?.textContent, cap: document.querySelector('.igb-lb-cap')?.textContent }));
check('grid tile opens lightbox, not Instagram', lbGrid.url === '/explore/' && lbGrid.nav === 0 && /1 \/ 3/.test(lbGrid.meta), lbGrid);
check('caption shown', lbGrid.cap === 'Carousel caption', lbGrid.cap);
const side = await page.evaluate(() => { const b = document.querySelector('.igb-lb-bar').getBoundingClientRect(), m = document.querySelector('.igb-lb-stage').getBoundingClientRect(); return { barLeft: Math.round(b.left), stageRight: Math.round(m.right), barTop: Math.round(b.top), barH: Math.round(b.height) }; });
check('caption panel beside the media', side.barLeft >= side.stageRight && side.barTop === 0 && side.barH === 900, side);

await page.keyboard.press('ArrowRight');
const slide2 = await page.evaluate(() => [...document.querySelectorAll('.igb-lb-dots i')].findIndex(i => i.classList.contains('on')));
check('arrow steps through carousel', slide2 === 1, slide2);

// wheel past the last slide → next post (a video, already prefetched)
const n0 = reqs.filter(p => p.startsWith('/api/')).length;
for (let i = 0; i < 2; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(300); }
await page.waitForSelector('.igb-lb-stage video', { timeout: 5000 });
const lbVid = await page.evaluate(() => { const v = document.querySelector('.igb-lb-stage video'); return { src: v.getAttribute('src'), controls: v.controls, muted: v.muted, volume: v.volume, meta: document.querySelector('.igb-lb-meta')?.textContent }; });
check('wheel moves on to next post', /2 \/ 3/.test(lbVid.meta), lbVid.meta);
check('lightbox video: best mp4, controls, 40%', lbVid.src.endsWith('b_high.mp4') && lbVid.controls && !lbVid.muted && Math.abs(lbVid.volume - 0.4) < 0.01, lbVid);
const n1 = reqs.filter(p => p.startsWith('/api/')).length;
check('next post came from prefetch', n1 === n0, { before: n0, after: n1 });

await page.keyboard.press('ArrowUp');
const backUp = await page.evaluate(() => document.querySelector('.igb-lb-meta')?.textContent);
check('ArrowUp goes to previous post', /1 \/ 3/.test(backUp), backUp);

await page.goBack();
await page.waitForTimeout(300);
const closed = await page.evaluate(() => ({ lb: !!document.querySelector('.igb-lb'), url: location.pathname, attr: document.documentElement.hasAttribute('data-igb-lb') }));
check('Back button closes lightbox', !closed.lb && closed.url === '/explore/' && !closed.attr, closed);

await page.click('a[href="/p/SINGLECCCCC/"]');
await page.waitForSelector('.igb-lb');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const escClosed = await page.evaluate(() => ({ lb: !!document.querySelector('.igb-lb'), len: history.length }));
check('Esc closes and pops its history entry', !escClosed.lb, { ...escClosed, histBefore });

// ---------- downloads ----------
await page.goto('https://www.instagram.com/');
await page.waitForTimeout(1200);
const photo = await page.locator('#photo img').boundingBox();
await page.mouse.move(photo.x + 200, photo.y + 200);
await page.waitForSelector('.igb-tools:not([hidden]) .igb-tool', { timeout: 3000 });
const toolCount = await page.locator('.igb-tools .igb-tool').count();
check('hover bar on carousel photo (this / all / open / link / not interested)', toolCount === 5, toolCount);
let dl = page.waitForEvent('download', { timeout: 5000 });
await page.locator('.igb-tools .igb-tool').first().click();
let name = (await dl.catch(() => null))?.suggestedFilename();
check('download current slide, named from pattern', name === 'alice_PHOTOAAAAAA_2.jpg', name);
const names = [];
page.on('download', d => names.push(d.suggestedFilename()));
await page.locator('.igb-tools .igb-dl-all').click();
await page.waitForTimeout(1500);
check('download all slides', names.join() === 'alice_PHOTOAAAAAA_1.jpg,alice_PHOTOAAAAAA_2.jpg,alice_PHOTOAAAAAA_3.jpg', names);
await page.locator('#single img').scrollIntoViewIfNeeded();
await page.waitForTimeout(200);
const single = await page.locator('#single img').boundingBox();
await page.mouse.move(single.x + 200, single.y + 200);
await page.waitForTimeout(300);
dl = page.waitForEvent('download', { timeout: 5000 });
await page.keyboard.press('Alt+S');
name = (await dl.catch(() => null))?.suggestedFilename();
check('Alt+S downloads media under mouse', name === 'carol_SINGLECCCCC_1.jpg', name);
await page.mouse.click(single.x + 200, single.y + 200);
await page.waitForSelector('.igb-lb .igb-tools-inline .igb-tool', { timeout: 5000 });
const lbLinks = await page.evaluate(() => [...document.querySelectorAll('.igb-lb-cap a')].map(a => a.getAttribute('href') + (a.target ? ' new-tab' : '')));
check('lightbox caption: address, @mention and #hashtag are links', lbLinks.join() === 'https://example.com/x new-tab,/dave/,/explore/tags/tag/', lbLinks);
dl = page.waitForEvent('download', { timeout: 5000 });
await page.keyboard.press('d');
name = (await dl.catch(() => null))?.suggestedFilename();
check('lightbox D key downloads', name === 'carol_SINGLECCCCC_1.jpg', name);
await page.keyboard.press('Escape');

// ---------- buttons stay up; link for Discord ----------
await page.goto('https://www.instagram.com/');
await page.waitForTimeout(800);
await page.mouse.move(5, 5);
await page.waitForTimeout(500);
const stay = await page.evaluate(() => { const b = document.querySelector('.igb-tools'); const r = document.querySelector('#vid video').getBoundingClientRect(), br = b?.getBoundingClientRect();
  return { shown: !!b && !b.hidden, n: b?.querySelectorAll('.igb-tool').length, besideVideo: !!br && br.left >= r.right && br.top >= r.top }; });
check('buttons stay up beside the post in view, mouse elsewhere', stay.shown && stay.n >= 3 && stay.besideVideo, stay);
await page.locator('.igb-tools .igb-embed-btn').click().catch(() => {});
await page.waitForTimeout(400);
const copied = await page.evaluate(async () => ({ toast: document.querySelector('.igb-toast')?.textContent, clip: await navigator.clipboard.readText().catch(e => 'ERR ' + e.message) }));
check('link button copies Discord embed link (reel path for a video)', copied.clip === 'https://kkinstagram.com/reel/VIDEOBBBBBB/' && /Copied https:\/\/kkinstagram\.com\/reel\/VIDEOBBBBBB\//.test(copied.toast || ''), copied);

// ---------- not interested ----------
await page.goto('https://www.instagram.com/');
await page.waitForTimeout(1000);
await page.locator('#single img').scrollIntoViewIfNeeded();
const sb = await page.locator('#single img').boundingBox();
await page.mouse.move(sb.x + 200, sb.y + 200);
await page.waitForSelector('.igb-tools:not([hidden]) .igb-ni-btn', { timeout: 3000 }).catch(() => {});
await page.locator('.igb-tools .igb-ni-btn').click().catch(() => {});
await page.waitForSelector('.igb-toast', { timeout: 3000 }).catch(() => {});
const ni = await page.evaluate(() => ({ hidden: document.getElementById('single').classList.contains('igb-ni'), toast: document.querySelector('.igb-toast')?.textContent }));
const niReq = posted.find(p => p.path === '/api/v1/discover/explore_report/');
check('not interested: POST explore_report with media pk + csrf', niReq && niReq.method === 'POST' && niReq.body.m_pk === mediaId('SINGLECCCCC') && niReq.csrf === 'testcsrf', niReq);
check('not interested: feed post collapses, toast shown', ni.hidden && /Not interested/.test(ni.toast || ''), ni);
await page.locator('.igb-toast button').click().catch(() => {});
await page.waitForTimeout(300);
const undo = posted.find(p => p.path === '/api/v1/discover/explore_report_undo/');
const unhidden = await page.evaluate(() => !document.getElementById('single').classList.contains('igb-ni'));
check('not interested: Undo', undo?.body.m_pk === mediaId('SINGLECCCCC') && unhidden, { undo, unhidden });

// ---------- Reels tab: auto-scroll, not interested moves on ----------
await page.goto('https://www.instagram.com/reels/REELAAAAAAA/');
await page.waitForTimeout(1200);
const rLoop = await page.evaluate(() => [...document.querySelectorAll('#col video')].map(v => v.loop));
check('reels tab: no looping while auto-scroll is on', rLoop.length === 3 && rLoop.every(l => l === false), rLoop);
const centerOf = () => page.evaluate(() => [...document.querySelectorAll('#col video')].findIndex(v => { const r = v.getBoundingClientRect(); return r.top < 450 && r.bottom > 450; }));
const r0 = await centerOf();
await page.evaluate(() => document.getElementById('r1').dispatchEvent(new Event('ended')));
await page.waitForTimeout(900);
const r1 = await centerOf();
check('reels tab: reel ends -> next reel scrolled in', r0 === 0 && r1 === 1, { r0, r1 });
const rb = await page.locator('#r2').boundingBox();
await page.mouse.move(rb.x + 200, rb.y + 300);
await page.waitForSelector('.igb-tools:not([hidden]) .igb-ni-btn', { timeout: 3000 }).catch(() => {});
const before = posted.length;
await page.locator('.igb-tools .igb-ni-btn').click().catch(() => {});
await page.waitForTimeout(900);
const r2 = await centerOf();
const rReq = posted.slice(before).find(p => p.path === '/api/v1/discover/explore_report/');
check('reels tab: not interested marks the reel and moves on', rReq?.body.m_pk === mediaId('REELAAAAAAA') && r2 === 2, { rReq, r2 });

// captions: opened in full, addresses linked, caption kept visible and clickable over the video
await page.mouse.move(5, 5);
await page.waitForTimeout(900);
const cap = await page.evaluate(() => {
  const c = document.getElementById('cap3'), full = c.querySelector('.capfull');
  const links = [...c.querySelectorAll('a.igb-link')].map(a => a.getAttribute('href'));
  const user = c.querySelector('a[href="/user3/"]'), ur = user.getBoundingClientRect();
  return { full: !!full, btn: !!c.querySelector('.capbtn'), links, text: full?.textContent, cls: c.className, opacity: getComputedStyle(c).opacity,
    userHit: document.elementFromPoint(ur.left + 5, ur.top + 5) === user };
});
check('reels caption opened in full', cap.full && !cap.btn, cap);
check('caption addresses become links (not e-mail)', cap.links.join() === 'https://linktr.ee/foo,https://example.com/a?b=1' && /Mail me@mail\.com/.test(cap.text || ''), cap);
check('caption over the video stays visible and clickable', /igb-cap/.test(cap.cls) && !/igb-ov/.test(cap.cls) && cap.opacity === '1' && cap.userHit, cap);

// auto-scroll button switches the setting
// in the button column beside the reel
const asState = () => page.evaluate(() => { const b = document.querySelector('.igb-tools:not([hidden]) .igb-as-btn'); return b ? b.getAttribute('aria-pressed') + ' ' + b.textContent : null; });
const as0 = await asState();
await page.click('.igb-tools .igb-as-btn').catch(() => {});
await page.waitForTimeout(500);
const as1 = await asState();
const loop1 = await page.evaluate(() => document.getElementById('r3').loop);
await page.click('.igb-tools .igb-as-btn').catch(() => {});
await page.waitForTimeout(500);
const as2 = await asState();
check('auto-scroll button in the column toggles it', as0 === 'true Auto' && as1 === 'false Off' && loop1 === true && as2 === 'true Auto', { as0, as1, loop1, as2 });
const look = await page.evaluate(() => { const b = document.querySelector('.igb-tools .igb-dl'), cs = getComputedStyle(b);
  return { bg: cs.backgroundColor, svg: !!b.querySelector('svg[stroke="currentColor"]'), w: Math.round(b.getBoundingClientRect().width) }; });
check('buttons look like Instagram action buttons (bare line icons)', look.bg === 'rgba(0, 0, 0, 0)' && look.svg && look.w === 40, look);

// a reel that comes up muted after the page has had a click gets the user's level back
const unmuted = await page.evaluate(() => new Promise(r => {
  document.getElementById('col').insertAdjacentHTML('beforeend', '<video id="rm" muted src="https://cdn.example.test/m.mp4" style="width:300px;height:300px"></video>');
  const v = document.getElementById('rm');
  Object.defineProperty(v, 'paused', { get: () => false });
  setTimeout(() => r({ muted: v.muted, volume: v.volume, active: navigator.userActivation.hasBeenActive }), 1000);
}));
check('reel stuck muted after a click gets unmuted', unmuted.active && unmuted.muted === false && Math.abs(unmuted.volume - 0.4) < 0.01, unmuted);
const asOff = await page.evaluate(() => { history.pushState({}, '', '/'); document.body.append(document.createElement('div')); return new Promise(r => setTimeout(() => r(!document.querySelector('.igb-tools:not([hidden]) .igb-as-btn')), 700)); });
check('auto-scroll button only on the Reels tab', asOff === true, asOff);

// ---------- settings panel: sidebar gear, Alt+W ----------
await page.goto('https://www.instagram.com/');
await page.waitForSelector('.igb-gear', { timeout: 3000 }).catch(() => {});
const gear = await page.evaluate(() => { const g = document.querySelector('.igb-gear'); return g && { text: g.querySelector('a > span').textContent, last: g === g.parentElement.lastElementChild, href: g.querySelector('a').getAttribute('href'), svg: g.querySelector('svg title')?.textContent }; });
check('sidebar gear entry cloned from Search', gear?.text === 'Better Browsing' && gear.last && gear.href === '#' && gear.svg === 'Better Browsing', gear);
await page.click('.igb-gear a');
await page.waitForSelector('.igb-settings iframe', { timeout: 3000 }).catch(() => {});
let frame = null;
for (let i = 0; i < 30 && !frame; i++) { frame = page.frames().find(f => f.url().endsWith('/popup/popup.html')); if (!frame) await page.waitForTimeout(100); }
if (frame) await frame.waitForSelector('[data-key="settingsGear"]', { timeout: 3000 }).catch(() => {});
const fInputs = frame ? await frame.locator('[data-key]').count() : 0;
check('gear opens settings panel (popup in iframe)', fInputs === 17 && page.url().endsWith('/'), { fInputs, url: page.url() });
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
const escP = await page.$('.igb-settings');
await page.keyboard.press('Alt+W');
await page.waitForTimeout(200);
const altP = await page.$('.igb-settings');
await page.keyboard.press('Alt+W');
await page.waitForTimeout(200);
check('Esc closes, Alt+W toggles panel', !escP && !!altP && !(await page.$('.igb-settings')), { esc: !!escP, alt: !!altP });

// ---------- popup → live settings change ----------
// Unpacked extension id = sha256 of its path (UTF-16LE on Windows), first 32 hex digits mapped to a-p
const idSrc = process.platform === 'win32' ? Buffer.from(ext, 'utf16le') : Buffer.from(ext);
const extId = [...crypto.createHash('sha256').update(idSrc).digest('hex').slice(0, 32)].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');
const pop = await ctx.newPage();
try {
  await pop.goto(`chrome-extension://${extId}/popup/popup.html`);
  await pop.selectOption('select[data-key="videoMode"]', 'muted');
  await page.waitForTimeout(600);
  const attr = await page.evaluate(() => document.documentElement.dataset.igbVideo);
  check('popup change reaches open page', /"mode":"muted"/.test(attr), attr);
} catch (e) {
  check('popup change reaches open page', false, 'popup not reachable: ' + e.message);
}

// ---------- userscript build, no extension ----------
const usFile = path.resolve(path.dirname(ext), 'instagram-better-browsing.user.js');
if (fs.existsSync(usFile)) {
  const b2 = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const c2 = await b2.newContext({ viewport: { width: 1400, height: 900 } });
  await c2.route(/instagram\.com|example\.test/, fixtures);
  await c2.addInitScript({ path: usFile });
  const p2 = await c2.newPage();
  p2.on('pageerror', e => logs.push('[userscript pageerror] ' + e.message));
  await p2.goto('https://www.instagram.com/');
  await p2.waitForTimeout(1500);
  const us = await p2.evaluate(() => { const v = document.querySelector('#vid video'); return { controls: v.controls, muted: v.muted, volume: v.volume, css: !!document.getElementById('igb-css') }; });
  check('userscript: controls + sound', us.controls && !us.muted && Math.abs(us.volume - 0.4) < 0.01 && us.css, us);
  await p2.keyboard.press('Alt+W');
  await p2.waitForTimeout(300);
  const panel = await p2.evaluate(() => { const r = document.querySelector('.igb-settings')?.shadowRoot; return { inputs: r?.querySelectorAll('[data-key]').length, vol: r?.querySelector('[data-key="videoVolume"]')?.value }; });
  check('userscript: Alt+W settings panel', panel.inputs === 17 && panel.vol === '40', panel);
  await p2.evaluate(() => { const sel = document.querySelector('.igb-settings')?.shadowRoot?.querySelector('[data-key="videoMode"]'); if (!sel) return; sel.value = 'muted'; sel.dispatchEvent(new Event('change')); });
  await p2.waitForTimeout(400);
  const attr2 = await p2.evaluate(() => document.documentElement.dataset.igbVideo);
  check('userscript: settings change applies live', /"mode":"muted"/.test(attr2), attr2);
  await b2.close();
} else check('userscript: built', false, usFile + ' missing');

let fails = 0;
for (const [k, v] of Object.entries(ok)) {
  if (!v) fails++;
  console.log(`${v ? 'PASS' : 'FAIL'}  ${k}${v ? '' : '  ' + JSON.stringify(r[k])}`);
}
if (logs.length) console.log('\nconsole:\n' + logs.join('\n'));
await ctx.close();
fs.rmSync(prof, { recursive: true, force: true });
process.exit(fails ? 1 : 0);
