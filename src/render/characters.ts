import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { normalMap, tileableNoise, toTexture } from './texgen';

/**
 * Characters: articulated rigs with realistic proportions and a small
 * procedural animation system.
 *
 * A rig is a joint hierarchy of plain Object3Ds (hips, spine, neck, head, and
 * two-segment limbs with hands and feet) with smooth-shaded capsule and lathe
 * meshes hung off them. Every rig exposes the same named joints, so the clips
 * below drive players, guards, and goblins alike; the rat is a quadruped with
 * its own small cycle.
 *
 * Animation is pose-based: a locomotion pose (idle blended with a
 * distance-phased walk/run cycle, so feet never slide) is computed every
 * frame, an action clip (attack, chop, mine, fish, cast, hammer, crouch,
 * flinch, death) is layered over the joints it owns, and the result is eased
 * toward with a short time constant so transitions never pop.
 */

export type JointName =
  | 'hips'
  | 'spine'
  | 'neck'
  | 'head'
  | 'thighL'
  | 'kneeL'
  | 'footL'
  | 'thighR'
  | 'kneeR'
  | 'footR'
  | 'shoulderL'
  | 'elbowL'
  | 'handL'
  | 'shoulderR'
  | 'elbowR'
  | 'handR';

export const JOINTS: readonly JointName[] = [
  'hips',
  'spine',
  'neck',
  'head',
  'thighL',
  'kneeL',
  'footL',
  'thighR',
  'kneeR',
  'footR',
  'shoulderL',
  'elbowL',
  'handL',
  'shoulderR',
  'elbowR',
  'handR',
];

const J: Record<JointName, number> = Object.fromEntries(JOINTS.map((n, i) => [n, i])) as Record<JointName, number>;

/** Joint rotations (Euler XYZ, radians) plus root offsets. */
export interface Pose {
  rot: Float32Array;
  /** Vertical offset of the hips (bob, crouch). */
  hipsY: number;
  /** Whole-body pitch (falling over). */
  lean: number;
  /** Whole-body vertical offset (sinking into the ground when dead). */
  rootY: number;
}

export function makePose(): Pose {
  return { rot: new Float32Array(JOINTS.length * 3), hipsY: 0, lean: 0, rootY: 0 };
}

function set(p: Pose, j: JointName, x: number, y = 0, z = 0): void {
  const i = J[j] * 3;
  p.rot[i] = x;
  p.rot[i + 1] = y;
  p.rot[i + 2] = z;
}

function clearPose(p: Pose): void {
  p.rot.fill(0);
  p.hipsY = 0;
  p.lean = 0;
  p.rootY = 0;
}

/** Where gear attaches. Each socket's origin is the joint it hangs from. */
export interface Sockets {
  head: THREE.Object3D;
  torso: THREE.Object3D;
  thighL: THREE.Object3D;
  thighR: THREE.Object3D;
  shinL: THREE.Object3D;
  shinR: THREE.Object3D;
  footL: THREE.Object3D;
  footR: THREE.Object3D;
  handL: THREE.Object3D;
  handR: THREE.Object3D;
}

export interface Rig {
  group: THREE.Group;
  joints: Record<JointName, THREE.Object3D>;
  sockets: Sockets;
  /** Height above the feet for the health bar / hitsplats. */
  barHeight: number;
  /** Segment lengths the equipment builders size themselves against. */
  dims: RigDims;
  kind: 'humanoid' | 'rat';
}

export interface RigDims {
  scale: number;
  thigh: number;
  shin: number;
  upperArm: number;
  forearm: number;
  torso: number;
  headR: number;
  shoulderHalf: number;
  hipHalf: number;
}

// --- Materials ----------------------------------------------------------------------

type Finish = 'skin' | 'cloth' | 'leather' | 'metal' | 'hair' | 'dark';

const materialCache = new Map<string, THREE.MeshStandardMaterial>();
let fabricTexture: THREE.DataTexture | null = null;

/** A fine woven weave as a normal map, so cloth catches light like cloth. */
function fabric(): THREE.DataTexture {
  if (!fabricTexture) {
    const size = 128;
    const h = new Float32Array(size * size);
    const n = tileableNoise(size, 3, 77, 8);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const weave = ((x >> 1) + (y >> 1)) % 2 === 0 ? 0.6 : 0.4;
        h[y * size + x] = weave * 0.7 + n[y * size + x] * 0.3;
      }
    }
    fabricTexture = toTexture(normalMap(h, size, 1.2), size, false);
    fabricTexture.repeat.set(6, 6);
  }
  return fabricTexture;
}

/** A smooth-shaded material with vertex colours enabled, cached by colour and finish. */
export function material(color: number, finish: Finish): THREE.MeshStandardMaterial {
  const key = `${finish}:${color}`;
  let m = materialCache.get(key);
  if (m) return m;
  switch (finish) {
    case 'skin':
      m = new THREE.MeshStandardMaterial({ color, vertexColors: true, roughness: 0.62, metalness: 0, envMapIntensity: 0.55 });
      break;
    case 'cloth':
      m = new THREE.MeshStandardMaterial({
        color,
        vertexColors: true,
        roughness: 0.92,
        metalness: 0,
        envMapIntensity: 0.4,
        normalMap: fabric(),
        normalScale: new THREE.Vector2(0.35, 0.35),
      });
      break;
    case 'leather':
      m = new THREE.MeshStandardMaterial({ color, vertexColors: true, roughness: 0.55, metalness: 0.05, envMapIntensity: 0.6 });
      break;
    case 'metal':
      m = new THREE.MeshStandardMaterial({ color, vertexColors: true, roughness: 0.5, metalness: 0.8, envMapIntensity: 0.8 });
      break;
    case 'hair':
      m = new THREE.MeshStandardMaterial({ color, vertexColors: true, roughness: 0.7, metalness: 0, envMapIntensity: 0.45 });
      break;
    case 'dark':
      m = new THREE.MeshStandardMaterial({ color, vertexColors: true, roughness: 0.5, metalness: 0, envMapIntensity: 0.3 });
      break;
  }
  materialCache.set(key, m);
  return m;
}

