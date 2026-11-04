import * as THREE from 'three';
import { JOINTS, JointName } from './characters';
import type { HumanTemplate } from './human';
import { skinDetail } from './characterTextures';
import { HairStyle, hairlineY } from './hair';
import { tileableNoise } from './texgen';

/**
 * Skin for the human template: clothes, hair and the face are painted straight
 * onto the body's UV atlas, so the figure keeps the sculpted anatomy of the
 * mesh (like a base mesh in a bodysuit) while reading as dressed.
 *
 * The atlas is rasterised once per template: every triangle is filled with
 * its body region (which joint owns it) and its rest-pose position relative
 * to that joint, packed into the pixel, then padded outward so nothing bleeds
 * in at the UV seams. Each look is a per-pixel pass over that atlas: region
 * and position decide tunic, trousers, boots, belt, hair or skin; brows,
 * lids, lips, nostrils and cheeks come from the face landmarks; a mottle
 * breaks up the flat colour. A matching roughness map keeps cloth dull and
 * skin soft.
 */

/** Facial hair, from none to a full beard; stubble, goatee and short are painted, full is painted and grown. */
export type BeardStyle = 'none' | 'stubble' | 'goatee' | 'short' | 'full';
export const BEARD_STYLES: readonly BeardStyle[] = ['none', 'stubble', 'goatee', 'short', 'full'];
/** A healed scar across the face. */
export type ScarStyle = 'none' | 'brow' | 'cheek' | 'lip' | 'eye';
export const SCAR_STYLES: readonly ScarStyle[] = ['none', 'brow', 'cheek', 'lip', 'eye'];
/** War paint: a stripe down one eye, bars under both, claw marks on a cheek, a row of dots over the brows. */
export type PaintStyle = 'none' | 'stripe' | 'bars' | 'claw' | 'dots';
export const PAINT_STYLES: readonly PaintStyle[] = ['none', 'stripe', 'bars', 'claw', 'dots'];

/** What is painted onto a face beyond its skin: makeup and marks, each strength 0 to 1. */
export interface FaceStyle {
  beard: BeardStyle;
  beardColor: number;
  lips: number;
  lipColor: number;
  shadow: number;
  shadowColor: number;
  blush: number;
  freckles: number;
  scar: ScarStyle;
  paint: PaintStyle;
  paintColor: number;
}

export const PLAIN_FACE: FaceStyle = { beard: 'none', beardColor: 0x2a1a10, lips: 0, lipColor: 0x9a2f3a, shadow: 0, shadowColor: 0x4a3a5a, blush: 0, freckles: 0, scar: 'none', paint: 'none', paintColor: 0xf0f0f0 };

export interface LookSpec {
  skin: number;
  hair: number;
  eyes: number;
  tunic: number;
  trouser: number;
  boots: number;
  hairStyle: HairStyle;
  sleeves: 'long' | 'short' | 'none';
  trousers: 'full' | 'ragged' | 'none';
  shirt: boolean;
  booted: boolean;
  /** Leather bracers on bare forearms. */
  bracers: boolean;
  goblin: boolean;
  /** Beard, makeup and marks; plain when left out. */
  face?: FaceStyle;
}

const SIZE = 1024;
const NONE = 16; // region id for pixels no triangle covered
const PAD = 10; // seam padding in pixels

/** Packing ranges for positions relative to each region's joint, in metres. */
type Range = { y: [number, number]; x: [number, number]; z: [number, number] };
const RANGES: Record<string, Range> = {
  head: { y: [-0.16, 0.2], x: [-0.13, 0.13], z: [-0.13, 0.21] },
  neck: { y: [-0.06, 0.16], x: [-0.1, 0.1], z: [-0.1, 0.12] },
  spine: { y: [-0.25, 0.55], x: [-0.26, 0.26], z: [-0.2, 0.25] },
  hips: { y: [-0.3, 0.3], x: [-0.26, 0.26], z: [-0.2, 0.25] },
  thighL: { y: [-0.55, 0.15], x: [-0.2, 0.2], z: [-0.2, 0.2] },
  thighR: { y: [-0.55, 0.15], x: [-0.2, 0.2], z: [-0.2, 0.2] },
  kneeL: { y: [-0.5, 0.1], x: [-0.15, 0.15], z: [-0.15, 0.15] },
  kneeR: { y: [-0.5, 0.1], x: [-0.15, 0.15], z: [-0.15, 0.15] },
  footL: { y: [-0.1, 0.15], x: [-0.12, 0.12], z: [-0.12, 0.25] },
  footR: { y: [-0.1, 0.15], x: [-0.12, 0.12], z: [-0.12, 0.25] },
  shoulderL: { y: [-0.35, 0.12], x: [-0.15, 0.15], z: [-0.15, 0.15] },
  shoulderR: { y: [-0.35, 0.12], x: [-0.15, 0.15], z: [-0.15, 0.15] },
  elbowL: { y: [-0.35, 0.1], x: [-0.12, 0.12], z: [-0.12, 0.12] },
  elbowR: { y: [-0.35, 0.1], x: [-0.12, 0.12], z: [-0.12, 0.12] },
  handL: { y: [-0.25, 0.06], x: [-0.12, 0.12], z: [-0.12, 0.12] },
  handR: { y: [-0.25, 0.06], x: [-0.12, 0.12], z: [-0.12, 0.12] },
  none: { y: [0, 1.8], x: [-0.3, 0.3], z: [-0.2, 0.3] },
};

