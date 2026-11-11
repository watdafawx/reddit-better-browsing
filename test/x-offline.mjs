// Offline smoke test for the X part of the userscript: loads dist/better-browsing.user.js into plain Chromium
// (no extension) and answers every x.com request from fixtures below, so it never touches live X.
// Run: npm run test:x
import { chromium, firefox } from 'playwright';
import path from 'path'; import fs from 'fs';
import { idleMutations, churnCost, costOk } from './lib/perf.mjs';

const usFile = path.resolve(process.argv[2] || 'dist/better-browsing.user.js');
const CLIP = fs.readFileSync(path.resolve('test/fixtures/clip.webm'));

// ---------- fixtures ----------
// X-like markup (data-testid based): videoPlayer > videoComponent > [layer with the <video>] [X's own overlay with a mute button]
const player = (id, w = 480, h = 200, extra = '', src = 'https://video.example.test/clip.webm') => `<div data-testid="videoPlayer" style="position:relative;width:${w}px;height:${h}px">
  <div data-testid="videoComponent" style="position:relative;width:100%;height:100%">
    <div style="position:absolute;inset:0"><video id="${id}" aria-label="Embedded video" playsinline ${extra} src="${src}" style="width:100%;height:100%;display:block;background:#222"></video></div>
    <div class="xov" style="position:absolute;inset:0"><button data-testid="mute-button" aria-label="Unmute" style="position:absolute;right:8px;bottom:8px;width:40px;height:40px">m</button></div>
  </div></div>`;
const bar = `<div role="group" style="display:flex;justify-content:space-between;width:480px">
  <div><button data-testid="reply"><svg width="18" height="18" style="color:rgb(113,118,123)"><path d="M0 0h18v18z"/></svg></button></div>
  <div><button data-testid="retweet">rt</button></div>
  <div><button data-testid="like">l</button></div>
  <div><button data-testid="bookmark"><svg width="18" height="18" style="color:rgb(113,118,123)"><path d="M0 0h18v18z"/></svg></button></div>
  <div><button aria-label="Share post">s</button></div></div>`;
const tweet = (id, user, tid, body) => `<article data-testid="tweet" id="${id}" style="margin:0 0 20px;width:500px">
  <div><a href="/${user}"><span>${user}</span></a> <a href="/${user}/status/${tid}"><time>1h</time></a></div>
  ${body}${bar}</article>`;
const home = `<!doctype html><html><head><title>home</title>
<script>
  // X-like page behaviour: mute and autoplay every video, again a bit later
  function xPlay() { document.querySelectorAll('video').forEach(v => { v.muted = true; v.play().catch(() => {}); }); }
  addEventListener('DOMContentLoaded', () => {
    xPlay(); setTimeout(xPlay, 400);
    document.addEventListener('click', e => {
      const t = e.target.closest('[data-testid]'); if (!t) return;
      const a = t.closest('article'), id = t.dataset.testid;
      if (id === 'like') t.dataset.testid = 'unlike'; else if (id === 'unlike') t.dataset.testid = 'like';
      else if (id === 'retweet' || id === 'unretweet') {
        window.__menus = (window.__menus || 0) + 1;
        const m = document.createElement('div'); m.setAttribute('role', 'menu'); m.dataset.testid = 'Dropdown'; m.dataset.for = a.id;
        m.innerHTML = '<div role="menuitem" data-testid="' + (id === 'retweet' ? 'retweetConfirm' : 'unretweetConfirm') + '">Repost</div><div role="menuitem">Quote</div>';
        document.getElementById('layers').append(m);
      } else if (id === 'retweetConfirm' || id === 'unretweetConfirm') {
        const m = t.closest('[role=menu]'), b = document.getElementById(m.dataset.for).querySelector('[data-testid=retweet],[data-testid=unretweet]');
        b.dataset.testid = id === 'retweetConfirm' ? 'unretweet' : 'retweet'; m.remove(); window.__confirmed = (window.__confirmed || 0) + 1;
      } else if (a && !t.closest('[role=group]')) window.__openTweet = (window.__openTweet || 0) + 1;   // clicking a tweet opens it
    });
    document.addEventListener('click', e => { if (e.target.closest('article') && !e.target.closest('button, [role=group], [role=menu]')) window.__articleClicks = (window.__articleClicks || 0) + 1; });
  });
</script></head><body style="margin:0;background:#000;color:#fff;font:14px sans-serif">
<nav aria-label="Primary" style="position:fixed;left:0;top:300px;width:200px;display:flex;flex-direction:column">
  <a href="/home"><svg width="24" height="24" viewBox="0 0 24 24"><path d="M2 2h20v20H2z"/></svg><span>Home</span></a>
  <a href="/explore"><svg width="24" height="24" viewBox="0 0 24 24"><path d="M2 2h20v20H2z"/></svg><span>Explore</span></a>
  <a href="/i/bookmarks"><svg width="24" height="24" viewBox="0 0 24 24"><path d="M2 2h20v20H2z"/></svg><span>Bookmarks</span></a>
  <a href="/alice"><svg width="24" height="24" viewBox="0 0 24 24"><path d="M2 2h20v20H2z"/></svg><span>Profile</span></a>
</nav>
<main style="margin-left:260px;padding-top:10px">
${tweet('t1', 'alice', '111', player('v1') )}
${tweet('t2', 'bob', '222', player('v2') + `<div role="link" style="border:1px solid #444;margin:4px 0"><a href="/dave/status/999"><time>2h</time></a> quoted tweet</div>`)}
<div style="height:700px"></div>
${tweet('t3', 'carol', '333', player('v3'))}
${tweet('t4', 'erin', '444', `<div data-testid="tweetPhoto">${player('gif', 300, 150, 'loop muted autoplay', 'https://video.example.test/tweet_video/g.webm')}</div>`)}
<div style="height:900px"></div>
</main><div id="layers"></div></body></html>`;

