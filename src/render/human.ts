import * as THREE from 'three';
import { JOINTS, JointName, Rig, RigDims, Sockets, Stance } from './characters';
import { eyeMaterial, lookMaterial, LookSpec } from './humanSkin';
import { buildBaseBoots } from './gear';
import { HairStyle, SCALP_COLS, SCALP_ROWS, ScalpShape, buildHair } from './hair';

/**
 * People are built from one real human body: MakeHuman's CC0 base mesh,
 * converted by scripts/build-human.mjs into a skinned template with the
 * game's sixteen joints, a canonical standing pose, and the landmarks the
 * renderer needs (eyes, nose, mouth, chin, ears, brows, skull, feet, hands).
 *
 * {@link buildHumanoid} clones the template per character, reshapes it
 * (head size, limb length, bulk, belly, waist, chest, pelvis, jaw), scales
 * it to the character's height, hangs a bone skeleton off the same joints
 * the animator already drives, and dresses it with a skin texture baked per
 * look (see humanSkin.ts). The reshape controls are what turn the base
 * mesh's androgynous figure into the tall, V-torsoed heroes of a Lineage 2
 * character screen: eight heads tall, long legs, broad shoulders and a
 * narrow waist.
 */

export interface HumanLandmarks {
  headTop: THREE.Vector3;
  eyeL: THREE.Vector3;
  eyeR: THREE.Vector3;
  noseTip: THREE.Vector3;
  mouth: THREE.Vector3;
  mouthHalfWidth: number;
  chin: THREE.Vector3;
  chinBottom: THREE.Vector3;
  earL: THREE.Vector3;
  earR: THREE.Vector3;
  brow: THREE.Vector3[];
  skullHalfWidth: number;
  skullFront: number;
  skullBack: number;
  neckFront: THREE.Vector3;
  chestFront: THREE.Vector3;
  chestBack: THREE.Vector3;
  footFront: number;
  footBack: number;
  footHalfWidth: number;
  handReach: number;
}

export interface HumanTemplate {
  /** Standing height in metres. */
  height: number;
  vertexCount: number;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
  indices: Uint32Array;
  joints: Record<JointName, THREE.Vector3>;
  parents: Record<JointName, JointName | null>;
  landmarks: HumanLandmarks;
  radii: { thigh: number; shin: number; upperArm: number; deltoid: number; forearm: number };
  torsoProfile: Array<readonly [number, number]>;
  torsoFlatten: number;
  /** Attributes every character shares (normals, uvs, skinning, index): uploaded once. */
  shared: {
    normal: THREE.BufferAttribute;
    uv: THREE.BufferAttribute;
    skinIndex: THREE.BufferAttribute;
    skinWeight: THREE.BufferAttribute;
    index: THREE.BufferAttribute;
  };
}

let template: HumanTemplate | null = null;

const v3 = (a: number[]): THREE.Vector3 => new THREE.Vector3(a[0], a[1], a[2]);