interface Atlas {
  /** Packed per pixel: r = region << 3, g = y, b = x, a = 1 + z, all relative to the region's joint. */
  data: Uint8ClampedArray;
  /** Fine noise for mottle, broad noise for hairlines and hems. */
  fine: Float32Array;
  broad: Float32Array;
  /** Template y of the seam where the lips meet (the mouth landmark is the upper lip's most forward point). */
  lipSplit: number;
}

const atlasCache = new WeakMap<HumanTemplate, Atlas>();
const materialCache = new Map<string, THREE.MeshStandardMaterial>();
const eyeCache = new Map<string, THREE.MeshStandardMaterial>();

const q = (v: number, [lo, hi]: [number, number], steps: number): number => Math.max(0, Math.min(steps, Math.round(((v - lo) / (hi - lo)) * steps)));

function bakeAtlas(T: HumanTemplate): Atlas {
  const hit = atlasCache.get(T);
  if (hit) return hit;
  // Rasterised by hand: a canvas would antialias the edges and blend the packed
  // codes of neighbouring triangles into nonsense.
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i++) data[i * 4] = NONE << 3;
  const idx = T.indices;
  const P = T.positions;
  const UV = T.uvs;
  const w = new Map<number, number>();
  const ownerIndex = T.owner.map((o) => JOINTS.indexOf(o));
  const MARGIN = 0.6; // pixels outside an edge still count, so adjacent triangles leave no cracks
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t];
    const b = idx[t + 1];
    const c = idx[t + 2];
    // The joint that owns most of the triangle.
    w.clear();
    for (const vi of [a, b, c]) {
      for (let k = 0; k < 4; k++) {
        const wt = T.skinWeight[vi * 4 + k];
        if (wt <= 0) continue;
        const j = ownerIndex[T.skinIndex[vi * 4 + k]];
        w.set(j, (w.get(j) ?? 0) + wt);
      }
    }
    let region = 0;
    let best = -1;
    for (const [j, wt] of w) if (wt > best) { best = wt; region = j; }
    const joint = T.joints[JOINTS[region]];
    const range = RANGES[JOINTS[region]];
    const code0 = region << 3;
    const ax = UV[a * 2] * SIZE;
    const ay = (1 - UV[a * 2 + 1]) * SIZE;
    const bx = UV[b * 2] * SIZE;
    const by = (1 - UV[b * 2 + 1]) * SIZE;
    const cxp = UV[c * 2] * SIZE;
    const cyp = (1 - UV[c * 2 + 1]) * SIZE;
    const area = (bx - ax) * (cyp - ay) - (by - ay) * (cxp - ax);
    if (Math.abs(area) < 1e-9) continue;
    const sgn = area > 0 ? 1 : -1;
    const lab = Math.hypot(bx - ax, by - ay) || 1;
    const lbc = Math.hypot(cxp - bx, cyp - by) || 1;
    const lca = Math.hypot(ax - cxp, ay - cyp) || 1;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cxp)) - 1);
    const x1 = Math.min(SIZE - 1, Math.ceil(Math.max(ax, bx, cxp)) + 1);
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cyp)) - 1);
    const y1 = Math.min(SIZE - 1, Math.ceil(Math.max(ay, by, cyp)) + 1);
    for (let py = y0; py <= y1; py++) {
      const y = py + 0.5;
      for (let px = x0; px <= x1; px++) {
        const x = px + 0.5;
        // Signed distances to the three edges, positive inside.
        const e0 = (((bx - ax) * (y - ay) - (by - ay) * (x - ax)) * sgn) / lab;
        if (e0 < -MARGIN) continue;
        const e1 = (((cxp - bx) * (y - by) - (cyp - by) * (x - bx)) * sgn) / lbc;
        if (e1 < -MARGIN) continue;
        const e2 = (((ax - cxp) * (y - cyp) - (ay - cyp) * (x - cxp)) * sgn) / lca;
        if (e2 < -MARGIN) continue;
        // Barycentric weights from the edge distances, so every pixel carries
        // its own position and painted lines run smoothly across triangles.
        let wa = Math.max(0, e1 * lbc);
        let wb = Math.max(0, e2 * lca);
        let wc = Math.max(0, e0 * lab);
        const ws = wa + wb + wc || 1;
        wa /= ws;
        wb /= ws;
        wc /= ws;
        const vx = wa * P[a * 3] + wb * P[b * 3] + wc * P[c * 3];
        const vy = wa * P[a * 3 + 1] + wb * P[b * 3 + 1] + wc * P[c * 3 + 1];
        const vz = wa * P[a * 3 + 2] + wb * P[b * 3 + 2] + wc * P[c * 3 + 2];
        const i = (py * SIZE + px) * 4;
        data[i] = code0;
        data[i + 1] = q(vy - joint.y, range.y, 255);
        data[i + 2] = q(vx - joint.x, range.x, 255);
        data[i + 3] = 1 + q(vz - joint.z, range.z, 254);
      }
    }
  }
  // Pad every island outward so filtering and mipmaps never pull in the background.
  const covered = new Uint8Array(SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) covered[i] = data[i * 4 + 3] ? 1 : 0;
  const next = new Uint8Array(SIZE * SIZE);
  for (let pass = 0; pass < PAD; pass++) {
    next.set(covered);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const i = y * SIZE + x;
        if (covered[i]) continue;
        const from = x > 0 && covered[i - 1] ? i - 1 : x < SIZE - 1 && covered[i + 1] ? i + 1 : y > 0 && covered[i - SIZE] ? i - SIZE : y < SIZE - 1 && covered[i + SIZE] ? i + SIZE : -1;
        if (from < 0) continue;
        data[i * 4] = data[from * 4];
        data[i * 4 + 1] = data[from * 4 + 1];
        data[i * 4 + 2] = data[from * 4 + 2];
        data[i * 4 + 3] = data[from * 4 + 3];
        next[i] = 1;
      }
    }
    covered.set(next);
  }
  // The seam between the lips: the densest ring of vertices on the centreline
  // below the mouth landmark, where the lip margins turn into the mouth.
  const lm = T.landmarks;
  const rings = new Map<number, number>();
  for (let v = 0; v < P.length; v += 3) {
    const y = P[v + 1];
    if (Math.abs(P[v]) > 0.006 || y > lm.mouth.y - 0.003 || y < lm.mouth.y - 0.015 || P[v + 2] < lm.mouth.z - 0.014) continue;
    const k = Math.round((lm.mouth.y - y) * 1000);
    rings.set(k, (rings.get(k) ?? 0) + 1);
  }
  let lipSplit = lm.mouth.y - 0.008;
  let fullest = 0;
  for (const [k, n] of rings) {
    if (n > fullest) {
      fullest = n;
      lipSplit = lm.mouth.y - k / 1000;
    }
  }
  const atlas = { data, fine: tileableNoise(SIZE, 5, 91, 6), broad: tileableNoise(SIZE, 2, 92, 2), lipSplit };
  atlasCache.set(T, atlas);
  return atlas;
}