// A feed of single-video tweets with gaps (for the middle-of-screen rule) and a tweet with four videos
const withMain = main => home.replace(/<main[\s\S]*<\/main>/,'<main style="margin-left:260px;padding-top:10px">' + main + '</main>');
const gap = h => '<div style="height:' + h + 'px"></div>';
const feed = withMain([1, 2, 3, 4, 5].map(n => tweet('ft' + n, 'u' + n, '50' + n, player('f' + n)) + gap(120)).join('') + gap(900));
const cell = id => player(id, 240, 135).replace('position:relative;', 'position:relative;float:left;');
const multi = withMain(gap(40) + tweet('m', 'multi', '600', '<div style="width:480px;height:270px">' + ['m1', 'm2', 'm3', 'm4'].map(cell).join('') + '</div>') + gap(1400));
const heavy = withMain(Array.from({ length: 80 }, (_, n) => tweet('h' + n, 'u' + n, '70' + n, '<div style="width:480px">tweet text ' + n + '</div>') + gap(30)).join(''));
const pages = { '/feed': feed, '/multi': multi, '/heavy': heavy };

const fixtures = route => {
  const u = new URL(route.request().url());
  if (u.pathname.endsWith('.webm')) {   // with Range support, so the test can seek
    const m = /bytes=(d+)-(d*)/.exec(route.request().headers().range || '');
    if (!m) return route.fulfill({ status: 200, contentType: 'video/webm', body: CLIP, headers: { 'accept-ranges': 'bytes' } });
    const a = +m[1], b = m[2] ? Math.min(+m[2], CLIP.length - 1) : CLIP.length - 1;
    return route.fulfill({ status: 206, contentType: 'video/webm', body: CLIP.subarray(a, b + 1), headers: { 'accept-ranges': 'bytes', 'content-range': 'bytes ' + a + '-' + b + '/' + CLIP.length } });
  }
  if (u.hostname === 'x.com') return route.fulfill({ status: 200, contentType: 'text/html', body: pages[u.pathname] || home });
  return route.fulfill({ status: 404, body: '' });
};

