# CLAUDE.md

One userscript (`dist/better-browsing.user.js`, auto-updating) for new Reddit, Instagram and X, built by `build.js` from three parts, all plain JavaScript with no framework, no bundler and no runtime dependencies: Reddit in `src/`, Instagram in `instagram/src/`, X in `x/src/`, plus code all three share in `userscript/`. The parts were once browser extensions (Manifest V3); that history explains their shape (content scripts, a `world: "MAIN"` file, `<site>.api.storage`), but no extension is built any more. README.md has the user-facing feature list and the file layout.

## Commands

- `npm run build`: writes `dist/better-browsing.user.js` and prints its size.
- `npm test`, `npm run test:instagram`, `npm run test:x`: build, then the offline Playwright test of that site (`test/offline.mjs`, `test/instagram-offline.mjs`, `test/x-offline.mjs`). Needs `npm install` and `npx playwright install chromium firefox` once. `BROWSER=firefox` runs a test in Firefox (Reddit and Instagram: only their second part; the first always runs in Chromium).
- `npm run test:all`: every site in Chromium and Firefox (`test/all.mjs`). Run it before a release. It includes the CPU guards in `test/lib/perf.mjs` (nothing changes on an idle page by itself; the script adds little work on a page that keeps changing); keep them passing when adding a subscriber, timer or observer.
- Syntax check without a browser: `for f in src/*.js src/*/*.js instagram/src/*.js instagram/src/*/*.js x/src/*.js x/src/*/*.js userscript/*.js; do node --check "$f"; done`

## Rules

- Edit the sources only. `dist/` is generated and gitignored.
- Never send automated traffic to live Reddit, Instagram or X from tests. Reddit blocks headless browsers; don't spoof user agents or otherwise get around that. Extend the fixtures in the site's test instead.
- Each part's `manifest.base.json` is its script list (load order: the `world: "MAIN"` entry first, then content scripts and CSS) and its `version`. A change to a part bumps that part's version; Reddit's goes in `manifest.base.json` and `package.json` together. A new content script only needs adding to its manifest.

## Userscript (`build.js`)

