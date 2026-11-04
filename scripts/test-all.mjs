// Boots a Vite dev server, runs every browser test against it, and reports.
// Usage: npm test
import { createServer } from 'vite';
import { spawn } from 'node:child_process';

const TESTS = [
  'smoke',
  'combat-test',
  'xp-test',
  'loot-test',
  'gather-test',
  'npc-test',
  'menu-test',
  'sfx-test',
  'hud-test',
  'item-test',
  'style-prayer-test',
  'skilling-test',
  'bank-test',
  'death-test',
  'skills-test',
  'quest-test',
  'map-test',
  'content-test',
  'ranged-magic-test',
  'character-shot',
  'creator-test',
];

const server = await createServer({ server: { port: 5199, open: false } });
await server.listen();
const url = 'http://localhost:5199';
console.log(`dev server up at ${url}\n`);

let failed = 0;
for (const name of TESTS) {
  const start = Date.now();
  const code = await new Promise((resolve) => {
    // The game tests skip the character screen; the lab shots and the screen's own test navigate themselves.
    const target = name === 'character-shot' || name === 'creator-test' ? url : `${url}/?play`;
    const child = spawn(process.execPath, [`scripts/${name}.mjs`, target], { stdio: 'pipe' });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (c) => {
      if (c !== 0) console.error(out.trim());
      resolve(c);
    });
  });
  const secs = ((Date.now() - start) / 1000).toFixed(0);
  console.log(`${code === 0 ? 'PASS' : 'FAIL'}  ${name} (${secs}s)`);
  if (code !== 0) failed++;
}

await server.close();
console.log(failed ? `\n${failed} test(s) failed` : '\nall tests passed');
process.exit(failed ? 1 : 0);
