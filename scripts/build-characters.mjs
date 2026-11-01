// Builds public/models/characters/*.glb: the character bodies on the shared
// humanoid skeleton, derived from MakeHuman's CC0 base mesh, default skeleton
// and painted skin weights (https://github.com/makehumancommunity/makehuman).
// This script is the source of truth for the character assets; there is no
// Blender step (see docs/characters.md).
//
// What it does:
//   1. Keeps only the `body` group of base.obj (no helpers, joint cubes, teeth).
//   2. Folds MakeHuman's weighted bones into the shared skeleton's 22 body
//      bones, which carry the standard humanoid names (Hips, Spine, Spine1,
//      Spine2, Neck, Head, Left/RightShoulder, Arm, ForeArm, Hand, UpLeg, Leg,
//      Foot, ToeBase), plus a short hair chain and a cape chain for sway.
//   3. Bakes a canonical standing pose (arms hanging, legs under the hips).
//   4. Computes smooth normals, splits vertices along UV seams, measures the
//      landmarks and limb radii the renderer needs, and decimates the body
//      into three LODs with meshoptimizer, the head and the body each to
//      their own triangle budget.
//   5. Writes a GLB per race (just the human for now) with the skeleton, the
//      skinned LOD meshes, and the measurements as glTF extras.
//
// Usage: node scripts/build-characters.mjs   (needs network access the first time)
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as THREE from 'three';
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

async function fetchCached(rel) {
  mkdirSync(CACHE, { recursive: true });
  const local = path.join(CACHE, path.basename(rel));
  if (existsSync(local)) return readFileSync(local, 'utf8');
  const res = await fetch(RAW + rel);
  if (!res.ok) throw new Error(`${rel}: ${res.status}`);
  const text = await res.text();
  writeFileSync(local, text);
  return text;
}

const [objText, skelText, weightsText] = await Promise.all([fetchCached(FILES.obj), fetchCached(FILES.skel), fetchCached(FILES.weights)]);

