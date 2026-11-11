# X Better Browsing

Part of the one userscript (`dist/better-browsing.user.js`) for x.com. There is no browser extension for X: `x/manifest.base.json` only lists the scripts `build.js` puts into the userscript, in load order, and holds this part's version. It replaces these older single-purpose scripts: *Native Media Controls with autoplay*, *X - Auto unmute videos*, *One Click Copy Link Button for Twitter(X)*, *Retweet in one click & Like+Retweet* and the video part of *X.com Heavy JS Optimizer+*.

## Features

- **Browser video controls on every tweet video** (seek bar, volume, fullscreen, speed, picture-in-picture). X's own overlay (play button, mute button) is invisible and click-through; clicks on the controls don't open the tweet. GIFs are left to X.
- **One video plays at a time.** The video you start wins until it scrolls away; otherwise the one nearest the middle of the screen plays (among videos at least half in view; the current one keeps it until another is clearly more central). Pause a video yourself and it stays paused, and nothing else starts in its place while it is on screen, so a tweet with several videos (or a quote tweet with its own) no longer fights over which one plays. Scrolled out of view, videos pause (optional).
- **Sound on by default** at your volume (40% to start). Browsers only allow sound after a click or key press on the page; until then videos play muted and unmute on the first one. X mutes videos on its own; those page-made mutes are ignored. Volume you set with the controls carries to the next videos until the page reloads. Modes: play with sound, always muted, no autoplay, or hands off.
- **One-click retweet**: Retweet and Undo repost skip the menu. <kbd>Shift</kbd>+click shows it (for Quote).
- **Like + Retweet** button in the action bar; click again to undo both.
- **Copy link for Discord** (link icon in the action bar): copies `https://vxtwitter.com/<user>/status/<id>`, which Discord shows as an embed with the picture or a playable video. The domain is a setting (`vxtwitter.com`, `fxtwitter.com`, `fixupx.com`, `fixvx.com` suggested).
- **Lighter page**: removes backdrop blur effects.

Settings: the gear after the last link in X's left sidebar, or <kbd>Alt</kbd>+<kbd>W</kbd> on any x.com page. They live in the page's localStorage (`xbb-userscript-settings`).

Not carried over from the old optimizer script: timer and animation-frame throttling, blocking X's metrics requests, removing preloads, hiding old tweets in the feed. They change how X's own code runs and can break it; say so if one of them is worth having back.

## How it works

- `main-world.js` patches `HTMLMediaElement` (`play`, `muted`, `volume`, `autoplay`) so X's players follow your audio setting, and swallows X's own `play()` on every video except the pick (`data-xbb-pick`) when one-at-a-time or no-autoplay is on. Settings arrive in `<html data-xbb-video>`. A mute or volume change counts as yours only right after a click or key press on that video's own player.
- `content/video.js` turns on `controls`, observes every video with one `IntersectionObserver`, and decides the pick on scroll, visibility and your clicks (no polling, no fighting with X's player). It tells your clicks from X's own play/pause calls by whether a click or key press just happened on that player. Overlay hiding is pure CSS (`videoComponent > :not(:has(video))`), so it survives X re-rendering.
- GIFs are looping videos from `/tweet_video/` in the same `videoPlayer`; they are skipped by that source path, or by `loop` being set when first seen.
- `content/tweet.js` finds tweets by `article[data-testid="tweet"]`, the `role="group"` action bar and the `like` / `unlike` / `retweet` / `unretweet` / `retweetConfirm` / `unretweetConfirm` test ids. A tweet's own link is the date link inside its article (a quoted tweet has none). One-click retweet hides X's menu (`html.xbb-rt`) while it clicks the confirm entry.
- `content/settings.js` clones a link in X's primary nav (Bookmarks if shown, else Explore) for the gear.

## Test

`npm run test:x` builds the userscript and loads it into plain Chromium against fixtures in `test/x-offline.mjs` (a small clip, `test/fixtures/clip.webm`, plays in them). It never contacts x.com. What it can't cover: X's real markup, which changes; after changing selectors in `video.js`, `tweet.js` or `settings.js`, check by hand on x.com.

## Firefox

Tested in Firefox as well as Chromium (`BROWSER=firefox node test/x-offline.mjs`). Firefox does not show the page clicks on a video's own controls, so a play or pause of yours is recognised by the pointer resting on that video plus the page's user activation (see `video.js`). Which video plays is measured from the video's position when it is needed (not from the observer's last report), and again while you scroll (at most every 150 ms), so the one nearest the middle plays right away.
