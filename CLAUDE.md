# CLAUDE.md

One userscript (`dist/better-browsing.user.js`, auto-updating) for new Reddit, Instagram and X. It is built from three code bases, all plain JavaScript with no framework, no bundler and no runtime dependencies: Reddit in `src/` (written as a Manifest V3 extension for Chrome and Firefox), Instagram in `instagram/` and X in `x/` (see the sections at the end). **Only the userscript is released.** The extension builds still exist (`npm run build:ext`) because the Reddit and Instagram Playwright tests load them; X has no extension build at all. README.md has the user-facing feature list and the file layout.

## Commands

- `npm run build`: writes the userscript `dist/better-browsing.user.js` for all three sites (see "Userscript" below). Nothing else.
- `npm run build:ext`: also copies `src/` to `dist/chrome` and `dist/firefox` (manifest from `manifest.base.json`) and `instagram/src` to `dist/instagram-chrome` / `dist/instagram-firefox`, unpacked, no zips. For the tests and for trying the extensions by hand.
- `npm test`: builds with extensions, then the offline Playwright smoke test of `dist/chrome`. Needs `npm install` and `npx playwright install chromium` once.
- `npm run test:instagram`: the same for `dist/instagram-chrome` (`test/instagram-offline.mjs`).
- `npm run test:x`: builds the userscript and tests its X part in plain Chromium (`test/x-offline.mjs`, clip in `test/fixtures/`). `BROWSER=firefox node test/x-offline.mjs` runs it in Firefox (`npx playwright install firefox` once); the same switch makes `test/offline.mjs` and `test/instagram-offline.mjs` run their userscript part in Firefox (their extension part only loads in Chromium).
- `npm run test:all`: everything: the three sites in Chromium and the userscript of each in Firefox (`test/all.mjs`). Run it before a release. It includes the CPU guards in `test/lib/perf.mjs` (nothing changes on an idle page by itself; the script adds little work on a page that keeps changing); keep them passing when adding a subscriber, timer or observer.
- Syntax check without a browser: `for f in src/*.js src/content/*.js src/popup/*.js; do node --check "$f"; done`

## Rules

- Edit `src/` and `manifest.base.json` only. `dist/` is generated and gitignored.
- Both browsers run the same files. The only per-browser difference is the `background` entry (and the Firefox gecko id), added in `build.js`. Use `RBE.api` (`browser ?? chrome`), never `chrome.*` directly in content scripts.
- Never send automated traffic to live Reddit from tests. Reddit blocks headless browsers; don't spoof user agents or otherwise get around that. Extend the fixtures in `test/offline.mjs` instead.
- New permissions in `manifest.base.json` can make browsers prompt users or disable the extension on update. Prefer ones with no install warning (`scripting` and `storage` have none).
- Bump `version` in `manifest.base.json` and `package.json` together. A change to the Instagram or X part bumps that part's own `manifest.base.json` version instead (the userscript `@version` follows all three).

## How it fits together

**Load order** is the `content_scripts` list in `manifest.base.json`. Every content script is an IIFE that hangs its API on the shared `RBE` global created in `defaults.js`. Later files may call earlier ones at load time; calls the other way must happen at runtime (for example `RBE.openLightbox?.()`).

**Settings**: `storage.sync` key `settings` (merged over `RBE.DEFAULTS`), plus `storage.local` key `customCss` (too big for sync). `core.js` keeps `RBE.settings` current and calls every `RBE.onSettings(fn)` subscriber on load and on change. It only reacts to those two keys, because account saves also write to `storage.local`. It also keeps a copy in the page's `localStorage` (`rbe-settings-snapshot`) so the theme applies on the first paint instead of after the async storage read. Code that writes settings reads `settings` from sync, changes it, and writes it back (see `patch()` in `quickbar.js`).

**Reacting to Reddit's DOM**: use `RBE.onDomChange(fn, delayMs)` from `core.js`. It is one shared `MutationObserver`, throttled per subscriber. Don't add new whole-document observers.

