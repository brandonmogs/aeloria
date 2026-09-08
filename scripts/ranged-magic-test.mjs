// Ranged and magic combat: a shortbow with bronze arrows on Rapid fires
// projectiles, consumes ammo, and trains Ranged; a staff of air casts Wind
// Strike with mind runes (manually and on autocast) and trains Magic.
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

// A sturdy archer: enough Defence to ignore goblin bites, and ranged/magic
// levels that make the strikes land often.
await page.evaluate((id) => {
  const a = window.__aeloria;
  a.player.skills.addXp('defense', a.xpForLevel(40));
  a.player.skills.addXp('range', a.xpForLevel(20));
  a.player.skills.addXp('magic', a.xpForLevel(20));
  a.push({ type: 'setRun', entityId: id, on: true });
  a.give('shortbow', 1);
  a.give('bronze_arrow', 30);
  const bow = a.player.inventory.slots.findIndex((s) => s && s.id === 'shortbow');
  a.push({ type: 'equipItem', entityId: id, slot: bow });
}, pid);
await page.waitForTimeout(800);
await page.evaluate((id) => {
  const a = window.__aeloria;
  const arrows = a.player.inventory.slots.findIndex((s) => s && s.id === 'bronze_arrow');
  a.push({ type: 'equipItem', entityId: id, slot: arrows });
  a.push({ type: 'setStyle', entityId: id, index: 1 }); // Rapid
}, pid);
await page.waitForTimeout(800);
const equipped = await page.evaluate(() => ({
  weapon: window.__aeloria.player.inventory.equipment.weapon?.id,
  ammo: window.__aeloria.player.inventory.equipment.ammo?.id,
}));
await page.evaluate(() => document.querySelectorAll('#inventory-panel .inv-tab')[0].click());
const styles = await page.$$eval('#inventory-panel .style-name', (els) => els.map((e) => e.textContent));

// Shoot a goblin; watch for a projectile in flight and Ranged XP.
await page.evaluate(() => window.__aeloria.attack('Goblin'));
let sawProjectile = false;
const rangedXp = await page
  .waitForFunction(
    () => {
      if (window.__aeloria.world.projectiles.size > 0) window.__sawProjectile = true;
      return window.__aeloria.player.skills.xpOf('range') > window.__aeloria.xpForLevel(20);
    },
    null,
    { timeout: 90000, polling: 100 },
  )
  .then(() => page.evaluate(() => window.__aeloria.player.skills.xpOf('range')))
  .catch(() => 0);
sawProjectile = await page.evaluate(() => window.__sawProjectile === true);
await page.screenshot({ path: 'scripts/shots/ranged.png' });
const ammoLeft = await page.evaluate(() => window.__aeloria.player.inventory.equipment.ammo?.qty ?? 0);

// Now magic: stop fighting, wield the staff, cast Wind Strike by hand.
await page.evaluate((id) => {
  const a = window.__aeloria;
  a.push({ type: 'move', entityId: id, target: { ...a.player.position } });
  a.give('staff_of_air', 1);
  a.give('mind_rune', 30);
  const staff = a.player.inventory.slots.findIndex((s) => s && s.id === 'staff_of_air');
  a.push({ type: 'equipItem', entityId: id, slot: staff });
}, pid);
await page.waitForTimeout(800);
const magicBefore = await page.evaluate(() => window.__aeloria.player.skills.xpOf('magic'));
await page.evaluate((id) => {
  const a = window.__aeloria;
  let best = null;
  let bestD = Infinity;
  for (const e of a.world.entities.values()) {
    if (e.kind === 'goblin' && e.hitpoints > 0) {
      const d = Math.max(Math.abs(e.position.x - a.player.position.x), Math.abs(e.position.y - a.player.position.y));
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
  }
  a.push({ type: 'castSpell', entityId: id, spellId: 'wind_strike', targetId: best.id });
}, pid);
const castXp = await page
  .waitForFunction((before) => window.__aeloria.player.skills.xpOf('magic') > before, magicBefore, { timeout: 60000 })
  .then(() => page.evaluate(() => window.__aeloria.player.skills.xpOf('magic')))
  .catch(() => magicBefore);
const mindLeft = await page.evaluate(() => window.__aeloria.player.inventory.countOf('mind_rune'));

// Autocast: set the spell and attack normally; each cast is worth its base XP.
// A wounded goblin may die to the first strike, so keep picking new ones.
await page.evaluate((id) => window.__aeloria.push({ type: 'setAutocast', entityId: id, spellId: 'wind_strike' }), pid);
let autocastXp = castXp;
for (let i = 0; i < 12 && autocastXp <= castXp + 5; i++) {
  await page.evaluate(() => {
    if (window.__aeloria.player.targetId === null) window.__aeloria.attack('Goblin');
  });
  autocastXp = await page
    .waitForFunction((before) => window.__aeloria.player.skills.xpOf('magic') > before + 5, castXp, { timeout: 8000 })
    .then(() => page.evaluate(() => window.__aeloria.player.skills.xpOf('magic')))
    .catch(() => page.evaluate(() => window.__aeloria.player.skills.xpOf('magic')));
}
await page.screenshot({ path: 'scripts/shots/magic.png' });

const logLines = await page.$$eval('#message-log .log-line', (els) => els.map((e) => e.textContent));
console.log(JSON.stringify({ equipped, styles, sawProjectile, rangedXp, ammoLeft, magicBefore, castXp, mindLeft, autocastXp, logLines, errors }, null, 2));
await browser.close();

const ok =
  !errors.length &&
  equipped.weapon === 'shortbow' &&
  equipped.ammo === 'bronze_arrow' &&
  styles.includes('Rapid') &&
  sawProjectile &&
  rangedXp > 0 &&
  ammoLeft < 30 &&
  castXp > magicBefore &&
  mindLeft < 30 &&
  autocastXp > castXp;
process.exit(ok ? 0 : 1);
