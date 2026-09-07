// The classic OSRS starter loop end-to-end: net a shrimp from a moat fishing
// spot, light a fire with the tinderbox, cook on it, and eat the result.
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

// Bulletproof the run: no retaliation detours, thick skin (goblins can barely
// scratch a level-40-defence fisher), and run enabled for the walks.
await page.evaluate((id) => {
  const a = window.__aeloria;
  a.player.skills.addXp('defense', a.xpForLevel(40));
  a.push({ type: 'setAutoRetaliate', entityId: id, on: false });
  a.push({ type: 'setRun', entityId: id, on: true });
}, pid);

// --- Fish -----------------------------------------------------------------
await page.evaluate(() => window.__aeloria.fish());
const caught = await page
  .waitForFunction(
    () => window.__aeloria.player.inventory.slots.some((s) => s && s.id === 'raw_shrimps'),
    null,
    { timeout: 90000 },
  )
  .then(() => true)
  .catch(() => false);

// --- Light a fire -----------------------------------------------------------
// Step onto open grass, then strike the tinderbox against a log.
await page.evaluate((id) => {
  const a = window.__aeloria;
  a.give('logs', 1);
  a.give('raw_shrimps', 7); // enough attempts that one always cooks
  const p = a.player.position;
  a.push({ type: 'move', entityId: id, target: { x: p.x, y: p.y - 2 } });
}, pid);
await page.waitForTimeout(2000);
await page.evaluate((id) => {
  const slot = window.__aeloria.player.inventory.slots.findIndex((s) => s && s.id === 'logs');
  window.__aeloria.push({ type: 'lightFire', entityId: id, slot });
}, pid);
const lit = await page
  .waitForFunction(() => window.__aeloria.world.fires.size > 0, null, { timeout: 30000 })
  .then(() => true)
  .catch(() => false);

// --- Cook -------------------------------------------------------------------
await page.evaluate((id) => {
  const fire = [...window.__aeloria.world.fires.values()][0];
  window.__aeloria.push({
    type: 'cook',
    entityId: id,
    fireId: fire.id,
    itemId: 'raw_shrimps',
  });
}, pid);
const cooked = await page
  .waitForFunction(
    () => window.__aeloria.player.inventory.slots.some((s) => s && s.id === 'shrimps'),
    null,
    { timeout: 90000 },
  )
  .then(() => true)
  .catch(() => false);

// --- Eat --------------------------------------------------------------------
await page.evaluate((id) => {
  window.__aeloria.player.hitpoints = 5;
  const slot = window.__aeloria.player.inventory.slots.findIndex((s) => s && s.id === 'shrimps');
  window.__aeloria.push({ type: 'useItem', entityId: id, slot });
}, pid);
const ate = await page
  .waitForFunction(() => window.__aeloria.player.hitpoints > 5, null, { timeout: 10000 })
  .then(() => true)
  .catch(() => false);

const xp = await page.evaluate(() => {
  const s = window.__aeloria.player.skills;
  return {
    fishing: s.xpOf('fishing'),
    firemaking: s.xpOf('firemaking'),
    cooking: s.xpOf('cooking'),
  };
});
await page.mouse.move(640, 400);
for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -120);
await page.waitForTimeout(400);
await page.screenshot({ path: 'scripts/shots/skilling-fire.png' });
const logLines = await page.$$eval('#message-log .log-line', (els) => els.map((e) => e.textContent));

console.log(JSON.stringify({ caught, lit, cooked, ate, xp, logLines, errors }, null, 2));
await browser.close();
process.exit(
  errors.length || !caught || !lit || !cooked || !ate || xp.fishing < 10 || xp.firemaking < 40 || xp.cooking < 30
    ? 1
    : 0,
);