/** Fetch the template once, before the world is built. */
export async function loadHumanTemplate(base = '/models/'): Promise<HumanTemplate> {
  if (template) return template;
  const [meta, bin] = await Promise.all([
    fetch(`${base}human.json`).then((r) => r.json()),
    fetch(`${base}human.bin`).then((r) => r.arrayBuffer()),
  ]);
  const ctors = { Float32Array, Uint16Array, Uint32Array } as const;
  const view = <K extends keyof typeof ctors>(name: string, type: K): InstanceType<(typeof ctors)[K]> => {
    const l = meta.layout[name] as { offset: number; length: number; type: string };
    if (l.type !== type) throw new Error(`${name}: expected ${type}, got ${l.type}`);
    return new ctors[type](bin, l.offset, l.length) as InstanceType<(typeof ctors)[K]>;
  };
  const positions = view('position', 'Float32Array');
  const normals = view('normal', 'Float32Array');
  const uvs = view('uv', 'Float32Array');
  const skinIndex = view('skinIndex', 'Uint16Array');
  const skinWeight = view('skinWeight', 'Float32Array');
  const indices = view('index', 'Uint32Array');
  const lm = meta.landmarks;
  const joints = Object.fromEntries(JOINTS.map((j) => [j, v3(meta.jointPositions[j])])) as Record<JointName, THREE.Vector3>;
  template = {
    height: meta.height,
    vertexCount: positions.length / 3,
    positions,
    normals,
    uvs,
    skinIndex,
    skinWeight,
    indices,
    joints,
    parents: meta.parents,
    landmarks: {
      headTop: v3(lm.headTop),
      eyeL: v3(lm.eyeL),
      eyeR: v3(lm.eyeR),
      noseTip: v3(lm.noseTip),
      mouth: v3(lm.mouth),
      mouthHalfWidth: lm.mouthHalfWidth,
      chin: v3(lm.chin),
      chinBottom: v3(lm.chinBottom),
      earL: v3(lm.earL),
      earR: v3(lm.earR),
      brow: (lm.brow as number[][]).map(v3),
      skullHalfWidth: lm.skullHalfWidth,
      skullFront: lm.skullFront,
      skullBack: lm.skullBack,
      neckFront: v3(lm.neckFront),
      chestFront: v3(lm.chestFront),
      chestBack: v3(lm.chestBack),
      footFront: lm.footFront,
      footBack: lm.footBack,
      footHalfWidth: lm.footHalfWidth,
      handReach: lm.handReach,
    },
    radii: meta.radii,
    torsoProfile: meta.torsoProfile,
    torsoFlatten: meta.torsoFlatten,
    shared: {
      normal: new THREE.BufferAttribute(normals, 3),
      uv: new THREE.BufferAttribute(uvs, 2),
      skinIndex: new THREE.BufferAttribute(skinIndex, 4),
      skinWeight: new THREE.BufferAttribute(skinWeight, 4),
      index: new THREE.BufferAttribute(indices, 1),
    },
  };
  return template;
}

export function humanTemplate(): HumanTemplate {
  if (!template) throw new Error('human template not loaded: await loadHumanTemplate() first');
  return template;
}

// --- Specs --------------------------------------------------------------------------

export interface HumanoidPalette {
  skin: number;
  hair: number;
  tunic: number;
  trouser: number;
  boots: number;
  /** Iris colour; brown by default. */
  eyes?: number;
}

export interface HumanoidSpec {
  /** Standing height in tiles (about metres). */
  height: number;
  palette: HumanoidPalette;
  /** Head size relative to a realistic head (0.92 makes a figure eight heads tall). */
  headScale?: number;
  /** Arm and leg length relative to realistic. */
  armScale?: number;
  legScale?: number;
  /** Limb and chest thickness relative to the template (0.8 wiry, 1.2 burly). */
  bulk?: number;
  /** 0 = flat stomach, 1 = pot belly. */
  belly?: number;
  /** Chest fullness: 0 flattens the base mesh's slight breasts (the default), 1 keeps them. */
  chest?: number;
  /** Shoulder width relative to the template (the default 1.06 broadens the base mesh a little). */
  shoulders?: number;
  /** Waist girth relative to the template: 0.85 pinches a V-torso, 1.1 thickens the middle. */
  waist?: number;
  /** Ribcage and upper-back width relative to the template: 1.12 is a fighter's chest. */
  chestWidth?: number;
  /** Pectoral definition, 0 (none) to 1 (sculpted). */
  pecs?: number;
  /** Pelvis width relative to the template: narrow hips (0.95) read as male and athletic. */
  hips?: number;
  /** Neck length relative to the template. */
  neck?: number;
  /** Jaw width toward the chin relative to the template: 0.9 gives the sharp chin of a Lineage 2 face. */
  jaw?: number;
  /** Green skin, no shirt, ragged breeches, bare feet; ears and nose are added by the caller. */
  goblin?: boolean;
  /** Hair style: built as geometry on the skull, with a painted scalp beneath. */
  hair?: HairStyle;
  /** Clothing cut. Defaults: tunic with sleeves to the elbow, full trousers, boots. */
  sleeves?: 'long' | 'short' | 'none';
  trousers?: 'full' | 'ragged' | 'none';
  shirt?: boolean;
  booted?: boolean;
  /** A resting posture the animator layers under every clip. */
  stance?: Stance;
  /** Optional decorations added to the head or body sockets. */
  extras?: (rig: Rig) => void;
}

/** The tall, athletic build of a Lineage 2 human fighter; spread over a spec with overrides. */
export const HERO_BUILD = {
  headScale: 0.93,
  legScale: 1.06,
  armScale: 1.03,
  bulk: 1.1,
  shoulders: 1.16,
  waist: 0.86,
  chestWidth: 1.12,
  pecs: 1,
  hips: 0.95,
  neck: 1.05,
  jaw: 0.9,
  stance: 'hero',
} as const satisfies Partial<HumanoidSpec>;

