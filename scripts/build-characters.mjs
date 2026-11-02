// Builds public/models/characters/*.glb: one body per race and sex on the
// shared humanoid skeleton, derived from MakeHuman's CC0 base mesh, morph
// targets, default skeleton and painted skin weights
// (https://github.com/makehumancommunity/makehuman). This script is the
// source of truth for the character assets; there is no Blender step (see
// docs/characters.md).
//
// What it does, per body:
//   1. Layers MakeHuman targets on the base mesh (sex, build, race features
//      such as pointed ears or a heavy jaw) and keeps only its `body` group
//      (no helpers, joint cubes, teeth). The joint cubes move with the
//      targets, so the skeleton follows the shape.
//   2. Folds MakeHuman's weighted bones into the shared skeleton's 22 body
//      bones, which carry the standard humanoid names (Hips, Spine, Spine1,
//      Spine2, Neck, Head, Left/RightShoulder, Arm, ForeArm, Hand, UpLeg, Leg,
//      Foot, ToeBase), plus a short hair chain and a cape chain for sway.
//   3. Bakes a canonical standing pose (arms hanging, legs under the hips).
//   4. Computes smooth normals, splits vertices along UV seams, measures the
//      landmarks and limb radii the renderer needs, and decimates the body
//      into three LODs with meshoptimizer, the head, the hands and the body
//      each to their own triangle budget.
//   5. Writes a GLB with the skeleton, the skinned LOD meshes, and the
//      measurements as glTF extras.
//
// Usage: node scripts/build-characters.mjs [body ...]   (needs network access the first time)
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as THREE from 'three';
import { relaxHands } from './hands.mjs';
import { MeshoptSimplifier } from 'meshoptimizer';
import { GltfBuilder } from './gltf.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(here, '..', 'public', 'models', 'characters');
const CACHE = path.join(here, '.cache', 'makehuman');
const RAW = 'https://raw.githubusercontent.com/makehumancommunity/makehuman/master/';
const FILES = {
  obj: 'makehuman/data/3dobjs/base.obj',
  skel: 'makehuman/data/rigs/default.mhskel',
  weights: 'makehuman/data/rigs/default_weights.mhw',
};
const TARGET_DIR = 'makehuman/data/targets/';

/**
 * Triangle budgets per LOD, split between the head (kept dense for the face,
 * which carries most of the painted detail), the hands (the fingers go first
 * otherwise) and the rest of the body, which is smooth enough to decimate hard.
 */
const LOD_TARGETS = [
  { head: 3400, hands: 600, body: 3000 },
  { head: 1000, hands: 200, body: 1300 },
  { head: 300, hands: 60, body: 440 },
];
/** The body whose decimation every other body reuses (see buildBody). */
const PLAN_BODY = 'human_m';

// ---- The bodies -------------------------------------------------------------------
// Each is a list of MakeHuman targets (path under data/targets, weight) layered
// on the base mesh. A sex is the three ethnic young-adult targets blended
// equally (MakeHuman's own default) plus the "ideal proportions" target, which
// gives the long-legged, eight-heads canon the art direction asks for; races
// add build and face targets on top. The dark elf shares the elf body.
const ETHNIC = ['african', 'asian', 'caucasian'];
const sexed = (sex, ...more) => [
  ...ETHNIC.map((e) => [`macrodetails/${e}-${sex}-young`, 1 / 3]),
  [`macrodetails/proportions/${sex}-young-averagemuscle-averageweight-idealproportions`, 1],
  ...more,
];
/** A left/right pair of targets ('%' stands for the side). */
const both = (name, w) => [
  [name.replace('%', 'l'), w],
  [name.replace('%', 'r'), w],
];
const ELF_FACE = [
  ...both('ears/%-ear-shape-pointed', 1),
  ...both('ears/%-ear-scale-vert-incr', 0.7),
  ...both('ears/%-ear-trans-up', 0.25),
  ...both('cheek/%-cheek-bones-incr', 0.4),
  ['chin/chin-triangle', 0.5],
  ['chin/chin-width-decr', 0.3],
  ['nose/nose-scale-horiz-decr', 0.3],
];
const ORC_FACE = [
  ['chin/chin-width-incr', 0.7],
  ['chin/chin-prognathism-incr', 0.7],
  ['chin/chin-height-incr', 0.4],
  ['eyebrows/eyebrows-trans-forward', 0.7],
  ['forehead/forehead-scale-vert-decr', 0.5],
  ['forehead/forehead-trans-backward', 0.3],
  ['nose/nose-flaring-incr', 0.8],
  ['nose/nose-width2-incr', 0.6],
  ['nose/nose-scale-vert-decr', 0.3],
  ['mouth/mouth-scale-horiz-incr', 0.5],
  ['neck/neck-scale-horiz-incr', 0.5],
  ['head/head-scale-horiz-incr', 0.2],
  ...both('ears/%-ear-shape-pointed', 0.5),
];
const DWARF_FACE = [
  ['nose/nose-scale-horiz-incr', 0.4],
  ['nose/nose-volume-incr', 0.3],
  ['chin/chin-width-incr', 0.3],
  ['head/head-scale-horiz-incr', 0.15],
  ['neck/neck-scale-horiz-incr', 0.3],
];
const BODIES = {
  human_m: sexed('male'),
  human_f: sexed('female'),
  elf_m: sexed('male', ['macrodetails/universal-male-young-averagemuscle-minweight', 0.45], ...ELF_FACE),
  elf_f: sexed('female', ['macrodetails/universal-female-young-averagemuscle-minweight', 0.35], ...ELF_FACE),
  orc_m: sexed(
    'male',
    ['macrodetails/universal-male-young-maxmuscle-averageweight', 0.7],
    ['macrodetails/universal-male-young-maxmuscle-maxweight', 0.3],
    ['torso/torso-scale-horiz-incr', 0.3],
    ['torso/torso-vshape-incr', 0.4],
    ...ORC_FACE,
  ),
  orc_f: sexed(
    'female',
    ['macrodetails/universal-female-young-maxmuscle-averageweight', 0.6],
    ['torso/torso-scale-horiz-incr', 0.15],
    ...ORC_FACE.map(([t, w]) => [t, w * 0.6]),
  ),
  dwarf_m: sexed(
    'male',
    ['macrodetails/height/male-young-averagemuscle-averageweight-minheight', 1],
    ['macrodetails/universal-male-young-maxmuscle-maxweight', 0.45],
    ['macrodetails/universal-male-young-maxmuscle-averageweight', 0.3],
    ['torso/torso-scale-horiz-incr', 0.4],
    ['torso/torso-scale-depth-incr', 0.3],
    ...DWARF_FACE,
  ),
  dwarf_f: sexed(
    'female',
    ['macrodetails/height/female-young-averagemuscle-averageweight-minheight', 1],
    ['macrodetails/universal-female-young-maxmuscle-averageweight', 0.3],
    ['macrodetails/universal-female-young-averagemuscle-maxweight', 0.2],
    ['torso/torso-scale-horiz-incr', 0.25],
    ...DWARF_FACE.map(([t, w]) => [t, w * 0.7]),
  ),
};

