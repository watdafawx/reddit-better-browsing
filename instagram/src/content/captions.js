/* Captions: Reels captions open in full instead of one line with "… more", and web addresses in
   captions and comments become links (Instagram leaves them as plain text). */
(() => {
  const h = IGB.h;

  // ---------- links ----------
  // Bare domains ("linktr.ee/x", "bit.ly/y") only in lower case and with TLDs that rarely show up
  // as a missing space between words ("done.In the" stays text).
  const TLD = 'com|net|org|io|co|me|ly|gg|tv|app|dev|link|shop|store|bio|ee|xyz|info|uk|ca|de|fr|eu|au|page|site|online|fm|ai';
  const URL_RE = new RegExp(String.raw`(?:[Hh][Tt][Tt][Pp][Ss]?:\/\/|[Ww]{3}\.)[^\s<>"']+|\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:${TLD})\b(?:\/[^\s<>"']*)?`, 'g');
  // Trailing punctuation belongs to the sentence, not the address
  const trimEnd = u => u.replace(/[.,;:!?'")\]}>…]+$/, '');
  // [start, end, href] for every address in a string. Skips e-mail addresses and @mentions.
  function findUrls(text) {
    const out = [];
    URL_RE.lastIndex = 0;
    let m;
    while ((m = URL_RE.exec(text))) {
      const raw = trimEnd(m[0]);
      const prev = text[m.index - 1];
      if (!raw || prev === '@' || /[\w.@-]/.test(prev || '')) continue;
      out.push([m.index, m.index + raw.length, /^https?:/i.test(raw) ? raw : 'https://' + raw]);
    }
    return out;
  }
  const extLink = (href, text) => h('a', { class: 'igb-link', href, target: '_blank', rel: 'noopener noreferrer nofollow' }, text);

  // Plain caption text → nodes, with addresses, @mentions and #hashtags as links (lightbox panel)
  IGB.linkify = function (text) {
    const nodes = [];
    const re = /(@[\w.]{1,30})|#([\p{L}\p{N}_]+)/gu;
    const parts = [];
    for (const [a, b, href] of findUrls(text)) parts.push([a, b, extLink(href, text.slice(a, b))]);
    let m;
    while ((m = re.exec(text))) {
      const a = m.index, b = a + m[0].length;
      if (parts.some(([x, y]) => a < y && b > x)) continue;                  // inside an address
      if (m[1] && /[\w]/.test(text[a - 1] || '')) continue;                 // e-mail
      const href = m[1] ? `/${m[1].slice(1).replace(/\.$/, '')}/` : `/explore/tags/${encodeURIComponent(m[2])}/`;
      parts.push([a, b, h('a', { class: 'igb-link', href }, m[0])]);
    }
    parts.sort((x, y) => x[0] - y[0]);
    let at = 0;
    for (const [a, b, node] of parts) { if (a > at) nodes.push(text.slice(at, a)); nodes.push(node); at = b; }
    if (at < text.length) nodes.push(text.slice(at));
    return nodes;
  };

  // Page text: split a text node around its addresses. The original node keeps the text before the
  // first one (React still owns it); everything after is ours.
  const SKIP = 'a, button, input, textarea, script, style, [contenteditable="true"], .igb-root';
  const done = new WeakSet();
  function linkTextNode(t) {
    const text = t.nodeValue;
    const hits = findUrls(text);
    done.add(t);
    if (!hits.length) return;
    const after = [];
    let at = hits[0][0];
    for (const [a, b, href] of hits) {
      if (a > at) after.push(document.createTextNode(text.slice(at, a)));
      after.push(extLink(href, text.slice(a, b)));
      at = b;
    }
    if (at < text.length) after.push(document.createTextNode(text.slice(at)));
    after.forEach(n => n.nodeType === 3 && done.add(n));
    t.nodeValue = text.slice(0, hits[0][0]);
    t.after(...after);
  }
  function linkify() {
    const scope = document.querySelector('main') || document.querySelector('[role="dialog"]');
    if (!scope) return;
    for (const root of [scope, ...document.querySelectorAll('[role="dialog"]')]) {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: n => !done.has(n) && n.nodeValue.length > 4 && n.nodeValue.includes('.') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
      });
      const list = [];
      for (let n; (n = w.nextNode());) list.push(n);
      for (const n of list) if (!n.parentElement?.closest(SKIP)) linkTextNode(n); else done.add(n);
    }
  }
  // Our links sit inside Instagram's clickable caption: open the link, nothing else
  addEventListener('click', e => { if (e.target.closest?.('a.igb-link[target]')) e.stopPropagation(); }, true);

  // ---------- full captions on Reels ----------
  // A collapsed Reels caption is a role=button holding the text cut to one line (white-space: nowrap)
  // and a "… more" marker span (aria-hidden, visible only when text was cut). Clicking it opens the
  // full caption in place, so we click it for the user.
  // Logged-in Reels layout: the caption beside the video is a role=button holding a [dir=auto] text
  // block cut by CSS line-clamp; clicking it opens the caption in place as well.
  const clamped = el => { const cs = getComputedStyle(el); return cs.webkitLineClamp !== 'none' && el.scrollHeight > el.clientHeight + 2; };
  const clicked = new WeakSet();
  let lastTry = 0, tries = [], opened = false;
  // The open caption is still Instagram's button: a click anywhere on it would fold it up again.
  // Stop those clicks at the caption (before Instagram's handler at the page root) so it reads as
  // plain text; links in it (hashtags, @users, addresses) still work, and text can be selected.
  function lockOpen(btn) {
    btn.dataset.igbCaption = '1';
    // Instagram toggles on press (pointer/mouse/touch), not only on click: stop all of them. Its own
    // links (#tags, @users) need its handlers to navigate; our web-address links open a tab by themselves.
    const stop = e => { const a = e.target.closest?.('a[href]'); if (!a || a.classList.contains('igb-link')) e.stopPropagation(); };
    ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchend'].forEach(t => btn.addEventListener(t, stop, true));
    btn.addEventListener('keydown', e => { if (e.target === btn && (e.key === 'Enter' || e.key === ' ')) e.stopPropagation(); }, true);
  }
  function expand() {
    if (!/^\/reels?\//.test(location.pathname)) return;
    // Instagram keeps ONE open/folded state for all Reels captions on the page and re-renders every
    // caption when it changes. So: click one cut-off caption (that opens them all), wait for the
    // re-render, and give up after a few tries rather than loop. Once none is cut off, lock them all.
    const caps = [...document.querySelectorAll('main [role="button"] [dir="auto"]')].map(t => t.closest('[role="button"]'))
      .filter((b, i, a) => a.indexOf(b) === i && !b.querySelector('svg, img, video'));
    const cut = caps.find(b => !b.dataset.igbCaption && [...b.querySelectorAll('[dir="auto"]')].some(clamped));
    const now = Date.now();
    tries = tries.filter(t => now - t < 20000);
    if (cut) {
      if (now - lastTry > 1500 && tries.length < 3) { lastTry = now; tries.push(now); cut.click(); }
    } else if (tries.length || opened) {   // we opened them: keep them (and new ones) open
      opened = true;
      caps.forEach(b => b.dataset.igbCaption || lockOpen(b));
    }
    for (const more of document.querySelectorAll('main [role="button"] span[aria-hidden="true"]')) {
      const btn = more.closest('[role="button"]');
      const txt = more.previousElementSibling;
      if (clicked.has(btn) || !txt || txt.tagName !== 'SPAN' || btn.querySelector('svg, img, video')) continue;
      if (getComputedStyle(txt).whiteSpace !== 'nowrap' || getComputedStyle(more).visibility === 'hidden') continue;
      clicked.add(btn);
      btn.click();
    }
  }

  function run() {
    const s = IGB.settings;
    if (s.captionExpand) expand();
    if (s.captionLinks) linkify();
  }
  IGB.onDomChange(run, 500);
  IGB.onSettings(() => { if (document.body) run(); });
})();