// ---------- harness ----------
const FF = process.env.BROWSER === 'firefox';
const launchOpts = FF ? { firefoxUserPrefs: process.env.FFDEFAULT ? {} : { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0 } } : { args: ['--autoplay-policy=no-user-gesture-required'] };
const browser = await (FF ? firefox : chromium).launch(launchOpts);
const logs = [], ok = {}, r = {};
const check = (name, cond, detail) => { ok[name] = !!cond; r[name] = detail; };
async function open(seed, urlPath = '/home', height = 900) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height } });
  await ctx.route(/x\.com|example\.test/, fixtures);
  if (!FF) await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://x.com' });
  await ctx.addInitScript(seed ? `localStorage.setItem('xbb-userscript-settings', ${JSON.stringify(JSON.stringify({ settings: seed }))});` : '');
  await ctx.addInitScript({ path: usFile });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error' || /XBB/.test(m.text())) logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
  await page.goto('https://x.com' + urlPath);
  return { ctx, page };
}
const vids = page => page.evaluate(() => ['v1', 'v2', 'v3', 'gif'].map(id => { const v = document.getElementById(id); return { id, playing: !v.paused && !v.ended, muted: v.muted, volume: +v.volume.toFixed(2), controls: v.controls, loop: v.loop }; }));
const playing = s => s.filter(v => v.playing && v.id !== 'gif').map(v => v.id).join();
const click = async (page, sel) => { const b = await page.locator(sel).boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2 - 20); };

// ---------- video ----------
{
  const { ctx, page } = await open();
  await page.waitForTimeout(1800);
  const s = await vids(page);
  const attr = await page.evaluate(() => document.documentElement.dataset.xbbVideo);
  check('settings attribute', /"mode":"volume"/.test(attr || '') && /"one":true/.test(attr), attr);
  check('native controls on tweet videos, not on the GIF', s[0].controls && s[1].controls && s[2].controls && !s[3].controls, s);
  check('one video plays at a time (two in view, X tried to play both)', playing(s).split(',').filter(Boolean).length === 1, s);
  const first = playing(s);
  const pickedOk = await page.evaluate(() => [...document.querySelectorAll('video[data-xbb-pick]')].map(v => v.id).join());
  check('exactly one video carries the pick mark', pickedOk === first, { pickedOk, first });
  const pv = s.find(v => v.id === first);
  check('plays with sound at 40%', pv && !pv.muted && pv.volume === 0.4, pv);
  check('GIF left alone (still looping, playing)', s[3].playing && s[3].loop, s[3]);

  // overlay of X (mute button) is click-through; a click on it reaches the video, not the tweet
  const over = await page.evaluate(() => { const v = document.getElementById('v1'), b = v.getBoundingClientRect();
    const at = (fx, fy) => document.elementFromPoint(b.left + b.width * fx, b.top + b.height * fy);
    return { center: at(.5, .5) === v, corner: at(.96, .85) === v, opacity: getComputedStyle(document.querySelector('#t1 .xov')).opacity }; });
  check('X overlay invisible and click-through (controls reachable)', over.center && over.corner && over.opacity === '0', over);
  const art0 = await page.evaluate(() => window.__articleClicks || 0);
  await click(page, '#v1');
  await page.waitForTimeout(500);
  const art1 = await page.evaluate(() => window.__articleClicks || 0);
  check('click on a video does not reach the tweet (no navigation)', art1 === art0, { art0, art1 });

  // you start v2: it wins, v1 stops
  await page.evaluate(() => document.getElementById('v1').pause());
  await click(page, '#v2');
  await page.waitForTimeout(700);
  let st = await vids(page);
  check('video you start plays alone', playing(st) === 'v2', st);
  // you start v1 while v2 plays: v1 takes over
  await click(page, '#v1');
  await page.waitForTimeout(700);
  st = await vids(page);
  check('starting another video takes over', playing(st) === 'v1', st);
  // you pause it: stays paused, nothing else takes its place, even after more scroll events
  await click(page, '#v1');
  await page.waitForTimeout(500);
  await page.mouse.wheel(0, 3); await page.waitForTimeout(500); await page.mouse.wheel(0, -3);
  await page.waitForTimeout(1200);
  st = await vids(page);
  check('your pause sticks and nothing else starts', playing(st) === '', st);
  // scroll to the third tweet: first two pause (offscreen), v3 starts
  await page.evaluate(() => window.scrollTo(0, 1000));
  await page.waitForTimeout(1500);
  st = await vids(page);
  check('scrolled away: offscreen videos pause, the one in view starts', playing(st) === 'v3', st);
  // back: the pause no longer counts, one video starts again
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1500);
  st = await vids(page);
  check('scrolled back: exactly one video plays again', playing(st).split(',').filter(Boolean).length === 1 && !playing(st).includes('v3'), st);

  // sound: the user changes the volume with the controls on one video; the next one follows
  await page.evaluate(() => { const v = document.getElementById('v2'), f = document.createElement('iframe'); document.body.append(f);
    Object.getOwnPropertyDescriptor(f.contentWindow.HTMLMediaElement.prototype, 'volume').set.call(v, 0.8); f.remove(); });
  await page.mouse.move(700, 400); await page.mouse.down(); await page.mouse.up();   // gesture on the page
  // page's own mute write is ignored
  const mw = await page.evaluate(() => { const v = document.getElementById('v1'); v.muted = true; v.volume = 0.1; return { muted: v.muted, volume: +v.volume.toFixed(2) }; });
  check('page mute/volume writes ignored while native controls are on', mw.muted === false && mw.volume === 0.4 || mw.muted === false, mw);
  await ctx.close();
}