**Fetching**: always `RBE.getJSON(path)`. In Firefox it uses the page's `content.fetch` so cookies and CORS behave like Reddit's own requests.
- Post data: `RBE.getPosts(ids)` / `RBE.getPost(id)` in `media.js`. Batches up to 50 ids through `/api/info.json`, falls back to `/by_id/`, then to one `/comments/<id>.json` per post, three at a time. Results are cached per page.
- Threads: `loadThread()` in `viewer.js`. A 90 s cache shared by the viewer, the inline view and the image viewer's comment panel. Failed requests are never cached. Hovering a post for 300 ms, or pressing on it, prefetches its thread, with at most one hover prefetch in flight to stay clear of Reddit's rate limit. If you change the thread URL (`jsonUrl()`), prefetch and viewer must keep building it the same way or the cache stops hitting.
- Avatars: user pictures are batched (`/api/user_data_by_account_ids.json`, 100 per request); subreddit icons come from post data (`sr_detail`) or a cached `about.json`.

**Untrusted HTML**: anything from Reddit's API goes through `RBE.sanitize()` (allowlisted tags and attributes, image hosts limited to Reddit/imgur/giphy, `javascript:`/`data:` links removed) before it touches `innerHTML`. Build other DOM with `RBE.h(tag, props, ...children)`.

**Video** is split across two worlds:
- `main-world.js` runs in the page's JS world (`"world": "MAIN"`) and patches `HTMLMediaElement` `play`, `muted`, `volume` and `autoplay` so Reddit's own players follow the user's setting. It reads settings from the `<html data-rbe-video>` attribute, which `video.js` writes, and re-parses it only when the attribute changes.
- `video.js` handles offscreen pause and our own players. Reddit videos are HLS. hls.js (about 400 KB) is not in the manifest; `RBE.loadHls()` asks `background.js` to inject `vendor/hls.min.js` into the tab with `scripting.executeScript` on first use, and the viewer and image viewer warm it up when they open. If that fails, playback falls back to native HLS, then to the silent MP4 `fallback_url`. Call `RBE.destroyVideos(root)` before removing any of our UI that might hold videos.

**Viewer history**: opening the side panel or modal pushes a history entry, so the browser Back button closes it (the `popstate` handler in `viewer.js`). Closing it any other way pops that entry again.

## Testing

`test/offline.mjs` loads the built extension into Playwright's Chromium and answers every reddit.com request from fixtures: a small feed page, thread JSON with 61 comments and a "load more", and a video post. It checks the theme, quick bar, header gear, prefetch and cache behaviour, sanitizer output, load more, collapse, sort, `J`, `Esc`, video volume and live settings changes, and prints PASS/FAIL per check. When you add a feature, add a check here.

What it can't cover: Reddit's real markup (feed web components, shadow DOM players, header layout) and Firefox. After changes to selectors in `main.js`, `theme.js`, `navgear.js` or `spoilers.js`, check by hand on www.reddit.com in both browsers.

## Instagram extension (`instagram/`)

Same rules and shape as the Reddit one, with its own `manifest.base.json` (own `version`), `src/` and global `IGB` instead of `RBE`. `build.js` lists it as a second extension (for the tests); it has no background script. `instagram/README.md` describes the features and how they work.

- The userscript part comes from the manifest's script list plus `instagram/userscript/` (see "Userscript" below).
- Never send automated traffic to live Instagram from tests; extend the fixtures in `test/instagram-offline.mjs`.
- Instagram's class names are generated and change often. Find things by structure, ARIA attributes and geometry (`article`, `a[href*="/p/"]`, `aria-current="step"`, `elementsFromPoint`), never by class name or by English `aria-label` text.
- Feed videos sit inside an `<a href="/reels/…">` inside an `<article>`; grid previews are videos or images inside a link outside any `article`. `main-world.js`, `video.js` and `lightbox.js` all rely on that difference.

## X (`x/`)

Userscript only: there is no X extension build. `x/manifest.base.json` is just the list of scripts (main-world first, then content scripts and CSS in load order) plus the X part's `version`; `build.js` reads it like the others. Global `XBB`, files in `x/src/`, shim and panel in `x/userscript/`. `x/README.md` describes the features and how they work.

- Never send automated traffic to live X from tests; extend the fixtures in `test/x-offline.mjs`.
- Find things by `data-testid` and structure (`article[data-testid="tweet"]`, `[role="group"]`, `videoPlayer` > `videoComponent`), never by X's generated class names or English labels. The testids were checked against real x.com on 2026-11-11; the offline fixtures copy that shape.
- The script runs in the page's own JS world, so its own calls to `play()`, `muted` and `volume` go through the `main-world.js` patches too: a video it starts must carry `data-xbb-pick`, and `muted`/`volume` writes from it are ignored while native controls are on.
- GIFs are videos in the same `videoPlayer`; they are skipped by their `/tweet_video/` source or `loop` at first sight.

