// The minimap and world map: the minimap stays centred on the player and
// rotates with the camera, clicking it walks there (in the right direction
// even after a rotation), and the world map opens with labels and a key.
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:2006';

const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__aeloria !== undefined, null, { timeout: 15000 });
await page.waitForTimeout(800);

const pid = await page.evaluate(() => window.__aeloria.player.id);
await page.evaluate((id) => window.__aeloria.push({ type: 'setAutoRetaliate', entityId: id, on: false }), pid);

// Face north (the compass snaps the camera), then click the minimap a little
// above centre: that must resolve to a tile north of the player.
await page.click('#compass');
await page.waitForTimeout(400);
const mm = await page.locator('#minimap').boundingBox();
const start = await page.evaluate(() => ({ ...window.__aeloria.player.position }));
await page.mouse.click(mm.x + mm.width / 2, mm.y + mm.height * 0.28);
await page.waitForTimeout(300);
const northTarget = await page.evaluate(() => window.__aeloria.lastMinimapTarget());
const walkingNorth = northTarget && northTarget.y > start.y && Math.abs(northTarget.x - start.x) <= 1;

// Rotate the camera a half turn, click "above centre" again: now that is south.
await page.evaluate(() => window.__aeloria.camera.faceSouth());
await page.waitForTimeout(400);
const mid = await page.evaluate(() => ({ ...window.__aeloria.player.position }));
await page.mouse.click(mm.x + mm.width / 2, mm.y + mm.height * 0.28);
await page.waitForTimeout(300);
const southTarget = await page.evaluate(() => window.__aeloria.lastMinimapTarget());
const walkingSouth = southTarget && southTarget.y < mid.y;
await page.screenshot({ path: 'scripts/shots/minimap.png' });

// The world map.
await page.click('#world-map-btn');
await page.waitForTimeout(400);
const worldMap = await page.evaluate(() => {
  const el = document.getElementById('world-map');
  return { open: !!el && !el.hidden, keyRows: el ? el.querySelectorAll('.world-map-key-row').length : 0 };
});
await page.screenshot({ path: 'scripts/shots/world-map.png' });
await page.keyboard.press('Escape');
const closed = await page.evaluate(() => document.getElementById('world-map').hidden);

// Scrolling over the minimap zooms it: up zooms in, down zooms back out, and
// a click still resolves to the right tile at the new scale.
await page.mouse.move(mm.x + mm.width / 2, mm.y + mm.height / 2);
await page.mouse.wheel(0, -100);
await page.mouse.wheel(0, -100);
await page.waitForTimeout(400);
const zoomedIn = await page.evaluate(() => window.__aeloria.minimapZoom());
await page.evaluate(() => window.__aeloria.camera.faceNorth());
await page.waitForTimeout(300);
const before = await page.evaluate(() => ({ ...window.__aeloria.player.position }));
await page.mouse.click(mm.x + mm.width / 2, mm.y + mm.height * 0.28);
await page.waitForTimeout(300);
const zoomedTarget = await page.evaluate(() => window.__aeloria.lastMinimapTarget());
// At 1.49x zoom the same screen offset reaches fewer tiles north than at 1x.
const zoomedClickNorth = zoomedTarget && zoomedTarget.y > before.y && zoomedTarget.y - before.y < northTarget.y - start.y;
await page.screenshot({ path: 'scripts/shots/minimap-zoomed.png' });
await page.mouse.move(mm.x + mm.width / 2, mm.y + mm.height / 2);
for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 100);
await page.waitForTimeout(400);
const zoomedOut = await page.evaluate(() => window.__aeloria.minimapZoom());
const zoomWorks = zoomedIn > 1.3 && zoomedIn < 1.6 && zoomedOut < 1;

console.log(JSON.stringify({ start, northTarget, walkingNorth, mid, southTarget, walkingSouth, worldMap, closed, zoomedIn, zoomedTarget, zoomedClickNorth, zoomedOut, errors }, null, 2));
await browser.close();
process.exit(!errors.length && walkingNorth && walkingSouth && worldMap.open && worldMap.keyRows >= 5 && closed && zoomWorks && zoomedClickNorth ? 0 : 1);