// ---------- tweet buttons ----------
{
  const { ctx, page } = await open();
  await page.waitForSelector('#t1 .xbb-acts', { timeout: 3000 }).catch(() => {});
  const layout = await page.evaluate(() => { const g = document.querySelector('#t1 [role=group]'), box = g.querySelector('.xbb-acts');
    return { box: !!box, beforeShare: box && box.nextElementSibling === g.lastElementChild, btns: box && [...box.children].map(b => b.className.replace('xbb-act ', '')), color: box && box.style.color }; });
  check('copy-link and Like+Retweet buttons in the action bar, before Share', layout.box && layout.beforeShare && layout.btns.join() === 'xbb-copy,xbb-lr' && layout.color === 'rgb(113, 118, 123)', layout);

  await page.click('#t1 .xbb-copy');
  await page.waitForTimeout(200);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  const done = await page.evaluate(() => document.querySelector('#t1 .xbb-copy').classList.contains('done'));
  check('copy link: vxtwitter.com URL of the tweet itself', clip === 'https://vxtwitter.com/alice/status/111' && done, { clip, done });
  await page.waitForTimeout(1600);
  check('copy button goes back to the link icon', await page.evaluate(() => !document.querySelector('#t1 .xbb-copy').classList.contains('done')), null);
  await page.click('#t2 .xbb-copy');
  await page.waitForTimeout(200);
  check('quoted tweet link is not used for the outer tweet', (await page.evaluate(() => navigator.clipboard.readText())) === 'https://vxtwitter.com/bob/status/222', null);

  // one-click retweet
  await page.click('#t1 [data-testid=retweet]');
  await page.waitForTimeout(300);
  let rt = await page.evaluate(() => ({ un: !!document.querySelector('#t1 [data-testid=unretweet]'), menu: document.querySelectorAll('#layers [role=menu]').length, cls: document.documentElement.classList.contains('xbb-rt') }));
  check('one-click retweet confirms the menu by itself', rt.un && rt.menu === 0, rt);
  await page.waitForTimeout(400);
  check('menu-hiding class removed again', !(await page.evaluate(() => document.documentElement.classList.contains('xbb-rt'))), null);
  await page.click('#t1 [data-testid=unretweet]');
  await page.waitForTimeout(300);
  rt = await page.evaluate(() => ({ re: !!document.querySelector('#t1 [data-testid=retweet]'), menu: document.querySelectorAll('#layers [role=menu]').length }));
  check('one-click undo repost', rt.re && rt.menu === 0, rt);
  await page.click('#t1 [data-testid=retweet]', { modifiers: ['Shift'] });
  await page.waitForTimeout(300);
  rt = await page.evaluate(() => ({ un: !!document.querySelector('#t1 [data-testid=unretweet]'), menu: document.querySelectorAll('#layers [role=menu]').length }));
  check('Shift+click shows the normal menu (for Quote)', !rt.un && rt.menu === 1, rt);
  await page.evaluate(() => document.querySelector('#layers [role=menu]').remove());

  // like + retweet
  await page.click('#t2 .xbb-lr');
  await page.waitForTimeout(500);
  let lr = await page.evaluate(() => ({ liked: !!document.querySelector('#t2 [data-testid=unlike]'), rt: !!document.querySelector('#t2 [data-testid=unretweet]'), on: document.querySelector('#t2 .xbb-lr').classList.contains('on') }));
  check('Like + Retweet does both', lr.liked && lr.rt && lr.on, lr);
  await page.click('#t2 .xbb-lr');
  await page.waitForTimeout(500);
  lr = await page.evaluate(() => ({ liked: !!document.querySelector('#t2 [data-testid=unlike]'), rt: !!document.querySelector('#t2 [data-testid=unretweet]') }));
  check('Like + Retweet again undoes both', !lr.liked && !lr.rt, lr);

  // settings: gear + Alt+W, live change of the embed domain
  const gear = await page.evaluate(() => { const g = document.querySelector('nav .xbb-gear'); return g && { text: g.textContent.trim(), prev: g.previousElementSibling.getAttribute('href'), href: g.getAttribute('href') }; });
  check('sidebar gear cloned from a nav link, after the last one', gear && gear.text === 'Better Browsing' && gear.prev === '/alice' && gear.href === '#', gear);
  await page.click('nav .xbb-gear');
  await page.waitForTimeout(300);
  const panel = await page.evaluate(() => { const x = document.querySelector('.xbb-settings')?.shadowRoot; return { inputs: x?.querySelectorAll('[data-key]').length, vol: x?.querySelector('[data-key="videoVolume"]')?.value, host: x?.querySelector('[data-key="embedHost"]')?.value }; });
  check('gear opens the settings panel', panel.inputs === 13 && panel.vol === '40' && panel.host === 'vxtwitter.com', panel);
  await page.locator('.xbb-settings [data-key="videoLoop"]').click();
  await page.waitForTimeout(300);
  check('clicks inside the panel keep it open and save', await page.evaluate(() => !!document.querySelector('.xbb-settings') && JSON.parse(localStorage.getItem('xbb-userscript-settings')).settings.videoLoop === true), null);
  await page.evaluate(() => { const i = document.querySelector('.xbb-settings').shadowRoot.querySelector('[data-key="embedHost"]'); i.value = 'fxtwitter.com'; i.dispatchEvent(new Event('change')); });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('Esc closes the panel', !(await page.$('.xbb-settings')), null);
  await page.click('#t1 .xbb-copy');
  await page.waitForTimeout(200);
  check('embed domain change applies live', (await page.evaluate(() => navigator.clipboard.readText())) === 'https://fxtwitter.com/alice/status/111', null);
  const loop = await page.evaluate(() => document.getElementById('v1').loop);
  check('Loop setting applies live', loop === true, loop);
  await page.keyboard.press('Alt+W'); await page.waitForTimeout(200);
  const alt = !!(await page.$('.xbb-settings'));
  await page.keyboard.press('Alt+W'); await page.waitForTimeout(200);
  check('Alt+W toggles the panel', alt && !(await page.$('.xbb-settings')), alt);
  await ctx.close();
}

