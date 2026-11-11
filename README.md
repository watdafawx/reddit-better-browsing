# Reddit Better Browsing

A Chrome and Firefox extension for the new Reddit layout (www.reddit.com). Read posts and comments without leaving the feed, browse images in a proper viewer, and control video autoplay, spoilers, NSFW, accounts and themes.

- [Install](#install)
- [Features](#features)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Notes and limits](#notes-and-limits)
- [Development](#development)
- [License](#license)

## Install

**The userscript is the release** (below): one script for Reddit, Instagram and X that updates itself. The browser extensions below are no longer released or zipped; `npm run build:ext` still builds them unpacked (see [Development](#development)).

**Chrome, Edge, Brave**
1. Run `npm run build:ext`.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and pick `dist/chrome`.

**Firefox 128+**
- Try it: open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…** and pick `dist/firefox/manifest.json`. Firefox removes temporary add-ons when it restarts.
- Keep it: sign `dist/firefox` (zipped) for free as an *unlisted* add-on at addons.mozilla.org, or use Firefox Developer Edition / Nightly with `xpinstall.signatures.required = false`.

Click the toolbar icon (or the gear the extension adds to Reddit's top bar) to open settings. Settings sync between browsers signed in to the same account.

### As one userscript for Reddit, Instagram and X (auto-updates)

With [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/) installed, open
https://github.com/watdafawx/reddit-better-browsing/releases/download/userscript/better-browsing.user.js
and click **Install**. That one script runs Reddit Better Browsing on reddit.com, [Instagram Better Browsing](instagram/README.md) on instagram.com and [X Better Browsing](x/README.md) on x.com (browser video controls with one video playing at a time, sound on, one-click retweet, Like + Retweet, copy link for Discord), and the manager updates it by itself when a new version is released. It replaces the older single-purpose X scripts.

- Same features as the extensions, except **account switching** (it swaps Reddit's login cookies, which a userscript can't reach).
- Settings: the gear in Reddit's top bar (or the quick bar's ⚙️); on Instagram and X the sidebar gear or <kbd>Alt</kbd>+<kbd>W</kbd>. They're kept in each site's localStorage, so they don't sync between browsers.
- Use either the script or an extension for a site, not both: they'd both control the same videos.
- Chrome needs userscripts allowed: on `chrome://extensions`, open the manager's **Details** and turn on **Allow user scripts** (or Developer mode on older versions).

## Features

| Feature | What it does |
|---|---|
| **No page switching** | Clicking a post opens it with its comments in a **side panel**, a **modal**, or **inline** in the feed (pick in settings). Threads collapse, "load more" works, you can change the comment sort, and post links inside the viewer open in the viewer too (← goes back). Ctrl/⌘/middle-click still opens a new tab. |
| **Fast opening** | When the pointer rests on a post, its comments start loading in the background, so the viewer usually opens instantly. |
| **Image viewer** | Replaces Reddit's fullscreen viewer. The mouse wheel goes to the next or previous image, and past the last image of a gallery it continues into the next posts (optional). Click the image to zoom, drag to pan, `Ctrl`+wheel to zoom. A "vertical strip" style is available if you'd rather scroll. |
| **Video** | Autoplay with sound at X% (default 10%), autoplay muted, or no autoplay. Can pause videos scrolled out of view, and when the tab is hidden or the window loses focus. The viewer and lightbox use the browser's video controls (seek bar, volume, fullscreen); turn that off to play and pause with a click instead. |
| **Spoilers** | Auto-reveal all spoilers, or reveal everything on the page once. |
| **NSFW** | Reddit default, show, blur or hide. |
| **Accounts** | Log in once per account and click "Save current account". After that, switching is one click. |
| **Looks** | 9 themes plus an accent color, layout presets (card posts, compact, wide feed, hide sidebars, hide ads/awards, max media height, square corners) and custom CSS. Settings can be imported and exported. |
| **Quick bar** | A small floating bar at the bottom left with NSFW, video, spoiler and account toggles. It can be turned off. |
| **Copy for Discord** | 🔗 in the viewer, lightbox and under each opened post copies the post link on an embed-fixer domain (`redditez.com` by default, a setting), so Discord shows the picture or a playable video. If previews stop showing, try another embed-fixer domain. |

## Keyboard shortcuts

| Where | Key | Action |
|---|---|---|
| Anywhere | `Alt+N` | Cycle NSFW mode |
| Anywhere | `Alt+V` | Cycle video mode |
| Anywhere | `Alt+S` | Toggle spoiler auto-reveal |
| Anywhere | `Alt+A` | Account menu |
| Post viewer | `J` / `K` | Next / previous post |
| Post viewer | `Backspace` | Back (after following a link inside the viewer) |
| Post viewer | `Esc` or browser **Back** | Close |
| Image viewer | Wheel, arrows, `Space`, `J` / `K` | Next / previous image |
| Image viewer | `C` or `Enter` | Open post with comments |
| Image viewer | `T` | Show / hide the post text panel |
| Image viewer | `Esc` | Close |

## Notes and limits

- **Account switching** saves and restores Reddit's login cookies. Passwords are never stored. Saved sessions are kept in the extension's local storage on your computer, so anyone with access to your browser profile could use them. Logging out on Reddit ends that saved session; save the account again afterwards.
- **Sound before the first click**: browsers block audible autoplay until you've interacted with the page. Until then videos start muted, then unmute to your chosen volume on your first click or key press.
- **Voting and replying** aren't built into the viewer yet. Use "Reply on Reddit ↗" or "Open on Reddit".
- **Old Reddit** (old.reddit.com) is not supported.
- Reddit changes its page markup often. The viewer and image viewer load content from Reddit's JSON API, so they hold up well. Themes and layout presets depend on Reddit's CSS names and may need updating; use Custom CSS for quick fixes.

## Development

Requires Node 22 or newer. There are no runtime dependencies; Playwright is only used by the test.

```bash
npm install          # only needed for the test
npm run build        # all three sites -> dist/better-browsing.user.js (the release)
npm run build:ext    # also dist/chrome, dist/firefox, dist/instagram-* (unpacked, for the tests)
npx playwright install chromium   # once, for the test
npm test             # offline smoke test of dist/chrome
```

Load `dist/chrome` (or `dist/firefox/manifest.json`) unpacked to try changes. Edit files in `src/` only; `dist/` is generated.

### Layout

```
src/
  background.js       account switching (cookie save/restore), on-demand hls.js injection
  main-world.js       runs in the page's own JS world to control Reddit's video players
  content/            isolated content scripts, loaded in this order:
    defaults.js         default settings, themes, settings loader (also used by the popup)
    core.js             settings + change events, shared DOM observer, fetch, HTML sanitizer, avatars
    media.js            post data cache, batched post fetching, media extraction from post JSON
    theme.js            themes, layout presets, spoiler/NSFW CSS, custom CSS
    video.js            autoplay/volume, offscreen pause, our own video players (hls.js)
    spoilers.js         spoiler and blur auto-reveal
    lightbox.js         image viewer (step and strip styles)
    viewer.js           post + comments viewer (side / modal / inline), thread cache + prefetch
    quickbar.js         floating quick bar, account menu, hotkey actions
    navgear.js          settings gear in Reddit's header
    main.js             click interception and global hotkeys
    content.css         styles for everything above
  popup/              settings page (toolbar popup, options page and in-page panel)
  vendor/hls.min.js   hls.js, injected only when one of our players needs it
manifest.base.json    shared manifest; build.js adds the per-browser background entry
build.js              builds dist/ (no dependencies)
test/offline.mjs      Playwright smoke test against fixture pages, never hits live Reddit
instagram/, x/       the Instagram part (extension + userscript) and the X part (userscript only)
```

See [CLAUDE.md](CLAUDE.md) for how the pieces fit together and the rules to keep when changing them.

### Releasing

1. Bump `version` in the part you changed (`manifest.base.json` and `package.json` for Reddit, `instagram/manifest.base.json`, `x/manifest.base.json`).
2. Run `npm test`, `npm run test:instagram` and `npm run test:x`.
3. `npm run build`, then `npm run release:userscript` (uploads `dist/better-browsing.user.js` to the fixed `userscript` release that installed scripts check).

## Instagram and X

`instagram/` holds a second extension for instagram.com: browser video controls on every video, sound on by default at your volume, and a fast lightbox. `npm run build` builds it too (`dist/instagram-chrome`, `dist/instagram-firefox`), and the combined userscript `dist/better-browsing.user.js`. See [instagram/README.md](instagram/README.md). `x/` holds the X part (userscript only, no extension): [x/README.md](x/README.md).

## License

[MIT](LICENSE). hls.js is bundled under its own license (`src/vendor/hls.LICENSE`).
