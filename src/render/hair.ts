import * as THREE from 'three';
import type { Rig } from './characters';
import { hairDetail } from './characterTextures';
import { seeded } from './texgen';

/**
 * Hair as geometry, in the manner of a Lineage 2 character: a glossy,
 * volumetric cap shrink-wrapped to the actual skull, a sheet of hair falling
 * down the back for long styles, and strand cards (alpha-tested ribbons)
 * for a swept fringe and the locks in front of the ears. The styles: cropped,
 * short, long (a fall down the back that lies along it from the shoulders),
 * bob (to the jaw all round) and ponytail (gathered through a band at the
 * back of the crown).
 *
 * The scalp is measured from the finished head mesh (see human.ts): for
 * every direction out of a point inside the skull, the furthest skin. The
 * cap sits on that at a style-dependent thickness, thinning to nothing at a
 * hairline that runs high across the forehead, dips at the temples, clears
 * the ears and drops to the nape. Everything is sized from the skull's
 * half-width, so it fits whatever head the figure was built with.
 */

export type HairStyle = 'bald' | 'cropped' | 'short' | 'long' | 'bob' | 'ponytail';

/** The scalp seen from inside the skull: the furthest skin per direction. */
export interface ScalpShape {
  /** Centre of the skull, in the head bone's space. */
  centre: THREE.Vector3;
  /** Elevation bins from the crown (0) to straight down (π). */
  rows: number;
  /** Azimuth bins from the front (0), turning toward the character's left. */
  cols: number;
  radius: Float32Array;
}

export const SCALP_ROWS = 24;
export const SCALP_COLS = 48;

const TWO_PI = Math.PI * 2;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (x: number, a: number, b: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Scalp radius in a direction (azimuth `a`, elevation `e` from the crown), bilinear across the bins. */
export function scalpRadius(scalp: ScalpShape, a: number, e: number): number {
  const { rows, cols, radius } = scalp;
  const fr = Math.min(rows - 1, Math.max(0, (e / Math.PI) * rows - 0.5));
  let fc = ((a / TWO_PI) * cols - 0.5) % cols;
  if (fc < 0) fc += cols;
  const r0 = Math.floor(fr);
  const r1 = Math.min(rows - 1, r0 + 1);
  const tr = fr - r0;
  const c0 = Math.floor(fc) % cols;
  const c1 = (c0 + 1) % cols;
  const tc = fc - Math.floor(fc);
  const top = radius[r0 * cols + c0] * (1 - tc) + radius[r0 * cols + c1] * tc;
  const bottom = radius[r1 * cols + c0] * (1 - tc) + radius[r1 * cols + c1] * tc;
  return top * (1 - tr) + bottom * tr;
}

/** Unit direction for an azimuth (0 = forward, +z) and elevation (0 = up). */
function direction(a: number, e: number, out: THREE.Vector3): THREE.Vector3 {
  const se = Math.sin(e);
  return out.set(se * Math.sin(a), Math.cos(e), se * Math.cos(a));
}

/** Fold an azimuth to 0 (front) .. π (back). */
const fold = (a: number): number => Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));

/** Styles whose hair hangs past the nape: a longer hairline and a thicker cap. */
const longish = (style: HairStyle): boolean => style === 'long' || style === 'bob';

// --- Textures -------------------------------------------------------------------------

export interface StrandTextures {
  /** Opaque: pale streaks the material's colour multiplies. */
  albedo: THREE.CanvasTexture;
  /** The streaks with gaps between the strands, solid at the roots and letting go strand by strand toward the tips. */
  card: THREE.CanvasTexture;
  /** The streaks solid across, only the tips thinning: for the fine hair of the face. */
  fine: THREE.CanvasTexture;
}

let strands: StrandTextures | null = null;

/** Paint streaks running down a canvas, wrapping horizontally so they tile around the head. */
function paintStrands(ctx: CanvasRenderingContext2D, W: number, H: number, count: number, seed: number, minWidth: number, colourOf?: (i: number, lum: number) => string): void {
  const r = seeded(seed);
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    let x = r() * W;
    const width = minWidth + r() * 2.4;
    const lum = Math.round(255 * (0.62 + 0.5 * r()));
    ctx.lineWidth = width;
    ctx.strokeStyle = colourOf ? colourOf(i, lum) : `rgb(${lum},${lum},${lum})`;
    const step = 24;
    for (let y = -step; y < H; y += step) {
      const nx = x + (r() - 0.5) * 6;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(nx, y + step);
      ctx.stroke();
      // The same stroke again a texture-width over, so strands crossing an edge continue on the other side.
      ctx.beginPath();
      ctx.moveTo(x < W / 2 ? x + W : x - W, y);
      ctx.lineTo(x < W / 2 ? nx + W : nx - W, y + step);
      ctx.stroke();
      x = nx;
      if (x < 0) x += W;
      if (x >= W) x -= W;
    }
  }
}

