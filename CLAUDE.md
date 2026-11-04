# CLAUDE.md

Browser extension (Manifest V3) for new Reddit, one codebase for Chrome and Firefox. A second, smaller extension for Instagram lives in `instagram/` (see the section at the end). Plain JavaScript, no framework, no bundler, no runtime dependencies. README.md has the user-facing feature list and the file layout.

## Commands

- `npm run build`: copies `src/` to `dist/chrome` and `dist/firefox`, writes each manifest from `manifest.base.json`, zips both. Also builds `instagram/src` into `dist/instagram-chrome`, `dist/instagram-firefox` and the userscript `dist/instagram-better-browsing.user.js`.
- `npm test`: offline Playwright smoke test of `dist/chrome` (build first). Needs `npx playwright install chromium` once.
- `npm run test:instagram`: the same for `dist/instagram-chrome` (`test/instagram-offline.mjs`).
- Syntax check without a browser: `for f in src/*.js src/content/*.js src/popup/*.js; do node --check "$f"; done`

## Rules

- Edit `src/` and `manifest.base.json` only. `dist/` is generated and gitignored.
- Both browsers run the same files. The only per-browser difference is the `background` entry (and the Firefox gecko id), added in `build.js`. Use `RBE.api` (`browser ?? chrome`), never `chrome.*` directly in content scripts.
- Never send automated traffic to live Reddit from tests. Reddit blocks headless browsers; don't spoof user agents or otherwise get around that. Extend the fixtures in `test/offline.mjs` instead.
- New permissions in `manifest.base.json` can make browsers prompt users or disable the extension on update. Prefer ones with no install warning (`scripting` and `storage` have none).
- Bump `version` in `manifest.base.json` and `package.json` together.

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

Same rules and shape as the Reddit one, with its own `manifest.base.json` (own `version`), `src/` and global `IGB` instead of `RBE`. `build.js` lists both extensions; the Instagram one has no background script. `instagram/README.md` describes the features and how they work.

- The userscript is assembled in `build.js` from the same files plus `instagram/userscript/`. A new content script must be added to both the manifest and that list.
- Never send automated traffic to live Instagram from tests; extend the fixtures in `test/instagram-offline.mjs`.
- Instagram's class names are generated and change often. Find things by structure, ARIA attributes and geometry (`article`, `a[href*="/p/"]`, `aria-current="step"`, `elementsFromPoint`), never by class name or by English `aria-label` text.
- Feed videos sit inside an `<a href="/reels/…">` inside an `<article>`; grid previews are videos or images inside a link outside any `article`. `main-world.js`, `video.js` and `lightbox.js` all rely on that difference.