async function fetchCached(rel) {
  mkdirSync(CACHE, { recursive: true });
  const local = path.join(CACHE, rel.replace(/^makehuman\/data\//, '').replace(/[\\/]/g, '__'));
  if (existsSync(local)) return readFileSync(local, 'utf8');
  const res = await fetch(RAW + rel);
  if (!res.ok) throw new Error(`${rel}: ${res.status}`);
  const text = await res.text();
  writeFileSync(local, text);
  return text;
}

const [objText, skelText, weightsText] = await Promise.all([fetchCached(FILES.obj), fetchCached(FILES.skel), fetchCached(FILES.weights)]);

/** A target: sparse vertex offsets in base-mesh space (decimetres). */
const targetCache = new Map();
async function loadTarget(name) {
  let t = targetCache.get(name);
  if (t) return t;
  const text = await fetchCached(`${TARGET_DIR}${name}.target`);
  t = [];
  for (const line of text.split('\n')) {
    if (!line || line[0] === '#') continue;
    const p = line.trim().split(/\s+/);
    if (p.length < 4) continue;
    t.push([+p[0], +p[1], +p[2], +p[3]]);
  }
  targetCache.set(name, t);
  return t;
}

// ---- Parse the OBJ ----------------------------------------------------------------
const baseVerts = []; // Vector3, in decimetres, MakeHuman space (y up, +z forward, +x = character's left)
const uvs = [];
const groups = new Map(); // name -> { faces: [[v, vt], ...][], ids: Set<vertexIndex> }
let current = 'default';
for (const line of objText.split('\n')) {
  const p = line.trim().split(/\s+/);
  if (p[0] === 'v') baseVerts.push(new THREE.Vector3(+p[1], +p[2], +p[3]));
  else if (p[0] === 'vt') uvs.push([+p[1], +p[2]]);
  else if (p[0] === 'g') current = p.slice(1).join(' ');
  else if (p[0] === 'f') {
    const g = groups.get(current) ?? { faces: [], ids: new Set() };
    const face = p.slice(1).map((tok) => {
      const [v, vt] = tok.split('/');
      const vi = +v - 1;
      g.ids.add(vi);
      return [vi, vt ? +vt - 1 : -1];
    });
    g.faces.push(face);
    groups.set(current, g);
  }
}
const body = groups.get('body');
if (!body) throw new Error('no body group');
const tris = [];
for (const face of body.faces) {
  for (let i = 1; i + 1 < face.length; i++) tris.push([face[0], face[i], face[i + 1]]);
}
const skel = JSON.parse(skelText);
const weights = JSON.parse(weightsText).weights;

/** The vertices of the body being built: the base mesh plus its targets. */
let verts = baseVerts;
const centroidOf = (ids) => {
  const c = new THREE.Vector3();
  for (const i of ids) c.add(verts[i]);
  return c.divideScalar(ids.length || ids.size);
};
const groupCentroid = (name) => {
  const g = groups.get(name);
  if (!g) throw new Error(`missing joint group ${name}`);
  return centroidOf([...g.ids]);
};
/** Where a MakeHuman bone starts: the centroid of the joint cube its head names. */
const boneHead = (bone) => {
  const b = skel.bones[bone];
  if (!b) throw new Error(`unknown MakeHuman bone ${bone}`);
  return centroidOf(skel.joints[b.head]);
};

// ---- The shared skeleton ----------------------------------------------------------
// [name, parent, where it sits]. The ten game joints keep the helper cubes the
// old template used, so the procedural clips and gear sockets carry over.
const BONES = [
  ['Hips', null, () => groupCentroid('joint-pelvis')],
  ['Spine', 'Hips', () => groupCentroid('joint-spine-4')],
  ['Spine1', 'Spine', () => groupCentroid('joint-spine-3')],
  ['Spine2', 'Spine1', () => groupCentroid('joint-spine-2')],
  ['Neck', 'Spine2', () => groupCentroid('joint-neck')],
  ['Head', 'Neck', () => groupCentroid('joint-head')],
  ['LeftShoulder', 'Spine2', () => boneHead('clavicle.L')],
  ['LeftArm', 'LeftShoulder', () => groupCentroid('joint-l-shoulder')],
  ['LeftForeArm', 'LeftArm', () => groupCentroid('joint-l-elbow')],
  ['LeftHand', 'LeftForeArm', () => groupCentroid('joint-l-hand')],
  ['RightShoulder', 'Spine2', () => boneHead('clavicle.R')],
  ['RightArm', 'RightShoulder', () => groupCentroid('joint-r-shoulder')],
  ['RightForeArm', 'RightArm', () => groupCentroid('joint-r-elbow')],
  ['RightHand', 'RightForeArm', () => groupCentroid('joint-r-hand')],
  ['LeftUpLeg', 'Hips', () => groupCentroid('joint-l-upper-leg')],
  ['LeftLeg', 'LeftUpLeg', () => groupCentroid('joint-l-knee')],
  ['LeftFoot', 'LeftLeg', () => groupCentroid('joint-l-ankle')],
  ['LeftToeBase', 'LeftFoot', () => centroidOf(['toe1-1.L', 'toe2-1.L', 'toe3-1.L', 'toe4-1.L', 'toe5-1.L'].flatMap((b) => skel.joints[skel.bones[b].head]))],
  ['RightUpLeg', 'Hips', () => groupCentroid('joint-r-upper-leg')],
  ['RightLeg', 'RightUpLeg', () => groupCentroid('joint-r-knee')],
  ['RightFoot', 'RightLeg', () => groupCentroid('joint-r-ankle')],
  ['RightToeBase', 'RightFoot', () => centroidOf(['toe1-1.R', 'toe2-1.R', 'toe3-1.R', 'toe4-1.R', 'toe5-1.R'].flatMap((b) => skel.joints[skel.bones[b].head]))],
  // Secondary chains, placed after the pose is baked (see below): hair down the back of the skull, cape down the back.
  ['Hair1', 'Head', null],
  ['Hair2', 'Hair1', null],
  ['Hair3', 'Hair2', null],
  ['Cape1', 'Spine2', null],
  ['Cape2', 'Cape1', null],
  ['Cape3', 'Cape2', null],
];
const BONE_NAMES = BONES.map((b) => b[0]);
const BONE_PARENT = Object.fromEntries(BONES.map((b) => [b[0], b[1]]));
const boneIndex = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i]));
const BODY_BONES = BONES.filter((b) => b[2]).map((b) => b[0]);