// --- Geometry helpers ---------------------------------------------------------------

/**
 * Bake a gentle top-to-bottom brightness gradient into vertex colours (the
 * material multiplies these by its base colour): a cheap stand-in for the
 * ambient occlusion real bodies have under arms and between legs.
 */
export function shade(geo: THREE.BufferGeometry, top = 1.03, bottom = 0.9): THREE.BufferGeometry {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  geo.computeBoundingBox();
  const box = geo.boundingBox!;
  const span = Math.max(1e-5, box.max.y - box.min.y);
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - box.min.y) / span;
    const v = bottom + (top - bottom) * t;
    colors[i * 3] = v;
    colors[i * 3 + 1] = v;
    colors[i * 3 + 2] = v;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

/** Revolve a [radius, height] profile into a smooth solid, optionally flattened in z. */
export function lathe(profile: ReadonlyArray<readonly [number, number]>, segments = 12, flattenZ = 1): THREE.BufferGeometry {
  const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
  const geo = new THREE.LatheGeometry(pts, segments);
  if (flattenZ !== 1) geo.scale(1, 1, flattenZ);
  geo.computeVertexNormals();
  return shade(geo);
}

/** A limb segment: a tapered capsule hanging down from the origin. */
function segment(rTop: number, rBottom: number, length: number): THREE.BufferGeometry {
  const r = (rTop + rBottom) / 2;
  const geo = new THREE.CapsuleGeometry(r, Math.max(0.01, length - r * 0.6), 4, 10);
  // Taper: scale x/z by height.
  const pos = geo.attributes.position as THREE.BufferAttribute;
  geo.computeBoundingBox();
  const box = geo.boundingBox!;
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - box.min.y) / (box.max.y - box.min.y);
    const k = (rBottom + (rTop - rBottom) * t) / r;
    pos.setX(i, pos.getX(i) * k);
    pos.setZ(i, pos.getZ(i) * k);
  }
  geo.translate(0, -length / 2, 0);
  geo.computeVertexNormals();
  return shade(geo, 1.02, 0.92);
}

function sphere(r: number): THREE.BufferGeometry {
  return shade(new THREE.SphereGeometry(r, 10, 8), 1.02, 0.94);
}

function roundedBox(w: number, h: number, d: number): THREE.BufferGeometry {
  return shade(new THREE.BoxGeometry(w, h, d, 1, 1, 1), 1.02, 0.94);
}

/** Merge every child mesh of `parent` that shares a material into a single mesh. */
function mergeByMaterial(parent: THREE.Object3D): void {
  const groups = new Map<THREE.Material, THREE.Mesh[]>();
  for (const child of parent.children) {
    if (!(child instanceof THREE.Mesh)) continue;
    const list = groups.get(child.material as THREE.Material) ?? [];
    list.push(child);
    groups.set(child.material as THREE.Material, list);
  }
  for (const [mat, meshes] of groups) {
    if (meshes.length < 2) continue;
    const geos = meshes.map((m) => {
      m.updateMatrix();
      const g = (m.geometry as THREE.BufferGeometry).clone().applyMatrix4(m.matrix);
      return g.index ? g.toNonIndexed() : g;
    });
    const merged = mergeGeometries(geos, false);
    for (const m of meshes) parent.remove(m);
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    parent.add(mesh);
  }
}

