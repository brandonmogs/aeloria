// The content wave: wiki-typed equipment bonuses, smelting at the furnace and
// smithing at the anvil, oak trees gated by level, rod-and-bait fishing, the
// full prayer book, and the spellbook.
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:2006';

const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__aeloria !== undefined, null, { timeout: 15000 });
const pid = await page.evaluate(() => window.__aeloria.player.id);
await page.evaluate((id) => {
  const a = window.__aeloria;
  a.push({ type: 'setAutoRetaliate', entityId: id, on: false });
  a.push({ type: 'setRun', entityId: id, on: true });
  a.player.skills.addXp('defense', a.xpForLevel(40)); // shrug off wandering goblins
}, pid);

// Typed bonuses: the bronze scimitar's wiki line is +1/+7/-2 attack, +6 strength.
const bonuses = await page.evaluate((id) => {
  const a = window.__aeloria;
  const slot = a.player.inventory.slots.findIndex((s) => s && s.id === 'bronze_scimitar');
  a.push({ type: 'equipItem', entityId: id, slot });
  return new Promise((resolve) =>
    setTimeout(() => resolve(a.player.inventory.equipmentBonuses()), 900),
  );
}, pid);
await page.keyboard.press('F5');
await page.waitForTimeout(300);
const statsText = await page.evaluate(() => document.querySelector('#inventory-panel .equip-stats')?.textContent ?? '');
await page.screenshot({ path: 'scripts/shots/equipment-stats.png' });

// Smelt a bronze bar at the furnace, then hammer it into a dagger at the anvil.
await page.evaluate((id) => {
  const a = window.__aeloria;
  a.give('copper_ore', 2);
  a.give('tin_ore', 2);
  a.give('hammer', 1);
  const furnace = a.interactables().find((i) => i.kind === 'furnace');
  a.push({ type: 'interact', entityId: id, kind: 'furnace', target: furnace.tile });
}, pid);
const smelted = await page
  .waitForFunction(() => window.__aeloria.player.inventory.countOf('bronze_bar') >= 2, null, { timeout: 90000 })
  .then(() => true)
  .catch(() => false);
await page.evaluate((id) => {
  const a = window.__aeloria;
  const anvil = a.interactables().find((i) => i.kind === 'anvil');
  a.push({ type: 'interact', entityId: id, kind: 'anvil', target: anvil.tile });
}, pid);
const anvilOpened = await page
  .waitForFunction(() => window.__aeloria.smithingIsOpen(), null, { timeout: 60000 })
  .then(() => true)
  .catch(() => false);
await page.screenshot({ path: 'scripts/shots/smithing.png' });
await page.evaluate((id) => window.__aeloria.push({ type: 'smith', entityId: id, item: 'bronze_dagger', count: 1 }), pid);
const smithed = await page
  .waitForFunction(() => window.__aeloria.player.inventory.countOf('bronze_dagger') >= 1, null, { timeout: 30000 })
  .then(() => true)
  .catch(() => false);
const smithingXp = await page.evaluate(() => window.__aeloria.player.skills.xpOf('smithing'));

// An oak refuses a level-1 woodcutter, then yields oak logs at 15.
const oak = await page.evaluate(() => {
  const { world } = window.__aeloria;
  for (const n of world.resourceNodes.values()) if (n.kind === 'tree' && n.variant === 'oak') return { id: n.id, tile: n.tile };
  return null;
});
await page.evaluate((o) => window.__aeloria.push({ type: 'gather', entityId: window.__aeloria.player.id, nodeId: o.id }), oak);
await page.waitForTimeout(800);
const refused = await page.$$eval('#message-log .log-line', (els) => els.some((e) => e.textContent.includes('Woodcutting level of 15')));
await page.evaluate((o) => {
  const a = window.__aeloria;
  a.player.skills.addXp('woodcutting', a.xpForLevel(15));
  a.push({ type: 'gather', entityId: a.player.id, nodeId: o.id });
}, oak);
let oakLogs = false;
for (let i = 0; i < 12 && !oakLogs; i++) {
  await page.evaluate((o) => {
    const a = window.__aeloria;
    if (a.player.gatherTarget === null && a.player.targetId === null) a.push({ type: 'gather', entityId: a.player.id, nodeId: o.id });
  }, oak);
  oakLogs = await page
    .waitForFunction(() => window.__aeloria.player.inventory.countOf('oak_logs') > 0, null, { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
}

// Rod and bait at a moat spot: sardines from level 5.
await page.evaluate(() => {
  const a = window.__aeloria;
  a.player.skills.addXp('fishing', a.xpForLevel(5));
  a.give('fishing_rod', 1);
  a.give('fishing_bait', 20);
  for (const n of a.world.resourceNodes.values()) {
    if (n.kind === 'fishing_spot') {
      a.push({ type: 'gather', entityId: a.player.id, nodeId: n.id, method: 'bait' });
      return;
    }
  }
});
let sardine = false;
for (let i = 0; i < 12 && !sardine; i++) {
  await page.evaluate(() => {
    const a = window.__aeloria;
    if (a.player.gatherTarget === null && a.player.targetId === null) {
      for (const n of a.world.resourceNodes.values()) {
        if (n.kind === 'fishing_spot') {
          a.push({ type: 'gather', entityId: a.player.id, nodeId: n.id, method: 'bait' });
          return;
        }
      }
    }
  });
  sardine = await page
    .waitForFunction(() => window.__aeloria.player.inventory.countOf('raw_sardine') > 0, null, { timeout: 10000 })
    .then(() => true)
    .catch(() => false);
}
const baitLeft = await page.evaluate(() => window.__aeloria.player.inventory.countOf('fishing_bait'));

// The prayer book and spellbook.
await page.keyboard.press('F6');
await page.waitForTimeout(200);
const prayers = await page.$$eval('#inventory-panel .prayer-cell', (els) => els.length);
await page.keyboard.press('F7');
await page.waitForTimeout(200);
const spells = await page.$$eval('#inventory-panel .spell', (els) => els.length);
await page.screenshot({ path: 'scripts/shots/spellbook.png' });

const logLines = await page.$$eval('#message-log .log-line', (els) => els.map((e) => e.textContent));
console.log(JSON.stringify({ bonuses, statsText, smelted, anvilOpened, smithed, smithingXp, refused, oakLogs, sardine, baitLeft, prayers, spells, logLines, errors }, null, 2));
await browser.close();

const ok =
  !errors.length &&
  bonuses.aslash === 7 &&
  bonuses.astab === 1 &&
  bonuses.str === 6 &&
  statsText.includes('Slash: +7') &&
  smelted &&
  anvilOpened &&
  smithed &&
  smithingXp >= 12.4 + 12.4 &&
  refused &&
  oakLogs &&
  sardine &&
  baitLeft < 20 &&
  prayers === 29 &&
  spells === 40;
process.exit(ok ? 0 : 1);
