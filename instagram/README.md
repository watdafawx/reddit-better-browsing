# Instagram Better Browsing

Browser extension (Manifest V3, Chrome and Firefox) for instagram.com on desktop. It lives in this repo next to Reddit Better Browsing and is built by the same `build.js`.

## Features

- **Browser video controls on every post and reel video**: seek bar, time, volume, fullscreen, playback speed, picture-in-picture. Instagram's transparent overlay (its play button, mute button and tap handlers) is made click-through and hidden, and clicks on the controls no longer open the reel page.
- **Sound on by default** at your chosen volume (40% to start). Browsers only allow sound after you've clicked or pressed a key on the page once; until then videos play muted, and they unmute on that first click (a video that still comes up muted after that is unmuted within a second). Instagram mutes every video it plays; the extension ignores those page-made mutes and keeps your level. If you change the volume or mute on a video yourself, that sticks for that video. Modes: play with sound, always muted, no autoplay, or leave it to Instagram.
- Videos scrolled out of view pause, and videos loop (both optional).
- **Reels auto-scroll**: on the Reels tab, when a reel finishes the page scrolls to the next one, like the phone app's auto-scroll. Reels don't loop while it's on. The **Auto-scroll** button in the column of buttons beside the reel switches it (blue "Auto" when on).
- **Full captions on Reels**: the caption opens in full instead of one line with "… more". The caption, user and Follow button stay visible and clickable over the video with browser controls on.
- **Copy link for Discord** (link icon): copies `https://oginstagram.com/p/<code>/` (`/reel/` for reels), which Discord shows as an embed with the picture or a playable video. The domain is a setting (the popup suggests `oginstagram.com` — the fixer FixTweetBot uses — plus `vxinstagram.com`, `kkinstagram.com`, `ins.so`); embed fixers come and go (the original InstaFix, `ddinstagram.com`, was archived in 2026), so swap in another one if the preview stops showing.
- The buttons beside a post look like Instagram's own action buttons (bare line icons in the theme's colour) and stay up: they follow the mouse, and with the mouse elsewhere they sit next to the post or reel in the middle of the window.
- **Clickable links**: web addresses in captions and comments (`https://…`, `www.…`, `linktr.ee/…`, `bit.ly/…`) become links that open in a new tab. In the lightbox, @mentions and #hashtags are links too.
- **Not interested** (circle with a slash), the phone app's option: in the buttons beside a post or reel and in the lightbox. Instagram shows fewer posts like it; the feed post collapses, the Reels tab moves on to the next reel, the lightbox to the next post. The message at the bottom has Undo.
- **Fast lightbox** for profile, explore, tag and Reels-tab grids, and for photos in the home feed:
  - opens at once with the thumbnail already on the page, then swaps in the full-resolution image or the full MP4 (with audio, browser controls, your volume);
  - wheel or <kbd>←</kbd>/<kbd>→</kbd> go through a carousel's slides and on into the next posts; <kbd>↑</kbd>/<kbd>↓</kbd> jump by post;
  - the next two posts are fetched ahead, so stepping is instant;
  - user, date, the full caption, likes, comment count and download buttons sit in a panel beside the media (under it on windows narrower than 900px);
  - click a photo to see it at full size;
  - <kbd>Esc</kbd>, the browser Back button, or a click beside the media closes it. Ctrl/⌘/middle-click on a grid tile still opens Instagram's own page.
- Feed photos open in the lightbox on a single click; a double click still likes the post.
- Stories keep Instagram's own controls (tapping there means next/previous story).
- **Downloads**: hover a photo, video, reel or story and a column of buttons appears just right of it: **⤓** saves the current slide, **⤓ All** every slide in a carousel, **↗** opens the full-size file in a new tab. The lightbox has the same buttons, plus <kbd>D</kbd>. <kbd>Alt</kbd>+<kbd>S</kbd> saves the current story, lightbox item or whatever is under the mouse. Files come from the API at full quality and are named from a pattern you set (`{user}_{code}_{n}` by default; also `{date}`).

## Install

