/* Core helpers: settings, DOM, fetch, sanitizing */
(() => {
  const listeners = new Set();
  // Last known settings, kept in the page's localStorage so the theme applies on the first paint
  // instead of after the async storage read (no flash of Reddit's default look).
  const SNAP = 'rbe-settings-snapshot';
  let snap = null;
  try { snap = JSON.parse(localStorage.getItem(SNAP) || 'null'); } catch {}
  RBE.settings = RBE.mergeSettings(snap || {});
  if (snap) RBE.settings.customCss = snap.customCss || '';
  RBE.onSettings = fn => { listeners.add(fn); fn(RBE.settings); };

  const publish = s => {
    RBE.settings = s;
    try { localStorage.setItem(SNAP, JSON.stringify(s)); } catch {}
    listeners.forEach(fn => { try { fn(s); } catch (e) { console.error('[RBE]', e); } });
  };
  RBE.ready = RBE.loadSettings().then(s => {
    // skip the second round of work when nothing changed since the snapshot
    if (snap && JSON.stringify(s) === JSON.stringify(RBE.settings)) return;
    publish(s);
  });

  // Only settings changes matter here (account cookie saves also write to storage.local)
  RBE.api.storage.onChanged.addListener(async (changes, area) => {
    if (!(area === 'sync' && changes.settings) && !(area === 'local' && changes.customCss)) return;
    publish(await RBE.loadSettings());
  });

  // ---------- one shared DOM observer ----------
  // Several modules react to Reddit adding nodes. One observer instead of one per module;
  // each subscriber runs at most once per `delay` ms (throttle, so a busy feed can't starve it).
  const domSubs = [];
  RBE.onDomChange = (fn, delay = 250) => domSubs.push({ fn, delay, t: 0 });
  new MutationObserver(() => {
    for (const s of domSubs) {
      if (s.t) continue;
      s.t = setTimeout(() => { s.t = 0; try { s.fn(); } catch (e) { console.error('[RBE]', e); } }, s.delay);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  // ---------- DOM ----------
  RBE.h = function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat(Infinity)) {
      if (k == null || k === false) continue;
      el.append(k instanceof Node ? k : document.createTextNode(String(k)));
    }
    return el;
  };

  // ---------- fetch (Firefox: use page-context fetch so cookies/CORS behave like Reddit's own) ----------
  const pageFetch = (typeof content !== 'undefined' && content && content.fetch) ? content.fetch.bind(content) : fetch.bind(globalThis);
  // opts.retries: extra attempts after a 429 (rate limited) or 5xx, waiting Retry-After (max 5 s) or 1.5 s, 3 s...
  RBE.getJSON = async function (pathOrUrl, opts) {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : location.origin + pathOrUrl;
    for (let left = opts?.retries || 0; ; left--) {
      const r = await pageFetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
      if (r.ok) return r.json();
      if (left > 0 && (r.status === 429 || r.status >= 500)) {
        const ra = Number(r.headers.get('retry-after'));
        const wait = ra > 0 ? Math.min(ra, 5) : 1.5 * (((opts.retries || 0) - left) + 1);
        await new Promise(res => setTimeout(res, wait * 1000));
        continue;
      }
      const err = new Error('HTTP ' + r.status + ' for ' + url);
      err.status = r.status;
      throw err;
    }
  };

  // ---------- formatting ----------
  RBE.num = n => {
    n = Number(n) || 0;
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'm';
    if (Math.abs(n) >= 1e4) return Math.round(n / 1e3) + 'k';
    if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(n);
  };
  RBE.ago = utc => {
    const s = Math.max(0, Date.now() / 1000 - utc);
    const units = [[31536000, 'y'], [2592000, 'mo'], [604800, 'w'], [86400, 'd'], [3600, 'h'], [60, 'm']];
    for (const [sec, u] of units) if (s >= sec) return Math.floor(s / sec) + u;
    return 'now';
  };
  RBE.decode = str => { const t = document.createElement('textarea'); t.innerHTML = str || ''; return t.value; };

  // ---------- sanitize Reddit-provided HTML ----------
  const ALLOWED = new Set(['A', 'P', 'BR', 'HR', 'EM', 'STRONG', 'B', 'I', 'U', 'S', 'DEL', 'SUP', 'SUB', 'CODE', 'PRE',
    'BLOCKQUOTE', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD',
    'SPAN', 'DIV', 'IMG', 'FIGURE', 'FIGCAPTION']);
  const IMG_HOST = /^https:\/\/(i\.redd\.it|preview\.redd\.it|external-preview\.redd\.it|i\.imgur\.com|media\.giphy\.com|i\.giphy\.com)\//i;
  // One inert document reused for every call (no scripts run, no images load) instead of a
  // new DOMParser document per comment.
  const doc = document.implementation.createHTMLDocument('');
  RBE.sanitize = function (html) {
    const root = doc.createElement('div');
    root.innerHTML = html || '';
    const walk = node => {
      for (const c of [...node.children]) {
        if (!ALLOWED.has(c.tagName)) { c.replaceWith(...c.childNodes); continue; }
        for (const a of [...c.attributes]) {
          const n = a.name.toLowerCase();
          const keep = (n === 'href' && c.tagName === 'A') || (n === 'src' && c.tagName === 'IMG') ||
            n === 'class' || n === 'title' || n === 'alt' || n === 'colspan' || n === 'rowspan' || n === 'align';
          if (!keep || /^\s*(javascript|data|vbscript):/i.test(a.value)) c.removeAttribute(a.name);
        }
        if (c.tagName === 'IMG' && !IMG_HOST.test(c.getAttribute('src') || '')) { c.remove(); continue; }
        if (c.tagName === 'A') {
          const href = c.getAttribute('href') || '';
          if (href.startsWith('/')) c.setAttribute('href', 'https://www.reddit.com' + href);
          c.setAttribute('target', '_blank'); c.setAttribute('rel', 'noopener noreferrer');
          // inline media links (comment images/gifs)
          if (IMG_HOST.test(href) && /\.(jpe?g|png|webp|gif)(\?|$)|preview\.redd\.it|giphy/i.test(href) && !c.querySelector('img')) {
            const img = doc.createElement('img');
            img.setAttribute('src', href.replace(/&amp;/g, '&'));
            img.className = 'rbe-inline-img';
            img.setAttribute('loading', 'lazy');
            c.replaceChildren(img);
          }
        }
        walk(c);
      }
    };
    walk(root);
    return root.innerHTML;
  };

  RBE.isCommentsUrl = href => {
    try {
      const u = new URL(href, location.href);
      if (!/(^|\.)reddit\.com$/.test(u.hostname)) return false;
      return /^\/(r|u|user)\/[^/]+\/comments\/[a-z0-9]+/i.test(u.pathname) || /^\/comments\/[a-z0-9]+/i.test(u.pathname);
    } catch { return false; }
  };
  RBE.pathOf = href => { try { return new URL(href, location.href).pathname.replace(/\/+$/, '') + '/'; } catch { return ''; } };

  // ---------- avatars (users + subreddits) ----------
  // A round avatar: colored circle with the first letter, swapped for the real picture once it loads.
  const hue = s => { let n = 0; for (const ch of s || '') n = (n * 31 + ch.charCodeAt(0)) >>> 0; return n % 360; };
  RBE.avatar = function (name, { size = 24, sub = false } = {}) {
    const clean = String(name || '?').replace(/^(r|u)\//i, '');
    return RBE.h('span', { class: 'rbe-av' + (sub ? ' sub' : ''), 'aria-hidden': 'true',
      style: { width: size + 'px', height: size + 'px', fontSize: Math.round(size * .48) + 'px', background: `hsl(${hue(clean)} 45% 42%)` } },
      clean.charAt(0).toUpperCase());
  };
  const setPic = (el, url) => {
    if (!url) return;
    const img = new Image();
    img.onload = () => { el.style.backgroundImage = `url("${url.replace(/"/g, '%22')}")`; el.classList.add('has-img'); };
    img.src = url;
  };
  // only Reddit-hosted pictures
  const cleanUrl = u => { u = (u || '').replace(/&amp;/g, '&'); return /^https:\/\/[^/]*(redd\.it|redditstatic\.com|redditmedia\.com)\//.test(u) ? u : ''; };

  // User pictures: one batched request per burst of comments
  const userPic = new Map(), userWait = new Map(), userQueue = new Set();
  let userTimer = null, userApiBroken = false;
  function flushUsers() {
    userTimer = null;
    const ids = [...userQueue].slice(0, 100);
    ids.forEach(id => userQueue.delete(id));
    if (userQueue.size) userTimer = setTimeout(flushUsers, 0);
    if (!ids.length) return;
    const done = () => ids.forEach(id => { (userWait.get(id) || []).forEach(el => setPic(el, userPic.get(id))); userWait.delete(id); });
    if (userApiBroken) return done();
    RBE.getJSON('/api/user_data_by_account_ids.json?ids=' + ids.join(','))
      .then(j => ids.forEach(id => userPic.set(id, cleanUrl(j?.[id]?.profile_img))))
      .catch(e => { userApiBroken = true; console.warn('[RBE] user avatars unavailable', e); })
      .finally(done);
  }
  RBE.userAvatar = function (name, fullname, opts) {
    const el = RBE.avatar(name, opts);
    if (!fullname || RBE.settings.showAvatars === false || name === '[deleted]') return el;
    if (userPic.has(fullname)) { setPic(el, userPic.get(fullname)); return el; }
    if (!userWait.has(fullname)) userWait.set(fullname, []);
    userWait.get(fullname).push(el);
    userQueue.add(fullname);
    if (!userTimer) userTimer = setTimeout(flushUsers, 60);
    return el;
  };

  // Subreddit icons: from post data when it has them (sr_detail), else /r/<name>/about.json (cached)
  const subPic = new Map();
  RBE.subAvatar = function (subName, opts, detail) {
    const name = String(subName || '').replace(/^r\//i, '');
    const el = RBE.avatar(name, { ...opts, sub: true });
    if (!name || RBE.settings.showAvatars === false) return el;
    const key = name.toLowerCase();
    const fromDetail = detail && cleanUrl(detail.community_icon || detail.icon_img);
    if (fromDetail) subPic.set(key, Promise.resolve(fromDetail));
    if (!subPic.has(key)) {
      subPic.set(key, RBE.getJSON(`/r/${encodeURIComponent(name)}/about.json?raw_json=1`)
        .then(j => cleanUrl(j?.data?.community_icon || j?.data?.icon_img))
        .catch(() => ''));
    }
    subPic.get(key).then(u => setPic(el, u));
    return el;
  };

  // Discord shows poor previews for reddit.com links (no video); an embed-fixer domain serves the same
  // path with the tags Discord reads. The domain is a setting because these services come and go.
  RBE.embedUrl = function (permalink) {
    const host = String(RBE.settings?.embedHost || 'redditez.com').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '') || 'redditez.com';
    const path = new URL(permalink, 'https://www.reddit.com').pathname;
    return `https://${host}${path}`;
  };
  RBE.copyText = async function (text) {
    try { await navigator.clipboard.writeText(text); return; } catch {}
    const ta = RBE.h('textarea', { style: 'position:fixed;opacity:0' }, text);
    document.body.append(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (!ok) throw new Error('clipboard blocked');
  };
  RBE.copyEmbed = async function (permalink) {
    if (!permalink) return;
    const url = RBE.embedUrl(permalink);
    try { await RBE.copyText(url); RBE.toast('Copied ' + url); }
    catch { RBE.toast('Could not copy: ' + url); }
  };
  // The outside site a post points at (YouTube, Streamable, ...): { url, site } or null.
  // Takes API post data or, for feed posts that are not loaded yet, a <shreddit-post> element.
  RBE.outLink = function (d) {
    let url, site;
    if (d && d.getAttribute) { url = d.getAttribute('content-href') || ''; site = d.getAttribute('domain') || ''; }
    else if (d) {
      if (d.is_self || d.is_gallery) return null;
      url = d.url_overridden_by_dest || d.url || ''; site = d.media?.oembed?.provider_name || d.domain || '';
    }
    if (!/^https?:\/\//i.test(url || '')) return null;
    let host; try { host = new URL(url).hostname.replace(/^(www|m)\./, ''); } catch { return null; }
    if (/(^|\.)(reddit\.com|redd\.it|redditmedia\.com|redditstatic\.com)$/.test(host)) return null;
    return { url, site: site && !/^self\./.test(site) ? site : host };
  };
  // "↗ YouTube" button, a sibling of the Discord one
  RBE.siteButton = (link, cls = 'rbe-btn') => link ? RBE.h('a', {
    class: cls + ' rbe-site-btn', href: link.url, target: '_blank', rel: 'noopener noreferrer',
    title: 'Open ' + link.site + ': ' + link.url, 'aria-label': 'Open ' + link.site
  }, '↗ ' + link.site) : null;
  RBE.embedButton = (getPermalink, cls = 'rbe-btn') => RBE.settings?.embedLink === false ? null : RBE.h('button', {
    class: cls + ' rbe-embed-btn', type: 'button', title: 'Copy link for Discord (shows the post or video in the chat)', 'aria-label': 'Copy link for Discord',
    onclick: e => { e.preventDefault(); e.stopPropagation(); RBE.copyEmbed(getPermalink()); }
  }, '🔗');

  RBE.toast = function (msg) {
    let t = document.getElementById('rbe-toast');
    if (!t) { t = RBE.h('div', { id: 'rbe-toast', class: 'rbe-root' }); document.documentElement.append(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 1600);
  };
})();