type RGB = [number, number, number];
const rgb = (hex: number): RGB => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scale = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
/** A 0..1 hash of an integer, for stubble and freckles: speckle finer than the noise. */
const hash = (i: number): number => {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

/** The baked colour and roughness maps for a look. */
function lookMaps(T: HumanTemplate, look: LookSpec): { map: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture } {
  const atlas = bakeAtlas(T);
  const lm = T.landmarks;
  const J = T.joints;
  const skin = rgb(look.skin);
  const hair = rgb(look.hair);
  const tunic = rgb(look.tunic);
  const trouser = rgb(look.trouser);
  const boots = rgb(look.boots);
  const leather = rgb(0x3a2a1c);
  const strap = rgb(0x2a1d12);
  const buckle = rgb(0xc9a85a);
  const piping = rgb(0xb8963f);
  const undershirt = rgb(0xe9e1cc);
  const lip = mix(skin, rgb(look.goblin ? 0x3a3020 : 0x9a4444), 0.45);
  const f = look.face ?? PLAIN_FACE;
  const beardCol = scale(rgb(f.beardColor), 0.7);
  /** Distance from (px, py) to the segment (ax0, ay0)-(bx, by), for scars and paint. */
  const segDist = (px: number, py: number, ax0: number, ay0: number, bx: number, by: number): number => {
    const dx = bx - ax0;
    const dy = by - ay0;
    const t = clamp01(((px - ax0) * dx + (py - ay0) * dy) / (dx * dx + dy * dy));
    return Math.hypot(px - ax0 - t * dx, py - ay0 - t * dy);
  };
  const dark = rgb(0x1a1210);
  const white = rgb(0xffffff);
  const smooth = (v: number, a: number, b: number): number => {
    const t = clamp01((v - a) / (b - a));
    return t * t * (3 - 2 * t);
  };
  // Face landmarks in head-local metres.
  const H = J.head;
  const eye = { x: Math.abs(lm.eyeL.x - H.x), y: lm.eyeL.y - H.y };
  const nose = { y: lm.noseTip.y - H.y, z: lm.noseTip.z - H.z };
  const mouth = { y: lm.mouth.y - H.y, z: lm.mouth.z - H.z, half: lm.mouthHalfWidth };
  const chin = { y: lm.chin.y - H.y, z: lm.chin.z - H.z, bottom: lm.chinBottom.y - H.y };
  const lipSplit = atlas.lipSplit - H.y;
  const hairFrame = { hr: lm.skullHalfWidth, browY: lm.brow[1].y - H.y, earY: lm.earL.y - H.y };
  const skullCz = (lm.skullFront + lm.skullBack) / 2 - H.z;
  // Clothing lines, relative to the joints that own the surrounding triangles.
  const beltY = J.spine.y + 0.06;
  const neckSpine = J.neck.y - J.spine.y;
  const vTop = neckSpine + 0.02;
  const vDepth = 0.13;
  const tabardHem = beltY - 0.11;
  const sleeveEnd = -0.16;
  const cuff = J.handL.y - J.elbowL.y + 0.012;
  const hemKnee = J.kneeL.y - J.thighL.y + 0.04;
  const bootTopKnee = J.footL.y - J.kneeL.y + 0.19;
  const soleFoot = -J.footL.y + 0.018;

  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = SIZE;
  colorCanvas.height = SIZE;
  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = SIZE;
  roughCanvas.height = SIZE;
  const cctx = colorCanvas.getContext('2d')!;
  const rctx = roughCanvas.getContext('2d')!;
  const cimg = cctx.createImageData(SIZE, SIZE);
  const rimg = rctx.createImageData(SIZE, SIZE);
  const cd = cimg.data;
  const rd = rimg.data;
  const src = atlas.data;

  for (let i = 0; i < SIZE * SIZE; i++) {
    const r = src[i * 4];
    const region = r >> 3;
    const name: JointName | 'none' = region < JOINTS.length ? JOINTS[region] : 'none';
    const range = RANGES[name];
    const z = range.z[0] + ((src[i * 4 + 3] - 1) / 254) * (range.z[1] - range.z[0]);
    const y = range.y[0] + (src[i * 4 + 1] / 255) * (range.y[1] - range.y[0]);
    const x = range.x[0] + (src[i * 4 + 2] / 255) * (range.x[1] - range.x[0]);
    const ax = Math.abs(x);
    const nz = atlas.fine[i];
    const nb = atlas.broad[i];
    let col: RGB = skin;
    let rough = 0.52;
    let mottle = look.goblin ? 0.18 : 0.07;
    /** Painted cloth, leather or hair rather than skin: left out of the skin mask. */
    let cloth = false;

    switch (name) {
      case 'head': {
        // Hair over the crown, dropping to the nape at the back, leaving the ears and face.
        const ear = ax > 0.058 && y < eye.y + 0.028 && z > -0.02 && z < 0.06;
        if (look.hairStyle !== 'bald') {
          // The painted scalp under the hair geometry (see hair.ts) follows
          // the cap's own hairline, a touch above it, so the cap's edge is
          // what shows, never a painted one.
          const hairline = hairlineY(Math.atan2(x, z - skullCz), hairFrame, look.hairStyle) + 0.01;
          if (y > hairline && !ear) {
            col = hair;
            rough = 0.62;
            mottle = 0.22;
            cloth = true;
            break;
          }
        }
        rough = 0.5;
        if (ear) {
          col = mix(col, rgb(0xd08a6a), 0.1);
          break;
        }
        if (z > 0.06) {
          const dy = y - eye.y;
          const dxe = ax - eye.x;
          // The forehead and the nose carry a little more sheen than the cheeks.
          if ((ax < 0.014 && y > nose.y - 0.01) || (y > eye.y + 0.02 && ax < 0.045)) rough = 0.44;
          // Brows: thin and arched, peaking past the middle and tapering into a tail.
          if (ax > 0.009 && ax < 0.057) {
            const t = (ax - 0.009) / 0.048;
            const arch = eye.y + 0.02 + 0.006 * Math.sin(Math.PI * Math.min(1, t * 1.15)) - 0.003 * smooth(t, 0.8, 1);
            const half = (0.0028 + 0.0008 * Math.sin(Math.PI * t)) * (1 - 0.55 * smooth(t, 0.6, 1));
            const d = Math.abs(y - arch) / half;
            // Faint: the brow itself is strands (see faceFeatures.ts); this is the shadow under them.
            if (d < 1) col = mix(col, scale(hair, 0.6), (look.goblin ? 0.6 : 0.4) * (1 - smooth(d, 0.3, 1)));
          }
          // Lids: a soft shadow in the crease above the eye and a faint one
          // below it. The lashes are strands (see faceFeatures.ts); a painted
          // line at this texture's resolution is a staircase.
          const de = Math.hypot(dxe, dy);
          if (dy > 0.003 && dy < 0.017 && Math.abs(dxe) < 0.017) {
            col = mix(col, scale(skin, 0.7), 0.16 * (1 - smooth(dy, 0.009, 0.017)) * (1 - smooth(Math.abs(dxe), 0.011, 0.017)));
          }
          if (de < 0.02 && dy < 0) col = mix(col, scale(skin, 0.75), 0.07 * (1 - de / 0.02));
          // Nose: the sides of the bridge fall into shade; the nostrils are dark.
          const dny = y - nose.y;
          if (dny > 0.004 && dny < 0.045 && ax > 0.004 && ax < 0.02 && z > nose.z - 0.05) {
            col = mix(col, scale(skin, 0.78), 0.1 * smooth(ax, 0.004, 0.009) * (1 - smooth(ax, 0.012, 0.02)));
          }
          const dn = Math.hypot(ax - 0.009, y - (nose.y - 0.006));
          if (dn < 0.0036 && z > nose.z - 0.035) col = mix(col, scale(skin, 0.45), 0.7 * (1 - dn / 0.0036));
          // Lips: the upper lip from the seam (read off the mesh) up to its
          // border just above the mouth landmark, a fuller lower lip with a
          // highlight below it, both tapering into the corners.
          const halfW = mouth.half * 0.6;
          if (ax < halfW && z > mouth.z - 0.05) {
            const dm = y - lipSplit;
            const edge = clamp01(1 - (ax / halfW) * (ax / halfW));
            const lipH = mouth.y + 0.0025 - lipSplit;
            const up = lipH * (0.3 + 0.7 * edge);
            const down = 0.9 * lipH * (0.3 + 0.7 * edge);
            if (dm > 0 && dm < up) col = mix(col, lip, 0.4 * (1 - smooth(dm / up, 0.7, 1)));
            if (dm < 0 && dm > -down) {
              col = mix(col, lip, 0.5 * (1 - smooth(-dm / down, 0.7, 1)));
              const hl = (1 - smooth(Math.abs(dm + 0.45 * down), 0.1 * down, 0.28 * down)) * (1 - smooth(ax, 0.008, 0.016));
              col = mix(col, white, 0.14 * hl);
              rough = 0.38;
            }
            if (f.lips > 0) {
              const band = dm > 0 ? (dm < up ? 1 - smooth(dm / up, 0.8, 1) : 0) : dm > -down ? 1 - smooth(-dm / down, 0.8, 1) : 0;
              col = mix(col, rgb(f.lipColor), 0.85 * f.lips * band);
              if (band > 0.5) rough = 0.3;
            }
            if (Math.abs(dm) < 0.0006) col = mix(col, dark, 0.32 * (0.3 + 0.7 * edge));
          }
          // Cheek warmth.
          const dc = Math.hypot(ax - 0.046, y - (eye.y - 0.04));
          if (dc < 0.035 && !look.goblin) col = mix(col, rgb(0xc86a5a), 0.16 * (1 - dc / 0.035));
          if (!look.goblin) {
            // Eyeshadow over the lids, up to the crease; blush high on the cheeks.
            if (f.shadow > 0 && dy > 0.0005 && dy < 0.012 && Math.abs(dxe) < 0.016) {
              const sh = smooth(dy, 0.0005, 0.0025) * (1 - smooth(dy, 0.0065, 0.012)) * (1 - smooth(Math.abs(dxe), 0.009, 0.016));
              col = mix(col, rgb(f.shadowColor), 0.75 * f.shadow * sh);
            }
            const db = Math.hypot(ax - 0.042, y - (eye.y - 0.035));
            if (f.blush > 0 && db < 0.03) col = mix(col, rgb(0xd4707a), 0.45 * f.blush * (1 - db / 0.03) * (1 - db / 0.03));
            // Freckles: hashed dots a few millimetres apart over the cheeks and the nose, more of them the higher the slider.
            if (f.freckles > 0 && y < eye.y - 0.004 && y > eye.y - 0.052 && ax < 0.056) {
              const cell = 0.0042;
              const cx = Math.floor(x / cell);
              const cy = Math.floor(y / cell);
              const seed = cx * 73856093 + cy * 19349663;
              if (hash(seed) < 0.15 + 0.5 * f.freckles) {
                const fx = (cx + 0.25 + 0.5 * hash(seed + 1)) * cell;
                const fy = (cy + 0.25 + 0.5 * hash(seed + 2)) * cell;
                const rr = 0.0009 + 0.0005 * hash(seed + 3);
                const d = Math.hypot(x - fx, y - fy);
                col = mix(col, mix(skin, rgb(0x9a5a34), 0.5), (0.3 + 0.3 * hash(seed + 4)) * (1 - smooth(d, rr * 0.3, rr * 1.2)));
              }
            }
            // A scar: a pale, slightly glossy seam with a darker rim, soft enough to survive the texel grid.
            if (f.scar !== 'none') {
              const seg: [number, number, number, number] =
                f.scar === 'brow' ? [0.02, eye.y + 0.034, 0.036, eye.y + 0.012]
                : f.scar === 'cheek' ? [0.052, eye.y - 0.012, 0.03, eye.y - 0.05]
                : f.scar === 'lip' ? [0.013, mouth.y + 0.014, 0.008, mouth.y - 0.005]
                : [0.04, eye.y + 0.02, 0.028, eye.y - 0.024];
              const ds = segDist(x, y, ...seg);
              if (ds < 0.003) {
                const core = 1 - smooth(ds, 0.0004, 0.0014);
                const rim = smooth(ds, 0.0005, 0.0013) * (1 - smooth(ds, 0.0018, 0.003));
                col = mix(col, mix(skin, rgb(0xeab4a4), 0.7), 0.9 * core);
                col = mix(col, scale(skin, 0.7), 0.6 * rim);
                rough = rough - 0.18 * core;
              }
            }
            // War paint, weathered by the broad noise.
            if (f.paint !== 'none') {
              let w = 0;
              if (f.paint === 'stripe') {
                w = (1 - smooth(Math.abs(x - 0.03), 0.005, 0.0085)) * smooth(y, eye.y - 0.06, eye.y - 0.054) * (1 - smooth(y, eye.y + 0.034, eye.y + 0.04));
              } else if (f.paint === 'bars') {
                const along = 1 - smooth(Math.abs(ax - 0.03), 0.016, 0.021);
                w = along * Math.max(1 - smooth(Math.abs(y - (eye.y - 0.022)), 0.0035, 0.0055), 1 - smooth(Math.abs(y - (eye.y - 0.036)), 0.0035, 0.0055));
              } else if (f.paint === 'claw') {
                for (let k = 0; k < 3; k++) {
                  const d = segDist(x, y, -0.058, eye.y - 0.004 - 0.009 * k, -0.026, eye.y - 0.036 - 0.009 * k);
                  w = Math.max(w, 1 - smooth(d, 0.0012, 0.0032));
                }
              } else {
                for (const [cx, cy] of [[0.016, eye.y - 0.021], [0.03, eye.y - 0.026], [0.044, eye.y - 0.033]] as const) {
                  w = Math.max(w, 1 - smooth(Math.hypot(ax - cx, y - cy), 0.0022, 0.0034));
                }
              }
              if (w > 0) {
                col = mix(col, rgb(f.paintColor), 0.9 * w * (0.75 + 0.25 * nb));
                rough = Math.max(rough, 0.62);
              }
            }
          }
        }
        // Facial hair: over the upper lip, down the chin and along the jaw, denser by style, broken into hairs by the
        // fine noise; the full beard also hangs as geometry from the chin.
        if (f.beard !== 'none' && !look.goblin && y < eye.y - 0.015) {
          const noseBase = nose.y - 0.006;
          // The bare zone round the lips narrows toward the corners, as the lips do.
          const lipHalf = mouth.half * 0.72;
          const taper = 1 - 0.55 * clamp01((ax / lipHalf) * (ax / lipHalf));
          const lipTop = lipSplit + (mouth.y + 0.004 - lipSplit) * taper;
          const lipBottom = lipSplit - 0.011 * taper;
          // The cheek line runs from the sideburn down to the corner of the mouth, higher for a full beard.
          const earLine = f.beard === 'full' ? eye.y - 0.028 : eye.y - 0.042;
          const cornerY = f.beard === 'full' ? mouth.y + 0.012 : mouth.y + 0.004;
          const cheekLine = cornerY + (earLine - cornerY) * clamp01((ax - 0.042) / 0.03);
          const front = z > mouth.z - 0.06;
          const moustache = front && ax < mouth.half * 1.3 && y > lipTop && y < noseBase ? smooth(y, lipTop, lipTop + 0.002) * (1 - smooth(y, noseBase - 0.003, noseBase)) * (1 - smooth(ax, mouth.half * 1.05, mouth.half * 1.3)) : 0;
          const chinPatch = y < lipBottom && z > chin.z - 0.09 ? 1 - smooth(y, lipBottom - 0.003, lipBottom) : 0;
          const cheekIn = y > lipBottom && y < lipTop ? lipHalf : 0.024; // clear of the lips
          const cheek = ax > cheekIn && y < cheekLine && z > -0.01 ? smooth(ax, cheekIn, cheekIn + 0.008) * (1 - smooth(y, cheekLine - 0.006, cheekLine)) : 0;
          let m = f.beard === 'goatee' ? Math.max(moustache, chinPatch * (1 - smooth(ax, 0.018, 0.027))) : Math.max(moustache, chinPatch, cheek);
          m *= 1 - smooth(chin.bottom - y, 0.008, 0.022); // thinning out under the chin
          if (m > 0) {
            // Hashed hairs: fewer texels carry one toward the edges and in stubble.
            const h = hash(i);
            const share = f.beard === 'stubble' ? 0.12 + 0.5 * m : 0.4 + 0.6 * m;
            const grain = h < share ? 0.55 + 0.9 * (h / share) : 0.1;
            const density = f.beard === 'stubble' ? 0.6 : f.beard === 'goatee' ? 0.85 : f.beard === 'short' ? 0.85 : 0.95;
            col = mix(col, beardCol, clamp01(density * grain * smooth(m, 0, 0.6)));
            rough = rough + 0.15 * m;
          }
        }
        break;
      }
      case 'neck':
        break;
      case 'spine':
      case 'hips': {
        const yAbs = y + J[name].y;
        const ySpine = yAbs - J.spine.y;
        const front = z > 0.02;
        const dBelt = yAbs - beltY;
        // A V-neck down the chest over a laced undershirt, piped in gold.
        const vT = (ySpine - (vTop - vDepth)) / vDepth;
        const vHalf = 0.07 * vT;
        if (Math.abs(dBelt) < 0.02) {
          // A wide leather belt, stitched along its edges, with a framed buckle.
          col = leather;
          rough = 0.6;
          mottle = 0.12;
          cloth = true;
          if (Math.abs(dBelt) > 0.016) col = mix(col, buckle, 0.18);
          if (front && ax < 0.026 && Math.abs(dBelt) < 0.017) {
            const frame = ax > 0.019 || Math.abs(dBelt) > 0.011 || (ax < 0.003 && Math.abs(dBelt) < 0.012);
            col = frame ? buckle : strap;
            rough = frame ? 0.35 : 0.6;
            mottle = 0.03;
          }
        } else if (yAbs > beltY) {
          if (look.shirt) {
            col = tunic;
            rough = 0.82;
            mottle = 0.14;
            cloth = true;
            if (front && vT > 0 && ySpine < vTop + 0.03) {
              if (ax < vHalf) {
                // Inside the V: the undershirt, laced across three times.
                col = undershirt;
                rough = 0.9;
                mottle = 0.08;
                for (const lace of [0.035, 0.065, 0.095]) {
                  if (Math.abs(ySpine - (vTop - lace)) < 0.0016 && ax < vHalf - 0.004) col = mix(col, strap, 0.75);
                }
              } else if (ax < vHalf + 0.006) {
                col = piping;
                rough = 0.5;
                mottle = 0.05;
              }
            } else if (front && vT <= 0 && vT > -0.06 && ax < 0.006) {
              col = piping;
              rough = 0.5;
              mottle = 0.05;
            } else if (front && ax < 0.0015 && dBelt > 0.025) {
              col = scale(tunic, 0.8);
            }
          }
        } else if (look.shirt && yAbs > tabardHem && ax < 0.105) {
          // A short tabard below the belt, split at the hips, piped along its edges.
          const edge = yAbs < tabardHem + 0.006 || ax > 0.099;
          col = edge ? piping : scale(tunic, 0.88);
          rough = edge ? 0.5 : 0.82;
          mottle = edge ? 0.05 : 0.14;
          cloth = true;
        } else if (look.trousers !== 'none') {
          col = trouser;
          rough = 0.88;
          mottle = 0.14;
          cloth = true;
        }
        break;
      }
      case 'shoulderL':
      case 'shoulderR':
        if (look.shirt && look.sleeves !== 'none') {
          if (look.sleeves === 'long' || y > sleeveEnd) {
            col = tunic;
            rough = 0.82;
            mottle = 0.14;
            cloth = true;
            if (look.sleeves === 'short' && y < sleeveEnd + 0.006) {
              col = piping;
              rough = 0.5;
              mottle = 0.05;
            }
          }
        }
        break;
      case 'elbowL':
      case 'elbowR':
        if (look.shirt && look.sleeves === 'long') {
          col = tunic;
          rough = 0.82;
          mottle = 0.14;
          cloth = true;
          if (y < cuff + 0.014 && y > cuff) {
            col = piping;
            rough = 0.5;
            mottle = 0.05;
          }
        } else if (look.bracers && y < cuff + 0.12 && y > cuff - 0.004) {
          // A leather bracer from the wrist up the forearm, strapped twice.
          const d = y - cuff;
          col = Math.abs(d - 0.03) < 0.004 || Math.abs(d - 0.09) < 0.004 ? strap : leather;
          rough = 0.6;
          mottle = 0.12;
          cloth = true;
        }
        break;
      case 'thighL':
      case 'thighR': {
        const hem = hemKnee + (nb - 0.5) * 0.12;
        if (look.trousers === 'full' || (look.trousers === 'ragged' && y > hem)) {
          col = trouser;
          rough = 0.88;
          mottle = look.trousers === 'ragged' ? 0.24 : 0.14;
          cloth = true;
        }
        break;
      }
      case 'kneeL':
      case 'kneeR':
        if (look.booted && y < bootTopKnee) {
          // Boots to the knee, folded over at the top.
          const d = bootTopKnee - y;
          col = d < 0.035 ? scale(boots, 1.3) : d < 0.038 ? scale(boots, 0.6) : boots;
          rough = d < 0.035 ? 0.55 : 0.6;
          mottle = 0.12;
          cloth = true;
        } else if (look.trousers === 'full') {
          col = trouser;
          rough = 0.88;
          mottle = 0.14;
          cloth = true;
        }
        break;
      case 'footL':
      case 'footR':
        if (look.booted) {
          col = y < soleFoot ? scale(boots, 0.55) : boots;
          rough = 0.6;
          mottle = 0.12;
          cloth = true;
        }
        break;
      default:
        break;
    }
    const k = 1 - mottle / 2 + mottle * nz;
    cd[i * 4] = Math.min(255, col[0] * k);
    cd[i * 4 + 1] = Math.min(255, col[1] * k);
    cd[i * 4 + 2] = Math.min(255, col[2] * k);
    cd[i * 4 + 3] = 255;
    const rv = Math.round(rough * 255);
    // R carries the skin mask for the shading pass (see characterStyle.ts); G is what three reads as roughness.
    rd[i * 4] = cloth ? 0 : 255;
    rd[i * 4 + 1] = rv;
    rd[i * 4 + 2] = rv;
    rd[i * 4 + 3] = 255;
  }
  cctx.putImageData(cimg, 0, 0);
  rctx.putImageData(rimg, 0, 0);
  // Baked skins are kept reachable for the diagnostics scripts.
  const w = window as unknown as { __aeloriaLooks?: HTMLCanvasElement[] };
  (w.__aeloriaLooks ??= []).push(colorCanvas);

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.colorSpace = THREE.NoColorSpace;
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.ClampToEdgeWrapping;
  return { map, roughnessMap };
}

/** The body material for a look, cached. */
export function lookMaterial(T: HumanTemplate, look: LookSpec): THREE.MeshStandardMaterial {
  const key = JSON.stringify(look);
  const hit = materialCache.get(key);
  if (hit) return hit;
  const { map, roughnessMap } = lookMaps(T, look);
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map,
    roughnessMap,
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0.5,
    normalMap: skinDetail().normal,
    normalScale: new THREE.Vector2(0.18, 0.18),
  });
  // The style pass reads the skin mask out of the roughness map's red channel.
  m.userData.skin = true;
  materialCache.set(key, m);
  return m;
}