// ---- Parse the OBJ ----------------------------------------------------------------
const verts = []; // Vector3, in decimetres, MakeHuman space (y up, +z forward, +x = character's left)
const uvs = [];
const groups = new Map(); // name -> { faces: [[v, vt], ...][], ids: Set<vertexIndex> }
let current = 'default';
for (const line of objText.split('\n')) {
  const p = line.trim().split(/\s+/);
  if (p[0] === 'v') verts.push(new THREE.Vector3(+p[1], +p[2], +p[3]));
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
const skel = JSON.parse(skelText);
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
const bonePos = {};
for (const [name, , at] of BONES) if (at) bonePos[name] = at();

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

// Merged weights per vertex: Map<boneIndex, weight>.
const weights = JSON.parse(weightsText).weights;
const merged = Array.from({ length: verts.length }, () => new Map());
for (const [bone, list] of Object.entries(weights)) {
  const j = boneIndex[foldOf(bone)];
  for (const [vi, w] of list) merged[vi].set(j, (merged[vi].get(j) ?? 0) + w);
}
// Any body vertex the painted weights missed follows its nearest body bone.
const BODY_BONES = BONE_NAMES.filter((n) => bonePos[n]);
for (const vi of body.ids) {
  if (merged[vi].size > 0) continue;
  let best = 0;
  let bestD = Infinity;
  for (const n of BODY_BONES) {
    const d = verts[vi].distanceTo(bonePos[n]);
    if (d < bestD) {
      bestD = d;
      best = boneIndex[n];
    }
  }
  merged[vi].set(best, 1);
}
// Keep the four strongest, normalised.
const skinIndex = new Map();
const skinWeight = new Map();
for (const vi of body.ids) {
  const entries = [...merged[vi].entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const total = entries.reduce((s, e) => s + e[1], 0) || 1;
  while (entries.length < 4) entries.push([0, 0]);
  skinIndex.set(vi, entries.map((e) => e[0]));
  skinWeight.set(vi, entries.map((e) => e[1] / total));
}

// ---- Bake the canonical standing pose ---------------------------------------------
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

// ---- Normals (smooth, on the shared vertices) --------------------------------------
const normals = new Map();
for (const vi of body.ids) normals.set(vi, new THREE.Vector3());
const ab = new THREE.Vector3();
const ac = new THREE.Vector3();
const tris = [];
for (const face of body.faces) {
  for (let i = 1; i + 1 < face.length; i++) tris.push([face[0], face[i], face[i + 1]]);
}
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

// ---- Split along UV seams and pack ------------------------------------------------
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

// ---- Landmarks and measurements ---------------------------------------------------
const ownerOf = (vi) => OWNER[BONE_NAMES[skinIndex.get(vi)[0]]];
const bodyVerts = [...body.ids].map((vi) => ({ vi, p: baked.get(vi), dom: ownerOf(vi) }));
/** The game joints' positions, for the measurements below and the extras. */
const J = {};
for (const [j, bone] of Object.entries(GAME_JOINTS)) J[j] = posed[bone];
const pick = (filter, score) => {
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
  return best ? best.clone() : null;
};
const eyeY = eyeLw.y;
const noseTip = pick((p) => p.y > eyeY - 0.09 && p.y < eyeY - 0.01 && Math.abs(p.x) < 0.03, (p) => p.z);
const mouth = pick((p) => p.y > noseTip.y - 0.08 && p.y < noseTip.y - 0.025 && Math.abs(p.x) < 0.015, (p) => p.z);
let mouthHalf = 0;
for (const { p } of bodyVerts) if (Math.abs(p.y - mouth.y) < 0.012 && p.z > mouth.z - 0.035) mouthHalf = Math.max(mouthHalf, Math.abs(p.x));
const chin = pick((p) => p.y > mouth.y - 0.09 && p.y < mouth.y - 0.035 && Math.abs(p.x) < 0.02, (p) => p.z);
const chinBottom = pick((p) => Math.abs(p.x) < 0.03 && p.z > chin.z - 0.06 && p.y < mouth.y && p.y > mouth.y - 0.12, (p) => -p.y);
const earL = pick((p) => p.y > eyeY - 0.04 && p.y < eyeY + 0.05, (p) => p.x);
const earR = pick((p) => p.y > eyeY - 0.04 && p.y < eyeY + 0.05, (p) => -p.x);
const browY = eyeY + 0.028;
const brow = [0.012, 0.028, 0.044, 0.058].map((xi) => pick((p) => Math.abs(p.x - xi) < 0.006 && Math.abs(p.y - browY) < 0.01, (p) => p.z));
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
const neckFront = pick((p) => Math.abs(p.x) < 0.02 && p.y > J.neck.y - 0.02 && p.y < J.neck.y + 0.02, (p) => p.z);
const chestFront = pick((p) => Math.abs(p.x) < 0.03 && p.y > J.shoulderL.y - 0.14 && p.y < J.shoulderL.y - 0.1, (p) => p.z);
const chestBack = pick((p) => Math.abs(p.x) < 0.03 && p.y > J.shoulderL.y - 0.14 && p.y < J.shoulderL.y - 0.1, (p) => -p.z);

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

// ---- LODs -------------------------------------------------------------------------
await MeshoptSimplifier.ready;
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
function decimate(budget) {
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
const lods = LOD_TARGETS.map(decimate);

// ---- Write the GLB ----------------------------------------------------------------
mkdirSync(OUT_DIR, { recursive: true });
const v3 = (v) => [+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4)];
const meta = {
  source: 'MakeHuman base mesh, default skeleton and weights (CC0 1.0): https://github.com/makehumancommunity/makehuman',
  units: "metres, y up, +z forward, +x = the character's left",
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
writeFileSync(path.join(OUT_DIR, 'human.glb'), glb);
writeFileSync(
  path.join(OUT_DIR, 'ATTRIBUTION.md'),
  '# Character models\n\nThe `*.glb` files here are generated by `scripts/build-characters.mjs` from the MakeHuman base mesh, default skeleton and skin weights, released under CC0 1.0 by the MakeHuman community: https://github.com/makehumancommunity/makehuman\n',
);
const split = (k) => `head ${k.head}, hands ${k.hands}, body ${k.body}`;
console.log(`human.glb: ${(glb.length / 1024).toFixed(0)} KB, ${BONE_NAMES.length} bones, source ${n} vertices / ${indices.length / 3} triangles (${split(regionTris)})`);
for (const [i, l] of lods.entries()) console.log(`  LOD${i}: ${l.positions.length / 3} vertices, ${l.indices.length / 3} triangles (${split(l.kept)}), error ${l.error.toFixed(4)}`);
console.log('joints:', JSON.stringify(Object.fromEntries(Object.entries(GAME_JOINTS).map(([j, b]) => [j, v3(posed[b])]))));
