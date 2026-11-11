// Shared by the Reddit and Instagram tests: a playing <video> must pause when the tab is hidden or the window
// loses focus, and must not be started again meanwhile. (X has its own, longer tests for this.)
// "Hidden" and "unfocused" are faked: document.hidden / document.hasFocus() plus the visibilitychange / blur / focus events.
import fs from 'fs'; import path from 'path';
const CLIP = 'data:video/webm;base64,' + fs.readFileSync(path.resolve('test/fixtures/clip.webm')).toString('base64');

export async function awayChecks(page) {
  const out = {};
  const paused = () => page.evaluate(() => document.getElementById('awayv').paused);
  const play = () => page.evaluate(() => document.getElementById('awayv').play().then(() => true, () => false));
  const away = (kind, on) => page.evaluate(([kind, on]) => {
    if (kind === 'hidden') { Object.defineProperty(document, 'hidden', { configurable: true, get: () => on }); document.dispatchEvent(new Event('visibilitychange')); }
    else { document.hasFocus = () => !on; window.dispatchEvent(new Event(on ? 'blur' : 'focus')); }
  }, [kind, on]);
  await page.evaluate(src => {
    const v = document.createElement('video');
    v.id = 'awayv'; v.muted = true; v.loop = true; v.width = 320; v.height = 180; v.src = src;
    document.body.prepend(v);
  }, CLIP);
  await page.waitForTimeout(1500);   // the script finds new videos on its next DOM-change / interval scan
  for (const kind of ['hidden', 'blur']) {
    out[kind + 'Started'] = await play() && !(await paused());
    await away(kind, true);
    await page.waitForTimeout(600);
    out[kind + 'Paused'] = await paused();
    await play();                       // the site tries to start it while you are away
    await page.waitForTimeout(600);
    out[kind + 'StaysPaused'] = await paused();
    await away(kind, false);
  }
  return out;
}
export const awayOk = (name, o) => ({
  [name + ': a video pauses when the tab is hidden and nothing starts it meanwhile']: !!(o.hiddenStarted && o.hiddenPaused && o.hiddenStaysPaused),
  [name + ': a video pauses when the window loses focus and nothing starts it meanwhile']: !!(o.blurStarted && o.blurPaused && o.blurStaysPaused),
});
