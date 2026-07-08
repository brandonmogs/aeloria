// Headless smoke test: loads the game, waits a few ticks, screenshots,
// and reports console errors + FPS. Usage: node scripts/smoke.mjs [url]
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5173';
const shot = process.argv[3] ?? 'scripts/shots/smoke.png';

const browser = await chromium.launch({
  channel: 'msedge',
  args: ['--use-angle=d3d11', '--window-size=1280,800'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});
page.on('pageerror', (err) => errors.push(String(err)));

await page.goto(url, { waitUntil: 'load' });
// Let the game boot and run a few ticks.
await page.waitForTimeout(4000);

// Sample FPS over 2 seconds using rAF.
const fps = await page.evaluate(
  () =>
    new Promise((resolve) => {
      let frames = 0;
      const start = performance.now();
      const loop = () => {
        frames++;
        if (performance.now() - start < 2000) requestAnimationFrame(loop);
        else resolve(Math.round((frames * 1000) / (performance.now() - start)));
      };
      requestAnimationFrame(loop);
    }),
);

await page.screenshot({ path: shot });
console.log(JSON.stringify({ fps, errors }, null, 2));
await browser.close();
process.exit(errors.length ? 1 : 0);