export function strandTextures(): StrandTextures {
  if (strands) return strands;
  const W = 256;
  const H = 512;
  const albedoCanvas = document.createElement('canvas');
  albedoCanvas.width = W;
  albedoCanvas.height = H;
  const actx = albedoCanvas.getContext('2d')!;
  actx.fillStyle = 'rgb(200,200,200)';
  actx.fillRect(0, 0, W, H);
  paintStrands(actx, W, H, 220, 7, 0.8);

  // Cards: the solid streaks, then an alpha that holds at 1 for the roots and
  // lets go lock by lock toward the tips. Where each lock ends is painted as
  // a grey level, so the hem is wisps at their own lengths rather than a
  // comb of teeth or a razor cut; a slow wave across the width gathers them
  // a little further.
  const endsCanvas = document.createElement('canvas');
  endsCanvas.width = W;
  endsCanvas.height = H;
  const ectx = endsCanvas.getContext('2d')!;
  // Locks a few millimetres wide, so the wisps survive at a distance: single
  // strands would average away to nothing in the mipmaps and leave a razor hem.
  ectx.fillStyle = 'rgb(204,204,204)';
  ectx.fillRect(0, 0, W, H);
  const re = seeded(23);
  const strandEnd = Array.from({ length: 48 }, () => 0.8 + 0.18 * re());
  const endGrey = (i: number): string => {
    const g = Math.round(255 * strandEnd[i]);
    return `rgb(${g},${g},${g})`;
  };
  paintStrands(ectx, W, H, 24, 7, 5, endGrey);
  paintStrands(ectx, W, H, 24, 11, 9, (i) => endGrey(24 + i));
  const ends = ectx.getImageData(0, 0, W, H).data;
  // What the hair cards cover at all: coarser locks on nothing, solid at the
  // roots and parting down their length, so a ribbon reads as strands of
  // hair with air between them rather than a board.
  const coverCanvas = document.createElement('canvas');
  coverCanvas.width = W;
  coverCanvas.height = H;
  const kctx = coverCanvas.getContext('2d')!;
  paintStrands(kctx, W, H, 130, 13, 3.5, () => 'rgb(255,255,255)');
  const cover = kctx.getImageData(0, 0, W, H).data;
  const alphaAt = (x: number, y: number, gaps: boolean): number => {
    const t = y / H;
    const wave = Math.sin((x / W) * Math.PI * 2 * 2 + 0.7) * Math.sin((x / W) * Math.PI * 2 * 3.3);
    const e = Math.min(1, ends[(y * W + x) * 4] / 255 + 0.03 * wave);
    const fade = 0.08;
    const a = t < e - fade ? 1 : t > e ? 0 : (e - t) / fade;
    const c = gaps ? Math.max(cover[(y * W + x) * 4 + 3] / 255, 1 - smooth(t, 0.12, 0.5)) : 1;
    return a * a * c;
  };
  const withAlpha = (gaps: boolean): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(albedoCanvas, 0, 0);
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) d[(y * W + x) * 4 + 3] = Math.round(255 * alphaAt(x, y, gaps));
    ctx.putImageData(img, 0, 0);
    return canvas;
  };
  const cardCanvas = withAlpha(true);
  const fineCanvas = withAlpha(false);

  const albedo = new THREE.CanvasTexture(albedoCanvas);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.wrapS = albedo.wrapT = THREE.RepeatWrapping;
  albedo.anisotropy = 8;
  const card = new THREE.CanvasTexture(cardCanvas);
  card.colorSpace = THREE.SRGBColorSpace;
  card.wrapS = THREE.RepeatWrapping;
  card.wrapT = THREE.ClampToEdgeWrapping;
  card.anisotropy = 8;
  const fine = new THREE.CanvasTexture(fineCanvas);
  fine.colorSpace = THREE.SRGBColorSpace;
  fine.wrapS = THREE.RepeatWrapping;
  fine.wrapT = THREE.ClampToEdgeWrapping;
  fine.anisotropy = 8;
  strands = { albedo, card, fine };
  return strands;
}

const materialCache = new Map<string, THREE.MeshPhysicalMaterial>();