export function put(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

// --- Humanoid rig -------------------------------------------------------------------

export interface HumanoidPalette {
  skin: number;
  hair: number;
  tunic: number;
  trouser: number;
  boots: number;
}

export interface HumanoidSpec {
  /** Standing height in tiles (about metres). */
  height: number;
  palette: HumanoidPalette;
  /** Head size relative to a realistic head. */
  headScale?: number;
  /** Arm and leg length relative to realistic. */
  armScale?: number;
  legScale?: number;
  /** 0 = flat stomach, 1 = pot belly. */
  belly?: number;
  /** Resting forward lean of the spine, radians. */
  hunch?: number;
  /** Long hooked nose and bat ears for goblins. */
  goblin?: boolean;
  /** Hair style. */
  hair?: 'short' | 'long' | 'bald';
  /** Optional decorations added to the head or body sockets. */
  extras?: (rig: Rig) => void;
}

/**
 * A person: about seven and a half heads tall, hips a little under half way
 * up, shoulders a fifth of the height wide. Legs and arms are two capsules
 * with a sphere at the joint so bends stay closed.
 */
export function buildHumanoid(spec: HumanoidSpec): Rig {
  const s = spec.height / 1.75;
  const p = spec.palette;
  const headK = spec.headScale ?? 1;
  const armK = spec.armScale ?? 1;
  const legK = spec.legScale ?? 1;
  const belly = spec.belly ?? 0;

  const thigh = 0.44 * s * legK;
  const shin = 0.42 * s * legK;
  const hipsY = (0.06 + 0.44 + 0.42) * s * legK;
  const torso = 0.52 * s;
  const upperArm = 0.3 * s * armK;
  const forearm = 0.27 * s * armK;
  const hand = 0.15 * s;
  const headR = 0.115 * s * headK;
  const shoulderHalf = 0.18 * s;
  const hipHalf = 0.085 * s;

  const skin = material(p.skin, 'skin');
  const tunic = material(p.tunic, 'cloth');
  const trouser = material(p.trouser, 'cloth');
  const boots = material(p.boots, 'leather');
  const hair = material(p.hair, 'hair');
  const dark = material(0x1a1612, 'dark');

  const group = new THREE.Group();
  group.rotation.order = 'YXZ';
  const joint = (name: string, parent: THREE.Object3D, x: number, y: number, z: number): THREE.Object3D => {
    const j = new THREE.Object3D();
    j.name = name;
    j.position.set(x, y, z);
    j.rotation.order = 'YXZ';
    parent.add(j);
    return j;
  };

  const hips = joint('hips', group, 0, hipsY, 0);
  // Pelvis.
  hips.add(put(lathe([[0.11 * s, -0.12 * s], [0.14 * s, -0.02 * s], [0.135 * s, 0.06 * s]], 12, 0.72), trouser, 0, 0, 0));

  // Torso: waist, chest, shoulders, with an optional belly.
  const spine = joint('spine', hips, 0, 0.04 * s, 0);
  const bellyR = 0.03 * belly;
  spine.add(
    put(
      lathe(
        [
          [0.125 * s, 0],
          [(0.14 + bellyR * 1.5) * s, 0.1 * s],
          [(0.14 + bellyR) * s, 0.24 * s],
          [0.165 * s, 0.38 * s],
          [0.175 * s, 0.45 * s],
          [0.13 * s, 0.5 * s],
          [0.06 * s, 0.52 * s],
        ],
        14,
        0.62 + belly * 0.15,
      ),
      tunic,
    ),
  );
  // Belt.
  spine.add(put(lathe([[0.135 * s, -0.01 * s], [0.14 * s, 0.04 * s], [0.13 * s, 0.05 * s]], 12, 0.7), boots, 0, 0, 0));

  const neck = joint('neck', spine, 0, torso - 0.02 * s, 0);
  neck.add(put(segment(0.045 * s, 0.05 * s, 0.09 * s), skin, 0, 0.09 * s, 0));

  // Head: chin, jaw, cheekbones, brow, crown.
  const head = joint('head', neck, 0, 0.08 * s, 0);
  const hr = headR;
  head.add(
    put(
      lathe(
        [
          [0.045 * hr * 8.7, 0],
          [0.78 * hr, 0.25 * hr],
          [0.95 * hr, 0.8 * hr],
          [1.0 * hr, 1.3 * hr],
          [0.92 * hr, 1.75 * hr],
          [0.6 * hr, 2.02 * hr],
          [0, 2.08 * hr],
        ],
        14,
        0.9,
      ),
      skin,
      0,
      0,
      0,
    ),
  );
  // Face: eyes, brows, nose, mouth, ears.
  for (const sx of [-0.33 * hr, 0.33 * hr]) {
    head.add(put(sphere(0.1 * hr), dark, sx, 1.25 * hr, 0.82 * hr));
    const brow = put(roundedBox(0.3 * hr, 0.05 * hr, 0.06 * hr), hair, sx, 1.45 * hr, 0.86 * hr);
    brow.rotation.z = sx < 0 ? 0.15 : -0.15;
    head.add(brow);
  }
  if (spec.goblin) {
    const nose = put(new THREE.ConeGeometry(0.16 * hr, 0.9 * hr, 6), skin, 0, 1.05 * hr, 0.9 * hr);
    nose.geometry = shade(nose.geometry);
    nose.rotation.x = Math.PI / 2 + 0.25;
    head.add(nose);
    for (const sx of [-1, 1]) {
      const ear = put(new THREE.ConeGeometry(0.35 * hr, 1.3 * hr, 5), skin, sx * 1.05 * hr, 1.5 * hr, 0);
      ear.geometry = shade(ear.geometry);
      ear.rotation.z = sx < 0 ? 1.15 : -1.15;
      head.add(ear);
    }
  } else {
    const nose = put(roundedBox(0.16 * hr, 0.34 * hr, 0.2 * hr), skin, 0, 1.05 * hr, 0.92 * hr);
    nose.rotation.x = -0.15;
    head.add(nose);
    for (const sx of [-0.98 * hr, 0.98 * hr]) {
      const ear = put(sphere(0.16 * hr), skin, sx, 1.2 * hr, 0.05 * hr);
      ear.scale.set(0.5, 1, 0.8);
      head.add(ear);
    }
  }
  head.add(put(roundedBox(0.3 * hr, 0.05 * hr, 0.05 * hr), material(0x7a3a34, 'dark'), 0, 0.68 * hr, 0.9 * hr));

  const hairStyle = spec.hair ?? 'short';
  if (hairStyle !== 'bald') {
    // Crown cap plus a mane down the back, leaving the face open.
    head.add(put(lathe([[0.97 * hr, 1.3 * hr], [1.02 * hr, 1.6 * hr], [0.9 * hr, 1.95 * hr], [0.45 * hr, 2.15 * hr], [0, 2.18 * hr]], 14, 0.92), hair));
    const mane = new THREE.LatheGeometry(
      [
        new THREE.Vector2(1.0 * hr, hairStyle === 'long' ? -0.4 * hr : 0.7 * hr),
        new THREE.Vector2(1.04 * hr, 1.0 * hr),
        new THREE.Vector2(1.0 * hr, 1.5 * hr),
      ],
      8,
      Math.PI * 0.31, // the gap in the lathe faces +z: the face stays open
      Math.PI * 1.38,
    );
    mane.scale(1, 1, 0.92);
    mane.computeVertexNormals();
    head.add(put(shade(mane), hair));
    // Fringe.
    head.add(put(roundedBox(1.3 * hr, 0.22 * hr, 0.3 * hr), hair, 0, 1.68 * hr, 0.72 * hr));
  }

  // Legs.
  const legs: Record<'L' | 'R', THREE.Object3D[]> = { L: [], R: [] };
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? hipHalf : -hipHalf;
    const th = joint(`thigh${side}`, hips, sx, -0.04 * s, 0);
    th.add(put(segment(0.075 * s, 0.06 * s, thigh), trouser));
    const kn = joint(`knee${side}`, th, 0, -thigh, 0);
    kn.add(put(sphere(0.058 * s), trouser));
    kn.add(put(segment(0.055 * s, 0.045 * s, shin), trouser));
    const ft = joint(`foot${side}`, kn, 0, -shin, 0);
    ft.add(put(roundedBox(0.1 * s, 0.07 * s, 0.26 * s), boots, 0, -0.03 * s, 0.05 * s));
    legs[side] = [th, kn, ft];
  }

  // Arms: shoulders sit on the top of the torso, hands are flat boxes.
  const arms: Record<'L' | 'R', THREE.Object3D[]> = { L: [], R: [] };
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? shoulderHalf : -shoulderHalf;
    const sh = joint(`shoulder${side}`, spine, sx, torso - 0.05 * s, 0);
    sh.add(put(sphere(0.054 * s), tunic));
    sh.add(put(segment(0.052 * s, 0.043 * s, upperArm), tunic));
    const el = joint(`elbow${side}`, sh, 0, -upperArm, 0);
    el.add(put(sphere(0.042 * s), tunic));
    el.add(put(segment(0.04 * s, 0.034 * s, forearm), skin));
    const hd = joint(`hand${side}`, el, 0, -forearm, 0);
    hd.add(put(roundedBox(0.07 * s, hand, 0.035 * s), skin, 0, -hand / 2, 0));
    arms[side] = [sh, el, hd];
  }

  if (spec.hunch) spine.rotation.x = spec.hunch;

  // Fewer draw calls: parts that share a material and never move relative to
  // each other become one mesh.
  mergeByMaterial(head);
  for (const side of ['L', 'R'] as const) {
    mergeByMaterial(legs[side][1]);
    mergeByMaterial(arms[side][0]);
  }

  const joints: Record<JointName, THREE.Object3D> = {
    hips,
    spine,
    neck,
    head,
    thighL: legs.L[0],
    kneeL: legs.L[1],
    footL: legs.L[2],
    thighR: legs.R[0],
    kneeR: legs.R[1],
    footR: legs.R[2],
    shoulderL: arms.L[0],
    elbowL: arms.L[1],
    handL: arms.L[2],
    shoulderR: arms.R[0],
    elbowR: arms.R[1],
    handR: arms.R[2],
  };
  const rig: Rig = {
    group,
    joints,
    sockets: {
      head,
      torso: spine,
      thighL: legs.L[0],
      thighR: legs.R[0],
      shinL: legs.L[1],
      shinR: legs.R[1],
      footL: legs.L[2],
      footR: legs.R[2],
      handL: arms.L[2],
      handR: arms.R[2],
    },
    barHeight: spec.height + 0.22,
    dims: { scale: s, thigh, shin, upperArm, forearm, torso, headR, shoulderHalf, hipHalf },
    kind: 'humanoid',
  };
  spec.extras?.(rig);
  return rig;
}

