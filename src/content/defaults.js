/* Reddit Better Browsing — shared defaults (loaded by content scripts and popup) */
var RBE = globalThis.RBE || (globalThis.RBE = {});
RBE.api = globalThis.browser ?? globalThis.chrome;

RBE.DEFAULTS = {
  // Post viewer
  viewerMode: 'side',          // side | modal | lightbox | inline | off
  sideWidth: 46,               // % of window width
  historyBack: true,           // browser Back closes the viewer
  commentSort: 'confidence',   // confidence(best) | top | new | controversial | old | qa
  viewerFontSize: 15,
  collapseAutoMod: true,

  // Image lightbox
  lightbox: true,
  lightboxScope: 'feed',       // post | feed  (wheel past the last image continues to the next post)
  lightboxStyle: 'step',       // step (wheel = next/prev) | strip (vertical scroll)
  lightboxFilmstrip: true,
  lightboxPosts: 'all',        // all | media (images + videos) | images
  lightboxText: true,
  lightboxComments: true,      // load comments under the post text in the lightbox side panel          // show post title + text beside the media

  // Video
  videoMode: 'volume',         // default | volume | muted | off
  videoVolume: 10,             // 0-100
  videoPauseOffscreen: true,
  videoLoop: true,

  // Spoilers / blur
  revealSpoilers: false,
  nsfwMode: 'reddit',          // reddit (leave as-is) | show (unblur) | blur | hide
  navGear: true,               // settings gear in Reddit's top nav bar
  showAvatars: true,           // user pictures + subreddit icons in the viewer and lightbox
  quickBar: true,              // small floating toolbar on Reddit pages
  embedLink: true,             // 🔗 button: copy a link that Discord shows as an embed
  embedHost: 'redditez.com',   // embed-fixer domain for that link (popup offers redditez.com, vxreddit.com, rxddit.com; rxddit was down in Nov 2026)

  // Looks
  theme: 'default',
  accent: '',
  presets: {
    cards: false,
    hideLeft: false,
    hideRight: false,
    wideFeed: false,
    compact: false,
    hidePromoted: true,
    hideSuggestions: false,
    hideAwards: false,
    squareCorners: false,
    maxMediaHeight: 0          // px, 0 = off
  }
};

  // bg = page, card = raised surfaces, hover, border, text, weak = secondary text, accent
RBE.THEMES = {
  default:   null,
  midnight:  { dark: 1, bg: '#000000', card: '#0b0b0d', hover: '#17171b', border: '#24242a', text: '#e6e6e9', weak: '#8d8d96', accent: '#ff5722' },
  slate:     { dark: 1, bg: '#0f1419', card: '#161c23', hover: '#1f2730', border: '#2a3440', text: '#dde3ea', weak: '#8b98a5', accent: '#4aa3ff' },
  nord:      { dark: 1, bg: '#2e3440', card: '#3b4252', hover: '#434c5e', border: '#4c566a', text: '#eceff4', weak: '#a3acbd', accent: '#88c0d0' },
  dracula:   { dark: 1, bg: '#22212c', card: '#2b2a37', hover: '#363546', border: '#44475a', text: '#f8f8f2', weak: '#a7a5c4', accent: '#bd93f9' },
  mocha:     { dark: 1, bg: '#1e1e2e', card: '#181825', hover: '#313244', border: '#45475a', text: '#cdd6f4', weak: '#a6adc8', accent: '#f5c2e7' },
  solarized: { dark: 1, bg: '#002b36', card: '#073642', hover: '#0d4452', border: '#1b5563', text: '#eee8d5', weak: '#93a1a1', accent: '#b58900' },
  forest:    { dark: 1, bg: '#121a16', card: '#18231d', hover: '#213027', border: '#2c3e33', text: '#dfe9e2', weak: '#8fa597', accent: '#6fcf97' },
  paper:     { dark: 0, bg: '#f4efe6', card: '#fbf8f2', hover: '#ece5d8', border: '#ddd3c2', text: '#2b2620', weak: '#6f6559', accent: '#c2410c' },
  snow:      { dark: 0, bg: '#f6f7f9', card: '#ffffff', hover: '#eef0f3', border: '#dfe3e8', text: '#1a1d21', weak: '#5f6b7a', accent: '#2563eb' }
};

RBE.mergeSettings = function (stored) {
  const d = RBE.DEFAULTS;
  const s = Object.assign({}, d, stored || {});
  s.presets = Object.assign({}, d.presets, (stored && stored.presets) || {});
  return s;
};

RBE.loadSettings = async function () {
  const [sync, local] = await Promise.all([
    RBE.api.storage.sync.get('settings').catch(() => ({})),
    RBE.api.storage.local.get('customCss').catch(() => ({}))
  ]);
  const s = RBE.mergeSettings(sync.settings);
  s.customCss = local.customCss || '';
  return s;
};