1. `npm run build`
2. Chrome: `chrome://extensions` → Developer mode → **Load unpacked** → pick `dist/instagram-chrome`.
   Firefox: `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → pick `dist/instagram-firefox/manifest.json`.

Settings: the toolbar popup, the **gear at the bottom of Instagram's left sidebar**, or <kbd>Alt</kbd>+<kbd>W</kbd> on any Instagram page. The gear and Alt+W open the same form in a panel over the page; <kbd>Esc</kbd> or a click outside closes it.

### Or as a userscript

One userscript covers Instagram and Reddit and updates itself: with Tampermonkey or Violentmonkey, open https://github.com/watdafawx/reddit-better-browsing/releases/download/userscript/better-browsing.user.js and click **Install** (see the main [README](../README.md#as-one-userscript-for-reddit-instagram-and-x-auto-updates)). `npm run build` writes it to `dist/better-browsing.user.js`. It runs in the page at document-start (`@grant none`) and keeps its settings in the page's localStorage; the sidebar gear and <kbd>Alt</kbd>+<kbd>W</kbd> open the settings panel. Use either the extension or the script, not both.

## How it works

- `main-world.js` runs in the page's own JS world and patches `HTMLMediaElement` (`play`, `muted`, `volume`, `autoplay`) so Instagram's player follows your audio setting. Settings arrive through the `<html data-igb-video>` attribute. A mute or volume change counts as yours only right after a click or key press on that video's own player.
- `content/video.js` turns on `controls`, finds the elements stacked over each on-screen video (`elementsFromPoint`) and marks the overlay subtree `igb-ov` (click-through and invisible via `content.css`). Feed videos are wrapped in a link to the reel; its `href` is parked in `data-igb-href` while controls are on.
- `content/downloads.js` finds the media under the mouse with `elementsFromPoint`, works out the post (article link, page URL, or the story id in `/stories/<user>/<id>/`) and fetches the file as a blob so it can be saved under the chosen name. If the CDN refuses, it opens the file instead.
- `content/settings.js` clones Instagram's Search entry in the sidebar into a gear entry (so it matches whatever layout Instagram is showing) and opens `popup/popup.html` in an iframe panel; the popup files are listed in `web_accessible_resources` for that.
- The userscript build adds `instagram/userscript/shim.js` (localStorage in place of `storage.sync`) and `panel.js` (the popup form in a shadow-DOM panel). `popup.js` exposes `IGB.mountSettings(root)` so both use the same form.
- `content/notinterested.js` sends `POST /api/v1/discover/explore_report/` with the media pk (`m_pk`) and the CSRF token from the cookie: the call behind Instagram's web hide-post option (`usePolarisHidePost`, shown only on suggested feed posts) and the phone app's "Not interested". Undo is `explore_report_undo`. The Reels tab URL follows the reel on screen, so that's where the reel's code comes from.
- `content/captions.js`: a collapsed Reels caption is a `role=button` holding a `white-space: nowrap` text span and an `aria-hidden` "… more" span that's visible only when text was cut; clicking it opens the caption in place, so the script clicks it. Links: text nodes under `main` and dialogs are split around web addresses. The original text node keeps the text before the first address, so React still owns the node it created.
- `video.js` treats a piece of the overlay that holds text, links or buttons (the Reels caption) as `igb-cap`: visible, links clickable, the rest click-through. Only empty layers get `igb-ov`.
- Reels auto-scroll (`content/video.js`): the Reels tab is one scroll-snap column. With the option on, reels there don't loop, and on `ended` of the reel on screen the next `<video>` is scrolled into view (or the column scrolls one reel down if the next isn't rendered yet).
- `content/lightbox.js` reads post data from `/api/v1/media/<id>/info/` (the same endpoint Instagram's web app uses, with the page's cookies), converting the shortcode in the URL to the numeric id. One request per post, cached for the page; failures are not cached.

## Test

`npm run test:instagram` (after `npm run build`) loads `dist/instagram-chrome` into Playwright's Chromium and answers every instagram.com request from fixtures in `test/instagram-offline.mjs`. It never contacts Instagram. What it can't cover: Instagram's real markup and Firefox. After changing the overlay or link handling in `video.js`, or the selectors in `lightbox.js`, check by hand on instagram.com.