/** A giant rat: a long body on four short legs, snout, ears, and a bald tail. */
export function buildRat(): Rig {
  const fur = material(0x6f5c48, 'hair');
  const darkFur = material(0x4a3d30, 'hair');
  const pink = material(0xc98b8b, 'skin');
  const dark = material(0x1a1612, 'dark');
  const group = new THREE.Group();
  group.rotation.order = 'YXZ';
  const joint = (name: string, parent: THREE.Object3D, x: number, y: number, z: number): THREE.Object3D => {
    const j = new THREE.Object3D();
    j.name = name;
    j.position.set(x, y, z);
    j.rotation.order = 'YXZ';
    parent.add(j);
    return j;
  };
  const hips = joint('hips', group, 0, 0.22, 0);
  const body = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.05, -0.4),
      new THREE.Vector2(0.15, -0.25),
      new THREE.Vector2(0.17, 0.05),
      new THREE.Vector2(0.13, 0.3),
      new THREE.Vector2(0.09, 0.42),
      new THREE.Vector2(0.03, 0.62),
    ],
    12,
  );
  body.rotateX(Math.PI / 2);
  body.computeVertexNormals();
  hips.add(put(shade(body, 1.02, 0.85), fur));
  const spine = joint('spine', hips, 0, 0, 0.3);
  const neck = joint('neck', spine, 0, 0.02, 0.28);
  const head = joint('head', neck, 0, 0, 0);
  const snout = put(new THREE.ConeGeometry(0.05, 0.12, 8), pink, 0, -0.03, 0.08);
  snout.geometry = shade(snout.geometry);
  snout.rotation.x = Math.PI / 2;
  head.add(snout);
  for (const sx of [-0.08, 0.08]) {
    const ear = put(sphere(0.045), pink, sx, 0.1, -0.06);
    ear.scale.set(1, 1, 0.4);
    head.add(ear);
    head.add(put(sphere(0.018), dark, sx * 0.8, 0.02, 0.06));
  }
  const tail = put(new THREE.ConeGeometry(0.03, 0.7, 6), pink, 0, -0.08, -0.7);
  tail.geometry = shade(tail.geometry);
  tail.rotation.x = -Math.PI / 2 - 0.15;
  hips.add(tail);

  const leg = (name: string, x: number, z: number): [THREE.Object3D, THREE.Object3D, THREE.Object3D] => {
    const th = joint(name, hips, x, -0.06, z);
    th.add(put(segment(0.04, 0.035, 0.1), fur));
    const kn = joint(`${name}k`, th, 0, -0.1, 0);
    kn.add(put(segment(0.03, 0.025, 0.08), darkFur));
    const ft = joint(`${name}f`, kn, 0, -0.08, 0);
    return [th, kn, ft];
  };
  const bl = leg('thighL', 0.11, -0.18);
  const br = leg('thighR', -0.11, -0.18);
  const fl = leg('shoulderL', 0.11, 0.2);
  const fr = leg('shoulderR', -0.11, 0.2);
  const joints: Record<JointName, THREE.Object3D> = {
    hips,
    spine,
    neck,
    head,
    thighL: bl[0],
    kneeL: bl[1],
    footL: bl[2],
    thighR: br[0],
    kneeR: br[1],
    footR: br[2],
    shoulderL: fl[0],
    elbowL: fl[1],
    handL: fl[2],
    shoulderR: fr[0],
    elbowR: fr[1],
    handR: fr[2],
  };
  return {
    group,
    joints,
    sockets: {
      head,
      torso: spine,
      thighL: bl[0],
      thighR: br[0],
      shinL: bl[1],
      shinR: br[1],
      footL: bl[2],
      footR: br[2],
      handL: fl[2],
      handR: fr[2],
    },
    barHeight: 0.8,
    dims: { scale: 0.5, thigh: 0.1, shin: 0.08, upperArm: 0.1, forearm: 0.08, torso: 0.3, headR: 0.06, shoulderHalf: 0.11, hipHalf: 0.11 },
    kind: 'rat',
  };
}

