// Headless screenshots of the character lab (/dev/character/), one per named
// look, for reviewing the model after each milestone. Fails on page errors,
// so it doubles as the lab's smoke test under `npm test`.
// Usage: node scripts/character-shot.mjs [url]   (no url: boots its own Vite server)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const SHOTS = [
  ['default', 'turntable=0'],
  ['plate', 'set=plate:rune&ui=0&turntable=0'],
  ['walk', 'set=chain:steel&anim=walk&ui=0&turntable=0'],
  ['face', 'frame=head&light=studio&ui=0&turntable=0'],
  ['elf', 'race=elf&sex=f&set=leather&light=golden&ui=0&turntable=0'],
  ['female', 'race=human&sex=f&light=studio&ui=0&turntable=0'],
  ['darkelf', 'race=darkelf&sex=f&set=cloth&light=moonlit&ui=0&turntable=0'],
  ['orc', 'race=orc&sex=m&set=chain:iron&light=overcast&ui=0&turntable=0'],
  ['dwarf', 'race=dwarf&sex=m&light=golden&ui=0&turntable=0'],
  ['pbr', 'set=plate:steel&style=off&light=golden&frame=torso&ui=0&turntable=0'],
  ['styled', 'set=plate:steel&style=all&light=golden&frame=torso&ui=0&turntable=0'],
  ['moonlit', 'set=plate:mithril&light=moonlit&frame=torso&ui=0&turntable=0'],
  ['plate-back', 'set=plate:rune&yaw=2.8&light=studio&ui=0&turntable=0'],
  ['run', 'hair=long&cape=max_cape&anim=run&yaw=1.6&light=golden&ui=0&turntable=0'],
];

let url = process.argv[2];
let server = null;
if (!url) {
  const { createServer } = await import('vite');
  server = await createServer({ server: { port: 5197, open: false, strictPort: true }, logLevel: 'warn' });
  await server.listen();
  url = 'http://localhost:5197';
}
mkdirSync('scripts/shots', { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11', '--window-size=1280,800'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));

const shots = [];
for (const [name, query] of SHOTS) {
  await page.goto(`${url}/dev/character/?${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__characterLab?.ready === true, null, { timeout: 60000 });
  await page.waitForTimeout(700);
  const stats = await page.evaluate(() => window.__characterLab.lab.stats);
  const path = `scripts/shots/character-${name}.png`;
  await page.screenshot({ path });
  shots.push({
    name,
    path,
    characterCalls: stats.characterCalls,
    characterTriangles: stats.characterTriangles,
    frameMs: +stats.frameMs.toFixed(1),
    animMs: +stats.animMs.toFixed(2),
  });
}

console.log(JSON.stringify({ shots, errors }, null, 2));
await browser.close();
await server?.close();
process.exit(errors.length ? 1 : 0);