/** Glossy hair with an anisotropic highlight running across the strands. */
function hairMaterial(color: number, cards: boolean): THREE.MeshPhysicalMaterial {
  const key = `${color}:${cards ? 'card' : 'cap'}`;
  const hit = materialCache.get(key);
  if (hit) return hit;
  const tex = strandTextures();
  // The sheen is kept dim and tinted toward the hair's own colour: a white
  // ring of light on dark hair reads as a helmet, a warm band reads as gloss.
  const m = new THREE.MeshPhysicalMaterial({
    color,
    map: cards ? tex.card : tex.albedo,
    vertexColors: true,
    roughness: 0.62,
    metalness: 0,
    envMapIntensity: 0.7,
    specularIntensity: 0.35,
    specularColor: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.5),
    normalMap: hairDetail().normal,
    normalScale: new THREE.Vector2(0.5, 0.5),
    anisotropy: 0.6,
    anisotropyRotation: 0,
    ...(cards ? { alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide } : {}),
  });
  m.name = cards ? 'hair-cards' : 'hair-cap';
  m.userData.hair = true; // the style pass lays its strand highlight on it
  materialCache.set(key, m);
  return m;
}

/** The leather tie of a ponytail; merged into the attachments, it takes the leather tile. */
let tie: THREE.MeshStandardMaterial | null = null;
function tieMaterial(): THREE.MeshStandardMaterial {
  if (tie) return tie;
  const m = (tie = new THREE.MeshStandardMaterial({ color: 0x4a3222, roughness: 0.75, metalness: 0 }));
  m.name = 'hair-tie';
  m.userData.tile = 'leather';
  return m;
}

/**
 * The alpha-tested strand material of the brows and lashes: the hair's
 * streaks without the gaps, and matte, so the fine hair of the face never
 * catches the sky. Merged into the attachments, it takes the fine tile.
 */
export function strandMaterial(color: number): THREE.MeshPhysicalMaterial {
  const key = `${color}:fine`;
  const hit = materialCache.get(key);
  if (hit) return hit;
  const m = new THREE.MeshPhysicalMaterial({
    color,
    map: strandTextures().fine,
    vertexColors: true,
    roughness: 0.8,
    metalness: 0,
    envMapIntensity: 0.06,
    specularIntensity: 0.1,
    alphaTest: 0.5,
    alphaToCoverage: true,
    side: THREE.DoubleSide,
  });
  m.name = 'face-strands';
  m.userData.tile = 'fine';
  materialCache.set(key, m);
  return m;
}

// --- Geometry -------------------------------------------------------------------------

/** Accumulates triangles with position, normal, uv and colour. */
export class Builder {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly uv: number[] = [];
  readonly col: number[] = [];
  readonly idx: number[] = [];

  /** Adds a vertex; `alpha` thins strand cards toward their tips (the cap stays opaque). */
  vertex(p: THREE.Vector3, n: THREE.Vector3, u: number, v: number, shade: number, alpha = 1): number {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    this.col.push(shade, shade, shade, alpha);
    return this.pos.length / 3 - 1;
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.idx.push(a, b, d, b, c, d);
  }

  build(): THREE.BufferGeometry | null {
    if (this.idx.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 4));
    geo.setIndex(this.idx);
    geo.computeBoundingSphere();
    return geo;
  }
}

/** The head measurements the hairline is drawn from, in head space. */
export interface HairlineFrame {
  /** Skull half-width: the unit every hair measurement is taken in. */
  hr: number;
  browY: number;
  earY: number;
}

interface HeadFrame extends HairlineFrame {
  scalp: ScalpShape;
}

/**
 * Height of the hairline at azimuth `a` (0 = front, growing toward the
 * character's left): high across the forehead, dipping at the temples,
 * clearing the ears and dropping to the nape. The skin painter uses the same
 * curve so the painted scalp stays under the cap.
 */
export function hairlineY(a: number, h: HairlineFrame, style: HairStyle): number {
  const t = fold(a);
  const front = h.browY + (style === 'long' ? 0.64 : 0.74) * h.hr;
  const temple = h.browY + 0.46 * h.hr;
  const side = h.earY + 0.3 * h.hr;
  // A ponytail is pulled up off the nape, so its hairline sits higher there.
  const nape = h.earY - (style === 'long' ? 0.9 : style === 'ponytail' ? 0.65 : 1.0) * h.hr;
  const keys: Array<[number, number]> = [
    [0, front],
    [0.7, temple],
    [1.2, side],
    [1.9, side],
    [2.5, nape + 0.12 * h.hr],
    [Math.PI, nape],
  ];
  for (let i = 0; i + 1 < keys.length; i++) {
    const [a0, y0] = keys[i];
    const [a1, y1] = keys[i + 1];
    if (t >= a0 && t <= a1) {
      const k = 0.5 - 0.5 * Math.cos(((t - a0) / (a1 - a0)) * Math.PI);
      return y0 + (y1 - y0) * k;
    }
  }
  return nape;
}

