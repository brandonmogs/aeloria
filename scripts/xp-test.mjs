// Verifies XP drops, the message log, and (by grinding kills) the level-up
// banner. Uses the __aeloria debug handle to drive fights.
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5173';

const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__aeloria !== undefined, null, { timeout: 15000 });

// Cheat the player close to a level-up so one fight triggers the banner.
await page.evaluate(() => {
  const p = window.__aeloria.player;
  const { xpForLevel } = window.__aeloria;
  // addXp is available on the skills object; push attack to 1 xp below next level.
  const cur = p.skills.xpOf('attack');
  const level = p.skills.levelOf('attack');
  p.skills.addXp('attack', Math.max(0, window.__aeloria.xpForLevel(level + 1) - cur - 1));
});

await page.evaluate(() => window.__aeloria.attack('Goblin'));

// Wait for the first XP drop to appear.
const sawDrop = await page
  .waitForSelector('.xp-drop', { timeout: 30000 })
  .then(() => true)
  .catch(() => false);
await page.screenshot({ path: 'scripts/shots/xp-drop.png' });

// Wait for the level-up banner.
const sawBanner = await page
  .waitForSelector('.levelup-banner', { timeout: 45000 })
  .then(() => true)
  .catch(() => false);
await page.screenshot({ path: 'scripts/shots/levelup.png' });

const logLines = await page.$$eval('#message-log .log-line', (els) =>
  els.map((e) => e.textContent),
);

console.log(JSON.stringify({ sawDrop, sawBanner, logLines, errors }, null, 2));
await browser.close();
process.exit(errors.length || !sawDrop ? 1 : 0);
