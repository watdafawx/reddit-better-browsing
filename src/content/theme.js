/* Themes + CSS presets + custom CSS */
(() => {

  const ROOTS = 'html:root, html.theme-dark, html.theme-light, :root .theme-dark, :root .theme-light, :root .theme-beta, :root .theme-rpl';

  function themeCss(t, accent) {
    if (!t && !accent) return '';
    const a = accent || (t && t.accent);
    let v = '';
    if (t) v += `
      color-scheme: ${t.dark ? 'dark' : 'light'};
      --rbe-bg:${t.bg}; --rbe-card:${t.card}; --rbe-hover:${t.hover}; --rbe-border:${t.border}; --rbe-text:${t.text}; --rbe-weak:${t.weak};
      --color-neutral-background:${t.bg} !important;
      --color-neutral-background-weak:${t.card} !important;
      --color-neutral-background-container:${t.card} !important;
      --color-neutral-background-strong:${t.hover} !important;
      --color-neutral-background-hover:${t.hover} !important;
      --color-neutral-background-container-hover:${t.hover} !important;
      --color-neutral-background-selected:${t.hover} !important;
      --color-neutral-background-container-strong:${t.hover} !important;
      --color-neutral-background-gilded:${t.card} !important;
      --color-neutral-content:${t.text} !important;
      --color-neutral-content-strong:${t.text} !important;
      --color-neutral-content-weak:${t.weak} !important;
      --color-neutral-border:${t.border} !important;
      --color-neutral-border-weak:${t.border} !important;
      --color-neutral-border-strong:${t.weak} !important;
      --color-secondary-background:${t.hover} !important;
      --color-secondary-background-hover:${t.border} !important;
      --color-secondary-background-selected:${t.border} !important;
      --color-secondary-plain:${t.text} !important;
      --color-secondary-plain-weak:${t.weak} !important;
      --color-secondary-weak:${t.weak} !important;
      --color-secondary:${t.text} !important;
      --color-secondary-onBackground:${t.text} !important;
      --color-input-background:${t.card} !important;
      --color-input-secondary:${t.card} !important;
      --color-tone-1:${t.text} !important; --color-tone-2:${t.weak} !important; --color-tone-3:${t.weak} !important;
      --color-tone-4:${t.border} !important; --color-tone-5:${t.hover} !important; --color-tone-6:${t.hover} !important; --color-tone-7:${t.card} !important;
      --shreddit-content-background:${t.card} !important;
      --color-global-white:${t.dark ? t.card : '#ffffff'};`;
    if (a) v += `
      --rbe-accent:${a};
      --color-primary:${a} !important; --color-primary-background:${a} !important; --color-primary-plain:${a} !important;
      --color-primary-hover:${a} !important; --color-primary-background-hover:${a} !important; --color-global-focus:${a} !important;
      --color-brand-background:${a} !important; --color-brand-background-hover:${a} !important;`;
    let css = `${ROOTS} {${v}}\n`;
    if (t) css += `html, body { background:${t.bg} !important; color:${t.text}; }
      shreddit-app, .main-container, #main-content { background: transparent !important; }
      ::selection { background:${a}55; }
      * { scrollbar-color: ${t.border} transparent; }\n`;
    return css;
  }

  function presetCss(p) {
    let c = '';
    if (p.cards) c += `
      shreddit-feed shreddit-post, shreddit-feed shreddit-ad-post { background: var(--color-neutral-background-weak, var(--rbe-card)) !important;
        border: 1px solid var(--color-neutral-border-weak, var(--rbe-border)) !important; border-radius: 14px !important; margin: 10px 0 !important; }
      shreddit-feed > hr, shreddit-feed article + hr { display: none !important; }`;
    if (p.hideLeft) c += `
      #left-sidebar-container, flex-left-nav-container, #flex-left-nav-container, reddit-sidebar-nav, #left-sidebar { display: none !important; }
      .grid-container { grid-template-columns: minmax(0,1fr) !important; --flex-nav-width: 0px !important; }
      .subgrid-container { margin-left: auto !important; margin-right: auto !important; }`;
    if (p.hideRight) c += `
      #right-sidebar-container, [slot="right-sidebar"], #right-sidebar-contents, .right-sidebar, aside[aria-label*="sidebar" i] { display: none !important; }
      .main-container { grid-template-columns: minmax(0,1fr) !important; }`;
    if (p.wideFeed) c += `
      .subgrid-container, .main-container, main.main, #main-content { max-width: none !important; width: 100% !important; }
      shreddit-feed, shreddit-post { max-width: none !important; }`;
    if (p.compact) c += `
      shreddit-post { padding-top: 6px !important; padding-bottom: 6px !important; margin-top: 2px !important; margin-bottom: 2px !important; }
      shreddit-post [slot="title"] { font-size: 15px !important; line-height: 20px !important; }
      shreddit-post [slot="text-body"] { display: none !important; }`;
    if (p.hidePromoted) c += `
      shreddit-ad-post, shreddit-dynamic-ad-link, shreddit-comments-page-ad, shreddit-sidebar-ad, shreddit-comment-tree-ad,
      [data-testid="ad-post"], shreddit-post[promoted], shreddit-post[is-promoted], article:has(> shreddit-ad-post),
      faceplate-tracker[source="ad"], games-section-badge-controller { display: none !important; }`;
    if (p.hideSuggestions) c += `
      recent-posts, shreddit-recent-posts, community-highlight-carousel, shreddit-recommended-communities,
      [data-testid="community-recommendation"], shreddit-gallery-carousel[data-testid*="recommend" i],
      reddit-recent-pages, #recent-communities-section, faceplate-tracker[noun="recommended_communities"],
      search-dynamic-id-cache-controller + div:has(> [aria-label*="Trending" i]) { display: none !important; }`;
    if (p.hideAwards) c += `
      award-button, shreddit-post award-button, shreddit-comment award-button, [noun="award"], shreddit-post-share-button,
      shreddit-comment-share-button { display: none !important; }`;
    if (p.squareCorners) c += `
      shreddit-post, shreddit-comment, img, video, .rbe-root, .rbe-root * { border-radius: 0 !important; }`;
    if (+p.maxMediaHeight > 0) c += `
      shreddit-feed shreddit-post shreddit-aspect-ratio, shreddit-feed shreddit-post gallery-carousel,
      shreddit-feed shreddit-post shreddit-player, shreddit-feed shreddit-post shreddit-player-2 { max-height: ${+p.maxMediaHeight}px !important; overflow: hidden !important; }
      shreddit-feed shreddit-post img.media-lightbox-img, shreddit-feed shreddit-post shreddit-aspect-ratio img { max-height: ${+p.maxMediaHeight}px !important; object-fit: contain !important; }`;
    return c;
  }

  function spoilerCss(s) {
    let c = '';
    if (s.revealSpoilers) c += `
      .md-spoiler-text, span[class*="spoiler" i] { background: transparent !important; color: inherit !important; filter: none !important; }
      .md-spoiler-text * { visibility: visible !important; opacity: 1 !important; }
      shreddit-blurred-container[reason="spoiler"] img, shreddit-blurred-container[reason="spoiler"] video,
      shreddit-post[spoiler] img, shreddit-post[spoiler] video { filter: none !important; }`;
    const NSFW = 'shreddit-post:is([nsfw],[over-18],[is-nsfw])';
    if (s.nsfwMode === 'show') c += `
      shreddit-blurred-container[reason="nsfw"] img, shreddit-blurred-container[reason="nsfw"] video,
      ${NSFW} img, ${NSFW} video { filter: none !important; }`;
    if (s.nsfwMode === 'blur') c += `
      ${NSFW} :is(img, video, shreddit-player, shreddit-player-2, gallery-carousel, shreddit-aspect-ratio, [slot="thumbnail"], [slot="text-body"]) {
        filter: blur(30px) saturate(.6) !important; transition: filter .2s; }
      ${NSFW}:hover :is(img, video, shreddit-player, shreddit-player-2, gallery-carousel, shreddit-aspect-ratio, [slot="thumbnail"], [slot="text-body"]) { filter: blur(14px) !important; }
      .rbe-nsfw-blur:not(.rbe-unblurred) .rbe-media { filter: blur(30px); cursor: pointer; }`;
    if (s.nsfwMode === 'hide') c += `
      ${NSFW}, article:has(> ${NSFW}), shreddit-feed article:has(${NSFW}) { display: none !important; }
      ${NSFW} + hr, article:has(${NSFW}) + hr { display: none !important; }`;
    return c;
  }

  function apply(s) {
    let style = document.getElementById('rbe-theme');
    if (!style) {
      style = document.createElement('style');
      style.id = 'rbe-theme';
      (document.head || document.documentElement).append(style);
    }
    const t = RBE.THEMES[s.theme] || null;
    document.documentElement.classList.toggle('rbe-themed', !!t);
    document.documentElement.classList.toggle('rbe-light', !!t && !t.dark);
    document.documentElement.style.setProperty('--rbe-viewer-font', (s.viewerFontSize || 15) + 'px');
    style.textContent = themeCss(t, s.accent) + presetCss(s.presets) + spoilerCss(s) + '\n/* custom */\n' + (s.customCss || '');
    // keep our style last in <head> so it wins ties
    if (document.head && style.parentNode !== document.head) document.head.append(style);
  }

  RBE.onSettings(apply);
  document.addEventListener('DOMContentLoaded', () => apply(RBE.settings));
})();
