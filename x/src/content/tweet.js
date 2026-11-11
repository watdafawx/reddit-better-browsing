/* Tweet action bar: copy link for Discord, Like + Retweet, and one-click retweet.
   Found by data-testid (X's class names are generated): article[data-testid=tweet], its role=group
   action bar, and buttons like / unlike / retweet / unretweet / bookmark. */
(() => {
  const { h } = XBB;
  const root = document.documentElement;

  // ---------- tweet link ----------
  const embedHost = () => (XBB.settings.embedHost || 'vxtwitter.com').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '') || 'vxtwitter.com';
  // The tweet's own permalink: the date link in its header. A quoted tweet inside it has no such link,
  // and links to other tweets (replies shown above it) belong to a different article.
  function tweetPath(article) {
    for (const t of article.querySelectorAll('a[href*="/status/"] time')) {
      const a = t.closest('a');
      if (a.closest('article') !== article) continue;
      const m = a.getAttribute('href').match(/^\/([^/]+)\/status\/(\d+)/);
      if (m) return `/${m[1]}/status/${m[2]}`;
    }
    const m = location.pathname.match(/^\/([^/]+)\/status\/(\d+)/);   // a tweet's own page, no date link found
    return m ? `/${m[1]}/status/${m[2]}` : null;
  }
  XBB.embedUrl = path => `https://${embedHost()}${path}`;

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {}
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } });
    ta.value = text;
    document.body.append(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch {}
    ta.remove();
    return ok;
  }

  // ---------- like + retweet ----------
  const q = (a, id) => a.querySelector(`[data-testid="${id}"]`);
  function likeAndRetweet(article) {
    const liked = !!q(article, 'unlike'), retweeted = !!q(article, 'unretweet');
    if (liked && retweeted) { q(article, 'unlike').click(); q(article, 'unretweet').click(); return; }
    if (!liked) q(article, 'like')?.click();
    if (!retweeted) setTimeout(() => q(article, 'retweet')?.click(), 120);   // let the like register first
  }
  const bothDone = a => !!q(a, 'unlike') && !!q(a, 'unretweet');

  // ---------- one-click retweet ----------
  // Clicking Retweet opens a menu (Repost / Quote); click the confirm entry ourselves, with the menu
  // hidden meanwhile. Shift+click shows the menu, for Quote. Undoing a repost is the same.
  const CONFIRM = '[data-testid="retweetConfirm"], [data-testid="unretweetConfirm"]';
  let confirming = false;
  function autoConfirm() {
    if (confirming) return;
    confirming = true;
    root.classList.add('xbb-rt');
    const t0 = performance.now();
    const done = () => { confirming = false; setTimeout(() => root.classList.remove('xbb-rt'), 150); };
    const tick = () => {
      const el = document.querySelector(CONFIRM);
      if (el) { el.click(); done(); }
      else if (performance.now() - t0 > 1500) done();
      else setTimeout(tick, 16);
    };
    tick();
  }
  addEventListener('click', e => {
    if (!XBB.settings.quickRetweet || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.target.closest?.('[data-testid="retweet"], [data-testid="unretweet"]')) autoConfirm();
  }, true);

  // ---------- buttons in the action bar ----------
  function button(cls, icon, title, onclick) {
    return h('button', { class: 'xbb-act ' + cls, type: 'button', title, 'aria-label': title, onclick }, XBB.icon(icon));
  }
  function addButtons(article) {
    const s = XBB.settings;
    const group = article.querySelector('[role="group"]');
    if (!group || !q(group, 'reply')) return;
    let box = group.querySelector(':scope > .xbb-acts');
    const want = (s.embedLink && tweetPath(article)) || s.likeRetweet;
    if (!want) { box?.remove(); return; }
    if (!box) {
      box = h('div', { class: 'xbb-acts xbb-root' });
      // before the last entry (Share), so the bar keeps its look
      group.insertBefore(box, group.lastElementChild);
      const ref = group.querySelector('[data-testid="bookmark"] svg, [data-testid="reply"] svg');   // X's grey for icons, light or dark theme
      if (ref) box.style.color = getComputedStyle(ref).color;
    }

    const link = box.querySelector('.xbb-copy');
    if (s.embedLink && tweetPath(article)) {
      if (!link) box.prepend(button('xbb-copy', 'link', 'Copy link for Discord (shows the tweet and its video in the chat)', async e => {
        e.preventDefault(); e.stopPropagation();
        const path = tweetPath(article), btn = e.currentTarget;
        if (!path || !(await copy(XBB.embedUrl(path)))) return;
        btn.replaceChildren(XBB.icon('check')); btn.classList.add('done');
        setTimeout(() => { btn.replaceChildren(XBB.icon('link')); btn.classList.remove('done'); }, 1400);
      }));
    } else link?.remove();

    const lr = box.querySelector('.xbb-lr');
    if (s.likeRetweet) {
      if (!lr) box.append(button('xbb-lr', 'likeRetweet', 'Like and retweet', e => { e.preventDefault(); e.stopPropagation(); likeAndRetweet(article); }));
      box.querySelector('.xbb-lr').classList.toggle('on', bothDone(article));
      box.querySelector('.xbb-lr').title = bothDone(article) ? 'Undo like and retweet' : 'Like and retweet';
    } else lr?.remove();
  }
  function scan() {
    document.querySelectorAll('article[data-testid="tweet"]').forEach(addButtons);
  }
  XBB.onSettings(() => { document.querySelectorAll('.xbb-acts').forEach(b => b.remove()); scan(); });
  XBB.onDomChange(scan, 200);
})();
