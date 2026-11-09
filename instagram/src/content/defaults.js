/* Instagram Better Browsing: shared defaults (loaded by content scripts and the popup) */
var IGB = globalThis.IGB || (globalThis.IGB = {});
IGB.api = globalThis.browser ?? globalThis.chrome;

IGB.DEFAULTS = {
  // Video
  videoMode: 'volume',        // default (Instagram decides) | volume | muted | off (no autoplay)
  videoVolume: 40,            // 0-100
  nativeControls: true,       // browser controls on every post/reel video; hides Instagram's overlay
  videoLoop: true,
  videoPauseOffscreen: true,
  reelsAutoScroll: true,      // Reels tab: when a reel ends, scroll to the next one (like the phone app)

  notInterested: true,        // "Not interested" button on feed posts, reels and in the lightbox
  captionExpand: true,        // Reels: open the full caption instead of one line with "… more"
  captionLinks: true,         // web addresses in captions and comments become links (also in the lightbox)

  // Lightbox
  lightboxGrid: true,         // profile / explore / tag grids open in the lightbox instead of Instagram's modal
  lightboxFeed: true,         // clicking a photo in the home feed opens the lightbox
  lightboxCaption: true,

  settingsGear: true,         // settings entry in Instagram's left sidebar (Alt+W works either way)

  // Downloads
  embedLink: true,            // 🔗 button: copy a link that Discord shows as an embed
  embedHost: 'oginstagram.com', // embed-fixer domain used in that link (OGInstagram, the one FixTweetBot uses; others in the popup list)
  downloadTools: true,        // download / open buttons over media and in the lightbox, Alt+S
  downloadName: '{user}_{code}_{n}' // {user} {code} {n} (slide number) {date} (YYYYMMDD)
};

IGB.mergeSettings = stored => Object.assign({}, IGB.DEFAULTS, stored || {});

IGB.loadSettings = async function () {
  const sync = await IGB.api?.storage?.sync.get('settings').catch(() => ({}));
  return IGB.mergeSettings(sync?.settings);
};
