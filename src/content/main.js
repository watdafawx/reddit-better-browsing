/* Click interception: open posts in the viewer and images in the lightbox instead of navigating */
(() => {
  const INTERACTIVE = new Set(['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'LABEL', 'SUMMARY',
    'SHREDDIT-POST-OVERFLOW-MENU', 'FACEPLATE-DROPDOWN-MENU', 'AWARD-BUTTON', 'SHREDDIT-JOIN-BUTTON',
    'SHREDDIT-POST-SHARE-BUTTON', 'FACEPLATE-SHARE-BUTTON', 'SHREDDIT-PLAYER', 'SHREDDIT-PLAYER-2', 'VIDEO',
    'SHREDDIT-EMBED', 'FACEPLATE-HOVERCARD', 'SHREDDIT-POST-FLAIR', 'SHREDDIT-STATUS-ICONS', 'IFRAME']);

  function onClick(e) {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.defaultPrevented) return;
    const s = RBE.settings;
    const path = e.composedPath();
    if (path.some(n => n.classList && n.classList.contains('rbe-root') && !n.classList.contains('rbe-viewer') && !n.classList.contains('rbe-inline'))) return; // our quick bar / lightbox

    const post = path.find(n => n.tagName === 'SHREDDIT-POST');
    const inOurUi = path.some(n => n.classList && (n.classList.contains('rbe-viewer') || n.classList.contains('rbe-inline')));

    // 1) Images in feed / post pages → our lightbox
    if (post && s.lightbox && !inOurUi) {
      const img = path.find(n => n.tagName === 'IMG');
      const blocked = path.some(n => n.tagName === 'BUTTON' || n.tagName === 'A' && n.getAttribute('href') && !RBE.isCommentsUrl(n.href) && !/redd\.it/.test(n.href));
      if (img && !blocked && RBE.isMediaPostEl(post)) {
        const blurred = path.find(n => n.tagName === 'SHREDDIT-BLURRED-CONTAINER');
        if (blurred && blurred.matches('[blurred]:not([data-rbe-revealed])') && s.nsfwMode !== 'show') return; // let Reddit handle "click to see"
        let index = 0;
        const li = path.find(n => n.tagName === 'LI' && n.parentElement && path.some(x => x.tagName === 'GALLERY-CAROUSEL'));
        if (li) index = [...li.parentElement.children].filter(c => c.tagName === 'LI').indexOf(li);
        stop(e);
        RBE.openLightbox({ postId: RBE.postIdOf(post), index: Math.max(0, index) });
        return;
      }
    }

    if (s.viewerMode === 'off') return;

    // 2) Links to posts / comments anywhere → viewer
    const a = path.find(n => n.tagName === 'A' && n.getAttribute && n.getAttribute('href'));
    const interactive = path.find(n => n.nodeType === 1 && (INTERACTIVE.has(n.tagName) || n.getAttribute?.('role') === 'button'));
    const onPostPage = /\/comments\//.test(location.pathname);

    if (a) {
      if (interactive && path.indexOf(interactive) < path.indexOf(a)) return;  // a button inside the link
      if (!RBE.isCommentsUrl(a.href)) {
        if (inOurUi && a.target !== '_blank' && RBE.viewerOpen()) RBE.closeViewer(true); // navigating to a sub/user page
        return;
      }
      // On a post's own page, don't hijack clicks on the main post
      if (onPostPage && post && !post.closest('shreddit-feed') && RBE.pathOf(a.href) === RBE.pathOf(location.href)) return;
      stop(e);
      const feedPost = post && RBE.pathOf(post.getAttribute('permalink')) === RBE.pathOf(a.href) ? post : null;
      if (inOurUi && RBE.viewerOpen()) { /* link inside the viewer: stack it */ RBE._pushInViewer(a.href); return; }
      RBE.openViewer(new URL(a.href).pathname, feedPost);
      return;
    }

    // 3) Click on a feed card's blank area (Reddit would navigate)
    if (post && !inOurUi && !interactive && post.getAttribute('permalink')) {
      if (onPostPage && !post.closest('shreddit-feed')) return;
      const sel = window.getSelection && String(window.getSelection());
      if (sel && sel.length > 2) return; // user is selecting text
      stop(e);
      RBE.openViewer(post.getAttribute('permalink'), post);
    }
  }
  function stop(e) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); }

  // A post link clicked inside the viewer is stacked (← goes back)
  RBE._pushInViewer = href => RBE.viewerPush(new URL(href).pathname);

  window.addEventListener('click', onClick, true);

  // ---------- 🔗 in each post's action row ----------
  // Share sits in <slot name="share-button"> inside shreddit-post's open shadow root; our button goes
  // right after it and borrows Reddit's own button classes (they're in that shadow root's stylesheet).
  const FEED_BTN = 'rbe-feed-embed';
  let retry = 0, retries = 0;
  function addFeedButtons() {
    const on = RBE.settings.embedLink !== false;
    let pending = false;
    for (const post of document.querySelectorAll('shreddit-post')) {
      const sr = post.shadowRoot;
      if (!sr) { pending = true; continue; }
      const old = sr.querySelector('.' + FEED_BTN);
      if (!on) { sr.querySelectorAll('.' + FEED_BTN).forEach(x => x.remove()); continue; }
      if (old) continue;
      const share = sr.querySelector('slot[name="share-button"]');
      if (!share) { pending = true; continue; }
      if (!post.getAttribute('permalink')) continue;
      const b = RBE.embedButton(() => post.getAttribute('permalink'),
        FEED_BTN + ' button border-md flex flex-row justify-center items-center h-xl font-semibold relative text-12 button-secondary inline-flex items-center px-sm');
      b.style.cssText = 'height:var(--size-button-sm-h);padding:0 12px;gap:4px';
      b.textContent = '🔗 Discord';
      share.after(b);
      const out = RBE.outLink(post);
      if (out) {
        const o = RBE.siteButton(out, FEED_BTN + ' button border-md flex flex-row justify-center items-center h-xl font-semibold relative text-12 button-secondary inline-flex items-center px-sm no-underline');
        o.style.cssText = 'height:var(--size-button-sm-h);padding:0 12px;gap:4px;text-decoration:none';
        b.after(o);
      }
    }
    // Reddit renders a post's shadow root after inserting it, which the light-DOM observer doesn't see.
    clearTimeout(retry);
    if (pending && retries++ < 20) retry = setTimeout(addFeedButtons, 700);
    else if (!pending) retries = 0;
  }
  RBE.onDomChange(() => { retries = 0; addFeedButtons(); }, 400);
  RBE.onSettings(addFeedButtons);

  // ---------- hotkeys ----------
  window.addEventListener('keydown', e => {
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.key.toLowerCase();
    const code = e.code;
    if (k === 'n' || code === 'KeyN') { e.preventDefault(); RBE.cycleNsfw(); }
    else if (k === 'v' || code === 'KeyV') { e.preventDefault(); RBE.cycleVideo(); }
    else if (k === 's' || code === 'KeyS') { e.preventDefault(); RBE.toggleSpoilers(); }
  }, true);
})();
