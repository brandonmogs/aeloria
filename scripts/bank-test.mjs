// Walks to the castle bank booth, opens the bank, deposits the whole backpack,
// withdraws the coins back, and confirms the screen closes on walking away.
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
  window.__aeloria.push({ type: 'interact', entityId: id, kind: 'bank', target: { x: 20, y: 43 } });
}, pid);

const opened = await page
  .waitForFunction(() => window.__aeloria.bankIsOpen(), null, { timeout: 90000 })
  .then(() => true)
  .catch(() => false);
const panelVisible = await page.isVisible('#bank-panel');
await page.screenshot({ path: 'scripts/shots/bank-open.png' });

// Deposit everything; the backpack should empty and the bank should fill.
await page.evaluate((id) => {
  window.__aeloria.push({ type: 'bankDepositAll', entityId: id });
}, pid);
const deposited = await page
  .waitForFunction(
    () =>
      window.__aeloria.player.inventory.slots.every((s) => s === null) &&
      window.__aeloria.player.bank.size >= 6,
    null,
    { timeout: 10000 },
  )
  .then(() => true)
  .catch(() => false);

// Withdraw the whole coin stack back.
await page.evaluate((id) => {
  window.__aeloria.push({ type: 'bankWithdraw', entityId: id, itemId: 'coins', qty: -1 });
}, pid);
const withdrew = await page
  .waitForFunction(
    () => window.__aeloria.player.inventory.slots.some((s) => s && s.id === 'coins' && s.qty === 25),
    null,
    { timeout: 10000 },
  )
  .then(() => true)
  .catch(() => false);
await page.screenshot({ path: 'scripts/shots/bank-stocked.png' });

// Walk off — the bank screen should close itself.
await page.evaluate((id) => {
  window.__aeloria.push({ type: 'move', entityId: id, target: { x: 24, y: 37 } });
}, pid);
const closed = await page
  .waitForFunction(() => !window.__aeloria.bankIsOpen(), null, { timeout: 15000 })
  .then(() => true)
  .catch(() => false);

const bank = await page.evaluate(() => [...window.__aeloria.player.bank.entries()]);

console.log(JSON.stringify({ opened, panelVisible, deposited, withdrew, closed, bank, errors }, null, 2));
await browser.close();
process.exit(errors.length || !opened || !panelVisible || !deposited || !withdrew || !closed ? 1 : 0);
