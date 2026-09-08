// Quests end to end: talk to the Cook, accept "The Cook's Rat Problem" through
// the dialogue box, satisfy it, hand in, and check the quest points, the XP
// reward, the completion scroll, and the struck-through journal.
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
  window.__aeloria.push({ type: 'setAutoRetaliate', entityId: id, on: false });
  window.__aeloria.push({ type: 'setRun', entityId: id, on: true });
}, pid);

/** Walk through a conversation, picking the option whose text matches `pick`. */
async function converse(npcName, pick) {
  await page.evaluate((name) => window.__aeloria.talk(name), npcName);
  const opened = await page
    .waitForFunction(() => window.__aeloria.player.dialogue !== null, null, { timeout: 60000 })
    .then(() => true)
    .catch(() => false);
  if (!opened) return { opened, steps: 0 };
  let steps = 0;
  while (steps < 30) {
    const view = await page.evaluate(() => window.__aeloria.dialogueView());
    if (!view) break;
    steps++;
    if (view.kind === 'options') {
      const index = view.options.findIndex((o) => o.includes(pick));
      await page.evaluate(({ id, index }) => window.__aeloria.push({ type: 'dialogueChoose', entityId: id, index: Math.max(0, index) }), { id: pid, index });
    } else {
      await page.evaluate((id) => window.__aeloria.push({ type: 'dialogueContinue', entityId: id }), pid);
    }
    await page.waitForTimeout(700);
  }
  return { opened, steps };
}

// Quest list before: red (not started).
await page.keyboard.press('F3');
await page.waitForTimeout(200);
const listBefore = await page.$$eval('#inventory-panel .quest-row', (els) => els.map((e) => `${e.textContent}:${e.className}`));

// Accept the quest.
const accept = await converse('Cook', 'Consider it done');
await page.screenshot({ path: 'scripts/shots/quest-dialogue.png' });
const stageAfterAccept = await page.evaluate(() => window.__aeloria.player.quests.get('cooks_rats'));

// Satisfy it the quick way: three rat kills on the counter and three cooked meat.
await page.evaluate(() => {
  const a = window.__aeloria;
  a.player.killCounts.set('rat', (a.player.killCounts.get('rat') ?? 0) + 3);
  a.give('cooked_meat', 3);
});
const journalMid = await page.evaluate(() => {
  const a = window.__aeloria;
  document.querySelectorAll('#inventory-panel .quest-row')[0].click();
  return [...document.querySelectorAll('#quest-journal .journal-line')].map((e) => `${e.classList.contains('done') ? '[x]' : '[ ]'} ${e.textContent}`);
});
await page.keyboard.press('Escape');

// Hand in.
const handIn = await converse('Cook', 'Consider it done');
await page.waitForTimeout(500);
const after = await page.evaluate(() => {
  const a = window.__aeloria;
  return {
    stage: a.player.quests.get('cooks_rats'),
    qp: a.player.questPoints,
    cookingXp: a.player.skills.xpOf('cooking'),
    meatLeft: a.player.inventory.countOf('cooked_meat'),
    completeShown: !document.getElementById('quest-complete').hidden,
    completeText: document.getElementById('quest-complete').textContent,
  };
});
await page.screenshot({ path: 'scripts/shots/quest-complete.png' });
const listAfter = await page.$$eval('#inventory-panel .quest-row', (els) => els.map((e) => `${e.textContent}:${e.className}`));
const logLines = await page.$$eval('#message-log .log-line', (els) => els.map((e) => e.textContent));

console.log(JSON.stringify({ listBefore, accept, stageAfterAccept, journalMid, handIn, after, listAfter, logLines, errors }, null, 2));
await browser.close();

const ok =
  !errors.length &&
  listBefore.every((l) => l.includes('not-started')) &&
  accept.opened &&
  stageAfterAccept === 1 &&
  journalMid.some((l) => l.startsWith('[x]')) &&
  after.stage === 2 &&
  after.qp === 1 &&
  after.cookingXp >= 300 &&
  after.meatLeft === 0 &&
  after.completeShown &&
  after.completeText.includes('Quest Complete') &&
  listAfter.some((l) => l.includes('complete') && !l.includes('in-progress'));
process.exit(ok ? 0 : 1);
