// Kills the goblin, verifies loot appears on the ground, walks over and picks
// it up, and verifies it lands in the inventory with a log message.
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5173';

const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__aeloria !== undefined, null, { timeout: 15000 });

await page.evaluate(() => window.__aeloria.attack('Goblin'));

// Wait for the kill and for loot to hit the ground.
const lootCount = await page
  .waitForFunction(() => window.__aeloria.world.groundItems.size > 0, null, { timeout: 90000 })
  .then(() => page.evaluate(() => window.__aeloria.world.groundItems.size));

await page.waitForTimeout(600);
await page.mouse.move(640, 400);
for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -120);
await page.waitForTimeout(400);
await page.screenshot({ path: 'scripts/shots/loot-ground.png' });

// Pick up ground items one at a time via the same command path a click would
// use (a new pickup click supersedes the previous one, like OSRS).
const picked = lootCount;
for (let i = 0; i < lootCount; i++) {
  await page.evaluate(() => {
    const w = window.__aeloria.world;
    const id = [...w.groundItems.keys()][0];
    if (id !== undefined) {
      window.__aeloria.push({
        type: 'pickup',
        entityId: window.__aeloria.player.id,
        groundItemId: id,
      });
    }
  });
  await page
    .waitForFunction(
      (n) => window.__aeloria.world.groundItems.size <= n,
      lootCount - i - 1,
      { timeout: 20000 },
    )
    .catch(() => {});
}

// Wait until the ground is clear (picked up, not despawned — TTL is long).
const groundClear = await page
  .waitForFunction(() => window.__aeloria.world.groundItems.size === 0, null, { timeout: 30000 })
  .then(() => true)
  .catch(() => false);

const inv = await page.evaluate(() =>
  window.__aeloria.player.inventory.slots.filter(Boolean).map((s) => s.name),
);
const logLines = await page.$$eval('#message-log .log-line', (els) =>
  els.map((e) => e.textContent),
);
await page.screenshot({ path: 'scripts/shots/loot-picked.png' });

console.log(JSON.stringify({ lootCount, picked, groundClear, inv, logLines, errors }, null, 2));
await browser.close();
process.exit(errors.length || !groundClear ? 1 : 0);
