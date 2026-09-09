import * as THREE from 'three';

/**
 * The shared toolkit behind every procedural texture in the game: seeded
 * randomness, tileable noise, canvas helpers, and the height-field-to-normal-map
 * step. Everything is drawn at start-up on a canvas, so the game still ships
 * no image assets, and the seeds keep the result identical every run.
 */

/** A colour texture plus the tangent-space normal map derived from its height field. */
export interface TextureSet {
  /** sRGB colour; the height field rides along in alpha for blending. */
  albedo: THREE.DataTexture;
  /** Tangent-space normal map (linear). */
  normal: THREE.DataTexture;
}

export function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Tileable multi-octave value noise, size×size, values in 0..1. */
export function tileableNoise(size: number, octaves: number, seed: number, baseCells = 4): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const cells = baseCells << o;
    const lattice = new Float32Array(cells * cells);
    const rnd = seeded(seed * 7919 + o * 104729 + 17);
    for (let i = 0; i < lattice.length; i++) lattice[i] = rnd();
    const cell = size / cells;
    for (let y = 0; y < size; y++) {
      const fy = y / cell;
      const j0 = Math.floor(fy) % cells;
      const ty = smooth(fy - Math.floor(fy));
      const j1 = (j0 + 1) % cells;
      for (let x = 0; x < size; x++) {
        const fx = x / cell;
        const i0 = Math.floor(fx) % cells;
        const tx = smooth(fx - Math.floor(fx));
        const i1 = (i0 + 1) % cells;
        const a = lattice[j0 * cells + i0];
        const b = lattice[j0 * cells + i1];
        const c = lattice[j1 * cells + i0];
        const d = lattice[j1 * cells + i1];
        out[y * size + x] += amp * ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty);
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

export function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return [canvas, canvas.getContext('2d')!];
}

export function hsl(h: number, s: number, l: number): string {
  return `hsl(${h.toFixed(1)}, ${s.toFixed(1)}%, ${l.toFixed(1)}%)`;
}

export function gray(l: number): string {
  const v = Math.round(Math.max(0, Math.min(1, l)) * 255);
  return `rgb(${v}, ${v}, ${v})`;
}

/** Fill a canvas per pixel from a colour function of pixel index and position. */
export function fillPixels(
  ctx: CanvasRenderingContext2D,
  size: number,
  color: (i: number, x: number, y: number) => [number, number, number],
): void {
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const [r, g, b] = color(i, x, y);
      d[i * 4] = r;
      d[i * 4 + 1] = g;
      d[i * 4 + 2] = b;
      d[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Run `draw` at every offset needed for a shape near the edge to wrap around. */
export function wrapped(size: number, x: number, y: number, margin: number, draw: (ox: number, oy: number) => void): void {
  const xs = [0];
  const ys = [0];
  if (x < margin) xs.push(size);
  if (x > size - margin) xs.push(-size);
  if (y < margin) ys.push(size);
  if (y > size - margin) ys.push(-size);
  for (const ox of xs) for (const oy of ys) draw(ox, oy);
}

const scratch = new THREE.Color();
/** sRGB bytes for an HSL colour (hue in degrees, saturation/lightness in percent). */
export function hslBytes(h: number, s: number, l: number): [number, number, number] {
  scratch.setHSL(h / 360, s / 100, l / 100, THREE.SRGBColorSpace);
  return [Math.round(scratch.r * 255), Math.round(scratch.g * 255), Math.round(scratch.b * 255)];
}

/** Red channel of a canvas as 0..1 floats: the convention for height canvases. */
export function heightOf(ctx: CanvasRenderingContext2D, size: number): Float32Array {
  const d = ctx.getImageData(0, 0, size, size).data;
  const h = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) h[i] = d[i * 4] / 255;
  return h;
}

/** Sobel the height field (wrapping) into a tangent-space normal map. */
export function normalMap(height: Float32Array, size: number, strength: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(size * size * 4);
  const at = (x: number, y: number): number => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx =
        at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
      const dy =
        at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
      // DataTextures are not flipped, so texture v runs with canvas y: a slope
      // rising toward +y tilts the normal toward -y.
      let nx = -dx * strength;
      let ny = -dy * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * size + x) * 4;
      out[i] = Math.round((nx * 0.5 + 0.5) * 255);
      out[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      out[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      out[i + 3] = 255;
    }
  }
  return out;
}

/** Wrap raw RGBA bytes as a repeating, mipmapped texture. */
export function toTexture(data: Uint8Array<ArrayBuffer>, size: number, srgb: boolean): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/** Pack an albedo canvas plus a height field into a colour/normal texture pair. */
export function finishSet(albedo: CanvasRenderingContext2D, height: Float32Array, size: number, strength: number, heightInAlpha = true): TextureSet {
  const rgba = new Uint8Array(albedo.getImageData(0, 0, size, size).data);
  if (heightInAlpha) for (let i = 0; i < size * size; i++) rgba[i * 4 + 3] = Math.round(height[i] * 255);
  return { albedo: toTexture(rgba, size, true), normal: toTexture(normalMap(height, size, strength), size, false) };
}

/** A canvas with transparency (leaf clusters, decals) as a clamped, mipmapped texture. */
export function alphaTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}