// ---------- no autoplay ----------
{
  const { ctx, page } = await open({ videoMode: 'off' });
  await page.waitForTimeout(1800);
  let st = await vids(page);
  check('no-autoplay mode: nothing starts by itself', playing(st) === '' && st[3].playing, st);
  await click(page, '#v2');
  await page.waitForTimeout(700);
  st = await vids(page);
  check('no-autoplay mode: your click plays it, with sound', playing(st) === 'v2' && !st[1].muted && st[1].volume === 0.4, st);
  await ctx.close();
}
// ---------- hands off ----------
{
  const { ctx, page } = await open({ videoMode: 'default', nativeControls: false, quickRetweet: false, likeRetweet: false, embedLink: false });
  await page.waitForTimeout(1500);
  const st = await vids(page);
  const btns = await page.evaluate(() => document.querySelectorAll('.xbb-acts').length);
  check('mode "X decides" + features off: no controls, no buttons, X plays its own videos', !st[0].controls && playing(st).split(',').length === 3 && btns === 0, { st, btns });
  await ctx.close();
}

// ---------- which video plays: the one nearest the middle of the screen ----------
const geo = (page, ids) => page.evaluate(ids => { const mid = innerHeight / 2; return ids.map(id => { const v = document.getElementById(id), r = v.getBoundingClientRect();
  const vis = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) / Math.min(r.height, innerHeight);
  return { id, vis, dist: Math.abs(r.top + r.height / 2 - mid), playing: !v.paused && !v.ended, controls: v.controls }; }); }, ids);
{
  const ids = ['f1', 'f2', 'f3', 'f4', 'f5'], H = 700;
  const { ctx, page } = await open(null, '/feed', H);
  await page.waitForTimeout(1500);
  const bad = [], seen = new Set();
  // down the feed and back up: after each stop, what plays is (about as) central as the most central video in view
  for (const y of [0, 150, 320, 480, 650, 820, 1000, 1180, 1350, 1180, 1000, 820, 650, 480, 320, 150, 0]) {
    await page.evaluate(y => window.scrollTo(0, y), y);
    await page.waitForTimeout(900);
    const g = await geo(page, ids);
    const cand = g.filter(v => v.vis >= 0.5), run = g.filter(v => v.playing);
    if (run.length > 1) bad.push({ y, why: 'more than one plays', run: run.map(v => v.id) });
    if (cand.length) {
      const best = Math.min(...cand.map(v => v.dist));
      if (!run.length || run[0].dist > best + H * 0.08 + 1) bad.push({ y, why: 'not the most central', run: run.map(v => v.id), cand: cand.map(v => [v.id, Math.round(v.dist)]) });
      else seen.add(run[0].id);
    } else if (run.length && run[0].vis < 0.05) bad.push({ y, why: 'offscreen video plays' });
  }
  check('feed: the video nearest the middle plays at every scroll stop (down and up)', bad.length === 0, bad);
  check('feed: playback moved through several videos', seen.size >= 4, [...seen]);
  await ctx.close();
}

