// Attack styles route XP (aggressive trains Strength), bones bury for Prayer
// XP, the altar recharges points, Protect from Melee blocks a guard's hits,
// and active prayers drain points on the OSRS curve.
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

// Fight on the aggressive style (unarmed "Kick") with retaliation off so
// wandering goblins can't hijack our later walks.
await page.evaluate((id) => {
  window.__aeloria.push({ type: 'setStyle', entityId: id, index: 1 });
  window.__aeloria.push({ type: 'setAutoRetaliate', entityId: id, on: false });
  window.__aeloria.push({ type: 'setRun', entityId: id, on: true });
}, pid);
await page.evaluate(() => window.__aeloria.attack('Goblin'));

const styleXp = await page
  .waitForFunction(
    () => window.__aeloria.player.skills.xpOf('strength') > 0,
    null,
    { timeout: 60000 },
  )
  .then(() =>
    page.evaluate(() => ({
      strength: window.__aeloria.player.skills.xpOf('strength'),
      attack: window.__aeloria.player.skills.xpOf('attack'),
    })),
  )
  .catch(() => null);

// Bury a bone for Prayer XP.
await page.evaluate((id) => {
  window.__aeloria.give('bones', 2);
  const slot = window.__aeloria.player.inventory.slots.findIndex((s) => s && s.id === 'bones');
  window.__aeloria.push({ type: 'useItem', entityId: id, slot });
}, pid);
const buried = await page
  .waitForFunction(() => window.__aeloria.player.skills.xpOf('prayer') >= 4, null, { timeout: 10000 })
  .then(() => true)
  .catch(() => false);

// Jump Prayer to 43 (Protect from Melee), then recharge at the altar — points
// stay at the old maximum until you pray at one.
await page.evaluate((id) => {
  const a = window.__aeloria;
  a.player.skills.addXp('prayer', a.xpForLevel(43));
  a.push({ type: 'interact', entityId: id, kind: 'altar', target: { x: 27, y: 43 } });
}, pid);
const recharged = await page
  .waitForFunction(() => window.__aeloria.player.prayerPoints >= 43, null, { timeout: 90000 })
  .then(() => true)
  .catch(() => false);

// Protect from Melee on, then pick a fight with a guard and take no damage.
await page.evaluate((id) => {
  window.__aeloria.push({ type: 'togglePrayer', entityId: id, prayerId: 'protect_from_melee' });
}, pid);
await page.waitForTimeout(1000);
const protectActive = await page.evaluate(() =>
  window.__aeloria.player.activePrayers.has('protect_from_melee'),
);
const hpBefore = await page.evaluate(() => (window.__aeloria.player.hitpoints = window.__aeloria.player.maxHitpoints));
await page.evaluate(() => window.__aeloria.attack('Guard'));

// Wait until the guard has had time to land several would-be hits.
await page.waitForTimeout(15000);
const after = await page.evaluate(() => ({
  hp: window.__aeloria.player.hitpoints,
  maxHp: window.__aeloria.player.maxHitpoints,
  points: window.__aeloria.player.prayerPoints,
  guardFighting: [...window.__aeloria.world.entities.values()].some(
    (e) => e.kind === 'guard' && e.targetId === window.__aeloria.player.id,
  ),
}));
const protectHeld = after.hp === after.maxHp && after.guardFighting;
const drained = after.points < 43; // Protect drains ~a point per 3s

const logLines = await page.$$eval('#message-log .log-line', (els) => els.map((e) => e.textContent));

console.log(
  JSON.stringify({ styleXp, buried, recharged, protectActive, after, protectHeld, drained, logLines, errors }, null, 2),
);
await browser.close();
process.exit(
  errors.length ||
    !styleXp ||
    styleXp.attack !== 0 ||
    !buried ||
    !recharged ||
    !protectActive ||
    !protectHeld ||
    !drained
    ? 1
    : 0,
);