const sstep = (v: number, a: number, b: number): number => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * The brightness of an iris at radius `rr` (0 at the pupil's centre, 1 at
 * the limbus) and angle, multiplying the iris colour: a soft-edged pupil, a
 * lighter collarette round it, radial fibres with crypts between them, and
 * a dark limbal ring.
 */
export function irisShade(rr: number, angle: number): number {
  if (rr < 0.33) return 0.02;
  const pupilEdge = sstep(rr, 0.33, 0.4);
  const spokes = 0.5 + 0.5 * Math.sin(angle * 41 + 2.3 * Math.sin(angle * 13 + rr * 9));
  const finer = 0.5 + 0.5 * Math.sin(angle * 97 + 1.7 * Math.cos(angle * 5 - rr * 6));
  const fibre = 0.72 + 0.4 * (0.6 * spokes + 0.4 * finer);
  const collarette = 1 + 0.3 * sstep(rr, 0.36, 0.46) * (1 - sstep(rr, 0.5, 0.64));
  const crypts = 1 - 0.35 * Math.max(0, Math.sin(angle * 17 + 1.2) * Math.sin(rr * 25 + angle * 3)) * sstep(rr, 0.5, 0.75);
  const limbus = 1 - 0.85 * sstep(rr, 0.8, 1);
  return Math.max(0.02, pupilEdge * fibre * collarette * crypts * limbus * (1.15 - 0.4 * rr));
}