- Do not change `@name` or `@namespace`: managers use them to tell scripts apart, and a new name would install next to the old one instead of updating it.
- Layout of the output: `userscript/run-main.js`, `store.js` and `panel.js` once at the top, then one block per site. Per site: its main-world files inside `runMain(...)`, its content scripts in manifest order with `<site>.api = bbStore(key)` right after `defaults.js`, its `popup/popup.js`, the panel (`bbPanel`), then its CSS in a `<style>`.
- `@version` is `<reddit version>.<instagram version>.<x version>.<userscriptRevision>` (`package.json`), so it goes up whenever any part's does. Bump `userscriptRevision` for script-only changes (header, `userscript/*`); set it back to 0 when bumping a part. (X's 1.0.0 was added as a new part before the revision, so the first three-part version, 1.3.9.1.6.6.1.0.0.0, is above the old 1.3.9.1.6.6.0.)
- Installed scripts check `@updateURL`, the `better-browsing.user.js` asset of the fixed GitHub release `userscript`. After a change to any part, run `npm run release:userscript` (`gh release upload userscript … --clobber`), or installed scripts won't see it.
- **Settings storage** (`userscript/store.js`): the page's localStorage, one key per site: `rbe-userscript-storage` (nested `{ sync, local }`), `igb-userscript-settings` and `xbb-userscript-settings` (flat sync area). Keep those keys and layouts, or users lose their settings. Each site's `core.js` also keeps a `<prefix>-settings-snapshot` so the theme applies on the first paint instead of after the async read.
- **Settings panel** (`userscript/panel.js`): each site's `popup/popup.html` (from `<header>` to `</main>`) and `popup.css` (`:root` → `:host`) in a shadow-DOM panel; `popup.js` mounts its form on that shadow root (`<site>.mountSettings(root)`). Look things up in `popup.js` through the root (`$`/`$$`), never `document`. Reddit's gear and quick bar ⚙️ call `RBE.openSettingsInPage`; Instagram and X use `<site>.openSettings` (sidebar gear, Alt+W). The panel handles Esc and keeps the site's key handlers away from its fields.
- The header says `@inject-into auto`, not `page`. Violentmonkey on Firefox cannot inline a `<script>` into a page whose CSP has a nonce (X, Reddit: `'unsafe-inline'` is ignored once a nonce is present), so `page` ended in "Could not inject some scripts" and the script never ran. With `auto` it falls back to its content realm, where `runMain` hands the main-world hooks to the page as a `<script>` with a nonce read from one of the page's own scripts (`window.wrappedJSObject` marks that realm; in the page world the hooks just run). Checked in the real Zen 1.24 + Violentmonkey 2.50 with a throwaway profile (geckodriver, `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1`, install through the confirm page's Install button, probe scripts in `page`/`content`/`auto` mode): only `page` failed. `test/x-offline.mjs` fakes that realm and checks the nonce path.
- `videoPauseOnHide` (all three sites, default on): `document.hidden` (visibilitychange) or a window `blur` that leaves `document.hasFocus()` false pauses what plays; a `blurred` flag (set on blur, cleared on focus) stops anything starting meanwhile. A window that merely loaded unfocused plays as usual, since no blur event was seen. Reddit and Instagram do not resume afterwards; X's own pick logic does. The tests fake hidden/unfocused (`document.hidden`, `document.hasFocus`, events) in `test/lib/away.mjs` and `x-offline.mjs`.
- Firefox never shows the page a click on a video's own controls (no pointerdown/mousedown/click; only mouse moves, `focusin`, keys and user activation). Telling your play/pause from the page's own therefore also uses "pointer over that video + `navigator.userActivation.isActive`" (X's `video.js` and `main-world.js`). Don't rely on pointer events alone for that.
- Never let a `play()` through "for a while after any click" and remember it: X calls `play()` on its other videos after a click or key press, and a remembered allowance made X and our own pausing take turns in a tight loop (CPU spikes in Firefox). Allow only the pick or the video you are acting on.

## Reddit (`src/`)

**Load order** is the `content_scripts` list in `manifest.base.json`. Every content script is an IIFE that hangs its API on the shared `RBE` global created in `defaults.js`. Later files may call earlier ones at load time; calls the other way must happen at runtime (for example `RBE.openLightbox?.()`).

**Settings**: `storage.sync` key `settings` (merged over `RBE.DEFAULTS`), plus `storage.local` key `customCss`. `core.js` keeps `RBE.settings` current and calls every `RBE.onSettings(fn)` subscriber on load and on change. Code that writes settings reads `settings` from sync, changes it, and writes it back (see `patch()` in `quickbar.js`).

**Reacting to Reddit's DOM**: use `RBE.onDomChange(fn, delayMs)` from `core.js`. It is one shared `MutationObserver`, throttled per subscriber. Don't add new whole-document observers.

**Fetching**: always `RBE.getJSON(path)`. In a Firefox content realm it uses the page's `content.fetch` so cookies and CORS behave like Reddit's own requests.
- Post data: `RBE.getPosts(ids)` / `RBE.getPost(id)` in `media.js`. Batches up to 50 ids through `/api/info.json`, falls back to `/by_id/`, then to one `/comments/<id>.json` per post, three at a time. Results are cached per page.
- Threads: `loadThread()` in `viewer.js`. A 90 s cache shared by the viewer, the inline view and the image viewer's comment panel. Failed requests are never cached. Hovering a post for 300 ms, or pressing on it, prefetches its thread, with at most one hover prefetch in flight to stay clear of Reddit's rate limit. If you change the thread URL (`jsonUrl()`), prefetch and viewer must keep building it the same way or the cache stops hitting.
- Avatars: user pictures are batched (`/api/user_data_by_account_ids.json`, 100 per request); subreddit icons come from post data (`sr_detail`) or a cached `about.json`.

**Untrusted HTML**: anything from Reddit's API goes through `RBE.sanitize()` (allowlisted tags and attributes, image hosts limited to Reddit/imgur/giphy, `javascript:`/`data:` links removed) before it touches `innerHTML`. Build other DOM with `RBE.h(tag, props, ...children)`.

**Video** is split across two worlds:
- `main-world.js` runs in the page's JS world and patches `HTMLMediaElement` `play`, `muted`, `volume` and `autoplay` so Reddit's own players follow the user's setting. It reads settings from the `<html data-rbe-video>` attribute, which `video.js` writes, and re-parses it only when the attribute changes.
- `video.js` handles offscreen pause and our own players. Reddit videos are HLS, with the sound in a separate audio rendition (so hls.js's light build, which drops alternate audio, would play them silent). hls.js (about 400 KB, `src/vendor/hls.min.js`) sits in the function `RBE_LOAD_HLS` (added by `build.js`), run by `RBE.loadHls()` on first use; the viewer and image viewer warm it up when they open. If that fails, playback falls back to native HLS, then to the silent MP4 `fallback_url`. Call `RBE.destroyVideos(root)` before removing any of our UI that might hold videos.

**Viewer history**: opening the side panel or modal pushes a history entry, so the browser Back button closes it (the `popstate` handler in `viewer.js`). Closing it any other way pops that entry again.

**Testing**: `test/offline.mjs` answers every reddit.com request from fixtures: a small feed page, thread JSON with 61 comments and a "load more", and a video post. It checks the theme, quick bar, header gear, prefetch and cache behaviour, sanitizer output, load more, collapse, sort, `J`, `Esc`, video volume, live settings changes and the settings panel, and prints PASS/FAIL per check. When you add a feature, add a check here. What it can't cover: Reddit's real markup (feed web components, shadow DOM players, header layout). After changes to selectors in `main.js`, `theme.js`, `navgear.js` or `spoilers.js`, check by hand on www.reddit.com in both browsers.

## Instagram (`instagram/`)

Same shape as Reddit, with global `IGB` instead of `RBE`. `instagram/README.md` describes the features and how they work.

- Instagram's class names are generated and change often. Find things by structure, ARIA attributes and geometry (`article`, `a[href*="/p/"]`, `aria-current="step"`, `elementsFromPoint`), never by class name or by English `aria-label` text.
- Feed videos sit inside an `<a href="/reels/…">` inside an `<article>`; grid previews are videos or images inside a link outside any `article`. `main-world.js`, `video.js` and `lightbox.js` all rely on that difference.

## X (`x/`)

Same shape, global `XBB`. `x/README.md` describes the features and how they work.

- Find things by `data-testid` and structure (`article[data-testid="tweet"]`, `[role="group"]`, `videoPlayer` > `videoComponent`), never by X's generated class names or English labels. The testids were checked against real x.com on 2026-11-11; the offline fixtures copy that shape.
- The script runs in the page's own JS world, so its own calls to `play()`, `muted` and `volume` go through the `main-world.js` patches too: a video it starts must carry `data-xbb-pick`, and `muted`/`volume` writes from it are ignored while native controls are on.
- GIFs are videos in the same `videoPlayer`; they are skipped by their `/tweet_video/` source or `loop` at first sight.