// --- Clips --------------------------------------------------------------------------

export type ActionKind =
  | 'slash'
  | 'stab'
  | 'crush'
  | 'bow'
  | 'cast'
  | 'chop'
  | 'mine'
  | 'fish'
  | 'hammer'
  | 'crouch'
  | 'flinch'
  | 'death';

/** Durations in seconds; skilling clips loop, the rest play once. */
export const ACTION_DURATION: Record<ActionKind, number> = {
  slash: 0.5,
  stab: 0.45,
  crush: 0.55,
  bow: 0.6,
  cast: 0.7,
  chop: 0.9,
  mine: 1.0,
  fish: 2.4,
  hammer: 0.8,
  crouch: 1.6,
  flinch: 0.35,
  death: 1.1,
};

const TWO_PI = Math.PI * 2;

function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Standing: relaxed arms with a little bend, breathing, and a slow weight shift. */
function idlePose(t: number, out: Pose): void {
  const breath = Math.sin(t * 2.1) * 0.5 + 0.5;
  set(out, 'spine', 0.02 + breath * 0.02, Math.sin(t * 0.37) * 0.03, 0);
  set(out, 'neck', -0.03 + Math.sin(t * 0.61) * 0.02, Math.sin(t * 0.45) * 0.06, 0);
  set(out, 'shoulderL', 0.04, 0, -0.07);
  set(out, 'shoulderR', 0.04, 0, 0.07);
  set(out, 'elbowL', -0.16, 0, 0.02);
  set(out, 'elbowR', -0.16, 0, -0.02);
  const shift = Math.sin(t * 0.3);
  set(out, 'hips', 0, 0, shift * 0.02);
  set(out, 'thighL', 0.02, 0, -shift * 0.02);
  set(out, 'thighR', 0.02, 0, -shift * 0.02);
  set(out, 'kneeL', 0.04);
  set(out, 'kneeR', 0.04);
  out.hipsY = -0.005 + breath * 0.004;
}

/**
 * Walk/run cycle at `phase` in [0, 1): one full stride (two steps). `run`
 * blends from a walk to a run: longer swing, bent arms, forward lean, more
 * bounce, knees driven higher.
 */
function gaitPose(phase: number, run: number, out: Pose): void {
  const a = phase * TWO_PI;
  const swing = 0.55 + run * 0.35; // thigh amplitude
  const leg = Math.sin(a);
  // Knees bend when the leg is swinging forward (thigh going negative).
  const kneeL = Math.max(0, Math.sin(a + 0.9)) * (0.9 + run * 0.6);
  const kneeR = Math.max(0, Math.sin(a + Math.PI + 0.9)) * (0.9 + run * 0.6);
  set(out, 'thighL', -leg * swing, 0, 0);
  set(out, 'thighR', leg * swing, 0, 0);
  set(out, 'kneeL', kneeL);
  set(out, 'kneeR', kneeR);
  // Feet flex to stay flat on the ground on the stance leg.
  set(out, 'footL', leg * 0.25 - kneeL * 0.3 + 0.05);
  set(out, 'footR', -leg * 0.25 - kneeR * 0.3 + 0.05);
  // Arms swing opposite the legs, elbows more bent when running.
  const armSwing = 0.35 + run * 0.45;
  set(out, 'shoulderL', leg * armSwing, 0, -0.08 - run * 0.1);
  set(out, 'shoulderR', -leg * armSwing, 0, 0.08 + run * 0.1);
  set(out, 'elbowL', -0.25 - run * 0.9 + Math.max(0, leg) * 0.25, 0, 0);
  set(out, 'elbowR', -0.25 - run * 0.9 + Math.max(0, -leg) * 0.25, 0, 0);
  // Hips sway and dip, the spine counter-rotates, the head stays level.
  const bounce = (1 - Math.cos(a * 2)) * 0.5;
  set(out, 'hips', 0, leg * 0.08, -leg * 0.05);
  set(out, 'spine', 0.06 + run * 0.22, -leg * 0.12, leg * 0.04);
  set(out, 'neck', -0.05 - run * 0.15, leg * 0.06, 0);
  out.hipsY = -0.02 + bounce * (0.025 + run * 0.03);
}

/** The rat trots: diagonal legs together, the spine bobs, the tail sweeps. */
function ratGaitPose(phase: number, out: Pose): void {
  const a = phase * TWO_PI;
  const s = Math.sin(a);
  set(out, 'thighL', s * 0.6);
  set(out, 'thighR', -s * 0.6);
  set(out, 'shoulderL', -s * 0.6);
  set(out, 'shoulderR', s * 0.6);
  set(out, 'spine', Math.sin(a * 2) * 0.05);
  set(out, 'hips', 0, Math.sin(a) * 0.06, 0);
  out.hipsY = Math.abs(Math.sin(a)) * 0.015;
}