// ---------- X starts videos by itself while you scroll: no start-then-stop flicker ----------
{
  const { ctx, page } = await open(null, '/feed', 700);
  await page.waitForTimeout(1500);
  await page.evaluate(() => {   // X-like autoplay: plays a video once 60% of it is in view, pauses it below that
    const io = new IntersectionObserver(es => es.forEach(e => { const v = e.target; if (e.intersectionRatio >= 0.6) { v.muted = true; v.play().catch(() => {}); } else if (!v.paused) v.pause(); }), { threshold: [0, 0.3, 0.6, 1] });
    document.querySelectorAll('video').forEach(v => io.observe(v));
    window.__flick = []; const t = {};
    for (const v of document.querySelectorAll('video')) {
      v.addEventListener('play', () => { t[v.id] = performance.now(); });
      v.addEventListener('pause', () => { const r = v.getBoundingClientRect(), vis = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) / r.height;
        if (t[v.id] && performance.now() - t[v.id] < 600 && vis >= 0.6) window.__flick.push(v.id + ' stopped ' + Math.round(performance.now() - t[v.id]) + 'ms after starting at ' + Math.round(vis * 100) + '% in view'); });
    }
  });
  for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, 30); await page.waitForTimeout(50); }
  await page.waitForTimeout(1200);
  const flick = await page.evaluate(() => window.__flick);
  const run = await page.evaluate(() => [...document.querySelectorAll('video')].filter(v => !v.paused).map(v => v.id));
  check('feed, X autoplaying by itself: no video starts and stops again while it is well in view', flick.length === 0, flick);
  check('feed, X autoplaying by itself: one video plays when scrolling stops', run.length === 1, run);
  await ctx.close();
}

// ---------- tab hidden / window unfocused ----------
{
  // pretend: a hidden tab (document.hidden + visibilitychange) or a window without focus (hasFocus + blur/focus)
  const away = (page, kind, on) => page.evaluate(([kind, on]) => {
    if (kind === 'hidden') { Object.defineProperty(document, 'hidden', { configurable: true, get: () => on }); document.dispatchEvent(new Event('visibilitychange')); }
    else { document.hasFocus = () => !on; window.dispatchEvent(new Event(on ? 'blur' : 'focus')); }
  }, [kind, on]);
  const run = page => page.evaluate(() => [...document.querySelectorAll('video')].filter(v => !v.paused).map(v => v.id));
  for (const kind of ['hidden', 'blur']) {
    const { ctx, page } = await open(null, '/feed', 700);
    await page.waitForTimeout(1500);
    check(`${kind === 'hidden' ? 'tab hidden' : 'window unfocused'}: a video plays to begin with`, (await run(page)).length === 1, await run(page));
    await away(page, kind, true);
    await page.waitForTimeout(700);
    check(`${kind === 'hidden' ? 'tab hidden' : 'window unfocused'}: the playing video pauses`, (await run(page)).length === 0, await run(page));
    for (let i = 0; i < 20; i++) { await page.mouse.wheel(0, 40); await page.waitForTimeout(40); }
    await page.waitForTimeout(800);
    check(`${kind === 'hidden' ? 'tab hidden' : 'window unfocused'}: scrolling meanwhile starts nothing`, (await run(page)).length === 0, await run(page));
    await away(page, kind, false);
    await page.waitForTimeout(1500);
    check(`${kind === 'hidden' ? 'tab hidden' : 'window unfocused'}: back again, one video plays`, (await run(page)).length === 1, await run(page));
    await ctx.close();
  }
  {
    const { ctx, page } = await open({ videoPauseOnHide: false }, '/feed', 700);
    await page.waitForTimeout(1500);
    await away(page, 'hidden', true); await away(page, 'blur', true);
    await page.waitForTimeout(700);
    check('pause-on-hide off: the video keeps playing', (await run(page)).length === 1, await run(page));
    await ctx.close();
  }
}

