// The character screen: it opens on a first visit; the player picks a race
// and a sex, a face preset, moves a slider, types a name, and the world
// starts with that look. The saved look skips the screen next time, and
// ?create brings it back. Writes scripts/shots/creator-*.png.
// Usage: node scripts/creator-test.mjs [url]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:2006';
mkdirSync('scripts/shots', { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11', '--window-size=1280,800'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));

const failures = [];
const check = (ok, what) => {
  if (!ok) failures.push(what);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};
const screenReady = () => page.waitForFunction(() => window.__creator?.ready === true, null, { timeout: 60000 });
const worldReady = () => page.waitForFunction(() => window.__aeloria?.player !== undefined, null, { timeout: 90000 });
const look = () => page.evaluate(() => window.__creator.look);

// A first visit opens the screen.
await page.goto(url, { waitUntil: 'load' });
await screenReady();
check((await page.$('.creator')) !== null, 'the character screen opens on a first visit');
await page.screenshot({ path: 'scripts/shots/creator-first.png' });

// Race and sex rebuild the figure; a preset sets its sliders.
await page.click('.creator-race[data-race="elf"]');
await page.click('.creator-sex[data-sex="female"]');
await screenReady();
let l = await look();
check(l.race === 'elf' && l.sex === 'female', 'the race and sex buttons change the look');
await page.click('.creator-preset[data-preset="sharp"]');
await screenReady();
l = await look();
check((l.morphs.cheekbones ?? 0) > 0, 'a face preset sets its sliders');

// A slider on the face tab.
await page.click('.creator-tab[data-tab="face"]');
await page.click('.creator-group[data-group="eyes"] summary');
await page.waitForSelector('.morph-slider[data-id="eyeSize"]');
await page.$eval('.morph-slider[data-id="eyeSize"]', (el) => {
  el.value = '0.8';
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
await screenReady();
l = await look();
check(Math.abs((l.morphs.eyeSize ?? 0) - 0.8) < 1e-6, 'a slider writes its value into the look');
await page.waitForTimeout(400);
await page.screenshot({ path: 'scripts/shots/creator-face.png' });

// The style tab: a makeup slider and a scar choice write into the look.
await page.click('.creator-tab[data-tab="style"]');
await page.waitForSelector('.style-slider[data-style="lips"]');
await page.$eval('.style-slider[data-style="lips"]', (el) => {
  el.value = '0.7';
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.click('.creator-scar[data-scar="cheek"]');
await screenReady();
l = await look();
check(Math.abs(l.lips - 0.7) < 1e-6 && l.scar === 'cheek', 'the style tab writes makeup and marks into the look');
await page.waitForTimeout(400);
await page.screenshot({ path: 'scripts/shots/creator-style.png' });

// Hair, then the name, then into the world.
await page.click('.creator-tab[data-tab="hair"]');
await page.click('.creator-hair[data-hair="short"]');
await screenReady();
await page.fill('#creator-name', 'Lysara');
await page.click('.creator-enter');
await worldReady();
check((await page.$('.creator')) === null, 'the screen comes down on entering');
const name = await page.evaluate(() => window.__aeloria.player.name);
check(name === 'Lysara', `the player carries the chosen name (${name})`);
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('aeloria.appearance') ?? 'null'));
check(saved?.race === 'elf' && saved?.sex === 'female' && saved?.hair === 'short' && saved?.scar === 'cheek' && Math.abs((saved?.lips ?? 0) - 0.7) < 1e-6 && Math.abs((saved?.morphs?.eyeSize ?? 0) - 0.8) < 1e-6, 'the look is saved for next time');
await page.waitForTimeout(2500);
await page.screenshot({ path: 'scripts/shots/creator-world.png' });

// A return visit goes straight into the world; ?create reopens the screen with the saved look.
await page.goto(url, { waitUntil: 'load' });
await worldReady();
check((await page.$('.creator')) === null, 'a return visit skips the screen');
await page.goto(`${url}/?create`, { waitUntil: 'load' });
await screenReady();
l = await look();
check(l.name === 'Lysara' && l.race === 'elf' && l.hair === 'short', '?create reopens the screen with the saved look');

console.log(JSON.stringify({ failures, errors: errors.slice(0, 10) }, null, 2));
await browser.close();
process.exit(failures.length || errors.length ? 1 : 0);
