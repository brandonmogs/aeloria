import * as THREE from 'three';
import { TextureSet, fillPixels, finishSet, gray, heightOf, hsl, hslBytes, makeCanvas, seeded, tileableNoise } from './texgen';

/**
 * Building materials for the castle: dressed stone in a running bond, oak
 * planking, and roof slates, each with a normal map cut from its own height
 * field so the mortar lines and plank gaps catch the sun. One texture tile
 * spans two world units (see {@link projectUvs}).
 */

/** Grey ashlar blocks with dark mortar, chipped edges, and a bevelled lip. */
export function stoneTextures(base = '#9a968a', seed = 3, size = 512): TextureSet {
  const [, ctx] = makeCanvas(size);
  const [, hctx] = makeCanvas(size);
  const grit = tileableNoise(size, 5, seed, 8);
  const rnd = seeded(seed * 13 + 1);
  const b = new THREE.Color(base);
  const hslOf = { h: 0, s: 0, l: 0 };
  b.getHSL(hslOf, THREE.SRGBColorSpace);
  const hue = hslOf.h * 360;
  const sat = hslOf.s * 100;
  const light = hslOf.l * 100;

  // Mortar.
  fillPixels(ctx, size, (i) => hslBytes(hue, sat * 0.6, light * 0.45 + grit[i] * 8));
  fillPixels(hctx, size, (i) => {
    const v = Math.round((0.16 + grit[i] * 0.08) * 255);
    return [v, v, v];
  });

  const rows = 8;
  const cols = 4;
  const bh = size / rows;
  const bw = size / cols;
  const gap = 3;
  for (let r = 0; r < rows; r++) {
    const offset = r % 2 === 0 ? 0 : bw / 2;
    for (let c = -1; c <= cols; c++) {
      const x = c * bw + offset;
      const y = r * bh;
      const tint = light + (rnd() - 0.5) * 14;
      const h = 0.7 + (rnd() - 0.5) * 0.12;
      // Face, then a lighter top/left bevel and a darker bottom/right edge.
      ctx.fillStyle = hsl(hue + (rnd() - 0.5) * 6, sat, tint);
      ctx.fillRect(x + gap, y + gap, bw - gap * 2, bh - gap * 2);
      ctx.fillStyle = hsl(hue, sat, tint + 12);
      ctx.fillRect(x + gap, y + gap, bw - gap * 2, 2);
      ctx.fillRect(x + gap, y + gap, 2, bh - gap * 2);
      ctx.fillStyle = hsl(hue, sat, tint - 14);
      ctx.fillRect(x + gap, y + bh - gap - 2, bw - gap * 2, 2);
      ctx.fillRect(x + bw - gap - 2, y + gap, 2, bh - gap * 2);
      hctx.fillStyle = gray(h);
      hctx.fillRect(x + gap, y + gap, bw - gap * 2, bh - gap * 2);
      hctx.fillStyle = gray(h + 0.12);
      hctx.fillRect(x + gap + 2, y + gap + 2, bw - gap * 2 - 4, bh - gap * 2 - 4);
      // Chips and stains.
      for (let i = 0; i < 5; i++) {
        const px = x + gap + 3 + rnd() * (bw - gap * 2 - 6);
        const py = y + gap + 3 + rnd() * (bh - gap * 2 - 6);
        const pr = 1 + rnd() * 3;
        ctx.fillStyle = rnd() < 0.5 ? 'rgba(0, 0, 0, 0.14)' : 'rgba(255, 255, 255, 0.1)';
        ctx.beginPath();
        ctx.ellipse(px, py, pr * 1.6, pr, rnd() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Weathering across the whole face.
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < size * size; i++) {
    const g = (grit[i] - 0.5) * 30;
    d[i * 4] = Math.max(0, Math.min(255, d[i * 4] + g));
    d[i * 4 + 1] = Math.max(0, Math.min(255, d[i * 4 + 1] + g));
    d[i * 4 + 2] = Math.max(0, Math.min(255, d[i * 4 + 2] + g));
  }
  ctx.putImageData(img, 0, 0);
  const height = heightOf(hctx, size);
  for (let i = 0; i < height.length; i++) height[i] = Math.min(1, height[i] + (grit[i] - 0.5) * 0.1);

  return finishSet(ctx, height, size, 3.0, false);
}

/** Vertical oak planks with wandering grain and nail heads. */
export function woodTextures(base = '#7a5632', seed = 11, size = 256): TextureSet {
  const [, ctx] = makeCanvas(size);
  const [, hctx] = makeCanvas(size);
  const rnd = seeded(seed * 7 + 3);
  const b = new THREE.Color(base);
  const hslOf = { h: 0, s: 0, l: 0 };
  b.getHSL(hslOf, THREE.SRGBColorSpace);
  const hue = hslOf.h * 360;
  const sat = hslOf.s * 100;
  const light = hslOf.l * 100;
  const planks = 4;
  const pw = size / planks;

  hctx.fillStyle = gray(0.2);
  hctx.fillRect(0, 0, size, size);
  for (let p = 0; p < planks; p++) {
    const tint = light + (rnd() - 0.5) * 10;
    ctx.fillStyle = hsl(hue, sat, tint);
    ctx.fillRect(p * pw, 0, pw, size);
    hctx.fillStyle = gray(0.7);
    hctx.fillRect(p * pw + 2, 0, pw - 4, size);
    // Grain: wavy lines the length of the plank, periodic so they tile.
    for (let g = 0; g < 9; g++) {
      const gx = p * pw + 4 + rnd() * (pw - 8);
      const amp = 1 + rnd() * 2.5;
      const waves = 1 + Math.floor(rnd() * 3);
      const phase = rnd() * Math.PI * 2;
      const dark = rnd() < 0.6;
      for (const [target, style, w] of [
        [ctx, dark ? 'rgba(0, 0, 0, 0.18)' : 'rgba(255, 220, 180, 0.12)', 1 + rnd()],
        [hctx, gray(dark ? 0.55 : 0.8), 1.2],
      ] as const) {
        target.strokeStyle = style;
        target.lineWidth = w;
        target.beginPath();
        for (let y = 0; y <= size; y += 6) {
          const px = gx + Math.sin((y / size) * Math.PI * 2 * waves + phase) * amp;
          if (y === 0) target.moveTo(px, y);
          else target.lineTo(px, y);
        }
        target.stroke();
      }
    }
    // Plank edge and nails.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(p * pw, 0, 2, size);
    for (const ny of [14, size - 18]) {
      ctx.fillStyle = '#2d2117';
      ctx.fillRect(p * pw + pw / 2 - 2, ny, 4, 4);
      hctx.fillStyle = gray(0.9);
      hctx.fillRect(p * pw + pw / 2 - 2, ny, 4, 4);
    }
  }

  return finishSet(ctx, heightOf(hctx, size), size, 2.0, false);
}

/** Roof slates in staggered rows, each a slightly different shade. */
export function slateTextures(base = '#4a4f5c', seed = 7, size = 256): TextureSet {
  const [, ctx] = makeCanvas(size);
  const [, hctx] = makeCanvas(size);
  const rnd = seeded(seed * 5 + 9);
  const b = new THREE.Color(base);
  const hslOf = { h: 0, s: 0, l: 0 };
  b.getHSL(hslOf, THREE.SRGBColorSpace);
  const hue = hslOf.h * 360;
  const sat = hslOf.s * 100;
  const light = hslOf.l * 100;

  ctx.fillStyle = hsl(hue, sat, light * 0.6);
  ctx.fillRect(0, 0, size, size);
  hctx.fillStyle = gray(0.25);
  hctx.fillRect(0, 0, size, size);
  const rows = 8;
  const rh = size / rows;
  const tw = rh * 2;
  for (let r = 0; r < rows; r++) {
    const offset = r % 2 === 0 ? 0 : rh;
    for (let c = -1; c < rows + 1; c++) {
      const x = c * tw + offset;
      const y = r * rh;
      const tint = light + (rnd() - 0.5) * 16;
      ctx.fillStyle = hsl(hue + (rnd() - 0.5) * 8, sat, tint);
      ctx.fillRect(x + 1, y + 1, tw - 2, rh - 2);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.fillRect(x + 1, y + rh - 3, tw - 2, 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.fillRect(x + 1, y + 1, tw - 2, 1);
      hctx.fillStyle = gray(0.7 + (rnd() - 0.5) * 0.1);
      hctx.fillRect(x + 1, y + 1, tw - 2, rh - 3);
    }
  }

  return finishSet(ctx, heightOf(hctx, size), size, 2.2, false);
}

/**
 * Rewrite a geometry's UVs from its world-space positions so a tiling
 * texture runs continuously across every axis-aligned face of a merged
 * building: vertical faces map (x+z, y), horizontal faces map (x, z).
 */
export function projectUvs(geo: THREE.BufferGeometry, scale = 0.5): void {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const nrm = geo.attributes.normal as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (Math.abs(nrm.getY(i)) > 0.7) {
      uv[i * 2] = x * scale;
      uv[i * 2 + 1] = z * scale;
    } else {
      uv[i * 2] = (x + z) * scale;
      uv[i * 2 + 1] = y * scale;
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