// ---------- X keeps replaying the videos we stop: no tug of war ----------
{
  const { ctx, page } = await open(null, '/feed', 700);
  await page.waitForTimeout(1500);
  await page.evaluate(() => {   // X-like player: plays every video on a key press, and again whenever one is paused
    window.__plays = 0;
    for (const v of document.querySelectorAll('video')) { v.addEventListener('play', () => window.__plays++); v.addEventListener('pause', () => { if (!v.ended) setTimeout(() => { v.muted = true; v.play().catch(() => {}); }, 0); }); }
    addEventListener('keydown', () => { for (const v of document.querySelectorAll('video')) { v.muted = true; v.play().catch(() => {}); } });
  });
  await page.keyboard.press('j');
  await page.waitForTimeout(500);
  await page.evaluate(() => { window.__plays = 0; });
  await page.waitForTimeout(3000);
  const n = await page.evaluate(() => window.__plays);
  const run = await page.evaluate(() => [...document.querySelectorAll('video')].filter(v => !v.paused).map(v => v.id));
  check('X replaying every stopped video: no play/pause tug of war (few play events, one video)', n < 20 && run.length === 1, { plays: n, run });
  await ctx.close();
}

// ---------- a tweet with several videos: they play one after another ----------
{
  const ids = ['m1', 'm2', 'm3', 'm4'];
  const { ctx, page } = await open(null, '/multi', 900);
  await page.waitForTimeout(1800);
  const run = async () => (await geo(page, ids)).filter(v => v.playing).map(v => v.id);
  const order = [];
  for (let i = 0; i < 4; i++) {
    const now = await run();
    if (now.length !== 1) { order.push('(' + now.join('+') + ')'); break; }
    order.push(now[0]);
    await page.evaluate(id => { const v = document.getElementById(id); v.currentTime = v.duration - 0.3; }, now[0]);
    await page.waitForTimeout(1800);
  }
  check('multi: each video that ends hands over to the next, one at a time, none twice', order.length === 4 && new Set(order).size === 4 && order.every(o => /^m[1-4]$/.test(o)), order);
  await ctx.close();
}

