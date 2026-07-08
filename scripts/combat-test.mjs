// Drives a real fight via the __aeloria debug handle and screenshots mid-swing.
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5173';

const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__aeloria !== undefined, null, { timeout: 15000 });
await page.waitForTimeout(1500);

// Walk next to the goblin, then attack it.
const npcId = await page.evaluate(() => window.__aeloria.attack('Goblin'));
if (npcId === null) {
  console.error('No living goblin found');
  process.exit(1);
}

// Zoom in for a good look at the animations.
await page.mouse.move(640, 400);
for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -120);

// Wait until we are adjacent and swinging, then take a burst of screenshots.
await page.waitForTimeout(4000);
for (let i = 0; i < 6; i++) {
  await page.screenshot({ path: `scripts/shots/combat-${i}.png` });
  await page.waitForTimeout(200);
}

// Fight to the death and capture the death animation window.
const dead = await page
  .waitForFunction(
    (id) => {
      const g = window.__aeloria.world.entities.get(id);
      return g && g.hitpoints === 0;
    },
    npcId,
    { timeout: 60000 },
  )
  .then(() => true)
  .catch(() => false);
await page.waitForTimeout(250);
await page.screenshot({ path: 'scripts/shots/combat-death.png' });

const state = await page.evaluate((id) => {
  const w = window.__aeloria.world;
  const g = w.entities.get(id);
  const p = window.__aeloria.player;
  return { tick: w.tickCount, goblinHp: g?.hitpoints, playerHp: p.hitpoints, xp: p.skills.xp };
}, npcId);

console.log(JSON.stringify({ dead, state, errors }, null, 2));
await browser.close();
process.exit(errors.length ? 1 : 0);