/** The elevation at which the scalp, going down from the crown at azimuth `a`, reaches `targetY`. */
function rimElevation(scalp: ScalpShape, a: number, targetY: number): number {
  const steps = 72;
  const maxE = Math.PI * 0.86;
  let prevE = 0;
  let prevY = scalp.centre.y + scalpRadius(scalp, a, 0);
  for (let i = 1; i <= steps; i++) {
    const e = (i / steps) * maxE;
    const y = scalp.centre.y + Math.cos(e) * scalpRadius(scalp, a, e);
    if (y <= targetY) {
      const k = (prevY - targetY) / Math.max(1e-6, prevY - y);
      return prevE + (e - prevE) * k;
    }
    prevE = e;
    prevY = y;
  }
  return maxE;
}

/**
 * How far the hair falls below the nape at azimuth `a`, in skull widths:
 * long hair from behind the ears down the back, a bob from the temples all
 * round to the jaw.
 */
function fallLength(a: number, style: HairStyle): number {
  const t = fold(a);
  if (style === 'long') return smooth(t, 1.7, 2.15) * (3.9 + 0.6 * ((t - 1.7) / (Math.PI - 1.7)));
  if (style === 'bob') return smooth(t, 0.95, 1.35) * (1.05 + 0.25 * ((t - 0.95) / (Math.PI - 0.95)));
  return 0;
}

/** Hair thickness over the scalp at azimuth `a` and cap parameter `v` (0 crown, 1 rim). */
function thickness(a: number, v: number, style: HairStyle, hr: number): number {
  const t = fold(a);
  const body = longish(style)
    ? 0.17 + 0.13 * (t / Math.PI)
    : style === 'cropped'
      ? 0.045 + 0.03 * (t / Math.PI)
      : style === 'ponytail'
        ? 0.07 + 0.05 * (t / Math.PI)
        : 0.085 + 0.06 * (t / Math.PI);
  const base = hr * body;
  // Short hair thins toward the skin at its edge (never quite to it, so the
  // skin can't poke through); long hair keeps its body into the fall.
  const keeps = smooth(fallLength(a, style), 0, 0.8);
  const taper = 1 - (1 - keeps) * v * v * v * 0.85;
  // Clumps: locks swelling and parting around the head, more so toward the rim; sleek styles less so.
  const clumpK = style === 'cropped' || style === 'ponytail' ? 0.4 : 1;
  const clump = 1 + clumpK * ((0.12 + 0.08 * v) * Math.sin(a * 3 + 1.3) * Math.sin(a * 2.1 + v * 4) + 0.08 * Math.sin(a * 5 + v * 6));
  return base * taper * clump;
}

/**
 * The rim wanders up and down a little around the head, slowly: a ragged
 * hairline is the skin painter's job, and a fast wobble here puts teeth on
 * every hem hung from the rim.
 */
function rimNoise(a: number): number {
  return 0.015 * Math.sin(a * 2 + 0.4) + 0.01 * Math.sin(a * 3.3 + 2.1);
}

/** A flat ribbon of hair along a curve, facing out from the skull. */
function ribbon(b: Builder, curve: THREE.Curve<THREE.Vector3>, centre: THREE.Vector3, w0: number, w1: number, shade: number, uOffset: number): void {
  const fade = (t: number): number => 1 - 0.5 * smooth(t, 0.6, 1);
  const M = 7;
  const p = new THREE.Vector3();
  const tan = new THREE.Vector3();
  const radial = new THREE.Vector3();
  const side = new THREE.Vector3();
  const q = new THREE.Vector3();
  const prev: [number, number] = [-1, -1];
  for (let i = 0; i <= M; i++) {
    const t = i / M;
    curve.getPointAt(t, p);
    curve.getTangentAt(t, tan);
    radial.copy(p).sub(centre).normalize();
    side.crossVectors(radial, tan).normalize();
    const w = w0 + (w1 - w0) * t;
    const n = radial.clone();
    const l = b.vertex(q.copy(p).addScaledVector(side, -w / 2), n, uOffset, 0.1 + 0.9 * t, shade, fade(t));
    const r = b.vertex(q.copy(p).addScaledVector(side, w / 2), n, uOffset + 0.5, 0.1 + 0.9 * t, shade, fade(t));
    if (prev[0] >= 0) b.quad(prev[0], l, r, prev[1]);
    prev[0] = l;
    prev[1] = r;
  }
}

/**
 * A sheet of hair from a grid of columns (each a run of points, top to
 * bottom), lit by normals taken from the neighbouring points, so locks that
 * swell and part shade as such. Columns may be empty; the sheet skips the gaps.
 */