function ratIdlePose(t: number, out: Pose): void {
  set(out, 'neck', Math.sin(t * 3) * 0.05, Math.sin(t * 0.7) * 0.2, 0);
  set(out, 'hips', 0, Math.sin(t * 1.1) * 0.03, 0);
}

/**
 * Action clips write the joints they own and return a per-joint mask (1 =
 * owned). `p` runs 0 → 1 over the clip. Weapon arm is the right (-x) arm.
 */
function actionPose(kind: ActionKind, p: number, out: Pose, mask: Float32Array): void {
  mask.fill(0);
  const own = (...js: JointName[]): void => {
    for (const j of js) mask[J[j]] = 1;
  };
  const arms: JointName[] = ['shoulderL', 'elbowL', 'handL', 'shoulderR', 'elbowR', 'handR'];
  switch (kind) {
    case 'slash': {
      // Wind up over the shoulder, cut across, settle.
      own(...arms, 'spine', 'neck');
      const wind = ease(Math.min(1, p / 0.35));
      const cut = p < 0.35 ? 0 : ease(Math.min(1, (p - 0.35) / 0.3));
      const settle = p < 0.65 ? 0 : ease((p - 0.65) / 0.35);
      const shoulderX = -2.3 * wind + (2.3 - 0.9) * cut + 0.9 * settle * 0.9;
      set(out, 'shoulderR', shoulderX, 0.4 * wind - 1.0 * cut + 0.6 * settle, 0.5 * wind - 0.2 * cut);
      set(out, 'elbowR', -0.9 * wind + 0.7 * cut, 0, 0);
      set(out, 'handR', -0.3 * cut, 0, 0);
      set(out, 'shoulderL', 0.3 * wind - 0.2 * cut, 0, -0.25);
      set(out, 'elbowL', -0.5, 0, 0);
      set(out, 'spine', 0.05 + 0.18 * cut, 0.35 * wind - 0.6 * cut + 0.25 * settle, 0);
      set(out, 'neck', -0.08, -0.2 * wind + 0.3 * cut, 0);
      break;
    }
    case 'stab': {
      own(...arms, 'spine', 'neck');
      const back = ease(Math.min(1, p / 0.3));
      const thrust = p < 0.3 ? 0 : ease(Math.min(1, (p - 0.3) / 0.25));
      const settle = p < 0.55 ? 0 : ease((p - 0.55) / 0.45);
      set(out, 'shoulderR', 0.7 * back - 2.2 * thrust + 1.5 * settle, 0, 0.15);
      set(out, 'elbowR', -1.2 * back + 1.0 * thrust - 0.1 * settle, 0, 0);
      set(out, 'handR', 0, 0, 0);
      set(out, 'shoulderL', -0.4 * back + 0.5 * thrust - 0.2 * settle, 0, -0.3);
      set(out, 'elbowL', -0.9, 0, 0);
      set(out, 'spine', 0.06 + 0.25 * thrust - 0.15 * settle, -0.3 * back + 0.5 * thrust - 0.2 * settle, 0);
      set(out, 'neck', -0.1, 0, 0);
      break;
    }
    case 'crush':
    case 'hammer':
    case 'mine': {
      // Both hands overhead, then a heavy downward strike.
      own(...arms, 'spine', 'neck');
      const raise = ease(Math.min(1, p / 0.45));
      const strike = p < 0.45 ? 0 : ease(Math.min(1, (p - 0.45) / 0.25));
      const settle = p < 0.7 ? 0 : ease((p - 0.7) / 0.3);
      const two = kind !== 'crush' ? 1 : 0.3;
      const sh = -2.6 * raise + 2.2 * strike + 0.1 * settle;
      set(out, 'shoulderR', sh, 0, 0.25 * raise);
      set(out, 'elbowR', -0.8 * raise + 0.5 * strike, 0, 0);
      set(out, 'shoulderL', sh * two, 0, -0.25 * raise);
      set(out, 'elbowL', (-0.8 * raise + 0.5 * strike) * two, 0, 0);
      set(out, 'spine', -0.2 * raise + 0.55 * strike - 0.1 * settle, 0, 0);
      set(out, 'neck', 0.15 * raise - 0.3 * strike, 0, 0);
      break;
    }
    case 'chop': {
      // A woodsman's sideways swing into the trunk with both hands.
      own(...arms, 'spine', 'neck');
      const wind = ease(Math.min(1, p / 0.4));
      const cut = p < 0.4 ? 0 : ease(Math.min(1, (p - 0.4) / 0.25));
      const settle = p < 0.65 ? 0 : ease((p - 0.65) / 0.35);
      const shx = -1.3 * wind + 0.3 * cut + 0.2 * settle;
      set(out, 'shoulderR', shx, 0.6 * wind - 1.3 * cut + 0.5 * settle, 0.4);
      set(out, 'elbowR', -0.6 * wind + 0.3 * cut, 0, 0);
      set(out, 'shoulderL', shx, 0.6 * wind - 1.3 * cut + 0.5 * settle, -0.5);
      set(out, 'elbowL', -0.9 * wind + 0.2 * cut, 0, 0);
      set(out, 'spine', 0.15, 0.5 * wind - 0.9 * cut + 0.35 * settle, 0);
      set(out, 'neck', -0.05, -0.3 * wind + 0.4 * cut, 0);
      break;
    }
    case 'bow': {
      own(...arms, 'spine', 'neck');
      const draw = ease(Math.min(1, p / 0.5));
      const release = p < 0.5 ? 0 : ease(Math.min(1, (p - 0.5) / 0.15));
      const settle = p < 0.65 ? 0 : ease((p - 0.65) / 0.35);
      // Left arm holds the bow out, right hand draws to the cheek.
      set(out, 'shoulderL', -1.55 * draw + 1.2 * settle, 0.3 * draw, -0.2);
      set(out, 'elbowL', -0.15, 0, 0);
      set(out, 'shoulderR', -1.5 * draw + 0.4 * release + 1.0 * settle, -0.9 * draw + 0.4 * release, 0.3);
      set(out, 'elbowR', -2.2 * draw + 1.2 * release + 0.9 * settle, 0, 0);
      set(out, 'spine', 0.02, 0.55 * draw - 0.5 * settle, 0);
      set(out, 'neck', -0.05, -0.45 * draw + 0.4 * settle, 0);
      break;
    }
    case 'cast': {
      own(...arms, 'spine', 'neck');
      const raise = ease(Math.min(1, p / 0.4));
      const push = p < 0.4 ? 0 : ease(Math.min(1, (p - 0.4) / 0.2));
      const settle = p < 0.6 ? 0 : ease((p - 0.6) / 0.4);
      const sh = -1.2 * raise - 0.4 * push + 1.5 * settle;
      set(out, 'shoulderL', sh, 0, -0.35 * raise);
      set(out, 'shoulderR', sh, 0, 0.35 * raise);
      set(out, 'elbowL', -0.9 * raise + 0.8 * push, 0, 0);
      set(out, 'elbowR', -0.9 * raise + 0.8 * push, 0, 0);
      set(out, 'spine', -0.1 * raise + 0.25 * push - 0.15 * settle, 0, 0);
      set(out, 'neck', 0.1 * raise - 0.2 * push, 0, 0);
      break;
    }
    case 'fish': {
      // Rod held out over the water, a slow patient sway, a small tug.
      own(...arms, 'spine', 'neck');
      const sway = Math.sin(p * TWO_PI) * 0.06;
      const tug = p > 0.7 && p < 0.85 ? Math.sin(((p - 0.7) / 0.15) * Math.PI) : 0;
      set(out, 'shoulderR', -1.15 - tug * 0.35, 0.1, 0.15);
      set(out, 'elbowR', -0.35 + tug * 0.2, 0, 0);
      set(out, 'shoulderL', -0.85 - tug * 0.25, 0.25, -0.3);
      set(out, 'elbowL', -0.9, 0, 0);
      set(out, 'spine', 0.1 + sway, 0.15, 0);
      set(out, 'neck', -0.15, 0.1, 0);
      break;
    }
    case 'crouch': {
      // Kneel to the ground (lighting a fire, cooking).
      own(...arms, 'spine', 'neck', 'thighL', 'kneeL', 'footL', 'thighR', 'kneeR', 'footR', 'hips');
      const down = ease(Math.min(1, p / 0.3)) * (p < 0.85 ? 1 : ease(1 - (p - 0.85) / 0.15));
      const work = Math.sin(p * TWO_PI * 3) * 0.15 * down;
      set(out, 'thighL', -1.35 * down, 0, 0.15 * down);
      set(out, 'kneeL', 2.2 * down);
      set(out, 'footL', 0.6 * down);
      set(out, 'thighR', -1.05 * down, 0, -0.15 * down);
      set(out, 'kneeR', 2.35 * down);
      set(out, 'footR', 0.8 * down);
      set(out, 'spine', 0.45 * down, 0, 0);
      set(out, 'neck', -0.2 * down, 0, 0);
      set(out, 'shoulderR', -1.0 * down + work, 0, 0.2);
      set(out, 'elbowR', -0.5 * down, 0, 0);
      set(out, 'shoulderL', -0.8 * down - work, 0, -0.25);
      set(out, 'elbowL', -0.6 * down, 0, 0);
      out.hipsY = -0.5 * down;
      break;
    }
    case 'flinch': {
      own('spine', 'neck', 'shoulderL', 'shoulderR');
      const k = Math.sin(p * Math.PI);
      set(out, 'spine', -0.35 * k, 0, 0.1 * k);
      set(out, 'neck', -0.3 * k, 0, 0);
      set(out, 'shoulderL', -0.5 * k, 0, -0.4 * k);
      set(out, 'shoulderR', -0.5 * k, 0, 0.4 * k);
      break;
    }
    case 'death': {
      // Knees buckle, then the body topples backward and settles.
      own(...JOINTS);
      const buckle = ease(Math.min(1, p / 0.35));
      const fall = p < 0.25 ? 0 : ease(Math.min(1, (p - 0.25) / 0.45));
      set(out, 'thighL', -0.6 * buckle, 0, 0.1);
      set(out, 'thighR', -0.5 * buckle, 0, -0.1);
      set(out, 'kneeL', 1.1 * buckle);
      set(out, 'kneeR', 0.9 * buckle);
      set(out, 'spine', 0.3 * buckle - 0.5 * fall, 0.1 * fall, 0);
      set(out, 'neck', 0.2 * buckle - 0.5 * fall, 0.2 * fall, 0);
      set(out, 'shoulderL', -0.4 * buckle - 1.2 * fall, 0, -0.6 * fall);
      set(out, 'shoulderR', -0.3 * buckle - 0.9 * fall, 0, 0.7 * fall);
      set(out, 'elbowL', -0.5 * buckle, 0, 0);
      set(out, 'elbowR', -0.3 * buckle, 0, 0);
      out.hipsY = -0.25 * buckle - 0.55 * fall;
      out.lean = -1.35 * fall;
      out.rootY = -0.05 * fall;
      break;
    }
  }
}

