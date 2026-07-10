// Verifies inventory item actions: eating bread heals, dropping an item puts
// it on the ground, and the right-click slot menu shows Eat/Drop/Examine.
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5173';

const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__aeloria !== undefined, null, { timeout: 15000 });

// Hurt the player so eating has something to heal (sim-side poke is fine for tests).
await page.evaluate(() => {
  window.__aeloria.player.hitpoints = 3;
});

// Right-click the bread slot (index 10) in the inventory panel.
const slot = page.locator('#inventory-panel .inv-grid .slot').nth(10);
await slot.click({ button: 'right' });
const rows = await page.$$eval('#context-menu .ctx-row', (els) => els.map((e) => e.textContent));
await page.screenshot({ path: 'scripts/shots/item-menu.png' });

// Eat it.
await page.click('#context-menu .ctx-row >> nth=0');
const healed = await page
  .waitForFunction(() => window.__aeloria.player.hitpoints === 8, null, { timeout: 5000 })
  .then(() => true)
  .catch(() => false);
const breadGone = await page.evaluate(() => window.__aeloria.player.inventory.slots[10] === null);

// Drop the logs (slot 9) and confirm a ground item appears under the player.
await page.locator('#inventory-panel .inv-grid .slot').nth(9).click({ button: 'right' });
await page.click('#context-menu .ctx-row >> nth=0'); // logs have no Eat, so row 0 = Drop
const dropped = await page
  .waitForFunction(() => window.__aeloria.world.groundItems.size === 1, null, { timeout: 5000 })
  .then(() => true)
  .catch(() => false);

const logLines = await page.$$eval('#message-log .log-line', (els) => els.map((e) => e.textContent));

console.log(JSON.stringify({ rows, healed, breadGone, dropped, logLines, errors }, null, 2));
await browser.close();
process.exit(errors.length || !healed || !breadGone || !dropped ? 1 : 0);
