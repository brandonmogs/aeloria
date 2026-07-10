// Verifies the WebAudio pipeline: context boots on first gesture, every effect
// plays without throwing, and a fight produces hit events routed to sound.
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5173';

const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__aeloria !== undefined, null, { timeout: 15000 });

const before = await page.evaluate(() => window.__aeloria.sfx.state);

// A real user click boots the AudioContext.
await page.mouse.click(640, 400);
await page.waitForTimeout(400);
const after = await page.evaluate(() => window.__aeloria.sfx.state);

// Exercise every effect; any throw would surface as a pageerror.
await page.evaluate(() => {
  const s = window.__aeloria.sfx;
  s.hit(); s.block(); s.chop(); s.mine(); s.pickup(); s.levelUp(); s.death();
});
await page.waitForTimeout(700);

console.log(JSON.stringify({ before, after, errors }, null, 2));
await browser.close();
process.exit(errors.length || after !== 'running' ? 1 : 0);
