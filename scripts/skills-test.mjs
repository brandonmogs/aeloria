// The OSRS stat system: all 23 skills on the real XP curve (200M cap), the
// stats tab with hover XP box and click-to-open skill guide, and the F-key
// interface tabs.
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:2006';

const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__aeloria !== undefined, null, { timeout: 15000 });

// The XP curve and a fresh account's totals.
const curve = await page.evaluate(() => {
  const a = window.__aeloria;
  const s = a.player.skills;
  const before = { total: s.totalLevel(), hp: s.levelOf('hitpoints'), combat: a.world.combatLevelOf(a.player) };
  s.addXp('attack', 200_000_000 + 5); // cap check
  const capped = s.xpOf('attack');
  s.addXp('prayer', 4.5);
  s.addXp('prayer', 4.5);
  const tenths = s.xpOf('prayer');
  return {
    l2: a.xpForLevel(2),
    l10: a.xpForLevel(10),
    l50: a.xpForLevel(50),
    l99: a.xpForLevel(99),
    before,
    capped,
    tenths,
    attackLevel: s.levelOf('attack'),
    skills: document.querySelectorAll('#inventory-panel .skill[data-skill]').length,
  };
});

// F2 opens the stats tab; hovering a skill shows the XP box; clicking opens the guide.
await page.keyboard.press('F2');
await page.waitForTimeout(300);
const skillsVisible = await page.isVisible('#inventory-panel .skills-grid');
const cell = await page.locator('.skill[data-skill="attack"]').boundingBox();
await page.mouse.move(cell.x + cell.width / 2, cell.y + cell.height / 2);
await page.waitForTimeout(250);
const tip = await page.evaluate(() => {
  const el = document.getElementById('skill-tip');
  return el && !el.hidden ? el.textContent : null;
});
await page.mouse.click(cell.x + cell.width / 2, cell.y + cell.height / 2);
await page.waitForTimeout(300);
const guide = await page.evaluate(() => {
  const el = document.getElementById('skill-guide');
  return {
    open: !!el && !el.hidden,
    title: el?.querySelector('.guide-title')?.textContent,
    rows: el ? el.querySelectorAll('.guide-row').length : 0,
    tabs: el ? el.querySelectorAll('.guide-tab').length : 0,
  };
});
await page.screenshot({ path: 'scripts/shots/skill-guide.png' });
await page.keyboard.press('Escape');
const guideClosed = await page.evaluate(() => document.getElementById('skill-guide').hidden);

// F4 back to the backpack, F1 to combat options.
await page.keyboard.press('F4');
const invVisible = await page.isVisible('#inventory-panel .inv-grid');
await page.keyboard.press('F1');
const combatVisible = await page.isVisible('#inventory-panel .combat-pane');

console.log(JSON.stringify({ curve, skillsVisible, tip, guide, guideClosed, invVisible, combatVisible, errors }, null, 2));
await browser.close();

const ok =
  !errors.length &&
  curve.l2 === 83 &&
  curve.l10 === 1154 &&
  curve.l50 === 101333 &&
  curve.l99 === 13034431 &&
  curve.before.total === 32 &&
  curve.before.hp === 10 &&
  curve.before.combat === 3 &&
  curve.capped === 200_000_000 &&
  curve.tenths === 9 &&
  curve.attackLevel === 99 &&
  curve.skills === 23 &&
  skillsVisible &&
  tip &&
  tip.includes('Attack XP') &&
  guide.open &&
  guide.title.includes('Attack') &&
  guide.rows > 10 &&
  guide.tabs >= 1 &&
  guideClosed &&
  invVisible &&
  combatVisible;
process.exit(ok ? 0 : 1);
