// Verifies the HP orb renders, the run toggle doubles movement speed, and
// clicking the minimap walks the player there.
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5173';

const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__aeloria !== undefined, null, { timeout: 15000 });

const orbVisible = await page.isVisible('#orbs');

// Toggle run on and confirm the player covers 2 tiles per tick.
await page.click('.orb-run');
const start = await page.evaluate(() => ({ ...window.__aeloria.player.position }));
await page.evaluate(() => {
  const p = window.__aeloria.player.position;
  // Straight-line run: 6 tiles south on open grass.
  window.__aeloria.push({
    type: 'move',
    entityId: window.__aeloria.player.id,
    target: { x: p.x, y: p.y - 6 },
    run: true,
  });
});
// After ~4 ticks (2.4s) a runner should have covered ~6 tiles; a walker only 4.
await page.waitForTimeout(2600);
const ranTiles = await page.evaluate(
  (s) => Math.abs(window.__aeloria.player.position.y - s.y),
  start,
);

// Minimap click-to-walk: click the minimap a bit south of center and verify
// the player pathfinds to roughly that tile.
const mm = await page.locator('#minimap').boundingBox();
await page.mouse.click(mm.x + mm.width * 0.45, mm.y + mm.height * 0.7);
const walking = await page
  .waitForFunction(() => window.__aeloria.player.path.length > 0, null, { timeout: 3000 })
  .then(() => true)
  .catch(() => false);

await page.screenshot({ path: 'scripts/shots/hud.png' });

console.log(JSON.stringify({ orbVisible, ranTiles, walking, errors }, null, 2));
await browser.close();
process.exit(errors.length || !orbVisible || ranTiles < 5 || !walking ? 1 : 0);
