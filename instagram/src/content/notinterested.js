/* "Not interested": the phone app's option on suggested posts and reels. Instagram's web app has the
   same call behind its feed menu (usePolarisHidePost → discover/explore_report, keyed by the media
   pk); we offer it on every post and reel. */
(() => {
  const h = IGB.h;
  const onReels = () => location.pathname.startsWith('/reels/');

  // Same fields Instagram's web app sends (nav_chain and the reason are optional)
  const body = code => ({
    m_pk: IGB.mediaId(code), container_module: 'feed_timeline', inventory_source: 'media_or_ad',
    m_ix: '0', sfplt_source: 'sfplt_in_menu'
  });
  IGB.markNotInterested = code => IGB.postForm('/api/v1/discover/explore_report/', body(code));
  IGB.undoNotInterested = code => IGB.postForm('/api/v1/discover/explore_report_undo/', body(code));

  // Small message at the bottom of the window, with an optional action button
  let toastEl = null, toastT = 0;
  IGB.toast = (text, action) => {
    toastEl?.remove(); clearTimeout(toastT);
    const el = toastEl = h('div', { class: 'igb-root igb-toast', role: 'status' }, h('span', null, text),
      action ? h('button', { onclick: () => { el.remove(); action.run(); } }, action.label) : '');
    document.body.append(el);
    toastT = setTimeout(() => el.remove(), 6000);
  };

  // Mark the post, then get it out of the way: a feed post collapses, a reel scrolls on to the next
  // one, the lightbox steps to the next post.
  async function notInterested(code, art) {
    await IGB.markNotInterested(code);
    if (art) art.classList.add('igb-ni');
    else if (IGB.lightboxItem?.()) IGB.lightboxNext?.();
    else if (onReels()) IGB.nextReel?.();
    IGB.toast('Not interested: Instagram will show fewer posts like this.', {
      label: 'Undo',
      run: () => IGB.undoNotInterested(code).then(
        () => { art?.classList.remove('igb-ni'); IGB.toast('Undone.'); },
        err => IGB.toast('Undo failed: ' + err.message))
    });
  }

  // getCode() / getArt() are read at click time
  IGB.notInterestedButton = (getCode, getArt) => h('button', {
    class: 'igb-tool igb-ni-btn', title: 'Not interested (see fewer posts like this)',
    onclick: async e => {
      e.preventDefault(); e.stopPropagation();
      const b = e.currentTarget;
      const code = getCode();
      if (!code || b.classList.contains('busy')) return;
      b.classList.add('busy');
      try { await notInterested(code, getArt?.()); }
      catch (err) { console.warn('[IGB] not interested failed', err); IGB.toast('Could not mark as not interested (' + err.message + ').'); }
      finally { b.classList.remove('busy'); }
    }
  }, '⊘');
})();
