import { TextureSet, fillPixels, finishSet, gray, heightOf, hsl, hslBytes, makeCanvas, seeded, tileableNoise, wrapped } from './texgen';

/**
 * Procedural ground materials in the spirit of 117 HD's ground textures:
 * tileable grass, packed dirt, and courtyard flagstones, each with a normal
 * map derived from its own height field so the sun rakes across blades,
 * pebbles, and mortar lines.
 *
 * Each albedo texture carries its height field in the alpha channel; the
 * terrain shader uses it for height-aware blending (dirt shows through the
 * gaps between grass blades before it covers them), which is what keeps the
 * transitions from looking like an airbrushed gradient.
 */
export type GroundTextureSet = TextureSet;

/** Meadow grass: undergrowth with thousands of overlapping blades in mixed greens. */
export function grassTextures(size = 512, seed = 3): GroundTextureSet {
  const [, ctx] = makeCanvas(size);
  const [, hctx] = makeCanvas(size);
  const soil = tileableNoise(size, 5, seed, 4);
  const drift = tileableNoise(size, 3, seed + 11, 2);

  fillPixels(ctx, size, (i) => hslBytes(88 + drift[i] * 22, 36 + soil[i] * 16, 25 + soil[i] * 14));
  fillPixels(hctx, size, (i) => {
    const v = Math.round(soil[i] * 0.35 * 255);
    return [v, v, v];
  });

  const rnd = seeded(seed * 31 + 7);
  const blades = Math.round((size * size) / 46);
  ctx.lineCap = 'round';
  hctx.lineCap = 'round';
  for (let k = 0; k < blades; k++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const i = Math.floor(y) * size + Math.floor(x);
    const len = 6 + rnd() * 10;
    const ang = rnd() * Math.PI * 2;
    const curve = (rnd() - 0.5) * 5;
    const width = 1.1 + rnd() * 1.4;
    const light = 31 + rnd() * 24 + (drift[i] - 0.5) * 14;
    const color = hsl(82 + rnd() * 30 + drift[i] * 8, 40 + rnd() * 24, light);
    const h = 0.45 + rnd() * 0.5;
    const mx = Math.cos(ang) * len * 0.5 - Math.sin(ang) * curve;
    const my = Math.sin(ang) * len * 0.5 + Math.cos(ang) * curve;
    const ex = Math.cos(ang) * len;
    const ey = Math.sin(ang) * len;
    wrapped(size, x, y, 20, (ox, oy) => {
      for (const [target, style] of [
        [ctx, color],
        [hctx, gray(h)],
      ] as const) {
        target.strokeStyle = style;
        target.lineWidth = width;
        target.beginPath();
        target.moveTo(x + ox, y + oy);
        target.quadraticCurveTo(x + ox + mx, y + oy + my, x + ox + ex, y + oy + ey);
        target.stroke();
      }
    });
  }

  // A few darker clumps so the field isn't one even carpet.
  for (let k = 0; k < 36; k++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 14 + rnd() * 26;
    wrapped(size, x, y, 40, (ox, oy) => {
      const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      g.addColorStop(0, 'rgba(20, 45, 15, 0.25)');
      g.addColorStop(1, 'rgba(20, 45, 15, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    });
  }

  return finishSet(ctx, heightOf(hctx, size), size, 1.5);
}

/** Packed earth: brown loam with a scatter of pebbles, dry cracks, and damp patches. */
export function dirtTextures(size = 512, seed = 5): GroundTextureSet {
  const [, ctx] = makeCanvas(size);
  const [, hctx] = makeCanvas(size);
  const loam = tileableNoise(size, 5, seed, 4);
  const damp = tileableNoise(size, 2, seed + 3, 2);

  fillPixels(ctx, size, (i) => hslBytes(26 + damp[i] * 12, 24 + loam[i] * 16, 34 + loam[i] * 18 - damp[i] * 7));
  fillPixels(hctx, size, (i) => {
    const v = Math.round((0.3 + loam[i] * 0.4) * 255);
    return [v, v, v];
  });

  const rnd = seeded(seed * 13 + 5);

  // Dry cracks: thin dark polylines, cut into the height field.
  for (let k = 0; k < 20; k++) {
    let x = rnd() * size;
    let y = rnd() * size;
    let ang = rnd() * Math.PI * 2;
    const steps = 6 + Math.floor(rnd() * 10);
    for (let s = 0; s < steps; s++) {
      const nx = x + Math.cos(ang) * (6 + rnd() * 8);
      const ny = y + Math.sin(ang) * (6 + rnd() * 8);
      wrapped(size, x, y, 24, (ox, oy) => {
        for (const [target, style, w] of [
          [ctx, 'rgba(45, 30, 16, 0.6)', 1.2],
          [hctx, gray(0.14), 1.6],
        ] as const) {
          target.strokeStyle = style;
          target.lineWidth = w;
          target.beginPath();
          target.moveTo(x + ox, y + oy);
          target.lineTo(nx + ox, ny + oy);
          target.stroke();
        }
      });
      x = nx;
      y = ny;
      ang += (rnd() - 0.5) * 1.4;
    }
  }

  // Pebbles: dull stones a shade lighter than the earth, with a soft shadow foot.
  for (let k = 0; k < 150; k++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 1.6 + rnd() * 3.2;
    const light = 40 + rnd() * 14;
    const hue = 26 + rnd() * 18;
    const sat = 8 + rnd() * 14;
    const rot = rnd() * Math.PI;
    const squash = 0.6 + rnd() * 0.4;
    wrapped(size, x, y, 12, (ox, oy) => {
      ctx.fillStyle = 'rgba(30, 20, 10, 0.35)';
      ctx.beginPath();
      ctx.ellipse(x + ox + r * 0.35, y + oy + r * 0.4, r, r * squash, rot, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hsl(hue, sat, light);
      ctx.beginPath();
      ctx.ellipse(x + ox, y + oy, r, r * squash, rot, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hsl(hue, sat, light + 9);
      ctx.beginPath();
      ctx.ellipse(x + ox - r * 0.3, y + oy - r * 0.3, r * 0.45, r * 0.35 * squash, rot, 0, Math.PI * 2);
      ctx.fill();
      const g = hctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      g.addColorStop(0, gray(0.95));
      g.addColorStop(0.7, gray(0.8));
      g.addColorStop(1, 'rgba(255,255,255,0)');
      hctx.fillStyle = g;
      hctx.beginPath();
      hctx.ellipse(x + ox, y + oy, r, r * squash, rot, 0, Math.PI * 2);
      hctx.fill();
    });
  }

  return finishSet(ctx, heightOf(hctx, size), size, 2.4);
}

/** Courtyard flagstones: jittered slabs in a grid with mortar and a bevelled lip. */
export function cobbleTextures(size = 512, seed = 7): GroundTextureSet {
  const [, ctx] = makeCanvas(size);
  const [, hctx] = makeCanvas(size);
  const grit = tileableNoise(size, 5, seed, 8);
  const tone = tileableNoise(size, 2, seed + 5, 2);

  // Mortar underneath everything.
  fillPixels(ctx, size, (i) => hslBytes(36, 8 + grit[i] * 6, 28 + grit[i] * 12));
  fillPixels(hctx, size, (i) => {
    const v = Math.round((0.18 + grit[i] * 0.1) * 255);
    return [v, v, v];
  });

  const n = 5;
  const cell = size / n;
  const rnd = seeded(seed * 17 + 3);
  const jitter: Array<[number, number]> = [];
  for (let i = 0; i < n * n; i++) jitter.push([(rnd() - 0.5) * cell * 0.3, (rnd() - 0.5) * cell * 0.3]);
  const corner = (i: number, j: number): [number, number] => {
    const [jx, jy] = jitter[((j % n) + n) % n * n + (((i % n) + n) % n)];
    return [i * cell + jx, j * cell + jy];
  };

  const slabs: Array<{ pts: Array<[number, number]>; light: number; hue: number; sat: number }> = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const pts = [corner(i, j), corner(i + 1, j), corner(i + 1, j + 1), corner(i, j + 1)];
      const t = tone[Math.floor((j + 0.5) * cell) * size + Math.floor((i + 0.5) * cell)];
      slabs.push({ pts, light: 44 + t * 18 + (rnd() - 0.5) * 10, hue: 32 + rnd() * 14, sat: 5 + rnd() * 8 });
    }
  }

  const inset = (pts: Array<[number, number]>, by: number): Array<[number, number]> => {
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    return pts.map(([x, y]) => {
      const dx = x - cx;
      const dy = y - cy;
      const len = Math.hypot(dx, dy) || 1;
      return [x - (dx / len) * by, y - (dy / len) * by];
    });
  };
  const poly = (target: CanvasRenderingContext2D, pts: Array<[number, number]>, ox: number, oy: number): void => {
    target.beginPath();
    target.moveTo(pts[0][0] + ox, pts[0][1] + oy);
    for (let k = 1; k < pts.length; k++) target.lineTo(pts[k][0] + ox, pts[k][1] + oy);
    target.closePath();
  };

  for (const slab of slabs) {
    const outer = inset(slab.pts, 4);
    const inner = inset(slab.pts, 6.5);
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        // Bevel: a light rim, then the face; a darker lower-right edge.
        ctx.fillStyle = hsl(slab.hue, slab.sat, slab.light + 14);
        poly(ctx, outer, ox, oy);
        ctx.fill();
        ctx.fillStyle = hsl(slab.hue, slab.sat, slab.light);
        poly(ctx, inner, ox, oy);
        ctx.fill();
        ctx.strokeStyle = hsl(slab.hue, slab.sat, slab.light - 14);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(outer[3][0] + ox, outer[3][1] + oy);
        ctx.lineTo(outer[2][0] + ox, outer[2][1] + oy);
        ctx.lineTo(outer[1][0] + ox, outer[1][1] + oy);
        ctx.stroke();

        hctx.fillStyle = gray(0.62);
        poly(hctx, outer, ox, oy);
        hctx.fill();
        hctx.fillStyle = gray(0.78);
        poly(hctx, inner, ox, oy);
        hctx.fill();
      }
    }
  }

  // Grit and wear over the faces.
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < size * size; i++) {
    const g = (grit[i] - 0.5) * 34;
    d[i * 4] = Math.max(0, Math.min(255, d[i * 4] + g));
    d[i * 4 + 1] = Math.max(0, Math.min(255, d[i * 4 + 1] + g));
    d[i * 4 + 2] = Math.max(0, Math.min(255, d[i * 4 + 2] + g));
  }
  ctx.putImageData(img, 0, 0);
  const height = heightOf(hctx, size);
  for (let i = 0; i < height.length; i++) height[i] = Math.min(1, height[i] + (grit[i] - 0.5) * 0.12);

  return finishSet(ctx, height, size, 3.2);
}
