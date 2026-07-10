// Verifies the NPC population, idle wandering, and goblin aggression.
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5173';

const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__aeloria !== undefined, null, { timeout: 15000 });

const census = await page.evaluate(() => {
  const byKind = {};
  for (const e of window.__aeloria.world.entities.values()) {
    if (e.kind) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
  }
  return byKind;
});

// Record NPC positions, wait ~15s of ticks, and check someone wandered.
const before = await page.evaluate(() => {
  const pos = {};
  for (const e of window.__aeloria.world.entities.values()) {
    if (e.kind) pos[e.id] = { x: e.position.x, y: e.position.y };
  }
  return pos;
});
await page.waitForTimeout(15000);
const wandered = await page.evaluate((prev) => {
  let moved = 0;
  for (const e of window.__aeloria.world.entities.values()) {
    if (!e.kind) continue;
    const p = prev[e.id];
    if (p && (p.x !== e.position.x || p.y !== e.position.y)) moved++;
  }
  return moved;
}, before);

// Aggression: walk the player next to the goblin camp and see if one attacks.
await page.evaluate(() => window.__aeloria.moveTo(21, 25));
const aggroed = await page
  .waitForFunction(
    () => {
      const pid = window.__aeloria.player.id;
      for (const e of window.__aeloria.world.entities.values()) {
        if (e.kind === 'goblin' && e.targetId === pid) return true;
      }
      return false;
    },
    null,
    { timeout: 30000 },
  )
  .then(() => true)
  .catch(() => false);

await page.mouse.move(640, 400);
for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -120);
await page.waitForTimeout(2500);
await page.screenshot({ path: 'scripts/shots/npc-aggro.png' });

console.log(JSON.stringify({ census, wandered, aggroed, errors }, null, 2));
await browser.close();
process.exit(errors.length || !aggroed ? 1 : 0);