// --- Animator -----------------------------------------------------------------------

export interface AnimationInput {
  /** Distance moved this frame, in tiles. */
  moved: number;
  moving: boolean;
  running: boolean;
  /** Seconds of world time (for idle motion). */
  time: number;
}

/** Drives one rig: locomotion, a layered action, and eased transitions. */
export class Animator {
  private phase = 0;
  private gait = 0;
  private run = 0;
  private readonly base = makePose();
  private readonly action = makePose();
  private readonly mask = new Float32Array(JOINTS.length);
  private readonly current = makePose();
  private readonly target = makePose();
  private clip: ActionKind | null = null;
  private clipT = 0;
  private clipLoop = false;
  private clipWeight = 0;
  /** Facing (yaw) eased toward the requested heading. */
  private yaw = 0;
  private yawSet = false;

  constructor(private readonly rig: Rig) {}

  /** Start (or restart) an action. Looping actions repeat until {@link stopAction}. */
  play(kind: ActionKind, loop = false): void {
    if (this.clip === kind && loop && this.clipLoop) return; // already cycling
    this.clip = kind;
    this.clipT = 0;
    this.clipLoop = loop;
  }

  get playing(): ActionKind | null {
    return this.clip;
  }

  /** Back to a neutral standing pose with no action (a respawn). */
  reset(): void {
    this.clip = null;
    this.clipLoop = false;
    this.clipWeight = 0;
    this.phase = 0;
    this.gait = 0;
    clearPose(this.current);
  }