function sheet(
  b: Builder,
  grid: THREE.Vector3[][],
  uOf: (c: number) => number,
  vOf: (t: number) => number,
  shadeOf: (c: number, t: number) => number,
  alphaOf: (t: number) => number,
  outward: (c: number) => THREE.Vector3,
): void {
  const ids: number[][] = [];
  const down = new THREE.Vector3();
  const across = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let c = 0; c < grid.length; c++) {
    const col = grid[c];
    const own: number[] = [];
    const out = outward(c);
    for (let k = 0; k < col.length; k++) {
      const t = col.length > 1 ? k / (col.length - 1) : 0;
      down.subVectors(col[Math.min(col.length - 1, k + 1)], col[Math.max(0, k - 1)]);
      across.subVectors(grid[c + 1]?.[k] ?? col[k], grid[c - 1]?.[k] ?? col[k]);
      if (across.lengthSq() < 1e-10 || down.lengthSq() < 1e-10) n.copy(out);
      else {
        n.crossVectors(down, across).normalize();
        if (n.dot(out) < 0) n.negate();
        n.lerp(out, 0.35).normalize();
      }
      own.push(b.vertex(col[k], n, uOf(c), vOf(t), shadeOf(c, t), alphaOf(t)));
    }
    ids.push(own);
  }
  for (let c = 0; c + 1 < grid.length; c++) {
    const l = ids[c];
    const r = ids[c + 1];
    const rows = Math.min(l.length, r.length);
    for (let k = 0; k + 1 < rows; k++) b.quad(l[k], l[k + 1], r[k + 1], r[k]);
  }
}

/** Where the body is under the hair, in the head's space: the neck and the left shoulder (bind pose). */
function bodyFrame(rig: Rig, hr: number): { neck: THREE.Vector3; shoulder: THREE.Vector3; depth: number } {
  const head = rig.joints.head;
  const local = (o: THREE.Object3D | undefined, fallback: THREE.Vector3): THREE.Vector3 => {
    if (!o || !head) return fallback;
    head.updateWorldMatrix(true, false);
    o.updateWorldMatrix(true, false);
    return head.worldToLocal(o.getWorldPosition(new THREE.Vector3()));
  };
  return {
    neck: local(rig.joints.neck, new THREE.Vector3(0, -2 * hr, -0.7 * hr)),
    shoulder: local(rig.joints.shoulderL, new THREE.Vector3(3 * hr, -3.6 * hr, -0.4 * hr)),
    depth: rig.dims.chestR * rig.dims.torsoFlatten,
  };
}

/**
 * Build hair for a rig built from the human template. Returns a group to
 * hang on the head bone, or null for bald heads and rigs without a scalp.
 */