/** The game's animated joints, by the shared bone that carries each. */
const GAME_JOINTS = {
  hips: 'Hips',
  spine: 'Spine',
  neck: 'Neck',
  head: 'Head',
  thighL: 'LeftUpLeg',
  kneeL: 'LeftLeg',
  footL: 'LeftFoot',
  thighR: 'RightUpLeg',
  kneeR: 'RightLeg',
  footR: 'RightFoot',
  shoulderL: 'LeftArm',
  elbowL: 'LeftForeArm',
  handL: 'LeftHand',
  shoulderR: 'RightArm',
  elbowR: 'RightForeArm',
  handR: 'RightHand',
};
/** Which game joint owns each bone's flesh, for the renderer's reshape and painters. */
const OWNER = {
  Hips: 'hips',
  Spine: 'spine',
  Spine1: 'spine',
  Spine2: 'spine',
  Neck: 'neck',
  Head: 'head',
  LeftShoulder: 'spine',
  LeftArm: 'shoulderL',
  LeftForeArm: 'elbowL',
  LeftHand: 'handL',
  RightShoulder: 'spine',
  RightArm: 'shoulderR',
  RightForeArm: 'elbowR',
  RightHand: 'handR',
  LeftUpLeg: 'thighL',
  LeftLeg: 'kneeL',
  LeftFoot: 'footL',
  LeftToeBase: 'footL',
  RightUpLeg: 'thighR',
  RightLeg: 'kneeR',
  RightFoot: 'footR',
  RightToeBase: 'footR',
  Hair1: 'head',
  Hair2: 'head',
  Hair3: 'head',
  Cape1: 'spine',
  Cape2: 'spine',
  Cape3: 'spine',
};

