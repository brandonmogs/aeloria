import * as THREE from 'three';
import type { Rig } from './characters';
import { hairDetail } from './characterTextures';
import { seeded } from './texgen';

/**
 * Hair as geometry, in the manner of a Lineage 2 character: a glossy,
 * volumetric cap shrink-wrapped to the actual skull, a sheet of hair falling
 * down the back for long styles, and strand cards (alpha-tested ribbons)
 * for a swept fringe and the locks in front of the ears.
 *
 * The scalp is measured from the finished head mesh (see human.ts): for
 * every direction out of a point inside the skull, the furthest skin. The
 * cap sits on that at a style-dependent thickness, thinning to nothing at a
 * hairline that runs high across the forehead, dips at the temples, clears
 * the ears and drops to the nape. Everything is sized from the skull's
 * half-width, so it fits whatever head the figure was built with.
 */

export type HairStyle = 'short' | 'long' | 'bald';

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

// --- Textures -------------------------------------------------------------------------

export interface StrandTextures {
  /** Opaque: pale streaks the material's colour multiplies. */
  albedo: THREE.CanvasTexture;
  /** The same streaks, solid for the upper half and thinning to wisps toward the bottom. */
  card: THREE.CanvasTexture;
}

let strands: StrandTextures | null = null;

/** Paint streaks running down a canvas, wrapping horizontally so they tile around the head. */
function paintStrands(ctx: CanvasRenderingContext2D, W: number, H: number, count: number, seed: number, minWidth: number): void {
  const r = seeded(seed);
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    let x = r() * W;
    const width = minWidth + r() * 2.4;
    const lum = Math.round(255 * (0.62 + 0.5 * r()));
    ctx.lineWidth = width;
    ctx.strokeStyle = `rgb(${lum},${lum},${lum})`;
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
  // decays strand by strand toward the tips.
  const cardCanvas = document.createElement('canvas');
  cardCanvas.width = W;
  cardCanvas.height = H;
  const cctx = cardCanvas.getContext('2d')!;
  cctx.drawImage(albedoCanvas, 0, 0);
  const img = cctx.getImageData(0, 0, W, H);
  const d = img.data;
  const r = seeded(11);
  // Strand ends: a slow wave across the width (locks) plus a little per-strand
  // scatter, so the hem tapers into soft locks rather than a comb of spikes.
  // Every strand reaches the bottom fifth of the texture, so a ribbon is a
  // solid lock until its last stretch, where the strands let go one by one.
  const ends = new Float32Array(W);
  for (let x = 0; x < W; x += 3) {
    const wave = 0.5 + 0.5 * Math.sin((x / W) * Math.PI * 2 * 2 + 0.7) * Math.sin((x / W) * Math.PI * 2 * 3.3);
    const e = 0.74 + 0.23 * wave + 0.03 * r();
    for (let k = 0; k < 3 && x + k < W; k++) ends[x + k] = e;
  }
  for (let y = 0; y < H; y++) {
    const t = y / H;
    for (let x = 0; x < W; x++) {
      const e = ends[x];
      const fade = 0.16;
      const a = t < e - fade ? 1 : t > e ? 0 : (e - t) / fade;
      d[(y * W + x) * 4 + 3] = Math.round(255 * a * a);
    }
  }
  cctx.putImageData(img, 0, 0);

  const albedo = new THREE.CanvasTexture(albedoCanvas);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.wrapS = albedo.wrapT = THREE.RepeatWrapping;
  albedo.anisotropy = 8;
  const card = new THREE.CanvasTexture(cardCanvas);
  card.colorSpace = THREE.SRGBColorSpace;
  card.wrapS = THREE.RepeatWrapping;
  card.wrapT = THREE.ClampToEdgeWrapping;
  card.anisotropy = 8;
  strands = { albedo, card };
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
    envMapIntensity: 0.22,
    specularIntensity: 0.35,
    specularColor: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.5),
    normalMap: hairDetail().normal,
    normalScale: new THREE.Vector2(0.5, 0.5),
    anisotropy: 0.6,
    anisotropyRotation: 0,
    ...(cards ? { alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide } : {}),
  });
  m.name = cards ? 'hair-cards' : 'hair-cap';
  materialCache.set(key, m);
  return m;
}

// --- Geometry -------------------------------------------------------------------------