// ---------- a tweet with several videos: you stay in charge ----------
{
  const ids = ['m1', 'm2', 'm3', 'm4'];
  const { ctx, page } = await open(null, '/multi', 900);
  await page.waitForTimeout(1800);
  const run = async () => (await geo(page, ids)).filter(v => v.playing).map(v => v.id);
  let g = await geo(page, ids);
  check('multi: every video has the browser controls', g.every(v => v.controls), g);
  let r1 = await run();
  check('multi: exactly one of the four videos plays', r1.length === 1, r1);
  const nearest = Math.min(...g.filter(v => v.vis >= 0.5).map(v => v.dist));
  check('multi: it is in the row nearest the middle', g.find(v => v.id === r1[0]).dist <= nearest + 1, g);

  const other = ids.find(id => id !== r1[0] && id !== 'm4');
  await click(page, '#' + other);
  await page.waitForTimeout(800);
  check('multi: clicking another video takes over, the first stops', (await run()).join() === other, await run());

  await click(page, '#' + other);   // pause it
  await page.waitForTimeout(500);
  await page.mouse.wheel(0, 3); await page.waitForTimeout(400); await page.mouse.wheel(0, -3);
  await page.waitForTimeout(1300);
  check('multi: your pause sticks, none of the others starts', (await run()).length === 0, await run());

  await click(page, '#m4');
  await page.waitForTimeout(700);
  check('multi: starting a third video plays it alone', (await run()).join() === 'm4', await run());
  await page.evaluate(() => { const v = document.getElementById('m4'); v.currentTime = v.duration - 0.3; });
  await page.waitForTimeout(2000);
  const after = await run();
  check('multi: after a video you started ends, the one you paused stays paused and nothing else starts', after.length === 0, after);

  await page.evaluate(() => window.scrollTo(0, 1500));
  await page.waitForTimeout(1500);
  check('multi: scrolled past the tweet, all of them pause', (await run()).length === 0, await run());
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1500);
  check('multi: scrolled back, exactly one plays again', (await run()).length === 1, await run());
  await ctx.close();
}
{
  // one-at-a-time off: every video that is well in view plays
  const ids = ['m1', 'm2', 'm3', 'm4'];
  const { ctx, page } = await open({ videoOneAtATime: false }, '/multi', 900);
  await page.waitForTimeout(1800);
  const g = await geo(page, ids);
  check('multi, one-at-a-time off: all four play', g.every(v => v.playing), g);
  await ctx.close();
}

// ---------- content realm + nonce CSP (Violentmonkey, @inject-into auto, Firefox on X) ----------
// There the manager runs the script outside the page's JS world and the inline <script> for the page hooks
// would be blocked, so they must go in with a nonce borrowed from one of the page's own scripts.
// window.wrappedJSObject (only present in that realm) is faked to take that path.
{
  const cspPage = withNonce => `<!doctype html><html><head><title>csp</title>${withNonce ? '<script nonce="n0nce">window.__pageOk = 1</script>' : ''}</head>
<body style="margin:0"><main>${tweet('c1', 'u1', '900', player('c1v'))}</main></body></html>`;
  const csp = "default-src 'self'; script-src 'nonce-n0nce' 'unsafe-inline'; style-src 'unsafe-inline'";
  for (const withNonce of [true, false]) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    await ctx.route(/x\.com|example\.test/, route => {
      const u = new URL(route.request().url());
      if (u.pathname === '/csp') return route.fulfill({ status: 200, contentType: 'text/html', headers: { 'content-security-policy': csp }, body: cspPage(withNonce) });
      return fixtures(route);
    });
    await ctx.addInitScript('window.wrappedJSObject = window;');
    await ctx.addInitScript({ path: usFile });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto('https://x.com/csp');
    await page.waitForTimeout(1500);
    const s = await page.evaluate(() => ({ main: !!window.__xbbMainWorld, cfg: !!document.documentElement.dataset.xbbVideo, flag: document.documentElement.hasAttribute('data-bb-main') }));
    const tag = withNonce ? 'nonce CSP, content realm' : 'CSP without any nonce script, content realm';
    check(tag + ': content part runs', s.cfg, s);
    check(tag + ': page hooks ' + (withNonce ? 'are injected with the page\'s nonce' : 'are skipped without an error'), s.main === withNonce && !s.flag && errs.length === 0, { s, errs });
    await ctx.close();
  }
}

// ---------- CPU: nothing runs away ----------
{
  const name = FF ? 'firefox' : 'chromium';
  const { ctx, page } = await open(null, '/heavy', 900);
  await page.waitForTimeout(2500);
  const idle = await idleMutations(page);
  check('CPU: on an idle page the script changes nothing on its own (no feedback loop)', idle <= 10, idle);
  await ctx.close();
  const c = await churnCost({ browserType: FF ? firefox : chromium, name, launchOpts, route: { re: /x.com|example.test/, fn: fixtures }, url: 'https://x.com/heavy', usFile });
  check('CPU: on a page that keeps changing, the script adds little work (' + name + ')', costOk(name, c), c);
}

let fails = 0;
for (const [k, v] of Object.entries(ok)) {
  if (!v) fails++;
  console.log(`${v ? 'PASS' : 'FAIL'}  ${k}${v ? '' : '  ' + JSON.stringify(r[k])}`);
}
if (logs.length) console.log('\nconsole:\n' + logs.join('\n'));
await browser.close();
process.exit(fails ? 1 : 0);
