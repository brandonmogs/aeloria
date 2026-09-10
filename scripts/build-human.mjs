// Builds public/models/human.{json,bin}: Aeloria's human body template, derived
// from MakeHuman's CC0 base mesh, default skeleton and hand-painted skin
// weights (https://github.com/makehumancommunity/makehuman).
//
// What it does:
//   1. Keeps only the `body` group of base.obj (no helpers, joint cubes, teeth).
//   2. Folds MakeHuman's 139 weighted bones into the game's 16 joints by walking
//      each bone up to the nearest ancestor the game animates.
//   3. Bakes a canonical standing pose (arms hanging, legs under the hips) with
//      linear blend skinning, so the game's clips start from the same rest pose
//      the old procedural rigs used.
//   4. Computes smooth normals, splits vertices along UV seams, and measures the
//      landmarks (eyes, nose, mouth, chin, ears, brows, skull) and limb radii the
//      renderer needs to place eyes, paint faces and size armour.
//
// Usage: node scripts/build-human.mjs   (needs network access the first time)
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as THREE from 'three';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(here, '..', 'public', 'models');
const CACHE = path.join(here, '.cache', 'makehuman');
const RAW = 'https://raw.githubusercontent.com/makehumancommunity/makehuman/master/';
const FILES = {
  obj: 'makehuman/data/3dobjs/base.obj',
  skel: 'makehuman/data/rigs/default.mhskel',
  weights: 'makehuman/data/rigs/default_weights.mhw',
};

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
const centroid = (name) => {
  const g = groups.get(name);
  if (!g) throw new Error(`missing joint group ${name}`);
  const c = new THREE.Vector3();
  for (const i of g.ids) c.add(verts[i]);
  return c.divideScalar(g.ids.size);
};

// ---- The game's skeleton ----------------------------------------------------------
const JOINTS = ['hips', 'spine', 'neck', 'head', 'thighL', 'kneeL', 'footL', 'thighR', 'kneeR', 'footR', 'shoulderL', 'elbowL', 'handL', 'shoulderR', 'elbowR', 'handR'];
const PARENT = {
  hips: null, spine: 'hips', neck: 'spine', head: 'neck',
  thighL: 'hips', kneeL: 'thighL', footL: 'kneeL', thighR: 'hips', kneeR: 'thighR', footR: 'kneeR',
  shoulderL: 'spine', elbowL: 'shoulderL', handL: 'elbowL', shoulderR: 'spine', elbowR: 'shoulderR', handR: 'elbowR',
};
const HELPER = {
  hips: 'joint-pelvis', spine: 'joint-spine-4', neck: 'joint-neck', head: 'joint-head',
  thighL: 'joint-l-upper-leg', kneeL: 'joint-l-knee', footL: 'joint-l-ankle',
  thighR: 'joint-r-upper-leg', kneeR: 'joint-r-knee', footR: 'joint-r-ankle',
  shoulderL: 'joint-l-shoulder', elbowL: 'joint-l-elbow', handL: 'joint-l-hand',
  shoulderR: 'joint-r-shoulder', elbowR: 'joint-r-elbow', handR: 'joint-r-hand',
};
const joint = {};
for (const j of JOINTS) joint[j] = centroid(HELPER[j]);
const eyeL = centroid('joint-l-eye');
const eyeR = centroid('joint-r-eye');
const headTopHelper = centroid('joint-head-2');