  stopAction(): void {
    this.clipLoop = false;
    if (this.clip && ACTION_DURATION[this.clip] > 1) this.clip = null;
  }

  /** Ease the body's heading toward `heading` (radians about y). */
  face(heading: number, dt: number, snap = false): void {
    if (!this.yawSet || snap) {
      this.yaw = heading;
      this.yawSet = true;
      return;
    }
    let delta = heading - this.yaw;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta)); // shortest arc
    const maxStep = 9 * dt; // a half turn in about a third of a second
    this.yaw += Math.max(-maxStep, Math.min(maxStep, delta));
  }

  update(input: AnimationInput, dt: number): void {
    const rig = this.rig;
    // Gait weight eases in and out; the stride phase advances with distance.
    const targetGait = input.moving ? 1 : 0;
    this.gait += (targetGait - this.gait) * Math.min(1, dt * 9);
    this.run += ((input.running ? 1 : 0) - this.run) * Math.min(1, dt * 6);
    const stride = rig.kind === 'rat' ? 0.55 : (1.35 + this.run * 0.9) * rig.dims.scale;
    if (input.moved > 0) this.phase = (this.phase + input.moved / stride) % 1;
    else if (this.gait < 0.02) this.phase = 0;

    // Locomotion: idle blended with the cycle.
    const base = this.base;
    const cycle = this.target;
    clearPose(base);
    clearPose(cycle);
    if (rig.kind === 'rat') {
      ratIdlePose(input.time, base);
      ratGaitPose(this.phase, cycle);
    } else {
      idlePose(input.time, base);
      gaitPose(this.phase, this.run, cycle);
    }
    blendInto(base, cycle, this.gait);

    // Action layer.
    if (this.clip) {
      const duration = ACTION_DURATION[this.clip];
      this.clipT += dt;
      let p = this.clipT / duration;
      if (p >= 1) {
        if (this.clipLoop) {
          this.clipT -= duration;
          p = this.clipT / duration;
        } else if (this.clip === 'death') {
          p = 1; // hold the final frame
        } else {
          this.clip = null;
        }
      }
      if (this.clip) {
        clearPose(this.action);
        actionPose(this.clip, Math.min(1, p), this.action, this.mask);
        this.clipWeight += (1 - this.clipWeight) * Math.min(1, dt * 14);
        for (let j = 0; j < JOINTS.length; j++) {
          const w = this.mask[j] * this.clipWeight;
          if (w <= 0) continue;
          for (let k = 0; k < 3; k++) {
            const i = j * 3 + k;
            base.rot[i] += (this.action.rot[i] - base.rot[i]) * w;
          }
        }
        base.hipsY += (this.action.hipsY - base.hipsY) * this.clipWeight * (this.mask[J.hips] || (this.clip === 'death' ? 1 : 0));
        base.lean += this.action.lean * this.clipWeight;
        base.rootY += this.action.rootY * this.clipWeight;
      }
    }
    if (!this.clip) this.clipWeight = 0;

    // Ease the visible pose toward the target and apply it.
    const k = 1 - Math.exp(-dt * 16);
    const cur = this.current;
    for (let i = 0; i < cur.rot.length; i++) cur.rot[i] += (base.rot[i] - cur.rot[i]) * k;
    cur.hipsY += (base.hipsY - cur.hipsY) * k;
    cur.lean += (base.lean - cur.lean) * k;
    cur.rootY += (base.rootY - cur.rootY) * k;

    for (let j = 0; j < JOINTS.length; j++) {
      const joint = rig.joints[JOINTS[j]];
      joint.rotation.set(cur.rot[j * 3], cur.rot[j * 3 + 1], cur.rot[j * 3 + 2]);
    }
    rig.joints.hips.position.y = rig.joints.hips.userData.restY ?? (rig.joints.hips.userData.restY = rig.joints.hips.position.y);
    rig.joints.hips.position.y += cur.hipsY * rig.dims.scale;
    rig.group.rotation.set(cur.lean, this.yaw, 0);
  }

  /** Vertical offset of the whole body (sinking after death). */
  get rootOffset(): number {
    return this.current.rootY;
  }
}

/** out = out * (1 - w) + b * w, for every channel. */
function blendInto(out: Pose, b: Pose, w: number): void {
  for (let i = 0; i < out.rot.length; i++) out.rot[i] += (b.rot[i] - out.rot[i]) * w;
  out.hipsY += (b.hipsY - out.hipsY) * w;
  out.lean += (b.lean - out.lean) * w;
  out.rootY += (b.rootY - out.rootY) * w;
}