export function buildHair(rig: Rig, style: HairStyle, color: number, seed = 1): THREE.Object3D | null {
  const f = rig.dims.face;
  if (!f || !f.scalp || style === 'bald') return null;
  const scalp = f.scalp;
  const hr = rig.dims.headR;
  const h: HeadFrame = { scalp, hr, browY: f.brow, earY: (f.earL.y + f.earR.y) / 2 };
  const C = scalp.centre;
  const rand = seeded(seed);
  const group = new THREE.Group();
  group.name = 'hair';
  group.userData.scalp = scalp;
  const long = longish(style);
  const sleek = style === 'cropped';

  // --- Cap: an azimuth × depth grid over the scalp, thinning to the hairline.
  const COLS = 48;
  const ROWS = 12;
  const cap = new Builder();
  const dir = new THREE.Vector3();
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const grid: number[][] = [];
  const rimPoint: THREE.Vector3[] = [];
  for (let c = 0; c <= COLS; c++) {
    const a = (c / COLS) * TWO_PI;
    const eRim = rimElevation(scalp, a, hairlineY(a, h, style)) + rimNoise(a);
    // A little lighter or darker per lock, so the mass reads as many strands rather than one tone.
    const tint = 1 + 0.06 * Math.sin(a * 13 + seed) * Math.sin(a * 5.3 + 1.1);
    const column: number[] = [];
    for (let r = 0; r <= ROWS; r++) {
      const v = r / ROWS;
      const e = v * eRim;
      direction(a, e, dir);
      const off = thickness(a, v, style, hr);
      p.copy(C).addScaledVector(dir, scalpRadius(scalp, a, e) + off);
      // Lighting normals lean radial so the cap shades as one rounded mass.
      n.copy(dir);
      column.push(cap.vertex(p, n, (c / COLS) * 4, v * 0.9, (1 - 0.18 * v) * tint));
      if (r === ROWS) rimPoint.push(p.clone());
    }
    grid.push(column);
  }
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      // Wound so the faces look outward (down the column first, then around).
      cap.quad(grid[c][r], grid[c][r + 1], grid[c + 1][r + 1], grid[c + 1][r]);
    }
  }
  const capGeo = cap.build();
  if (capGeo) {
    const mesh = new THREE.Mesh(capGeo, hairMaterial(color, false));
    mesh.name = 'hair-cap';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  /** A mesh that hangs from the head and sways down the hair chain (see attachments.ts). */
  const hang = (geo: THREE.BufferGeometry | null, cards: boolean): void => {
    if (!geo) return;
    const mesh = new THREE.Mesh(geo, hairMaterial(color, cards));
    mesh.name = 'hair-fall';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.noAO = true;
    group.add(mesh);
  };

  // --- The fall: long hair from behind the ears down the back, lying along
  // it from the shoulders; a bob all round to the jaw, turning in at the ends.
  // Each column is a lock with a length and a bulge of its own, so the hem is
  // layered and the surface swells and parts; an opaque sheet a little inside
  // backs the strands where they thin, so the mass never looks hollow.
  if (fallLength(Math.PI, style) > 0) {
    const bob = style === 'bob';
    const body = bodyFrame(rig, hr);
    const K = 10;
    const outer: THREE.Vector3[][] = [];
    const inner: THREE.Vector3[][] = [];
    const radial = new THREE.Vector3();
    const locks: number[] = [];
    // The body under the head, from the template's measurements: the back of
    // the neck, then the shoulder blades, and how wide the body is at each
    // height (the neck, then the trapezius out to the shoulders). A column
    // hangs straight from the rim until it is over the body, then lies a
    // finger's width off it.
    const neckBack = body.neck.z - 0.4 * hr;
    const bladeBack = body.shoulder.z - 0.62 * body.depth;
    const backOf = (y: number): number => neckBack + (bladeBack - neckBack) * smooth(-y, -body.neck.y, -body.shoulder.y - 0.5 * hr);
    const halfWidthOf = (y: number): number => 0.9 * hr + (body.shoulder.x + 0.1 * hr) * clamp01((body.neck.y - y) / (body.neck.y - body.shoulder.y + 0.3 * hr));
    const drape = (x: number, y: number, zHang: number): number => {
      const over = smooth(halfWidthOf(y) - Math.abs(x), -0.5 * hr, 0.3 * hr);
      return Math.min(zHang, zHang + (backOf(y) - 0.2 * hr - zHang) * over);
    };
    for (let c = 0; c <= COLS; c++) {
      const a = (c / COLS) * TWO_PI;
      const len0 = fallLength(a, style) * hr;
      const col: THREE.Vector3[] = [];
      const colIn: THREE.Vector3[] = [];
      const lock = Math.sin(a * 5 + 1.3 + seed) * Math.sin(a * 2.3 + 0.7);
      locks.push(lock);
      if (len0 > 0.01 * hr) {
        const base = rimPoint[c];
        const behind = clamp01(-Math.cos(a)); // 1 straight back, 0 at the sides
        const top = base.y + 0.1 * hr;
        // The hem is a height, not a length, so it runs level whatever the rim
        // does: a bob's at the jaw, a little under the nape's low hairline at
        // the back; long hair's down the back in a shallow U. The columns at
        // the fall's front edge are cut shorter, so it starts behind the ear
        // rather than with a wall.
        const hemY = bob ? f.chin + 0.1 * hr - 0.35 * hr * behind : f.chin - 3.7 * hr - 0.7 * hr * behind * behind;
        const edge = 0.7 + 0.3 * Math.min(1, len0 / ((bob ? 1.05 : 3.9) * hr));
        const len = Math.max(0.3 * hr, (top - hemY) * edge * (0.985 + 0.015 * Math.sin(a * 2.5 + seed)));
        const bulge = (bob ? 0.05 : 0.1) * (1 + 0.5 * lock) * hr;
        radial.set(Math.sin(a), 0, Math.cos(a));
        for (let k = 0; k <= K; k++) {
          const t = k / K;
          const y = top - len * t;
          let x: number;
          let z: number;
          if (bob) {
            // Straight down, a little back, turning in under the jaw.
            const turn = smooth(t, 0.45, 1);
            x = base.x * (1 - 0.12 * turn);
            z = drape(x, y, base.z - 0.08 * hr * t - 0.04 * hr * turn * behind);
          } else {
            // Straight down, spreading a little where it reaches the shoulders.
            x = base.x * (1 + 0.35 * smooth(-y, -body.neck.y - 0.5 * hr, -body.shoulder.y));
            z = drape(x, y, base.z - 0.05 * hr * t);
          }
          p.set(x, y, z).addScaledVector(radial, bulge * Math.sin(Math.PI * t));
          col.push(p.clone());
          if (t <= (bob ? 0.8 : 0.75) + 1e-6) colIn.push(p.clone().addScaledVector(radial, -0.06 * hr));
        }
      }
      outer.push(col);
      inner.push(colIn);
    }
    const outwardOf = (c: number): THREE.Vector3 => {
      const a = (c / COLS) * TWO_PI;
      return new THREE.Vector3(Math.sin(a), 0.15, Math.cos(a)).normalize();
    };
    const fall = new Builder();
    sheet(fall, outer, (c) => (c / COLS) * 4, (t) => 0.2 + 0.8 * t, (c, t) => (0.78 + 0.14 * t) * (1 + 0.08 * locks[c]), (t) => 1 - 0.3 * smooth(t, 0.8, 1), outwardOf);
    hang(fall.build(), true);
    const backing = new Builder();
    sheet(backing, inner, (c) => (c / COLS) * 4 + 0.3, (t) => 0.1 + 0.8 * t, (c, t) => (0.7 + 0.1 * t) * (1 + 0.08 * locks[c]), () => 1, outwardOf);
    hang(backing.build(), false);
  }

  // --- Cards: fringe and locks, all strand-textured ribbons.
  const cards = new Builder();

  // The fringe: curtain bangs from under the cap's front rim, parted a little
  // right of centre. Each column follows the skull down the forehead, slides
  // away from the parting as it falls and lifts off toward tips that thin out
  // above the brows; the columns nearest the parting are the shortest, the
  // ones at the temples the longest. Cropped hair has none.
  if (!sleek) {
    const FC = 26;
    const FK = 6;
    const span = 0.9;
    const parting = -0.22;
    const fringe: number[][] = [];
    for (let c = 0; c <= FC; c++) {
      const a0 = -span + (2 * span * c) / FC;
      const side = a0 < parting ? -1 : 1;
      const away = Math.abs(a0 - parting);
      const grown = smooth(away, 0.04, 0.6) * (0.9 + 0.2 * rand());
      const endY = h.browY + hr * (long ? 0.5 - 0.46 * grown : 0.62 - 0.34 * grown);
      const eTop = rimElevation(scalp, a0, hairlineY(a0, h, style)) - 0.12;
      const column: number[] = [];
      for (let k = 0; k <= FK; k++) {
        const t = k / FK;
        const a = a0 + side * (long ? 0.2 : 0.12) * t * (0.3 + 0.7 * smooth(away, 0, 0.3));
        const eEnd = rimElevation(scalp, a, endY);
        const e = Math.min(Math.PI * 0.86, eTop + (eEnd - eTop) * t);
        direction(a, e, dir);
        const off = (0.05 + 0.1 * t) * hr;
        p.copy(C).addScaledVector(dir, scalpRadius(scalp, a, e) + off);
        n.copy(dir);
        column.push(cards.vertex(p, n, (c / FC) * 2.5, 0.2 + 0.8 * t, 0.88 + 0.12 * t, 1 - 0.5 * smooth(t, 0.55, 1)));
      }
      fringe.push(column);
    }
    for (let c = 0; c < FC; c++) {
      for (let k = 0; k < FK; k++) cards.quad(fringe[c][k], fringe[c][k + 1], fringe[c + 1][k + 1], fringe[c + 1][k]);
    }
  }

  // A few locks lying over the fringe: swept across from a parting right of
  // centre, one falling back the other way.
  const curve = (a0: number, e0: number, lift: number, sweep: number, drop: number, out: number): THREE.QuadraticBezierCurve3 => {
    direction(a0, e0, dir);
    const start = new THREE.Vector3().copy(C).addScaledVector(dir, scalpRadius(scalp, a0, e0) + lift);
    const end = start.clone().add(new THREE.Vector3(sweep, -drop, out * 0.5));
    const mid = start.clone().add(new THREE.Vector3(sweep * 0.35, -drop * 0.4, out));
    return new THREE.QuadraticBezierCurve3(start, mid, end);
  };
  const locks: Array<[number, number]> = sleek ? [] : long ? [[-0.3, 1.0], [0.05, 0.8], [-0.5, -0.45]] : [[-0.2, 0.9], [-0.45, -0.4]];
  for (const [a0, sweepK] of locks) {
    const a = a0 + (rand() - 0.5) * 0.08;
    const eRim = rimElevation(scalp, a, hairlineY(a, h, style));
    const drop = (long ? 0.55 : 0.4) * hr * (0.85 + 0.3 * rand());
    const sweep = sweepK * (long ? 0.5 : 0.35) * hr * (0.85 + 0.3 * rand());
    ribbon(cards, curve(a, eRim - 0.12, 0.14 * hr, sweep, drop, 0.16 * hr), C, 0.5 * hr, 0.22 * hr, 0.92 + 0.08 * rand(), rand() * 0.5);
  }

  // Side locks in front of the ears: a few narrow strands a side at their own
  // lengths, the front ones over the collarbone for long hair, to the jaw for
  // a bob. Azimuth, length and width in skull widths.
  if (long) {
    const sideLocks: ReadonlyArray<readonly [number, number, number]> = style === 'long' ? [[1.2, 2.2, 0.32], [1.38, 1.6, 0.26], [1.55, 1.2, 0.22]] : [[1.2, 1.8, 0.3], [1.4, 1.65, 0.24]];
    for (const sign of [1, -1]) {
      for (const [t, len, w] of sideLocks) {
        const a0 = sign * (t + (rand() - 0.5) * 0.06);
        const eRim = rimElevation(scalp, a0, hairlineY(a0, h, style));
        ribbon(cards, curve(a0, eRim - 0.08, 0.08 * hr, sign * 0.06 * hr, len * hr * (0.9 + 0.2 * rand()), 0.12 * hr), C, w * hr, 0.12 * hr, 0.85 + 0.1 * rand(), rand() * 0.5);
      }
    }
  }

  const cardGeo = cards.build();
  if (cardGeo) {
    const mesh = new THREE.Mesh(cardGeo, hairMaterial(color, true));
    mesh.name = 'hair-cards';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.noAO = true; // alpha-tested ribbons would smear the AO buffer
    group.add(mesh);
  }

  // --- The ponytail: gathered at the back of the crown through a band, then
  // a fan of ribbons swinging down the back.
  if (style === 'ponytail') {
    direction(Math.PI, 1.12, dir);
    const gather = new THREE.Vector3().copy(C).addScaledVector(dir, scalpRadius(scalp, Math.PI, 1.12) + 0.3 * hr);
    const tail = new Builder();
    const N = 13;
    const swing = (0.15 + 0.12 * rand()) * hr;
    for (let i = 0; i < N; i++) {
      const s = (i / (N - 1)) * 2 - 1; // -1 .. 1 across the fan
      const depth = Math.sin(i * 2.4) * 0.14 * hr; // stacked front to back
      const len = (3.0 + 1.0 * rand()) * hr;
      const a0 = gather.clone().add(new THREE.Vector3(0.12 * hr * s, 0.03 * hr * (1 - s * s), depth));
      const a1 = a0.clone().add(new THREE.Vector3(0.1 * hr * s, -0.3 * len, -0.9 * hr));
      const a2 = a0.clone().add(new THREE.Vector3(0.3 * hr * s + swing * 0.4, -0.7 * len, -1.0 * hr));
      const a3 = a0.clone().add(new THREE.Vector3(0.4 * hr * s + swing, -len, -0.8 * hr));
      const curve3 = new THREE.CatmullRomCurve3([a0, a1, a2, a3], false, 'centripetal');
      ribbon(tail, curve3, C, 0.3 * hr, 0.1 * hr, 0.86 + 0.1 * rand(), rand() * 0.5);
    }
    hang(tail.build(), true);
    // The tie: a short leather band round the gather, facing out.
    const band = new Builder();
    const axis = new THREE.Vector3(0, -0.45, -0.9).normalize();
    const u = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(0, 1, 0)).normalize();
    const v = new THREE.Vector3().crossVectors(axis, u).normalize();
    const SEG = 10;
    const ring: number[][] = [];
    for (let i = 0; i <= SEG; i++) {
      const th = (i / SEG) * TWO_PI;
      const out = new THREE.Vector3().addScaledVector(u, Math.cos(th)).addScaledVector(v, Math.sin(th));
      const row: number[] = [];
      for (const along of [-0.07, 0.07]) {
        p.copy(gather).addScaledVector(axis, along * hr).addScaledVector(out, 0.24 * hr);
        row.push(band.vertex(p, out, (i / SEG) * 2, 0.3 + (along > 0 ? 0.2 : 0), 0.6));
      }
      ring.push(row);
    }
    for (let i = 0; i < SEG; i++) band.quad(ring[i][0], ring[i][1], ring[i + 1][1], ring[i + 1][0]);
    const bandGeo = band.build();
    if (bandGeo) {
      const tie = new THREE.Mesh(bandGeo, tieMaterial());
      tie.name = 'hair-tie';
      tie.castShadow = true;
      tie.receiveShadow = true;
      group.add(tie);
    }
  }
  return group;
}
