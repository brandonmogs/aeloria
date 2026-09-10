import * as THREE from 'three';
import { JOINTS, JointName } from './characters';
import type { HumanTemplate } from './human';
import { skinDetail } from './characterTextures';
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

export interface LookSpec {
  skin: number;
  hair: number;
  eyes: number;
  tunic: number;
  trouser: number;
  boots: number;
  hairStyle: 'short' | 'long' | 'bald';
  sleeves: 'long' | 'short' | 'none';
  trousers: 'full' | 'ragged' | 'none';
  shirt: boolean;
  booted: boolean;
  goblin: boolean;
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
  /** Packed per pixel: r = region << 3 | z (3 bits), g = y, b = x, all relative to the region's joint. */
  data: Uint8ClampedArray;
  /** Fine noise for mottle, broad noise for hairlines and hems. */
  fine: Float32Array;
  broad: Float32Array;
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
  const MARGIN = 0.6; // pixels outside an edge still count, so adjacent triangles leave no cracks
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t];
    const b = idx[t + 1];
    const c = idx[t + 2];
    const cx = (P[a * 3] + P[b * 3] + P[c * 3]) / 3;
    const cy = (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1]) / 3;
    const cz = (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3;
    // The joint that owns most of the triangle.
    w.clear();
    for (const vi of [a, b, c]) {
      for (let k = 0; k < 4; k++) {
        const wt = T.skinWeight[vi * 4 + k];
        if (wt > 0) w.set(T.skinIndex[vi * 4 + k], (w.get(T.skinIndex[vi * 4 + k]) ?? 0) + wt);
      }
    }
    let region = 0;
    let best = -1;
    for (const [j, wt] of w) if (wt > best) { best = wt; region = j; }
    const joint = T.joints[JOINTS[region]];
    const range = RANGES[JOINTS[region]];
    const zq = q(cz - joint.z, range.z, 7);
    const yq = q(cy - joint.y, range.y, 255);
    const xq = q(cx - joint.x, range.x, 255);
    const code0 = (region << 3) | zq;
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
        const i = (py * SIZE + px) * 4;
        data[i] = code0;
        data[i + 1] = yq;
        data[i + 2] = xq;
        data[i + 3] = 255;
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
        next[i] = 1;
      }
    }
    covered.set(next);
  }
  const atlas = { data, fine: tileableNoise(SIZE, 5, 91, 6), broad: tileableNoise(SIZE, 2, 92, 2) };
  atlasCache.set(T, atlas);
  return atlas;
}