// --- Building -----------------------------------------------------------------------

const CHILD: Partial<Record<JointName, JointName>> = {
  thighL: 'kneeL',
  kneeL: 'footL',
  thighR: 'kneeR',
  kneeR: 'footR',
  shoulderL: 'elbowL',
  elbowL: 'handL',
  shoulderR: 'elbowR',
  elbowR: 'handR',
};

/**
 * Measure the scalp of a finished head: for each direction out of a point
 * inside the skull, how far the skin is. Vertices the head bone owns count,
 * except the ears, which stick out past the skull hair should hug. Empty
 * bins (under the jaw, inside the neck) borrow from the bin above them.
 */
function measureScalp(pos: Float32Array, T: HumanTemplate, headJoint: THREE.Vector3, centre: THREE.Vector3, ears: THREE.Vector3[], earClear: number): ScalpShape {
  const rows = SCALP_ROWS;
  const cols = SCALP_COLS;
  const radius = new Float32Array(rows * cols);
  const headIndex = JOINTS.indexOf('head');
  const r = new THREE.Vector3();
  for (let i = 0; i < T.vertexCount; i++) {
    let wHead = 0;
    for (let k = 0; k < 4; k++) if (T.skinIndex[i * 4 + k] === headIndex) wHead += T.skinWeight[i * 4 + k];
    if (wHead < 0.3) continue;
    r.fromArray(pos, i * 3).sub(headJoint);
    if (ears.some((ear) => r.distanceTo(ear) < earClear)) continue;
    r.sub(centre);
    const len = r.length();
    if (len < 1e-6) continue;
    const e = Math.acos(Math.max(-1, Math.min(1, r.y / len)));
    let a = Math.atan2(r.x, r.z);
    if (a < 0) a += Math.PI * 2;
    const row = Math.min(rows - 1, Math.floor((e / Math.PI) * rows));
    const col = Math.floor((a / (Math.PI * 2)) * cols) % cols;
    const idx = row * cols + col;
    if (len > radius[idx]) radius[idx] = len;
  }
  // The crown bin is tiny: let every column share the widest reading there.
  let crown = 0;
  for (let c = 0; c < cols; c++) crown = Math.max(crown, radius[c]);
  for (let c = 0; c < cols; c++) radius[c] = crown;
  for (let row = 1; row < rows; row++) {
    for (let c = 0; c < cols; c++) {
      const idx = row * cols + c;
      if (radius[idx] > 0) continue;
      // Nearest filled neighbour in the row, else the bin above.
      let filled = 0;
      for (let d = 1; d <= 3 && !filled; d++) {
        const l = radius[row * cols + ((c - d + cols) % cols)];
        const rr = radius[row * cols + ((c + d) % cols)];
        filled = l > 0 ? l : rr > 0 ? rr : 0;
      }
      radius[idx] = filled || radius[(row - 1) * cols + c];
    }
  }
  // A bin with one vertex in a hollow reads short and lets the skin poke
  // through the hair: take the widest of each bin's neighbours instead.
  const dilated = new Float32Array(radius);
  for (let row = 0; row < rows; row++) {
    for (let c = 0; c < cols; c++) {
      let best = 0;
      for (let dr = -1; dr <= 1; dr++) {
        const rr = row + dr;
        if (rr < 0 || rr >= rows) continue;
        for (let dc = -1; dc <= 1; dc++) best = Math.max(best, radius[rr * cols + ((c + dc + cols) % cols)]);
      }
      dilated[row * cols + c] = best;
    }
  }
  return { centre: centre.clone(), rows, cols, radius: dilated };
}