// MakeHuman bone -> shared bone. Anything below these in the hierarchy folds into them.
const FOLD = {
  root: 'Hips', 'pelvis.L': 'Hips', 'pelvis.R': 'Hips', spine05: 'Hips',
  spine04: 'Spine', spine03: 'Spine1', spine02: 'Spine2', spine01: 'Spine2',
  'clavicle.L': 'LeftShoulder', 'shoulder01.L': 'LeftShoulder', 'clavicle.R': 'RightShoulder', 'shoulder01.R': 'RightShoulder',
  neck01: 'Neck', neck02: 'Neck', neck03: 'Neck', head: 'Head',
  'upperarm01.L': 'LeftArm', 'upperarm02.L': 'LeftArm', 'lowerarm01.L': 'LeftForeArm', 'lowerarm02.L': 'LeftForeArm', 'wrist.L': 'LeftHand',
  'upperarm01.R': 'RightArm', 'upperarm02.R': 'RightArm', 'lowerarm01.R': 'RightForeArm', 'lowerarm02.R': 'RightForeArm', 'wrist.R': 'RightHand',
  'upperleg01.L': 'LeftUpLeg', 'upperleg02.L': 'LeftUpLeg', 'lowerleg01.L': 'LeftLeg', 'lowerleg02.L': 'LeftLeg', 'foot.L': 'LeftFoot',
  'upperleg01.R': 'RightUpLeg', 'upperleg02.R': 'RightUpLeg', 'lowerleg01.R': 'RightLeg', 'lowerleg02.R': 'RightLeg', 'foot.R': 'RightFoot',
};
const foldOf = (bone) => {
  if (/^toe\d-\d\.L$/.test(bone)) return 'LeftToeBase';
  if (/^toe\d-\d\.R$/.test(bone)) return 'RightToeBase';
  let b = bone;
  for (let i = 0; i < 40 && b; i++) {
    if (FOLD[b]) return FOLD[b];
    b = skel.bones[b]?.parent;
  }
  throw new Error(`bone ${bone} folds into nothing`);
};

// Merged weights per vertex, Map<boneIndex, weight>; the same for every body.
const merged = Array.from({ length: baseVerts.length }, () => new Map());
for (const [bone, list] of Object.entries(weights)) {
  const j = boneIndex[foldOf(bone)];
  for (const [vi, w] of list) merged[vi].set(j, (merged[vi].get(j) ?? 0) + w);
}

await MeshoptSimplifier.ready;
mkdirSync(OUT_DIR, { recursive: true });

// ---- One body ---------------------------------------------------------------------
/**
 * Build one body. `plan` is the decimation worked out on the human man: the
 * same vertex choices and index buffers are reused for every other body, so
 * all bodies share one topology at every LOD and a vertex index means the
 * same spot on every one of them (equipment anchors to those). The first
 * body built makes the plan and returns it.
 */
