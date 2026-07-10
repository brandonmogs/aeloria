// Chops a tree and mines a rock via the debug handle; verifies items, XP,
// depletion (stump) and regrowth.
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5173';

const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__aeloria !== undefined, null, { timeout: 15000 });

// Find the tree nearest to the player and chop it.
const treeTile = await page.evaluate(() => {
  const { world, player } = window.__aeloria;
  let best = null;
  let bestD = Infinity;
  for (const n of world.resourceNodes.values()) {
    if (n.kind !== 'tree' || n.regrowTimer > 0) continue;
    const d = Math.abs(n.tile.x - player.position.x) + Math.abs(n.tile.y - player.position.y);
    if (d < bestD) {
      bestD = d;
      best = n.tile;
    }
  }
  window.__aeloria.gather(best.x, best.y);
  return best;
});

// Wait for logs to arrive, re-clicking the tree if a goblin interrupts us
// (aggro cancels gathering, like OSRS — a player would just click again).
let gotLogs = false;
for (let i = 0; i < 20 && !gotLogs; i++) {
  await page.evaluate((t) => {
    const p = window.__aeloria.player;
    if (p.gatherTarget === null && p.targetId === null) {
      window.__aeloria.gather(t.x, t.y);
    }
  }, treeTile);
  gotLogs = await page
    .waitForFunction(
      () => window.__aeloria.player.inventory.slots.filter((s) => s && s.id === 'logs').length >= 2, // starter kit has 1; +1 chopped
      null,
      { timeout: 5000 },
    )
    .then(() => true)
    .catch(() => false);
}

// The tree should now be depleted (stump) — check the sim node.
const treeDepleted = await page.evaluate(
  (t) => {
    for (const n of window.__aeloria.world.resourceNodes.values()) {
      if (n.tile.x === t.x && n.tile.y === t.y) return n.regrowTimer > 0;
    }
    return false;
  },
  treeTile,
);
await page.mouse.move(640, 400);
for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -120);
await page.waitForTimeout(300);
await page.screenshot({ path: 'scripts/shots/gather-stump.png' });

// Now mine the nearest rock, with the same re-click-on-interrupt patience.
let gotOre = false;
for (let i = 0; i < 25 && !gotOre; i++) {
  await page.evaluate(() => {
    const { world, player } = window.__aeloria;
    if (player.gatherTarget !== null || player.targetId !== null) return;
    let best = null;
    let bestD = Infinity;
    for (const n of world.resourceNodes.values()) {
      if (n.kind !== 'rock' || n.regrowTimer > 0) continue;
      const d = Math.abs(n.tile.x - player.position.x) + Math.abs(n.tile.y - player.position.y);
      if (d < bestD) {
        bestD = d;
        best = n.tile;
      }
    }
    if (best) window.__aeloria.gather(best.x, best.y);
  });
  gotOre = await page
    .waitForFunction(
      () => window.__aeloria.player.inventory.slots.some((s) => s && s.id === 'copper_ore'),
      null,
      { timeout: 5000 },
    )
    .then(() => true)
    .catch(() => false);
}
await page.screenshot({ path: 'scripts/shots/gather-mining.png' });

const state = await page.evaluate(() => {
  const p = window.__aeloria.player;
  return {
    wcXp: p.skills.xpOf('woodcutting'),
    miningXp: p.skills.xpOf('mining'),
    items: p.inventory.slots.filter(Boolean).map((s) => s.name),
  };
});
const logLines = await page.$$eval('#message-log .log-line', (els) => els.map((e) => e.textContent));

console.log(JSON.stringify({ gotLogs, treeDepleted, gotOre, state, logLines, errors }, null, 2));
await browser.close();
process.exit(errors.length || !gotLogs || !gotOre ? 1 : 0);
