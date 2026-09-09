import * as THREE from 'three';
import { TextureSet, alphaTexture, fillPixels, finishSet, gray, heightOf, hsl, hslBytes, makeCanvas, seeded, tileableNoise, wrapped } from './texgen';

/**
 * Textures for the living scenery: leaf clusters for the tree canopies (drawn
 * on transparent cards and alpha-tested, exactly how RuneScape's trees have
 * always been built), bark for the trunks, and weathered stone for boulders.
 */

export type LeafKind = 'broad' | 'oak' | 'willow';

/** One leaf: a pointed ellipse with a faint vein. */
function leaf(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, wid: number, rot: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-len, 0);
  ctx.quadraticCurveTo(0, -wid, len, 0);
  ctx.quadraticCurveTo(0, wid, -len, 0);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(-len * 0.85, 0);
  ctx.lineTo(len * 0.85, 0);
  ctx.stroke();
  ctx.restore();
}

/**
 * A cluster of leaves on a transparent card. Broad and oak clusters are round
 * masses that thin toward a ragged edge; willow cards are hanging strands with
 * small leaves along them, pivoted at the top.
 */
export function leafTexture(kind: LeafKind, seed = 1): THREE.CanvasTexture {
  const size = 256;
  const [canvas, ctx] = makeCanvas(size);
  const rnd = seeded(seed * 101 + 13);
  ctx.clearRect(0, 0, size, size);

  if (kind === 'willow') {
    for (let s = 0; s < 16; s++) {
      const x0 = 16 + rnd() * (size - 32);
      const len = 150 + rnd() * 100;
      const drift = (rnd() - 0.5) * 0.5;
      const strandX = (t: number): number => x0 + Math.sin(t * 3 + s) * 6 + drift * len * t;
      ctx.strokeStyle = hsl(68 + rnd() * 15, 30, 28);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x0, 2);
      for (let k = 1; k <= 12; k++) {
        const t = k / 12;
        ctx.lineTo(strandX(t), 2 + len * t);
      }
      ctx.stroke();
      for (let k = 0; k < 20; k++) {
        const t = rnd();
        const py = 2 + len * t;
        if (py > size - 6) continue;
        leaf(ctx, strandX(t), py, 5 + rnd() * 4, 2 + rnd() * 1.5, rnd() * Math.PI, hsl(72 + rnd() * 20, 36 + rnd() * 16, 30 + rnd() * 18));
      }
    }
    return alphaTexture(canvas);
  }

  const cx = size / 2;
  const cy = size / 2;
  const R = size * 0.45;
  const count = kind === 'oak' ? 210 : 240;
  const hueBase = kind === 'oak' ? 96 : 100;
  for (let i = 0; i < count; i++) {
    const a = rnd() * Math.PI * 2;
    // Dense in the middle, thinning toward an edge that wanders with the angle.
    const r = R * Math.sqrt(rnd()) * (0.78 + 0.22 * Math.sin(a * 5 + seed * 2.1));
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r * 0.9;
    const depth = r / R; // 0 centre → 1 edge
    const light = 21 + depth * 10 + rnd() * 12;
    const len = kind === 'oak' ? 8 + rnd() * 7 : 9 + rnd() * 8;
    const wid = kind === 'oak' ? len * 0.6 : len * 0.42;
    leaf(ctx, x, y, len, wid, rnd() * Math.PI, hsl(hueBase + rnd() * 22, 32 + rnd() * 16, light));
  }
  return alphaTexture(canvas);
}

/** Bark: dark brown grain with vertical ridges and furrows that tile top to bottom. */
export function barkTextures(size = 256, seed = 9): TextureSet {
  const [, ctx] = makeCanvas(size);
  const [, hctx] = makeCanvas(size);
  const grain = tileableNoise(size, 5, seed, 2);

  fillPixels(ctx, size, (i) => hslBytes(24 + grain[i] * 8, 28 + grain[i] * 12, 22 + grain[i] * 14));
  fillPixels(hctx, size, (i) => {
    const v = Math.round((0.35 + grain[i] * 0.3) * 255);
    return [v, v, v];
  });

  const rnd = seeded(seed * 3 + 1);
  ctx.lineCap = 'round';
  hctx.lineCap = 'round';
  for (let k = 0; k < 46; k++) {
    const x = rnd() * size;
    const width = 1.5 + rnd() * 4;
    const ridge = rnd() < 0.5;
    const amp = 3 + rnd() * 6;
    const waves = 1 + Math.floor(rnd() * 3);
    const phase = rnd() * Math.PI * 2;
    const color = ridge ? hsl(26, 26, 34 + rnd() * 8) : hsl(22, 30, 12 + rnd() * 6);
    for (const [target, style] of [
      [ctx, color],
      [hctx, gray(ridge ? 0.85 : 0.12)],
    ] as const) {
      target.strokeStyle = style;
      target.lineWidth = width;
      for (const ox of [-size, 0, size]) {
        target.beginPath();
        for (let y = 0; y <= size; y += 8) {
          // Periodic in y so the ridge meets itself when the texture repeats.
          const px = x + ox + Math.sin((y / size) * Math.PI * 2 * waves + phase) * amp;
          if (y === 0) target.moveTo(px, y);
          else target.lineTo(px, y);
        }
        target.stroke();
      }
    }
  }

  return finishSet(ctx, heightOf(hctx, size), size, 2.2, false);
}

/** Weathered grey stone with mineral flecks and a few cracks. */
export function rockTextures(size = 256, seed = 4): TextureSet {
  const [, ctx] = makeCanvas(size);
  const [, hctx] = makeCanvas(size);
  const grit = tileableNoise(size, 6, seed, 4);
  const big = tileableNoise(size, 2, seed + 1, 2);

  fillPixels(ctx, size, (i) => hslBytes(30 + big[i] * 20, 4 + grit[i] * 8, 36 + grit[i] * 26));
  fillPixels(hctx, size, (i) => {
    const v = Math.round((0.4 + grit[i] * 0.5) * 255);
    return [v, v, v];
  });

  const rnd = seeded(seed * 5 + 2);
  for (let k = 0; k < 14; k++) {
    let x = rnd() * size;
    let y = rnd() * size;
    let ang = rnd() * Math.PI * 2;
    for (let s = 0; s < 8; s++) {
      const nx = x + Math.cos(ang) * (5 + rnd() * 7);
      const ny = y + Math.sin(ang) * (5 + rnd() * 7);
      wrapped(size, x, y, 20, (ox, oy) => {
        for (const [target, style] of [
          [ctx, 'rgba(20, 18, 16, 0.55)'],
          [hctx, gray(0.1)],
        ] as const) {
          target.strokeStyle = style;
          target.lineWidth = 1.2;
          target.beginPath();
          target.moveTo(x + ox, y + oy);
          target.lineTo(nx + ox, ny + oy);
          target.stroke();
        }
      });
      x = nx;
      y = ny;
      ang += (rnd() - 0.5) * 1.2;
    }
  }

  return finishSet(ctx, heightOf(hctx, size), size, 2.4, false);
}