// MakeHuman bone -> game joint. Anything below these in the hierarchy folds into them.
const BONE_TO_JOINT = {
  root: 'hips', 'pelvis.L': 'hips', 'pelvis.R': 'hips', spine05: 'hips',
  spine04: 'spine', spine03: 'spine', spine02: 'spine', spine01: 'spine',
  'clavicle.L': 'spine', 'clavicle.R': 'spine', 'shoulder01.L': 'spine', 'shoulder01.R': 'spine',
  neck01: 'neck', neck02: 'neck', neck03: 'neck', head: 'head',
  'upperarm01.L': 'shoulderL', 'upperarm02.L': 'shoulderL', 'lowerarm01.L': 'elbowL', 'lowerarm02.L': 'elbowL', 'wrist.L': 'handL',
  'upperarm01.R': 'shoulderR', 'upperarm02.R': 'shoulderR', 'lowerarm01.R': 'elbowR', 'lowerarm02.R': 'elbowR', 'wrist.R': 'handR',
  'upperleg01.L': 'thighL', 'upperleg02.L': 'thighL', 'lowerleg01.L': 'kneeL', 'lowerleg02.L': 'kneeL', 'foot.L': 'footL',
  'upperleg01.R': 'thighR', 'upperleg02.R': 'thighR', 'lowerleg01.R': 'kneeR', 'lowerleg02.R': 'kneeR', 'foot.R': 'footR',
};
const skel = JSON.parse(skelText);
const jointOf = (bone) => {
  let b = bone;
  for (let i = 0; i < 40 && b; i++) {
    if (BONE_TO_JOINT[b]) return BONE_TO_JOINT[b];
    b = skel.bones[b]?.parent;
  }
  throw new Error(`bone ${bone} folds into nothing`);
};

// Merged weights per vertex: Map<jointIndex, weight>.
const weights = JSON.parse(weightsText).weights;
const merged = Array.from({ length: verts.length }, () => new Map());
for (const [bone, list] of Object.entries(weights)) {
  const j = JOINTS.indexOf(jointOf(bone));
  for (const [vi, w] of list) merged[vi].set(j, (merged[vi].get(j) ?? 0) + w);
}
// Any body vertex the painted weights missed follows its nearest joint.
for (const vi of body.ids) {
  if (merged[vi].size > 0) continue;
  let best = 0;
  let bestD = Infinity;
  JOINTS.forEach((j, idx) => {
    const d = verts[vi].distanceTo(joint[j]);
    if (d < bestD) { bestD = d; best = idx; }
  });
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
const transforms = new Map(); // joint name -> Matrix4 (rest -> canonical)
const posed = {};
for (const j of JOINTS) posed[j] = joint[j].clone();
const aboutPoint = (pivot, q) =>
  new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z).multiply(new THREE.Matrix4().makeRotationFromQuaternion(q)).multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