const gauss = (d: number, sigma: number): number => Math.exp(-(d * d) / (2 * sigma * sigma));
/** Smoothstep from 0 at `a` to 1 at `b`. */
const smooth = (x: number, a: number, b: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** A person built from the human template, reshaped and dressed for `spec`. */
export function buildHumanoid(spec: HumanoidSpec): Rig {
  const T = humanTemplate();
  const p = spec.palette;
  const headK = spec.headScale ?? 1;
  const armK = spec.armScale ?? 1;
  const legK = spec.legScale ?? 1;
  const bulk = spec.bulk ?? 1;
  const belly = spec.belly ?? 0;
  const chest = spec.chest ?? 0;
  const shoulders = spec.shoulders ?? 1.06;
  const waist = spec.waist ?? 1;
  const chestWidth = spec.chestWidth ?? 1;
  const pecs = spec.pecs ?? 0;
  const hipsK = spec.hips ?? 1;
  const neckK = spec.neck ?? 1;
  const jaw = spec.jaw ?? 1;
  const rest = T.joints;
  const lm = T.landmarks;
  const n = T.vertexCount;

  // 1. Reshape in template space: limbs thicker or thinner about their bone
  //    axes; the torso wider, pinched at the waist, broadened across the ribs,
  //    the belly swelling forward and the chest pushed out; the pelvis
  //    narrowed; the head scaled about its joint and the jaw tapered.
  const pos = new Float32Array(T.positions);
  const limbK = 1 + (bulk - 1) * 1.0;
  const torsoK = 1 + (bulk - 1) * 0.6;
  const navelY = rest.spine.y + 0.1;
  const waistY = rest.spine.y + 0.16;
  const ribY = rest.shoulderL.y - 0.09;
  const breastY = lm.chestFront.y;
  const pecY = breastY + 0.02;
  const mouthY = lm.mouth.y;
  const v = new THREE.Vector3();
  const d = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const axis = new THREE.Vector3();
  const proj = new THREE.Vector3();
  /** Width factors of the torso by height, shared with the armour profile below. */
  const torsoWidthAt = (y: number): number => 1 + (waist - 1) * gauss(y - waistY, 0.075) + (chestWidth - 1) * gauss(y - ribY, 0.09);
  const reshape = limbK !== 1 || torsoK !== 1 || belly !== 0 || headK !== 1 || chest !== 1 || waist !== 1 || chestWidth !== 1 || pecs !== 0 || hipsK !== 1 || jaw !== 1;
  if (reshape) {
    for (let i = 0; i < n; i++) {
      v.fromArray(pos, i * 3);
      d.set(0, 0, 0);
      for (let k = 0; k < 4; k++) {
        const w = T.skinWeight[i * 4 + k];
        if (w <= 0) continue;
        const j = JOINTS[T.skinIndex[i * 4 + k]];
        const c = CHILD[j];
        if (c) {
          const a = rest[j];
          axis.copy(rest[c]).sub(a);
          const t = tmp.copy(v).sub(a).dot(axis) / axis.lengthSq();
          proj.copy(a).addScaledVector(axis, t);
          d.addScaledVector(tmp.copy(v).sub(proj), (limbK - 1) * w);
        } else if (j === 'spine' || j === 'hips' || j === 'neck') {
          const bell = gauss(v.y - navelY, 0.1);
          const front = v.z > rest.spine.z ? 1 : 0.2;
          const wBell = gauss(v.y - waistY, 0.075);
          const hBell = j === 'hips' ? gauss(v.y - rest.hips.y, 0.12) : 0;
          const kx = torsoWidthAt(v.y) + (torsoK - 1) + belly * 0.12 * bell + (hipsK - 1) * hBell;
          const kz = torsoK + belly * 0.5 * bell * front + (waist - 1) * 0.6 * wBell;
          d.x += v.x * (kx - 1) * w;
          d.z += (v.z - rest.spine.z) * (kz - 1) * w;
          if (v.z > rest.spine.z + 0.05) {
            if (chest < 1) {
              // Press the base mesh's breasts back toward the ribcage.
              const bx = gauss(Math.abs(v.x) - 0.072, 0.045);
              const by = gauss(v.y - breastY, 0.05);
              d.z -= 0.034 * (1 - chest) * bx * by * w;
            }
            if (pecs > 0) {
              // Pectorals: a broad, flat plate from the sternum out to the
              // armpit, fading slowly up toward the collarbone and ending in
              // a crisper edge underneath.
              const ax = Math.abs(v.x);
              const px = smooth(ax, 0.012, 0.04) * (1 - smooth(ax, 0.095, 0.135));
              const dy = v.y - pecY;
              const py = dy > 0 ? gauss(dy, 0.055) : gauss(dy, 0.028);
              d.z += 0.011 * pecs * px * py * w;
            }
          }
        } else if (j === 'head') {
          d.addScaledVector(tmp.copy(v).sub(rest.head), (headK - 1) * w);
          if (jaw !== 1 && v.y < mouthY + 0.015 && v.z > rest.head.z + 0.03) {
            const fall = Math.min(1, (mouthY + 0.015 - v.y) / 0.045);
            d.x += v.x * (jaw - 1) * fall * w;
          }
        }
      }
      v.add(d).toArray(pos, i * 3);
    }
  }

  // 2. Proportions: longer or shorter limbs move the joints along their bones,
  //    the shoulders and thighs spread or close, the neck lengthens; the flesh
  //    follows through the skin weights, and the whole body drops so the feet
  //    stay on the ground.
  const posed = {} as Record<JointName, THREE.Vector3>;
  for (const j of JOINTS) posed[j] = rest[j].clone();
  posed.shoulderL.x *= shoulders;
  posed.shoulderR.x *= shoulders;
  posed.thighL.x *= hipsK;
  posed.thighR.x *= hipsK;
  posed.head.y += (neckK - 1) * (rest.head.y - rest.neck.y);
  const along = (from: JointName, to: JointName, k: number): void => {
    posed[to] = posed[from].clone().add(tmp.copy(rest[to]).sub(rest[from]).multiplyScalar(k));
  };
  along('thighL', 'kneeL', legK);
  along('kneeL', 'footL', legK);
  along('thighR', 'kneeR', legK);
  along('kneeR', 'footR', legK);
  along('shoulderL', 'elbowL', armK);
  along('elbowL', 'handL', armK);
  along('shoulderR', 'elbowR', armK);
  along('elbowR', 'handR', armK);
  const drop = posed.footL.y - rest.footL.y;
  for (const j of JOINTS) posed[j].y -= drop;
  const offset = {} as Record<JointName, THREE.Vector3>;
  let moved = false;
  for (const j of JOINTS) {
    offset[j] = posed[j].clone().sub(rest[j]);
    if (offset[j].lengthSq() > 1e-12) moved = true;
  }
  if (moved) {
    for (let i = 0; i < n; i++) {
      v.fromArray(pos, i * 3);
      for (let k = 0; k < 4; k++) {
        const w = T.skinWeight[i * 4 + k];
        if (w > 0) v.addScaledVector(offset[JOINTS[T.skinIndex[i * 4 + k]]], w);
      }
      v.toArray(pos, i * 3);
    }
  }

  // 3. Scale to the character's height, measured after the reshape so long
  //    legs or a long neck never make a figure taller than it was asked to be.
  const standing = posed.head.y + (lm.headTop.y - rest.head.y) * headK;
  const s = spec.height / standing;
  for (let i = 0; i < pos.length; i++) pos[i] *= s;
  for (const j of JOINTS) posed[j].multiplyScalar(s);
  /** A landmark on the head, in the head bone's local space (scaled with the head). */
  const onHead = (l: THREE.Vector3): THREE.Vector3 => l.clone().sub(rest.head).multiplyScalar(headK * s);

  // 4. Skeleton and skinned mesh.
  const group = new THREE.Group();
  group.rotation.order = 'YXZ';
  const bones = {} as Record<JointName, THREE.Bone>;
  for (const j of JOINTS) {
    const b = new THREE.Bone();
    b.name = j;
    b.rotation.order = 'YXZ';
    const parent = T.parents[j];
    b.position.copy(posed[j]);
    if (parent) {
      b.position.sub(posed[parent]);
      bones[parent].add(b);
    }
    bones[j] = b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', T.shared.normal);
  geo.setAttribute('uv', T.shared.uv);
  geo.setAttribute('skinIndex', T.shared.skinIndex);
  geo.setAttribute('skinWeight', T.shared.skinWeight);
  geo.setIndex(T.shared.index);
  geo.computeBoundingSphere();
  const look: LookSpec = {
    skin: p.skin,
    hair: p.hair,
    eyes: p.eyes ?? 0x5b3f2c,
    tunic: p.tunic,
    trouser: p.trouser,
    boots: p.boots,
    hairStyle: spec.hair ?? (spec.goblin ? 'bald' : 'short'),
    sleeves: spec.sleeves ?? (spec.goblin ? 'none' : 'short'),
    trousers: spec.trousers ?? (spec.goblin ? 'ragged' : 'full'),
    shirt: spec.shirt ?? !spec.goblin,
    booted: spec.booted ?? !spec.goblin,
    goblin: !!spec.goblin,
  };
  const mesh = new THREE.SkinnedMesh(geo, lookMaterial(T, look));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false; // poses reach outside the rest-pose bounds
  mesh.add(bones.hips);
  mesh.bind(new THREE.Skeleton(JOINTS.map((j) => bones[j])));
  group.add(mesh);

  // 5. Eyes: real eyeballs behind the lids.
  const eyeR = 0.0122 * s * headK;
  const eyeGeo = new THREE.SphereGeometry(eyeR, 18, 12);
  for (const l of [lm.eyeL, lm.eyeR]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMaterial(look.eyes, look.goblin));
    eye.position.copy(onHead(l));
    eye.castShadow = false;
    bones.head.add(eye);
  }

  // 6. Measurements for equipment, in the rig's units. The scalp is measured
  //    from the finished head so hair hugs whatever skull this figure has.
  const dist = (a: JointName, b: JointName): number => posed[a].distanceTo(posed[b]);
  const earL = onHead(lm.earL);
  const earR = onHead(lm.earR);
  const headTop = onHead(lm.headTop).y;
  const earY = (earL.y + earR.y) / 2;
  const skullCentre = new THREE.Vector3(0, earY + (headTop - earY) * 0.3, ((lm.skullFront + lm.skullBack) / 2 - rest.head.z) * headK * s);
  const scalp = measureScalp(pos, T, posed.head, skullCentre, [earL, earR], 0.03 * s * headK);
  const chestBands = T.torsoProfile.filter(([r]) => r > 0.1).map(([r, y]) => [r * torsoWidthAt(y + rest.spine.y), y] as const);
  const chestR = Math.max(...chestBands.map(([r]) => r)) * s * torsoK;
  const waistR = Math.min(...chestBands.map(([r]) => r)) * s * torsoK;
  const dims: RigDims = {
    scale: s,
    thigh: dist('thighL', 'kneeL'),
    shin: dist('kneeL', 'footL'),
    upperArm: dist('shoulderL', 'elbowL'),
    forearm: dist('elbowL', 'handL'),
    torso: posed.neck.y - posed.spine.y,
    headR: lm.skullHalfWidth * s * headK,
    shoulderHalf: posed.shoulderL.x,
    hipHalf: posed.thighL.x,
    headFlatten: (lm.skullFront - lm.skullBack) / (2 * lm.skullHalfWidth),
    torsoProfile: chestBands.map(([r, y]) => [r * s * torsoK * (1 + belly * 0.25), y * s] as const),
    torsoFlatten: T.torsoFlatten + belly * 0.2,
    chestR,
    waistR,
    thighR: T.radii.thigh * s * limbK,
    shinR: T.radii.shin * s * limbK,
    armR: T.radii.upperArm * s * limbK,
    forearmR: T.radii.forearm * s * limbK,
    deltoidR: T.radii.deltoid * s * limbK,
    ankle: posed.footL.y,
    footL: (lm.footFront - lm.footBack) * s,
    footW: lm.footHalfWidth * 2 * s,
    handL: lm.handReach * s * armK,
    face: {
      top: onHead(lm.headTop).y,
      brow: onHead(lm.brow[1]).y,
      chin: onHead(lm.chin).y,
      chinZ: onHead(lm.chin).z,
      noseTip: onHead(lm.noseTip),
      mouth: onHead(lm.mouth),
      front: (lm.skullFront - rest.head.z) * headK * s,
      back: (lm.skullBack - rest.head.z) * headK * s,
      earL,
      earR,
      scalp,
    },
  };

  const sockets: Sockets = {
    head: bones.head,
    torso: bones.spine,
    thighL: bones.thighL,
    thighR: bones.thighR,
    shinL: bones.kneeL,
    shinR: bones.kneeR,
    footL: bones.footL,
    footR: bones.footR,
    handL: bones.handL,
    handR: bones.handR,
  };
  const rig: Rig = {
    group,
    joints: bones,
    sockets,
    barHeight: spec.height + 0.22,
    dims,
    kind: 'humanoid',
    stance: spec.stance,
  };
  if (look.booted) {
    const [left, right] = buildBaseBoots(rig, p.boots);
    bones.footL.add(left);
    bones.footR.add(right);
  }
  const hair = buildHair(rig, look.hairStyle, p.hair, (p.hair & 0xff) + spec.height * 100);
  if (hair) {
    bones.head.add(hair);
    rig.hair = hair;
  }
  spec.extras?.(rig);
  return rig;
}
