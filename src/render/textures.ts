import * as THREE from 'three';

/**
 * Procedural textures in the spirit of RuneScape's 128×128 tiles: coarse,
 * hand-drawn-looking stone, timber, and thatch, generated on a canvas so the
 * game still ships no image assets. Nearest-neighbour magnification keeps the
 * texels crisp up close, the way the old client drew them.
 */

function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function finish(canvas: HTMLCanvasElement, repeat = 1): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

/** Grey ashlar blocks in a running bond with dark mortar; one tile ≈ 2 world units. */
export function stoneTexture(base = '#a9a496', seed = 3): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rnd = seeded(seed);
  ctx.fillStyle = '#5c584f'; // mortar
  ctx.fillRect(0, 0, size, size);

  const rows = 6;
  const cols = 4;
  const bh = size / rows;
  const bw = size / cols;
  const b = new THREE.Color(base);
  for (let r = 0; r < rows; r++) {
    const offset = r % 2 === 0 ? 0 : bw / 2;
    for (let c = -1; c <= cols; c++) {
      const x = c * bw + offset;
      const y = r * bh;
      const tint = b.clone().offsetHSL(0, 0, (rnd() - 0.5) * 0.12);
      ctx.fillStyle = `#${tint.getHexString()}`;
      ctx.fillRect(x + 2, y + 2, bw - 3, bh - 3);
      // A lighter top edge and a darker bottom edge give each block a bevel.
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillRect(x + 2, y + 2, bw - 3, 2);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(x + 2, y + bh - 3, bw - 3, 2);
      // Speckle.
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.1)';
        ctx.fillRect(x + 3 + rnd() * (bw - 6), y + 3 + rnd() * (bh - 6), 2, 2);
      }
    }
  }
  return finish(canvas);
}

/** Vertical planks with grain lines and nail heads. */
export function woodTexture(base = '#7a5632', seed = 11): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rnd = seeded(seed);
  const b = new THREE.Color(base);
  const planks = 4;
  const pw = size / planks;
  for (let p = 0; p < planks; p++) {
    const tint = b.clone().offsetHSL(0, 0, (rnd() - 0.5) * 0.1);
    ctx.fillStyle = `#${tint.getHexString()}`;
    ctx.fillRect(p * pw, 0, pw, size);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(p * pw, 0, 2, size);
    for (let g = 0; g < 5; g++) {
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.08)';
      const gx = p * pw + 4 + rnd() * (pw - 8);
      ctx.fillRect(gx, 0, 1, size);
    }
    ctx.fillStyle = '#2d2117';
    ctx.fillRect(p * pw + pw / 2 - 1, 10, 3, 3);
    ctx.fillRect(p * pw + pw / 2 - 1, size - 14, 3, 3);
  }
  return finish(canvas);
}

/** Rough thatch/slate for roofs: diagonal strokes. */
export function slateTexture(base = '#4a4f5c', seed = 7): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rnd = seeded(seed);
  const b = new THREE.Color(base);
  ctx.fillStyle = `#${b.getHexString()}`;
  ctx.fillRect(0, 0, size, size);
  const rows = 8;
  const rh = size / rows;
  for (let r = 0; r < rows; r++) {
    const offset = r % 2 === 0 ? 0 : rh;
    for (let c = -1; c < rows + 1; c++) {
      const tint = b.clone().offsetHSL(0, 0, (rnd() - 0.5) * 0.14);
      ctx.fillStyle = `#${tint.getHexString()}`;
      ctx.fillRect(c * rh * 2 + offset + 1, r * rh + 1, rh * 2 - 2, rh - 2);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(c * rh * 2 + offset + 1, r * rh + rh - 2, rh * 2 - 2, 2);
    }
  }
  return finish(canvas);
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