for (const side of ['L', 'R']) {
  const sgn = side === 'L' ? 1 : -1;
  // Arms: upper arm straight down with a little outward lean, forearm continuing with a slight forward bend.
  const S = joint['shoulder' + side];
  const E = joint['elbow' + side];
  const W = joint['hand' + side];
  const q1 = new THREE.Quaternion().setFromUnitVectors(E.clone().sub(S).normalize(), new THREE.Vector3(0.14 * sgn, -1, 0.02).normalize());
  const M1 = aboutPoint(S, q1);
  const E1 = E.clone().applyMatrix4(M1);
  const W1 = W.clone().applyMatrix4(M1);
  const q2 = new THREE.Quaternion().setFromUnitVectors(W1.clone().sub(E1).normalize(), new THREE.Vector3(0.03 * sgn, -1, 0.16).normalize());
  const M2 = aboutPoint(E1, q2).multiply(M1);
  transforms.set('shoulder' + side, M1);
  transforms.set('elbow' + side, M2);
  transforms.set('hand' + side, M2);
  posed['elbow' + side] = E1;
  posed['hand' + side] = W.clone().applyMatrix4(M2);
  // Legs: bring the splayed ankles in under the hips.
  const H = joint['thigh' + side];
  const K = joint['knee' + side];
  const A = joint['foot' + side];
  const q3 = new THREE.Quaternion().setFromUnitVectors(A.clone().sub(H).normalize(), new THREE.Vector3(0.45 * sgn, A.y - H.y, A.z - H.z).normalize());
  const M3 = aboutPoint(H, q3);
  transforms.set('thigh' + side, M3);
  transforms.set('knee' + side, M3);
  transforms.set('foot' + side, M3);
  posed['knee' + side] = K.clone().applyMatrix4(M3);
  posed['foot' + side] = A.clone().applyMatrix4(M3);
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
    const M = transforms.get(JOINTS[idx[k]]);
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
for (const j of JOINTS) posed[j] = toWorld(posed[j]);
const eyeLw = toWorld(eyeL);
const eyeRw = toWorld(eyeR);
const headTop = toWorld(headTopHelper);

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
const bodyVerts = [...body.ids].map((vi) => ({ vi, p: baked.get(vi), dom: JOINTS[skinIndex.get(vi)[0]] }));
const pick = (filter, score) => {
  let best = null;
  let bestS = -Infinity;
  for (const bv of bodyVerts) {
    if (!filter(bv.p, bv)) continue;
    const s = score(bv.p);
    if (s > bestS) { bestS = s; best = bv.p; }
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
const neckFront = pick((p) => Math.abs(p.x) < 0.02 && p.y > posed.neck.y - 0.02 && p.y < posed.neck.y + 0.02, (p) => p.z);
const chestFront = pick((p) => Math.abs(p.x) < 0.03 && p.y > posed.shoulderL.y - 0.14 && p.y < posed.shoulderL.y - 0.1, (p) => p.z);
const chestBack = pick((p) => Math.abs(p.x) < 0.03 && p.y > posed.shoulderL.y - 0.14 && p.y < posed.shoulderL.y - 0.1, (p) => -p.z);

// Limb radii: the 85th percentile distance of a joint's own vertices from its bone axis.
const radiusOf = (j, child, lo = 0.15, hi = 0.85) => {
  const a = posed[j];
  const b = posed[child];
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
  const y0 = posed.hips.y - 0.13;
  const y1 = posed.neck.y - 0.02;
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
      torsoProfile.push([+r.toFixed(4), +((lo + hi) / 2 - posed.spine.y).toFixed(4)]);
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
    footHalf = Math.max(footHalf, Math.abs(p.x - posed.footL.x));
  }
  if (dom === 'handL') handReach = Math.max(handReach, p.distanceTo(posed.handL));
}

// ---- Write ------------------------------------------------------------------------
mkdirSync(OUT_DIR, { recursive: true });
const n = outPos.length / 3;
const m = outIdx.length;
const parts = [
  ['position', new Float32Array(outPos)],
  ['normal', new Float32Array(outNor)],
  ['uv', new Float32Array(outUv)],
  ['skinIndex', new Uint16Array(outSi)],
  ['skinWeight', new Float32Array(outSw)],
  ['index', new Uint32Array(outIdx)],
];
const layout = {};
let offset = 0;
const chunks = [];
for (const [name, arr] of parts) {
  const pad = (4 - (offset % 4)) % 4;
  if (pad) { chunks.push(new Uint8Array(pad)); offset += pad; }
  layout[name] = { offset, length: arr.length, type: arr.constructor.name };
  chunks.push(new Uint8Array(arr.buffer));
  offset += arr.byteLength;
}
const bin = Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
const v3 = (v) => [+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4)];
const json = {
  source: 'MakeHuman base mesh, default skeleton and weights (CC0 1.0) — https://github.com/makehumancommunity/makehuman',
  units: 'metres, y up, +z forward, +x = the character\'s left',
  height: +headTop.y.toFixed(4),
  vertices: n,
  triangles: m / 3,
  joints: JOINTS,
  parents: PARENT,
  jointPositions: Object.fromEntries(JOINTS.map((j) => [j, v3(posed[j])])),
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
  layout,
  byteLength: bin.byteLength,
};
writeFileSync(path.join(OUT_DIR, 'human.json'), JSON.stringify(json, null, 1));
writeFileSync(path.join(OUT_DIR, 'human.bin'), bin);
writeFileSync(
  path.join(OUT_DIR, 'ATTRIBUTION.md'),
  '# Models\n\n`human.json` / `human.bin` are generated by `scripts/build-human.mjs` from the MakeHuman base mesh, default skeleton and skin weights, released under CC0 1.0 by the MakeHuman community: https://github.com/makehumancommunity/makehuman\n',
);
console.log(`human template: ${n} vertices, ${m / 3} triangles, ${(bin.byteLength / 1024).toFixed(0)} KB, height ${json.height} m`);
console.log('joints:', JSON.stringify(json.jointPositions));
console.log('landmarks:', JSON.stringify(json.landmarks));
console.log('radii:', JSON.stringify(json.radii), 'torsoFlatten', json.torsoFlatten);
console.log('torsoProfile:', JSON.stringify(torsoProfile));