type RGB = [number, number, number];
const rgb = (hex: number): RGB => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scale = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

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
  const buckle = rgb(0xc9a85a);
  const lip = mix(skin, rgb(look.goblin ? 0x3a3020 : 0x8a3a3a), 0.55);
  const dark = rgb(0x1a1210);
  // Face landmarks in head-local metres.
  const H = J.head;
  const eye = { x: Math.abs(lm.eyeL.x - H.x), y: lm.eyeL.y - H.y };
  const nose = { y: lm.noseTip.y - H.y, z: lm.noseTip.z - H.z };
  const mouth = { y: lm.mouth.y - H.y, z: lm.mouth.z - H.z, half: lm.mouthHalfWidth };
  const brows = lm.brow.map((b) => ({ x: b.x - H.x, y: b.y - H.y }));
  const browAt = (ax: number): number | null => {
    if (ax < brows[0].x - 0.004 || ax > brows[brows.length - 1].x + 0.01) return null;
    for (let i = 0; i + 1 < brows.length; i++) {
      const p0 = brows[i];
      const p1 = brows[i + 1];
      if (ax >= p0.x - 0.004 && ax <= p1.x + 0.01) {
        const t = clamp01((ax - p0.x) / Math.max(1e-4, p1.x - p0.x));
        return p0.y + (p1.y - p0.y) * t;
      }
    }
    return null;
  };
  // Clothing lines, relative to the joints that own the surrounding triangles.
  const beltY = J.spine.y + 0.06;
  const neckSpine = J.neck.y - J.spine.y;
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
    const z = range.z[0] + ((r & 7) / 7) * (range.z[1] - range.z[0]);
    const y = range.y[0] + (src[i * 4 + 1] / 255) * (range.y[1] - range.y[0]);
    const x = range.x[0] + (src[i * 4 + 2] / 255) * (range.x[1] - range.x[0]);
    const ax = Math.abs(x);
    const nz = atlas.fine[i];
    const nb = atlas.broad[i];
    let col: RGB = skin;
    let rough = 0.52;
    let mottle = look.goblin ? 0.18 : 0.07;

    switch (name) {
      case 'head': {
        // Hair over the crown, dropping to the nape at the back, leaving the ears and face.
        if (look.hairStyle !== 'bald') {
          // The hairline by depth: high on the forehead, dipping at the temples,
          // just over the ears at the sides, down to the nape behind.
          let hairline: number;
          if (z > 0.09) hairline = eye.y + 0.085;
          else if (z > 0.04) hairline = eye.y + 0.06;
          else if (z > -0.01) hairline = eye.y + 0.032;
          else if (z > -0.06) hairline = eye.y - 0.03;
          else hairline = eye.y - 0.07;
          hairline += (nb - 0.5) * 0.016;
          const ear = ax > 0.058 && y < eye.y + 0.028 && z > -0.02 && z < 0.06;
          if (y > hairline && !ear) {
            col = hair;
            rough = 0.62;
            mottle = 0.22;
            break;
          }
        }
        if (z > 0.06) {
          // Brows.
          const by = browAt(ax);
          if (by !== null && Math.abs(y - by) < 0.005 && ax > 0.006) {
            col = mix(skin, scale(hair, 0.7), 0.85);
            rough = 0.6;
            break;
          }
          // Eye sockets and the lash line.
          const de = Math.hypot(ax - eye.x, y - eye.y);
          if (de < 0.024) col = mix(col, scale(skin, 0.62), 0.3 * (1 - de / 0.024));
          if (Math.abs(y - (eye.y + 0.008)) < 0.0015 && Math.abs(ax - eye.x) < 0.012) col = mix(col, dark, 0.6);
          // Nostrils.
          const dn = Math.hypot(ax - 0.0085, y - (nose.y - 0.014));
          if (dn < 0.0045 && z > nose.z - 0.05) col = mix(col, scale(skin, 0.45), 0.7 * (1 - dn / 0.0045));
          // Lips and the line between them.
          if (ax < mouth.half * 0.72 && z > mouth.z - 0.05) {
            const dy = y - mouth.y;
            if (dy > -0.008 && dy < 0.0065) col = mix(col, lip, dy > 0 ? 0.55 : 0.7);
            if (Math.abs(dy) < 0.0014) col = mix(col, dark, 0.55);
          }
          // Cheek warmth.
          const dc = Math.hypot(ax - 0.05, y - (eye.y - 0.048));
          if (dc < 0.035 && !look.goblin) col = mix(col, rgb(0xc86a5a), 0.14 * (1 - dc / 0.035));
        }
        rough = 0.5;
        break;
      }
      case 'neck':
        break;
      case 'spine':
      case 'hips': {
        const yAbs = y + J[name].y;
        const ySpine = yAbs - J.spine.y;
        const scoop = ySpine > neckSpine - 0.075 && z > 0.02 && ax < 0.08 - (neckSpine - ySpine) * 0.7;
        if (Math.abs(yAbs - beltY) < 0.017) {
          col = leather;
          rough = 0.6;
          mottle = 0.12;
          if (ax < 0.022 && z > 0.06 && Math.abs(yAbs - beltY) < 0.014) {
            col = buckle;
            rough = 0.35;
            mottle = 0.03;
          }
        } else if (yAbs > beltY) {
          if (look.shirt && !scoop) {
            col = tunic;
            rough = 0.92;
            mottle = 0.14;
          }
        } else if (look.trousers !== 'none') {
          col = trouser;
          rough = 0.88;
          mottle = 0.14;
        }
        break;
      }
      case 'shoulderL':
      case 'shoulderR':
        if (look.shirt && look.sleeves !== 'none') {
          col = tunic;
          rough = 0.92;
          mottle = 0.14;
        }
        break;
      case 'elbowL':
      case 'elbowR':
        if (look.shirt && look.sleeves === 'long') {
          col = tunic;
          rough = 0.92;
          mottle = 0.14;
        }
        break;
      case 'thighL':
      case 'thighR': {
        const hem = hemKnee + (nb - 0.5) * 0.12;
        if (look.trousers === 'full' || (look.trousers === 'ragged' && y > hem)) {
          col = trouser;
          rough = 0.88;
          mottle = look.trousers === 'ragged' ? 0.24 : 0.14;
        }
        break;
      }
      case 'kneeL':
      case 'kneeR':
        if (look.booted && y < bootTopKnee) {
          col = boots;
          rough = 0.6;
          mottle = 0.12;
        } else if (look.trousers === 'full') {
          col = trouser;
          rough = 0.88;
          mottle = 0.14;
        }
        break;
      case 'footL':
      case 'footR':
        if (look.booted) {
          col = y < soleFoot ? scale(boots, 0.55) : boots;
          rough = 0.6;
          mottle = 0.12;
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
    rd[i * 4] = rv;
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
  materialCache.set(key, m);
  return m;
}

/** An eyeball: white with a coloured iris and pupil facing +z, faintly glowing for goblins. */
export function eyeMaterial(iris: number, glow: boolean): THREE.MeshStandardMaterial {
  const key = `${iris}:${glow ? 1 : 0}`;
  const hit = eyeCache.get(key);
  if (hit) return hit;
  const w = 256;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = glow ? '#e8dfc4' : '#f3efe9';
  ctx.fillRect(0, 0, w, h);
  // A hint of pink toward the corners.
  const tint = ctx.createRadialGradient(w * 0.25, h / 2, 10, w * 0.25, h / 2, 60);
  tint.addColorStop(0, 'rgba(255,255,255,0)');
  tint.addColorStop(1, 'rgba(210,150,140,0.35)');
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, w, h);
  const cx = w * 0.25;
  const cy = h * 0.5;
  const ir = glow ? 26 : 22;
  const [r, g, b] = rgb(iris);
  const irisG = ctx.createRadialGradient(cx, cy, ir * 0.15, cx, cy, ir);
  irisG.addColorStop(0, `rgb(${Math.min(255, r * 1.3)}, ${Math.min(255, g * 1.3)}, ${Math.min(255, b * 1.3)})`);
  irisG.addColorStop(0.85, `rgb(${r}, ${g}, ${b})`);
  irisG.addColorStop(1, `rgb(${r * 0.35}, ${g * 0.35}, ${b * 0.35})`);
  ctx.fillStyle = irisG;
  ctx.beginPath();
  ctx.arc(cx, cy, ir, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0b0908';
  ctx.beginPath();
  if (glow) ctx.ellipse(cx, cy, 5, ir * 0.7, 0, 0, Math.PI * 2);
  else ctx.arc(cx, cy, ir * 0.42, 0, Math.PI * 2);
  ctx.fill();
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const m = new THREE.MeshStandardMaterial({
    map,
    roughness: 0.25,
    metalness: 0,
    envMapIntensity: 0.9,
    ...(glow ? { emissive: new THREE.Color(iris), emissiveMap: map, emissiveIntensity: 1.4 } : {}),
  });
  eyeCache.set(key, m);
  return m;
}
