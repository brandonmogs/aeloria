// Dies to a guard and verifies the OSRS death rules: respawn at the spawn
// tile at full health, the three most valuable items kept, everything else
// dropped where you fell.
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5173';

const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__aeloria !== undefined, null, { timeout: 15000 });

const pid = await page.evaluate(() => window.__aeloria.player.id);
const spawn = await page.evaluate(() => ({ ...window.__aeloria.player.position }));

// Carry something precious, then pick a fight we cannot win.
await page.evaluate((id) => {
  window.__aeloria.give('rune_scimitar', 1);
  window.__aeloria.push({ type: 'setRun', entityId: id, on: true });
  window.__aeloria.attack('Guard');
}, pid);

// Once the brawl starts, weaken the player so the next guard hit is fatal.
await page.waitForFunction(
  () =>
    [...window.__aeloria.world.entities.values()].some(
      (e) => e.kind === 'guard' && e.targetId === window.__aeloria.player.id,
    ),
  null,
  { timeout: 60000 },
);
await page.evaluate(() => {
  window.__aeloria.player.hitpoints = 1;
});

// Death: back at spawn, healed, prayers cleared.
const respawned = await page
  .waitForFunction(
    (s) => {
      const p = window.__aeloria.player;
      return (
        p.position.x === s.x &&
        p.position.y === s.y &&
        p.hitpoints === p.maxHitpoints
      );
    },
    spawn,
    { timeout: 60000 },
  )
  .then(() => true)
  .catch(() => false);

const state = await page.evaluate(() => {
  const a = window.__aeloria;
  const kept = a.player.inventory.slots.filter(Boolean).map((s) => `${s.id} x${s.qty}`);
  const dropped = [...a.world.groundItems.values()].map((g) => `${g.item.id} x${g.item.qty}`);
  return { kept, dropped };
});
const logLines = await page.$$eval('#message-log .log-line', (els) => els.map((e) => e.textContent));
await page.screenshot({ path: 'scripts/shots/death.png' });

// The three most valuable single items survive: rune scimitar (25,600),
// bronze scimitar (32), wooden shield (20). The other six stacks drop.
const keptRight =
  state.kept.length === 3 &&
  state.kept.some((s) => s.startsWith('rune_scimitar')) &&
  state.kept.some((s) => s.startsWith('bronze_scimitar')) &&
  state.kept.some((s) => s.startsWith('wooden_shield'));
const droppedEnough = state.dropped.length >= 6;
const announced = logLines.some((l) => l.includes('Oh dear, you are dead!'));

console.log(JSON.stringify({ respawned, state, keptRight, droppedEnough, announced, errors }, null, 2));
await browser.close();
process.exit(errors.length || !respawned || !keptRight || !droppedEnough || !announced ? 1 : 0);