/** How much darker the white of the eye gets toward the iris, under the lids' shadow and the cornea's curve. */
export function scleraShade(rr: number): number {
  return 1 - 0.18 * (1 - sstep(rr, 1, 1.5));
}

/** An eyeball: the white with a painted iris and pupil facing +z, a slit pupil and a faint glow for goblins. */
export function eyeMaterial(iris: number, glow: boolean): THREE.MeshStandardMaterial {
  const key = `${iris}:${glow ? 1 : 0}`;
  const hit = eyeCache.get(key);
  if (hit) return hit;
  const w = 512;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const cx = w * 0.25;
  const cy = h * 0.5;
  const ir = glow ? 52 : 44;
  const irisRgb = rgb(iris);
  const sclera: RGB = glow ? [232, 223, 196] : [243, 239, 233];
  const flush: RGB = [205, 130, 120];
  const vein = tileableNoise(64, 3, 57, 6);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const rr = Math.hypot(dx, dy) / ir;
      let col: RGB;
      if (rr < 1) {
        const slit = glow && Math.abs(dx) < ir * 0.12 && Math.abs(dy) < ir * 0.72;
        const k = slit ? 0.02 : Math.min(1, 0.8 * irisShade(glow ? Math.max(rr, 0.41) : rr, Math.atan2(dy, dx)));
        col = scale(irisRgb, k);
      } else {
        // The white, flushed pink toward the corners (u near 0 and 0.5) with faint veins.
        const u = x / w;
        const corner = Math.max(0, 1 - Math.min(u, Math.abs(u - 0.5), 1 - u) / 0.09);
        const veins = Math.max(0, vein[(y % 64) * 64 + (x % 64)] - 0.62) * 2.5 * corner;
        col = scale(mix(sclera, flush, 0.3 * corner + veins), scleraShade(rr));
      }
      const i = (y * w + x) * 4;
      d[i] = Math.min(255, col[0]);
      d[i + 1] = Math.min(255, col[1]);
      d[i + 2] = Math.min(255, col[2]);
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const m = new THREE.MeshStandardMaterial({
    map,
    roughness: 0.12,
    metalness: 0,
    envMapIntensity: 1.2,
    ...(glow ? { emissive: new THREE.Color(iris), emissiveMap: map, emissiveIntensity: 1.4 } : {}),
  });
  m.userData.iris = iris;
  eyeCache.set(key, m);
  return m;
}