/** Accumulates triangles with position, normal, uv and colour. */
class Builder {
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
  const nape = h.earY - (style === 'long' ? 0.9 : 1.0) * h.hr;
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

/** How far the hair falls below the nape at azimuth `a`, in skull widths (long styles only). */
function fallLength(a: number, style: HairStyle): number {
  if (style !== 'long') return 0;
  const t = fold(a);
  const back = smooth(t, 1.45, 1.95);
  return back * (2.4 + 1.0 * ((t - 1.45) / (Math.PI - 1.45)));
}

/** Hair thickness over the scalp at azimuth `a` and cap parameter `v` (0 crown, 1 rim). */
function thickness(a: number, v: number, style: HairStyle, hr: number): number {
  const t = fold(a);
  const base = style === 'long' ? hr * (0.17 + 0.13 * (t / Math.PI)) : hr * (0.085 + 0.06 * (t / Math.PI));
  // Short hair thins toward the skin at its edge (never quite to it, so the
  // skin can't poke through); long hair keeps its body into the fall.
  const keeps = smooth(fallLength(a, style), 0, 0.8);
  const taper = 1 - (1 - keeps) * v * v * v * 0.85;
  // Clumps: locks swelling and parting around the head, more so toward the rim.
  const clump = 1 + (0.14 + 0.16 * v) * Math.sin(a * 7 + 1.3) * Math.sin(a * 3.1 + v * 4) + 0.1 * Math.sin(a * 11 + v * 6);
  return base * taper * clump;
}

/** A ragged hairline: the rim wanders up and down a little around the head. */
function rimNoise(a: number): number {
  return 0.035 * Math.sin(a * 9 + 0.4) + 0.025 * Math.sin(a * 4.7 + 2.1);
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
    const column: number[] = [];
    for (let r = 0; r <= ROWS; r++) {
      const v = r / ROWS;
      const e = v * eRim;
      direction(a, e, dir);
      const off = thickness(a, v, style, hr);
      p.copy(C).addScaledVector(dir, scalpRadius(scalp, a, e) + off);
      // Lighting normals lean radial so the cap shades as one rounded mass.
      n.copy(dir);
      column.push(cap.vertex(p, n, (c / COLS) * 4, v * 0.9, 1 - 0.18 * v));
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

  // --- Cards: fall, fringe and side locks, all strand-textured ribbons.
  const cards = new Builder();

  // The fall: from the nape down the back, widening a little and hanging just
  // clear of the shoulders, ending in wisps. Its own mesh: a helmet hides the
  // cap and fringe but long hair still falls out the back.
  if (style === 'long') {
    const fall = new Builder();
    const K = 8;
    const fallGrid: number[][] = [];
    for (let c = 0; c <= COLS; c++) {
      const a = (c / COLS) * TWO_PI;
      const len = fallLength(a, style) * hr;
      const column: number[] = [];
      if (len > 0.01 * hr) {
        const base = rimPoint[c];
        n.set(Math.sin(a), 0.15, Math.cos(a)).normalize();
        for (let k = 0; k <= K; k++) {
          const t = k / K;
          const sway = Math.sin(a * 4 + seed) * 0.08 * hr * t;
          p.set(base.x * (1 + 0.5 * t) + sway, base.y + 0.12 * hr - len * t, base.z - (0.35 * t + 0.25 * t * t) * hr);
          column.push(fall.vertex(p, n, (c / COLS) * 4, 0.2 + 0.8 * t, 0.78 + 0.14 * t, 1 - 0.45 * smooth(t, 0.7, 1)));
        }
      }
      fallGrid.push(column);
    }
    for (let c = 0; c < COLS; c++) {
      const l = fallGrid[c];
      const r = fallGrid[c + 1];
      if (l.length === 0 || r.length === 0) continue;
      for (let k = 0; k < K; k++) fall.quad(l[k], l[k + 1], r[k + 1], r[k]);
    }
    const fallGeo = fall.build();
    if (fallGeo) {
      const mesh = new THREE.Mesh(fallGeo, hairMaterial(color, true));
      mesh.name = 'hair-fall';
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.noAO = true;
      group.add(mesh);
    }
  }

  // The fringe: curtain bangs from under the cap's front rim, parted a little
  // right of centre. Each column follows the skull down the forehead, slides
  // away from the parting as it falls and lifts off toward tips that thin out
  // above the brows; the columns nearest the parting are the shortest, the
  // ones at the temples the longest.
  const long = style === 'long';
  {
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
  const locks: Array<[number, number]> = long ? [[-0.3, 1.0], [0.05, 0.8], [-0.5, -0.45]] : [[-0.2, 0.9], [-0.45, -0.4]];
  for (const [a0, sweepK] of locks) {
    const a = a0 + (rand() - 0.5) * 0.08;
    const eRim = rimElevation(scalp, a, hairlineY(a, h, style));
    const drop = (long ? 0.55 : 0.4) * hr * (0.85 + 0.3 * rand());
    const sweep = sweepK * (long ? 0.5 : 0.35) * hr * (0.85 + 0.3 * rand());
    ribbon(cards, curve(a, eRim - 0.12, 0.14 * hr, sweep, drop, 0.16 * hr), C, 0.5 * hr, 0.22 * hr, 0.92 + 0.08 * rand(), rand() * 0.5);
  }

  // Side locks in front of the ears, down to the jaw.
  if (style === 'long') {
    for (const sign of [1, -1]) {
      for (const [t, len] of [[1.12, 1.5], [1.32, 1.15]] as const) {
        const a0 = sign * t;
        const eRim = rimElevation(scalp, a0, hairlineY(a0, h, style));
        ribbon(cards, curve(a0, eRim - 0.08, 0.08 * hr, sign * 0.08 * hr, len * hr * (0.9 + 0.2 * rand()), 0.2 * hr), C, 0.38 * hr, 0.14 * hr, 0.85, rand() * 0.5);
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
  return group;
}