async function buildBody(id, targets, plan = null) {
  verts = baseVerts.map((v) => v.clone());
  for (const [name, w] of targets) {
    for (const [vi, dx, dy, dz] of await loadTarget(name)) {
      const v = verts[vi];
      if (v) {
        v.x += dx * w;
        v.y += dy * w;
        v.z += dz * w;
      }
    }
  }
  relaxHands(verts, skel, weights);
  const bonePos = {};
  for (const [name, , at] of BONES) if (at) bonePos[name] = at();

  // Any body vertex the painted weights missed follows its nearest body bone;
  // then keep the four strongest, normalised.
  const skinIndex = new Map();
  const skinWeight = new Map();
  for (const vi of body.ids) {
    const entries = [...merged[vi].entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    if (!entries.length) {
      let best = 0;
      let bestD = Infinity;
      for (const n of BODY_BONES) {
        const d = verts[vi].distanceTo(bonePos[n]);
        if (d < bestD) {
          bestD = d;
          best = boneIndex[n];
        }
      }
      entries.push([best, 1]);
    }
    const total = entries.reduce((s, e) => s + e[1], 0) || 1;
    while (entries.length < 4) entries.push([0, 0]);
    skinIndex.set(vi, entries.map((e) => e[0]));
    skinWeight.set(vi, entries.map((e) => e[1] / total));
  }

  // ---- Bake the canonical standing pose -------------------------------------------
  const transforms = new Map(); // bone name -> Matrix4 (rest -> canonical)
  const posed = {};
  for (const n of BODY_BONES) posed[n] = bonePos[n].clone();
  const aboutPoint = (pivot, q) =>
    new THREE.Matrix4()
      .makeTranslation(pivot.x, pivot.y, pivot.z)
      .multiply(new THREE.Matrix4().makeRotationFromQuaternion(q))
      .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
  for (const side of ['Left', 'Right']) {
    const sgn = side === 'Left' ? 1 : -1;
    // Arms: upper arm straight down with a little outward lean, forearm continuing with a slight forward bend.
    const S = bonePos[side + 'Arm'];
    const E = bonePos[side + 'ForeArm'];
    const W = bonePos[side + 'Hand'];
    const q1 = new THREE.Quaternion().setFromUnitVectors(E.clone().sub(S).normalize(), new THREE.Vector3(0.14 * sgn, -1, 0.02).normalize());
    const M1 = aboutPoint(S, q1);
    const E1 = E.clone().applyMatrix4(M1);
    const W1 = W.clone().applyMatrix4(M1);
    const q2 = new THREE.Quaternion().setFromUnitVectors(W1.clone().sub(E1).normalize(), new THREE.Vector3(0.03 * sgn, -1, 0.16).normalize());
    const M2 = aboutPoint(E1, q2).multiply(M1);
    transforms.set(side + 'Arm', M1);
    transforms.set(side + 'ForeArm', M2);
    transforms.set(side + 'Hand', M2);
    posed[side + 'ForeArm'] = E1;
    posed[side + 'Hand'] = W.clone().applyMatrix4(M2);
    // Legs: bring the splayed ankles in under the hips; the toes ride along.
    const H = bonePos[side + 'UpLeg'];
    const K = bonePos[side + 'Leg'];
    const A = bonePos[side + 'Foot'];
    const T = bonePos[side + 'ToeBase'];
    const q3 = new THREE.Quaternion().setFromUnitVectors(A.clone().sub(H).normalize(), new THREE.Vector3(0.45 * sgn, A.y - H.y, A.z - H.z).normalize());
    const M3 = aboutPoint(H, q3);
    for (const b of ['UpLeg', 'Leg', 'Foot', 'ToeBase']) transforms.set(side + b, M3);
    posed[side + 'Leg'] = K.clone().applyMatrix4(M3);
    posed[side + 'Foot'] = A.clone().applyMatrix4(M3);
    posed[side + 'ToeBase'] = T.clone().applyMatrix4(M3);
  }
  const baked = new Map(); // vertex index -> Vector3
  const tmp = new THREE.Vector3();
  for (const vi of body.ids) {
    const v = verts[vi];
    const out = new THREE.Vector3();
    const idx = skinIndex.get(vi);
    const wts = skinWeight.get(vi);
    for (let k = 0; k < 4; k++) {
      if (wts[k] <= 0) continue;
      const M = transforms.get(BONE_NAMES[idx[k]]);
      tmp.copy(v);
      if (M) tmp.applyMatrix4(M);
      out.addScaledVector(tmp, wts[k]);
    }
    baked.set(vi, out);
  }

  // Ground the model (soles at y = 0) and convert decimetres to metres.
  let minY = Infinity;
  for (const v of baked.values()) minY = Math.min(minY, v.y);
  const toWorld = (v) => new THREE.Vector3(v.x * 0.1, (v.y - minY) * 0.1, v.z * 0.1);
  for (const v of baked.values()) v.copy(toWorld(v));
  for (const n of BODY_BONES) posed[n] = toWorld(posed[n]);
  const eyeLw = toWorld(groupCentroid('joint-l-eye'));
  const eyeRw = toWorld(groupCentroid('joint-r-eye'));
  const headTop = toWorld(groupCentroid('joint-head-2'));

  // ---- Normals (smooth, on the shared vertices) ------------------------------------
  const normals = new Map();
  for (const vi of body.ids) normals.set(vi, new THREE.Vector3());
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  for (const [a, b, c] of tris) {
    const pa = baked.get(a[0]);
    const pb = baked.get(b[0]);
    const pc = baked.get(c[0]);
    ab.subVectors(pb, pa);
    ac.subVectors(pc, pa);
    const n = ab.cross(ac); // area-weighted
    normals.get(a[0]).add(n);
    normals.get(b[0]).add(n);
    normals.get(c[0]).add(n);
  }
  for (const n of normals.values()) n.normalize();

  // ---- Split along UV seams and pack ----------------------------------------------
  const keyIndex = new Map();
  const outPos = [];
  const outNor = [];
  const outUv = [];
  const outSi = [];
  const outSw = [];
  const outIdx = [];
  const emit = ([vi, vti]) => {
    const key = `${vi}/${vti}`;
    let i = keyIndex.get(key);
    if (i === undefined) {
      i = outPos.length / 3;
      keyIndex.set(key, i);
      const p = baked.get(vi);
      const n = normals.get(vi);
      const uv = vti >= 0 ? uvs[vti] : [0, 0];
      outPos.push(p.x, p.y, p.z);
      outNor.push(n.x, n.y, n.z);
      outUv.push(uv[0], uv[1]);
      outSi.push(...skinIndex.get(vi));
      outSw.push(...skinWeight.get(vi));
    }
    return i;
  };
  for (const [a, b, c] of tris) outIdx.push(emit(a), emit(b), emit(c));

  // ---- Landmarks and measurements -------------------------------------------------
  const ownerOf = (vi) => OWNER[BONE_NAMES[skinIndex.get(vi)[0]]];
  const bodyVerts = [...body.ids].map((vi) => ({ vi, p: baked.get(vi), dom: ownerOf(vi) }));
  /** The game joints' positions, for the measurements below and the extras. */
  const J = {};
  for (const [j, bone] of Object.entries(GAME_JOINTS)) J[j] = posed[bone];
  const pick = (what, filter, score) => {
    let best = null;
    let bestS = -Infinity;
    for (const bv of bodyVerts) {
      if (!filter(bv.p, bv)) continue;
      const s = score(bv.p);
      if (s > bestS) {
        bestS = s;
        best = bv.p;
      }
    }
    if (!best) throw new Error(`${id}: no vertex found for the ${what} landmark`);
    return best.clone();
  };
  const eyeY = eyeLw.y;
  const noseTip = pick('nose tip', (p) => p.y > eyeY - 0.09 && p.y < eyeY - 0.01 && Math.abs(p.x) < 0.03, (p) => p.z);
  const mouth = pick('mouth', (p) => p.y > noseTip.y - 0.08 && p.y < noseTip.y - 0.02 && Math.abs(p.x) < 0.015, (p) => p.z);
  let mouthHalf = 0;
  for (const { p } of bodyVerts) if (Math.abs(p.y - mouth.y) < 0.012 && p.z > mouth.z - 0.035) mouthHalf = Math.max(mouthHalf, Math.abs(p.x));
  const chin = pick('chin', (p) => p.y > mouth.y - 0.09 && p.y < mouth.y - 0.03 && Math.abs(p.x) < 0.02, (p) => p.z);
  const chinBottom = pick('chin bottom', (p) => Math.abs(p.x) < 0.03 && p.z > chin.z - 0.06 && p.y < mouth.y && p.y > mouth.y - 0.12, (p) => -p.y);
  const earL = pick('left ear', (p) => p.y > eyeY - 0.04 && p.y < eyeY + 0.05, (p) => p.x);
  const earR = pick('right ear', (p) => p.y > eyeY - 0.04 && p.y < eyeY + 0.05, (p) => -p.x);
  const browY = eyeY + 0.028;
  const brow = [0.012, 0.028, 0.044, 0.058].map((xi) => pick('brow', (p) => Math.abs(p.x - xi) < 0.008 && Math.abs(p.y - browY) < 0.012, (p) => p.z));
  let skullHalfWidth = 0;
  let skullFront = -Infinity;
  let skullBack = Infinity;
  for (const { p } of bodyVerts) {
    if (p.y > eyeY + 0.06 && p.y < eyeY + 0.1) {
      skullHalfWidth = Math.max(skullHalfWidth, Math.abs(p.x));
      skullFront = Math.max(skullFront, p.z);
      skullBack = Math.min(skullBack, p.z);
    }
  }
  const neckFront = pick('neck front', (p) => Math.abs(p.x) < 0.02 && p.y > J.neck.y - 0.02 && p.y < J.neck.y + 0.02, (p) => p.z);
  const chestFront = pick('chest front', (p) => Math.abs(p.x) < 0.03 && p.y > J.shoulderL.y - 0.14 && p.y < J.shoulderL.y - 0.1, (p) => p.z);
  const chestBack = pick('chest back', (p) => Math.abs(p.x) < 0.03 && p.y > J.shoulderL.y - 0.14 && p.y < J.shoulderL.y - 0.1, (p) => -p.z);

  // Limb radii: the 85th percentile distance of a joint's own vertices from its bone axis.
  const radiusOf = (j, child, lo = 0.15, hi = 0.85) => {
    const a = J[j];
    const b = J[child];
    const axis = b.clone().sub(a);
    const len = axis.length();
    axis.normalize();
    const ds = [];
    for (const { p, dom } of bodyVerts) {
      if (dom !== j) continue;
      const t = p.clone().sub(a).dot(axis) / len;
      if (t < lo || t > hi) continue;
      const proj = a.clone().addScaledVector(axis, t * len);
      ds.push(p.distanceTo(proj));
    }
    ds.sort((x, y) => x - y);
    return ds.length ? ds[Math.floor(ds.length * 0.85)] : 0;
  };
  const radii = {
    thigh: radiusOf('thighL', 'kneeL'),
    shin: radiusOf('kneeL', 'footL', 0.1, 0.6),
    upperArm: radiusOf('shoulderL', 'elbowL', 0.25, 0.85),
    deltoid: radiusOf('shoulderL', 'elbowL', 0.0, 0.2),
    forearm: radiusOf('elbowL', 'handL', 0.1, 0.6),
  };
  // Torso profile: widest half-width per height band, relative to the spine joint, plus front/back extent.
  const torsoProfile = [];
  let flattenSum = 0;
  let flattenN = 0;
  {
    const y0 = J.hips.y - 0.13;
    const y1 = J.neck.y - 0.02;
    const bands = 12;
    for (let b = 0; b < bands; b++) {
      const lo = y0 + ((y1 - y0) * b) / bands;
      const hi = y0 + ((y1 - y0) * (b + 1)) / bands;
      let r = 0;
      let zMax = -Infinity;
      let zMin = Infinity;
      for (const { p, dom } of bodyVerts) {
        if ((dom !== 'spine' && dom !== 'hips') || p.y < lo || p.y >= hi) continue;
        r = Math.max(r, Math.abs(p.x));
        zMax = Math.max(zMax, p.z);
        zMin = Math.min(zMin, p.z);
      }
      if (r > 0) {
        torsoProfile.push([+r.toFixed(4), +((lo + hi) / 2 - J.spine.y).toFixed(4)]);
        flattenSum += (zMax - zMin) / (2 * r);
        flattenN++;
      }
    }
  }
  let footFront = -Infinity;
  let footBack = Infinity;
  let footHalf = 0;
  let handReach = 0;
  for (const { p, dom } of bodyVerts) {
    if (dom === 'footL') {
      footFront = Math.max(footFront, p.z);
      footBack = Math.min(footBack, p.z);
      footHalf = Math.max(footHalf, Math.abs(p.x - J.footL.x));
    }
    if (dom === 'handL') handReach = Math.max(handReach, p.distanceTo(J.handL));
  }

  // The secondary chains hang from the finished head and chest.
  {
    const hr = skullHalfWidth;
    posed.Hair1 = new THREE.Vector3(0, headTop.y - hr * 0.2, skullBack + hr * 0.1);
    posed.Hair2 = posed.Hair1.clone().add(new THREE.Vector3(0, -0.12, -0.03));
    posed.Hair3 = posed.Hair2.clone().add(new THREE.Vector3(0, -0.14, -0.01));
    posed.Cape1 = new THREE.Vector3(0, posed.Spine2.y + 0.1, chestBack.z - 0.01);
    posed.Cape2 = posed.Cape1.clone().add(new THREE.Vector3(0, -0.3, -0.02));
    posed.Cape3 = posed.Cape2.clone().add(new THREE.Vector3(0, -0.3, -0.03));
  }

  // ---- LODs -----------------------------------------------------------------------
  const n = outPos.length / 3;
  const positions = new Float32Array(outPos);
  const normalsArr = new Float32Array(outNor);
  const uvArr = new Float32Array(outUv);
  const jointsArr = new Uint8Array(outSi);
  const weightsArr = new Float32Array(outSw);
  const indices = new Uint32Array(outIdx);
  /** Normals and UVs guide the simplifier so seams and shading survive. */
  const attrs = new Float32Array(n * 5);
  for (let i = 0; i < n; i++) {
    attrs[i * 5] = normalsArr[i * 3];
    attrs[i * 5 + 1] = normalsArr[i * 3 + 1];
    attrs[i * 5 + 2] = normalsArr[i * 3 + 2];
    attrs[i * 5 + 3] = uvArr[i * 2];
    attrs[i * 5 + 4] = uvArr[i * 2 + 1];
  }
  /** The vertices a region claims: those with at least half their weight on its bones. */
  const claim = (boneNames) => {
    const ids = new Set(boneNames.map((b) => boneIndex[b]));
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      let w = 0;
      for (let k = 0; k < 4; k++) if (ids.has(jointsArr[i * 4 + k])) w += weightsArr[i * 4 + k];
      out[i] = w >= 0.5 ? 1 : 0;
    }
    return out;
  };
  // Each region's triangles (all three vertices claimed) as an index buffer over the shared vertices; the body takes the rest.
  const REGION_BONES = { head: ['Head'], hands: ['LeftHand', 'RightHand'] };
  const REGIONS = [...Object.keys(REGION_BONES), 'body'];
  const regionLists = Object.fromEntries(REGIONS.map((r) => [r, []]));
  {
    const claimed = Object.fromEntries(Object.entries(REGION_BONES).map(([r, bones]) => [r, claim(bones)]));
    for (let t = 0; t < indices.length; t += 3) {
      const a = indices[t];
      const b = indices[t + 1];
      const c = indices[t + 2];
      const region = Object.keys(REGION_BONES).find((r) => claimed[r][a] && claimed[r][b] && claimed[r][c]) ?? 'body';
      regionLists[region].push(a, b, c);
    }
  }
  const regionIndices = Object.fromEntries(REGIONS.map((r) => [r, Uint32Array.from(regionLists[r])]));
  const regionTris = Object.fromEntries(REGIONS.map((r) => [r, regionIndices[r].length / 3]));
  const ATTRIBUTE_WEIGHTS = [0.3, 0.3, 0.3, 1.0, 1.0];
  /** Decimate one region to about `triangles`, its open borders (the neck ring, the wrists, the eye sockets) locked. */
  const simplify = (idx, triangles, maxError) =>
    MeshoptSimplifier.simplifyWithAttributes(idx, positions, 3, attrs, 5, ATTRIBUTE_WEIGHTS, null, triangles * 3, maxError, ['LockBorder', 'Sparse', 'Prune']);

  /**
   * Decimate each region separately to its own budget. The rings of vertices
   * two regions share are borders of both, so they are locked on both sides
   * and the parts still meet exactly when merged back together.
   */
  function planLod(budget) {
    const parts = REGIONS.map((r) => simplify(regionIndices[r], budget[r], r === 'body' ? 0.1 : 0.05));
    const idx = new Uint32Array(parts.reduce((sum, [out]) => sum + out.length, 0));
    const kept = {};
    let at = 0;
    REGIONS.forEach((r, i) => {
      idx.set(parts[i][0], at);
      at += parts[i][0].length;
      kept[r] = parts[i][0].length / 3;
    });
    const error = Math.max(...parts.map(([, e]) => e));
    const [remap, unique] = MeshoptSimplifier.compactMesh(idx); // renumbers idx in place
    return { indices: idx, remap, unique, kept, error };
  }
  /** This body's vertices gathered through a plan's choices. */
  function decimate({ indices: idx, remap, unique, kept, error }) {
    if (remap.length !== n) throw new Error(`${id}: ${n} vertices, but the ${PLAN_BODY} plan has ${remap.length}`);
    const gather = (src, stride, Ctor) => {
      const out = new Ctor(unique * stride);
      for (let i = 0; i < n; i++) {
        const to = remap[i];
        if (to === 0xffffffff || to >= unique) continue;
        for (let k = 0; k < stride; k++) out[to * stride + k] = src[i * stride + k];
      }
      return out;
    };
    return {
      positions: gather(positions, 3, Float32Array),
      normals: gather(normalsArr, 3, Float32Array),
      uvs: gather(uvArr, 2, Float32Array),
      joints: gather(jointsArr, 4, Uint8Array),
      weights: gather(weightsArr, 4, Float32Array),
      indices: idx,
      kept,
      error,
    };
  }
  plan ??= LOD_TARGETS.map(planLod);
  const lods = plan.map(decimate);

  // ---- Write the GLB --------------------------------------------------------------
  const v3 = (v) => [+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4)];
  const meta = {
    source: 'MakeHuman base mesh, targets, default skeleton and weights (CC0 1.0): https://github.com/makehumancommunity/makehuman',
    units: "metres, y up, +z forward, +x = the character's left",
    body: id,
    targets: targets.map(([t, w]) => `${t} ${w.toFixed(3)}`),
    height: +headTop.y.toFixed(4),
    bones: BONE_NAMES,
    boneParents: BONE_NAMES.map((b) => BONE_PARENT[b]),
    bonePositions: Object.fromEntries(BONE_NAMES.map((b) => [b, v3(posed[b])])),
    gameJoints: GAME_JOINTS,
    boneOwner: BONE_NAMES.map((b) => OWNER[b]),
    landmarks: {
      headTop: v3(headTop),
      eyeL: v3(eyeLw),
      eyeR: v3(eyeRw),
      noseTip: v3(noseTip),
      mouth: v3(mouth),
      mouthHalfWidth: +mouthHalf.toFixed(4),
      chin: v3(chin),
      chinBottom: v3(chinBottom),
      earL: v3(earL),
      earR: v3(earR),
      brow: brow.map(v3),
      skullHalfWidth: +skullHalfWidth.toFixed(4),
      skullFront: +skullFront.toFixed(4),
      skullBack: +skullBack.toFixed(4),
      neckFront: v3(neckFront),
      chestFront: v3(chestFront),
      chestBack: v3(chestBack),
      footFront: +footFront.toFixed(4),
      footBack: +footBack.toFixed(4),
      footHalfWidth: +footHalf.toFixed(4),
      handReach: +handReach.toFixed(4),
    },
    radii: Object.fromEntries(Object.entries(radii).map(([k, v]) => [k, +v.toFixed(4)])),
    torsoProfile,
    torsoFlatten: +(flattenSum / Math.max(1, flattenN)).toFixed(4),
    lods: lods.map((l) => ({ triangles: l.indices.length / 3, ...l.kept, error: +l.error.toFixed(4) })),
    /** Every body shares this body's vertex order and index buffers at each LOD. */
    topology: PLAN_BODY,
  };

  const g = new GltfBuilder('aeloria scripts/build-characters.mjs');
  g.json.asset.extras = meta;
  // Joint nodes: translations relative to the parent, in the canonical pose.
  const nodeOf = {};
  for (const name of BONE_NAMES) {
    const parent = BONE_PARENT[name];
    const t = parent ? posed[name].clone().sub(posed[parent]) : posed[name].clone();
    nodeOf[name] = g.node({ name, translation: [t.x, t.y, t.z], parent: parent ? nodeOf[parent] : undefined });
  }
  const ibm = new Float32Array(BONE_NAMES.length * 16);
  for (let i = 0; i < BONE_NAMES.length; i++) {
    const p = posed[BONE_NAMES[i]];
    new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z).toArray(ibm, i * 16);
  }
  const skin = g.skin('Humanoid', BONE_NAMES.map((b) => nodeOf[b]), ibm, nodeOf.Hips);
  const material = g.material('Skin', { color: [0.85, 0.66, 0.52, 1], roughness: 0.7 });
  lods.forEach((lod, i) => {
    const name = i === 0 ? 'Body' : `Body_LOD${i}`;
    const mesh = g.mesh(
      name,
      { POSITION: lod.positions, NORMAL: lod.normals, TEXCOORD_0: lod.uvs, JOINTS_0: lod.joints, WEIGHTS_0: lod.weights },
      lod.indices.length / 3 < 20000 && lod.positions.length / 3 < 65536 ? Uint16Array.from(lod.indices) : lod.indices,
      { material, extras: { lod: i } },
    );
    const node = g.node({ name });
    g.json.nodes[node].mesh = mesh;
    g.json.nodes[node].skin = skin;
  });
  const glb = g.toGlb();
  writeFileSync(path.join(OUT_DIR, `${id}.glb`), glb);
  const split = (k) => `head ${k.head}, hands ${k.hands}, body ${k.body}`;
  console.log(`${id}.glb: ${(glb.length / 1024).toFixed(0)} KB, ${meta.height.toFixed(2)} m, ${n} vertices / ${indices.length / 3} triangles (${split(regionTris)})`);
  for (const [i, l] of lods.entries()) console.log(`  LOD${i}: ${l.positions.length / 3} vertices, ${l.indices.length / 3} triangles (${split(l.kept)}), error ${l.error.toFixed(4)}`);
  console.log(`  shoulders ${(2 * J.shoulderL.x).toFixed(3)} m, hips ${(2 * J.thighL.x).toFixed(3)} m, legs ${J.thighL.y.toFixed(3)} m, ears at x ${earL.x.toFixed(3)} / ${earR.x.toFixed(3)}, skull half-width ${skullHalfWidth.toFixed(3)}`);
  return plan;
}

const wanted = process.argv.slice(2);
for (const id of wanted) if (!BODIES[id]) throw new Error(`unknown body ${id}; have ${Object.keys(BODIES).join(', ')}`);
// The human man always goes first: his decimation is the topology of every body.
const plan = await buildBody(PLAN_BODY, BODIES[PLAN_BODY]);
for (const id of wanted.length ? wanted : Object.keys(BODIES)) {
  if (id !== PLAN_BODY) await buildBody(id, BODIES[id], plan);
}
writeFileSync(
  path.join(OUT_DIR, 'ATTRIBUTION.md'),
  '# Character models\n\nThe `*.glb` files here are generated by `scripts/build-characters.mjs` from the MakeHuman base mesh, morph targets, default skeleton and skin weights, released under CC0 1.0 by the MakeHuman community: https://github.com/makehumancommunity/makehuman\n',
);
