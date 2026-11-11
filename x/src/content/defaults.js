/* X Better Browsing: shared defaults (loaded by content scripts and the popup) */
var XBB = globalThis.XBB || (globalThis.XBB = {});
XBB.api = globalThis.browser ?? globalThis.chrome;

XBB.DEFAULTS = {
  // Video
  videoMode: 'volume',        // volume (autoplay with sound) | muted | off (no autoplay) | default (X decides, no changes)
  videoVolume: 40,            // 0-100
  nativeControls: true,       // browser controls on every tweet video; hides X's own overlay
  videoOneAtATime: true,      // only one video plays: the one you started, else the one most in view
  videoPauseOffscreen: true,
  videoPauseOnHide: true,     // pause when the tab is hidden or the window loses focus
  videoLoop: false,

  // Tweets
  quickRetweet: true,         // Retweet / Undo repost skips the menu (Shift+click shows it, e.g. for Quote)
  likeRetweet: true,          // button that likes and retweets in one click
  embedLink: true,            // link button: copy a tweet link that Discord shows as an embed
  embedHost: 'vxtwitter.com', // embed-fixer domain used in that link

  // Page
  lighterPage: true,          // no backdrop blur
  settingsGear: true          // settings entry in X's left sidebar (Alt+W works either way)
};

XBB.mergeSettings = stored => Object.assign({}, XBB.DEFAULTS, stored || {});

XBB.loadSettings = async function () {
  const sync = await XBB.api?.storage?.sync.get('settings').catch(() => ({}));
  return XBB.mergeSettings(sync?.settings);
};
