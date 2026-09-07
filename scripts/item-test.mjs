// Verifies inventory item actions: eating bread heals, dropping an item puts
// it on the ground, the right-click slot menu shows Eat/Drop/Examine, and
// clicking the scimitar wields it (with the combat tab picking up the change).
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:2006';

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

// Starter kit layout: 0 scimitar, 1 shield, 2 axe, 3 pickaxe, 4 tinderbox,
// 5 net, 6 bread, 7 coins. Right-click the bread slot.
const slot = page.locator('#inventory-panel .inv-grid .slot').nth(6);
await slot.click({ button: 'right' });
const rows = await page.$$eval('#context-menu .ctx-row', (els) => els.map((e) => e.textContent));
await page.screenshot({ path: 'scripts/shots/item-menu.png' });

// Eat it.
await page.click('#context-menu .ctx-row >> nth=0');
const healed = await page
  .waitForFunction(() => window.__aeloria.player.hitpoints === 8, null, { timeout: 5000 })
  .then(() => true)
  .catch(() => false);
const breadGone = await page.evaluate(() => window.__aeloria.player.inventory.slots[6] === null);

// Drop the tinderbox (slot 4) and confirm a ground item appears under the player.
await page.locator('#inventory-panel .inv-grid .slot').nth(4).click({ button: 'right' });
await page.click('#context-menu .ctx-row >> nth=0'); // tinderbox has no Eat/Bury/Light, so row 0 = Drop
const dropped = await page
  .waitForFunction(() => window.__aeloria.world.groundItems.size === 1, null, { timeout: 5000 })
  .then(() => true)
  .catch(() => false);

// Wield the scimitar via a bare click and check the sim + combat tab agree.
await page.locator('#inventory-panel .inv-grid .slot').nth(0).click();
const wielded = await page
  .waitForFunction(
    () => window.__aeloria.player.inventory.equipment.weapon?.id === 'bronze_scimitar',
    null,
    { timeout: 5000 },
  )
  .then(() => true)
  .catch(() => false);
const combatTabWeapon = await page.evaluate(() => {
  document.querySelectorAll('#inventory-panel .inv-tab')[0].click();
  return document.querySelector('#inventory-panel .combat-weapon')?.textContent;
});

const logLines = await page.$$eval('#message-log .log-line', (els) => els.map((e) => e.textContent));

console.log(JSON.stringify({ rows, healed, breadGone, dropped, wielded, combatTabWeapon, logLines, errors }, null, 2));
await browser.close();
process.exit(
  errors.length || !healed || !breadGone || !dropped || !wielded || combatTabWeapon !== 'Bronze scimitar'
    ? 1
    : 0,
);