## Userscript (`dist/better-browsing.user.js`)

The one thing that is released: a single Tampermonkey/Violentmonkey script for Reddit, Instagram and X, built by `build.js`. Do not change its `@name` or `@namespace`: managers use them to tell scripts apart, and a new name would install next to the old one instead of updating it. Per site it takes the content scripts in manifest order (main-world files first), inserts a shim for the extension APIs right after `defaults.js`, and adds the popup form as an in-page panel. A new content script only needs adding to the manifest.

- Reddit: `userscript/reddit-shim.js` keeps `storage.sync`/`storage.local` in the page's localStorage, answers `rbe:loadHls` by running hls.js from inside the script (`RBE_LOAD_HLS`, a function so it's only parsed on first use), and sets `RBE.userscript` (account switching needs cookies, so its UI is hidden). `userscript/reddit-panel.js` mounts `popup.js` (`RBE.mountSettings(root, opts)`) in a shadow-DOM panel; the gear calls `RBE.openSettingsInPage`. Keep `popup.js` working on both `document` and a shadow root: look things up with its `$`/`$$`, not `document`.
- Instagram: `instagram/userscript/shim.js` and `panel.js`, same idea. X: `x/userscript/shim.js` and `panel.js` (settings kept under `xbb-userscript-settings`).
- `@version` is `<reddit version>.<instagram version>.<x version>.<userscriptRevision>` (`package.json`), so it goes up whenever any part's does. Bump `userscriptRevision` for script-only changes (header, `userscript/icon.svg`); set it back to 0 when bumping a part. (X's 1.0.0 was added as a new part before the revision, so the first three-part version, 1.3.9.1.6.6.1.0.0.0, is above the old 1.3.9.1.6.6.0.) Installed scripts check `@updateURL`, the `better-browsing.user.js` asset of the fixed GitHub release `userscript`. After a change to any part, run `npm run release:userscript` (`gh release upload userscript … --clobber`), or installed scripts won't see it.
- `npm test` and `npm run test:instagram` both run the userscript build too, in a browser without the extension; `npm run test:x` tests only the userscript.
- The userscript header says `@inject-into auto`, not `page`. Violentmonkey on Firefox cannot inline a `<script>` into a page whose CSP has a nonce (X, Reddit: `'unsafe-inline'` is ignored once a nonce is present), so `page` ended in "Could not inject some scripts" and the script never ran. With `auto` it falls back to its content realm, where `build.js`'s `runMain` hands the main-world hooks to the page as a `<script>` with a nonce read from one of the page's own scripts (`window.wrappedJSObject` marks that realm; in the page world the hooks just run). Checked in the real Zen 1.24 + Violentmonkey 2.50 with a throwaway profile (geckodriver, `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1`, install through the confirm page's Install button, probe scripts in `page`/`content`/`auto` mode): only `page` failed. `test/x-offline.mjs` fakes that realm and checks the nonce path.
- `videoPauseOnHide` (all three sites, default on): `document.hidden` (visibilitychange) or a window `blur` that leaves `document.hasFocus()` false pauses what plays; a `blurred` flag (set on blur, cleared on focus) stops anything starting meanwhile. A window that merely loaded unfocused plays as usual, since no blur event was seen. Reddit and Instagram do not resume afterwards; X's own pick logic does. The tests fake hidden/unfocused (`document.hidden`, `document.hasFocus`, events) in `test/lib/away.mjs` and `x-offline.mjs`.
- Firefox never shows the page a click on a video's own controls (no pointerdown/mousedown/click; only mouse moves, `focusin`, keys and user activation). Telling your play/pause from the page's own therefore also uses "pointer over that video + `navigator.userActivation.isActive`" (X's `video.js` and `main-world.js`). Don't rely on pointer events alone for that.
- Never let a `play()` through "for a while after any click" and remember it: X calls `play()` on its other videos after a click or key press, and a remembered allowance made X and our own pausing take turns in a tight loop (CPU spikes in Firefox). Allow only the pick or the video you are acting on.
