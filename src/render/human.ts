import * as THREE from 'three';
import { JOINTS, JointName, Rig, RigDims, Sockets, Stance } from './characters';
import { eyeMaterial, FaceStyle, lookMaterial, LookSpec } from './humanSkin';
import { buildBaseBoots } from './gear';
import { HairStyle, SCALP_COLS, SCALP_ROWS, ScalpShape, buildHair } from './hair';
import { FaceField, buildBrows, buildLashes } from './faceFeatures';
import { Glb, parseGlb, readFloat, readUint16, readUint32 } from './glb';
import { MorphValues, addMeasures, applyMorphs, cloneMeasures, hasMorphs, loadMorphs, morphSet } from './morphs';

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

/** One body mesh of the template at a level of detail. */
export interface TemplateMesh {
  vertexCount: number;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /** Four bone indices per vertex, into the template's `bones`. */
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
  indices: Uint32Array;
  /** Attributes every character shares (normals, uvs, skinning, index): uploaded once. */
  shared: {
    normal: THREE.BufferAttribute;
    uv: THREE.BufferAttribute;
    skinIndex: THREE.BufferAttribute;
    skinWeight: THREE.BufferAttribute;
    index: THREE.BufferAttribute;
  };
}

export type TemplateSource = 'legacy' | 'glb';

export type Race = 'human' | 'elf' | 'darkelf' | 'orc' | 'dwarf';
export type Sex = 'male' | 'female';
/** A body the pipeline writes (`public/models/characters/<id>.glb`), or the legacy json/bin pair. */
export type BodyId = 'legacy' | 'human_m' | 'human_f' | 'elf_m' | 'elf_f' | 'orc_m' | 'orc_f' | 'dwarf_m' | 'dwarf_f';
export const BODY_IDS: readonly BodyId[] = ['human_m', 'human_f', 'elf_m', 'elf_f', 'orc_m', 'orc_f', 'dwarf_m', 'dwarf_f'];
/** The body a race and sex are built on; dark elves share the elf body and differ in materials. */
export function bodyFor(race: Race, sex: Sex): BodyId {
  const base = race === 'darkelf' ? 'elf' : race;
  return `${base}_${sex === 'female' ? 'f' : 'm'}` as BodyId;
}

/**
 * The body everyone is built from: the finest mesh (also `lods[0]`), the
 * skeleton it is skinned to, and the measurements taken from it. The legacy
 * json/bin template has the game's sixteen joints as its bones; the GLB from
 * scripts/build-characters.mjs has the shared humanoid skeleton (standard
 * bone names, spine links, clavicles, toes, hair and cape chains), where each
 * game joint drives one bone and every other bone follows an owner joint.
 */
export interface HumanTemplate extends TemplateMesh {
  source: TemplateSource;
  id: BodyId;
  /** The sex of a pipeline body (its morph set); the legacy template has none. */
  sex?: Sex;
  /** Standing height in metres. */
  height: number;
  /** The measurements as the build wrote them, the shape a morph's deltas are added to. */
  raw: Measurements;
  /** Bone names in skin order. */
  bones: string[];
  boneParent: Array<number | null>;
  /** Rest positions of the bones in template space. */
  bonePositions: THREE.Vector3[];
  /** The game joint that owns each bone's flesh, for the reshape and the painters. */
  owner: JointName[];
  /** The bone each game joint drives. */
  jointBone: Record<JointName, number>;
  joints: Record<JointName, THREE.Vector3>;
  landmarks: HumanLandmarks;
  radii: { thigh: number; shin: number; upperArm: number; deltoid: number; forearm: number };
  torsoProfile: Array<readonly [number, number]>;
  torsoFlatten: number;
  /** The body at every level of detail, finest first. */
  lods: TemplateMesh[];
}

const bodies = new Map<BodyId, HumanTemplate>();
const loading = new Map<BodyId, Promise<HumanTemplate>>();
let defaultBody: BodyId | null = null;

const v3 = (a: number[]): THREE.Vector3 => new THREE.Vector3(a[0], a[1], a[2]);

/** Fetch one body once; later calls share the same template. */
export function loadBody(id: BodyId, base = '/models/'): Promise<HumanTemplate> {
  let p = loading.get(id);
  if (!p) {
    p = (id === 'legacy' ? loadLegacyTemplate(base) : loadGlbTemplate(`${base}characters/${id}.glb`)).then((t) => {
      t.id = id;
      if (id !== 'legacy') t.sex = id.endsWith('_f') ? 'female' : 'male';
      bodies.set(id, t);
      return t;
    });
    loading.set(id, p);
  }
  return p;
}

/** A loaded body; `loadBody` it first. */
export function body(id: BodyId): HumanTemplate {
  const t = bodies.get(id);
  if (!t) throw new Error(`body ${id} not loaded: await loadBody('${id}') first`);
  return t;
}

/**
 * Fetch the bodies before the world is built: every body the character
 * pipeline writes (the game's default), with the human man as the default for
 * a spec that names no body, or the legacy json/bin pair (`?chars=legacy`).
 */
export async function loadHumanTemplate(source: TemplateSource = 'legacy', base = '/models/'): Promise<HumanTemplate> {
  if (source === 'legacy') {
    defaultBody = 'legacy';
    return loadBody('legacy', base);
  }
  defaultBody = 'human_m';
  const [all] = await Promise.all([Promise.all(BODY_IDS.map((id) => loadBody(id, base))), loadMorphs('male', base), loadMorphs('female', base)]);
  return all[0];
}

function templateMesh(positions: Float32Array, normals: Float32Array, uvs: Float32Array, skinIndex: Uint16Array, skinWeight: Float32Array, indices: Uint32Array): TemplateMesh {
  return {
    vertexCount: positions.length / 3,
    positions,
    normals,
    uvs,
    skinIndex,
    skinWeight,
    indices,
    shared: {
      normal: new THREE.BufferAttribute(normals, 3),
      uv: new THREE.BufferAttribute(uvs, 2),
      skinIndex: new THREE.BufferAttribute(skinIndex, 4),
      skinWeight: new THREE.BufferAttribute(skinWeight, 4),
      index: new THREE.BufferAttribute(indices, 1),
    },
  };
}

/** The landmarks as the build scripts write them: [x, y, z] arrays and numbers. */
interface RawLandmarks {
  headTop: number[];
  eyeL: number[];
  eyeR: number[];
  noseTip: number[];
  mouth: number[];
  mouthHalfWidth: number;
  chin: number[];
  chinBottom: number[];
  earL: number[];
  earR: number[];
  brow: number[][];
  skullHalfWidth: number;
  skullFront: number;
  skullBack: number;
  neckFront: number[];
  chestFront: number[];
  chestBack: number[];
  footFront: number;
  footBack: number;
  footHalfWidth: number;
  handReach: number;
}

interface Measurements {
  height: number;
  /** By bone name; the legacy template keys these by joint. */
  bonePositions: Record<string, number[]>;
  landmarks: RawLandmarks;
  radii: HumanTemplate['radii'];
  torsoProfile: Array<[number, number]>;
  torsoFlatten: number;
}

/** The measurements a body is built with, converted from the raw numbers. */
interface Derived {
  height: number;
  bonePositions: THREE.Vector3[];
  joints: Record<JointName, THREE.Vector3>;
  landmarks: HumanLandmarks;
  radii: HumanTemplate['radii'];
  torsoProfile: Array<readonly [number, number]>;
  torsoFlatten: number;
}

/** Convert raw measurements (the GLB's, or those with a morph's deltas added) for a template's bones. */
function derive(raw: Measurements, bones: string[], jointBone: Record<JointName, number>): Derived {
  const bonePositions = bones.map((b) => v3(raw.bonePositions[b]));
  const joints = Object.fromEntries(JOINTS.map((j) => [j, bonePositions[jointBone[j]].clone()])) as Record<JointName, THREE.Vector3>;
  return {
    height: raw.height,
    bonePositions,
    joints,
    landmarks: landmarksFrom(raw.landmarks),
    radii: { ...raw.radii },
    torsoProfile: raw.torsoProfile.map(([r, y]) => [r, y] as const),
    torsoFlatten: raw.torsoFlatten,
  };
}

const landmarksFrom = (lm: RawLandmarks): HumanLandmarks => ({
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
  brow: lm.brow.map(v3),
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
});

/** The json/bin pair from scripts/build-human.mjs: the sixteen game joints are the bones. */
async function loadLegacyTemplate(base: string): Promise<HumanTemplate> {
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
  const mesh = templateMesh(
    view('position', 'Float32Array'),
    view('normal', 'Float32Array'),
    view('uv', 'Float32Array'),
    view('skinIndex', 'Uint16Array'),
    view('skinWeight', 'Float32Array'),
    view('index', 'Uint32Array'),
  );
  const m = meta as Omit<Measurements, 'bonePositions'> & { jointPositions: Record<JointName, number[]>; parents: Record<JointName, JointName | null> };
  const bones = [...JOINTS];
  const jointBone = Object.fromEntries(JOINTS.map((j, i) => [j, i])) as Record<JointName, number>;
  const raw: Measurements = { height: m.height, bonePositions: m.jointPositions, landmarks: m.landmarks, radii: m.radii, torsoProfile: m.torsoProfile, torsoFlatten: m.torsoFlatten };
  const d = derive(raw, bones, jointBone);
  return {
    ...mesh,
    source: 'legacy',
    id: 'legacy',
    raw,
    height: d.height,
    bones,
    boneParent: JOINTS.map((j) => {
      const p = m.parents[j];
      return p ? JOINTS.indexOf(p) : null;
    }),
    bonePositions: d.bonePositions,
    owner: bones,
    jointBone,
    joints: d.joints,
    landmarks: d.landmarks,
    radii: d.radii,
    torsoProfile: d.torsoProfile,
    torsoFlatten: d.torsoFlatten,
    lods: [mesh],
  };
}

/** What scripts/build-characters.mjs stores in the GLB's asset extras. */
interface GlbMeta extends Measurements {
  bones: string[];
  boneParents: Array<string | null>;
  gameJoints: Record<JointName, string>;
  boneOwner: JointName[];
}

function meshFrom(glb: Glb, prim: { attributes: Record<string, number>; indices: number }): TemplateMesh {
  const a = prim.attributes;
  return templateMesh(
    readFloat(glb, a.POSITION),
    readFloat(glb, a.NORMAL),
    readFloat(glb, a.TEXCOORD_0),
    readUint16(glb, a.JOINTS_0),
    readFloat(glb, a.WEIGHTS_0),
    readUint32(glb, prim.indices),
  );
}

/** The GLB from scripts/build-characters.mjs: the shared humanoid skeleton and the body at three levels of detail. */
async function loadGlbTemplate(url: string): Promise<HumanTemplate> {
  const glb = parseGlb(await fetch(url).then((r) => r.arrayBuffer()));
  const meta = glb.json.asset.extras as unknown as GlbMeta;
  const skin = glb.json.skins?.[0];
  if (!skin) throw new Error(`${url}: no skin`);
  const bones = skin.joints.map((i) => glb.json.nodes[i].name);
  const index = (name: string): number => {
    const i = bones.indexOf(name);
    if (i < 0) throw new Error(`${url}: no bone ${name}`);
    return i;
  };
  const jointBone = Object.fromEntries(JOINTS.map((j) => [j, index(meta.gameJoints[j])])) as Record<JointName, number>;
  const raw: Measurements = {
    height: meta.height,
    bonePositions: meta.bonePositions,
    landmarks: meta.landmarks,
    radii: meta.radii,
    torsoProfile: meta.torsoProfile,
    torsoFlatten: meta.torsoFlatten,
  };
  const d = derive(raw, bones, jointBone);
  const lods = glb.json.nodes
    .filter((node) => node.mesh !== undefined)
    .map((node) => glb.json.meshes[node.mesh as number])
    .sort((a, b) => Number(a.extras?.lod ?? 0) - Number(b.extras?.lod ?? 0))
    .map((mesh) => meshFrom(glb, mesh.primitives[0]));
  if (!lods.length) throw new Error(`${url}: no body mesh`);
  return {
    ...lods[0],
    source: 'glb',
    id: 'human_m', // set by loadBody
    raw,
    height: d.height,
    bones,
    boneParent: meta.boneParents.map((p) => (p ? index(p) : null)),
    bonePositions: d.bonePositions,
    owner: meta.boneOwner,
    jointBone,
    joints: d.joints,
    landmarks: d.landmarks,
    radii: d.radii,
    torsoProfile: d.torsoProfile,
    torsoFlatten: d.torsoFlatten,
    lods,
  };
}

/** The default body: the legacy template, or the human man. */
export function humanTemplate(): HumanTemplate {
  if (!defaultBody) throw new Error('bodies not loaded: await loadHumanTemplate() first');
  return body(defaultBody);
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
  /** The base body (race and sex); the default body when omitted. */
  body?: BodyId;
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
  /** Chest fullness: 0 flattens the legacy base mesh's slight breasts (its default), 1 keeps them (the default on the pipeline's sexed bodies). */
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
  /** Seat: 0 keeps the base mesh's buttocks, 1 presses them a third of the way into the pelvis. */
  seat?: number;
  /**
   * How far a shirt bridges the hollow between the pectorals: 1 fills it so
   * the cloth reads as one chest (the default under a shirt), 0 lets the
   * skin's groove show through (the default bare-chested, and on the women).
   */
  sternum?: number;
  /**
   * The character creator's sliders by id (see morphs.ts): the face and body
   * sculpted on top of the race's body, before the proportion knobs above.
   */
  morphs?: MorphValues;
  /** Eyebrow weight, 0 fine to 1 heavy; half by default. */
  browWeight?: number;
  /** Eyebrow colour; the hair's, darkened, by default. */
  browColor?: number;
  /** Upper eyelash length in metres at the figure's scale; the sex's usual by default, 0 for none. */
  lashes?: number;
  /** Beard, makeup and marks painted on the face (the full beard is also grown as geometry by the caller). */
  face?: FaceStyle;
  /** Green skin, no shirt, ragged breeches, bare feet; ears and nose are added by the caller. */
  goblin?: boolean;
  /** Hair style: built as geometry on the skull, with a painted scalp beneath. */
  hair?: HairStyle;
  /** Clothing cut. Defaults: tunic with sleeves to the elbow, full trousers, boots. */
  sleeves?: 'long' | 'short' | 'none';
  trousers?: 'full' | 'ragged' | 'none';
  shirt?: boolean;
  booted?: boolean;
  /** Leather bracers on bare forearms. */
  bracers?: boolean;
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
  bulk: 1.06,
  shoulders: 1.12,
  waist: 0.9,
  chestWidth: 1.08,
  // Athletic, not sculpted: a shirt over a strongly cut chest reads as a bust.
  pecs: 0.3,
  hips: 0.95,
  seat: 0.6,
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
  const isHead = T.owner.map((o) => o === 'head');
  const r = new THREE.Vector3();
  for (let i = 0; i < T.vertexCount; i++) {
    let wHead = 0;
    for (let k = 0; k < 4; k++) if (isHead[T.skinIndex[i * 4 + k]]) wHead += T.skinWeight[i * 4 + k];
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

/**
 * Which vertex each vertex welds to: the build scripts split vertices along
 * the UV seams, so normals must be gathered on the unsplit body or every seam
 * shades as a crease. Built once per template from the rest positions.
 */
const welds = new WeakMap<HumanTemplate, Uint32Array>();
function weldOf(T: HumanTemplate): Uint32Array {
  let weld = welds.get(T);
  if (weld) return weld;
  const n = T.vertexCount;
  weld = new Uint32Array(n);
  const first = new Map<string, number>();
  const p = T.positions;
  for (let i = 0; i < n; i++) {
    const key = `${Math.round(p[i * 3] * 1e5)},${Math.round(p[i * 3 + 1] * 1e5)},${Math.round(p[i * 3 + 2] * 1e5)}`;
    const j = first.get(key);
    if (j === undefined) {
      first.set(key, i);
      weld[i] = i;
    } else weld[i] = j;
  }
  welds.set(T, weld);
  return weld;
}

/**
 * Smooth normals of the reshaped body. The template's normals describe the
 * unreshaped mesh, so without this a chest pressed flat still shades as the
 * base mesh's breasts and a swollen belly shades as a flat one.
 */
function reshapedNormals(T: HumanTemplate, pos: Float32Array): THREE.BufferAttribute {
  const index = T.shared.index;
  if (!index) return T.shared.normal;
  const weld = weldOf(T);
  const n = T.vertexCount;
  const acc = new Float32Array(n * 3);
  const idx = index.array;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3;
    const b = idx[t + 1] * 3;
    const c = idx[t + 2] * 3;
    const abx = pos[b] - pos[a];
    const aby = pos[b + 1] - pos[a + 1];
    const abz = pos[b + 2] - pos[a + 2];
    const acx = pos[c] - pos[a];
    const acy = pos[c + 1] - pos[a + 1];
    const acz = pos[c + 2] - pos[a + 2];
    // Area-weighted: the cross product's length is twice the triangle's area.
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    for (const v of [idx[t], idx[t + 1], idx[t + 2]]) {
      const r = weld[v] * 3;
      acc[r] += nx;
      acc[r + 1] += ny;
      acc[r + 2] += nz;
    }
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = weld[i] * 3;
    const len = Math.hypot(acc[r], acc[r + 1], acc[r + 2]) || 1;
    out[i * 3] = acc[r] / len;
    out[i * 3 + 1] = acc[r + 1] / len;
    out[i * 3 + 2] = acc[r + 2] / len;
  }
  return new THREE.BufferAttribute(out, 3);
}

/** A person built from the human template, reshaped and dressed for `spec`. */
export function buildHumanoid(spec: HumanoidSpec): Rig {
  const T = spec.body ? body(spec.body) : humanTemplate();
  const p = spec.palette;
  const headK = spec.headScale ?? 1;
  const armK = spec.armScale ?? 1;
  const legK = spec.legScale ?? 1;
  const bulk = spec.bulk ?? 1;
  const belly = spec.belly ?? 0;
  const chest = spec.chest ?? (T.source === 'legacy' ? 0 : 1);
  const shoulders = spec.shoulders ?? 1.06;
  const waist = spec.waist ?? 1;
  const chestWidth = spec.chestWidth ?? 1;
  const pecs = spec.pecs ?? 0;
  const hipsK = spec.hips ?? 1;
  const neckK = spec.neck ?? 1;
  const jaw = spec.jaw ?? 1;
  const seat = spec.seat ?? 0;
  const shirt = spec.shirt ?? !spec.goblin;
  // The pipeline's men have a real hollow between the pectorals for a shirt
  // to bridge; the legacy mesh's chest is flat once pressed, and a fill
  // there would stand as a ridge.
  const sternum = spec.sternum ?? (shirt && T.source !== 'legacy' ? 1 : 0);
  const n = T.vertexCount;

  // 0. The creator's sliders: baked vertex deltas added to the finest mesh,
  //    and the measurements (joints, landmarks, radii, torso profile) moved
  //    with them, so the eyes, hair and gear follow the sculpted face and
  //    body. Everything below reads these instead of the template's own.
  const pos = new Float32Array(T.positions);
  let rest = T.joints;
  let lm = T.landmarks;
  let boneRest = T.bonePositions;
  let radii = T.radii;
  let torsoProfile = T.torsoProfile;
  let torsoFlatten = T.torsoFlatten;
  let morphed = false;
  const set = hasMorphs(spec.morphs) && T.sex ? morphSet(T.sex) : null;
  if (set && spec.morphs) {
    const deltas = applyMorphs(set, spec.morphs, 0, pos);
    if (deltas.length) {
      morphed = true;
      const raw = cloneMeasures(T.raw);
      for (const [d, w] of deltas) addMeasures(raw, d, w);
      const m = derive(raw, T.bones, T.jointBone);
      rest = m.joints;
      lm = m.landmarks;
      boneRest = m.bonePositions;
      radii = m.radii;
      torsoProfile = m.torsoProfile;
      torsoFlatten = m.torsoFlatten;
    }
  }
  /** The eyeballs grow and shrink with the eye sockets. */
  const eyeK = 1 + 0.3 * (spec.morphs?.eyeSize ?? 0);

  // 1. Reshape in template space: limbs thicker or thinner about their bone
  //    axes; the torso wider, pinched at the waist, broadened across the ribs,
  //    the belly swelling forward and the chest pushed out; the pelvis
  //    narrowed; the head scaled about its joint and the jaw tapered.
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
  const reshape = limbK !== 1 || torsoK !== 1 || belly !== 0 || headK !== 1 || chest !== 1 || waist !== 1 || chestWidth !== 1 || pecs !== 0 || hipsK !== 1 || jaw !== 1 || seat > 0 || sternum > 0;
  if (reshape) {
    for (let i = 0; i < n; i++) {
      v.fromArray(pos, i * 3);
      d.set(0, 0, 0);
      for (let k = 0; k < 4; k++) {
        const w = T.skinWeight[i * 4 + k];
        if (w <= 0) continue;
        const j = T.owner[T.skinIndex[i * 4 + k]];
        const c = CHILD[j];
        if (seat > 0 && (j === 'hips' || j === 'thighL' || j === 'thighR') && v.z < rest.hips.z - 0.02) {
          // The seat: buttocks pressed toward the pelvis.
          const gy = gauss(v.y - (rest.hips.y - 0.04), 0.07);
          d.z += (rest.hips.z - 0.02 - v.z) * 0.35 * seat * gy * w;
        }
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
              // Press the base mesh's slight breasts back to the sternum's
              // level: a broad, shallow press, measured on the legacy mesh
              // (its mounds stand about a centimetre proud). The deep, narrow
              // one before left dimples that read as a bust under a lit shirt.
              const bx = gauss(Math.abs(v.x) - 0.072, 0.05);
              const by = gauss(v.y - breastY, 0.05);
              d.z -= 0.016 * (1 - chest) * bx * by * w;
            }
            if (pecs > 0) {
              // Pectorals: a broad, flat plate from the sternum out to the
              // armpit, fading slowly up toward the collarbone and ending in
              // a crisper edge underneath.
              const ax = Math.abs(v.x);
              const px = smooth(ax, 0.012, 0.04) * (1 - smooth(ax, 0.095, 0.135));
              const dy = v.y - pecY;
              const py = dy > 0 ? gauss(dy, 0.055) : gauss(dy, 0.038);
              d.z += 0.011 * pecs * px * py * w;
            }
            if (sternum > 0) {
              // Under a shirt the cloth bridges the hollow between the
              // pectorals instead of dipping into it.
              d.z += 0.014 * sternum * gauss(v.x, 0.03) * gauss(v.y - pecY, 0.045) * w;
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
        if (w > 0) v.addScaledVector(offset[T.owner[T.skinIndex[i * 4 + k]]], w);
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

  // 4. Skeleton and skinned mesh. Every template bone becomes a THREE.Bone;
  //    the game's joints drive the bones that carry them, and the rest (spine
  //    links, clavicles, toes, the hair and cape chains) follow their owner
  //    joint's offset so they stay inside the reshaped flesh.
  const group = new THREE.Group();
  group.rotation.order = 'YXZ';
  const boneList = T.bones.map((name) => {
    const b = new THREE.Bone();
    b.name = name;
    b.rotation.order = 'YXZ';
    return b;
  });
  const posedBone = boneRest.map((p, b) => p.clone().add(offset[T.owner[b]]).multiplyScalar(s));
  for (let b = 0; b < boneList.length; b++) {
    const parent = T.boneParent[b];
    boneList[b].position.copy(posedBone[b]);
    if (parent !== null) {
      boneList[b].position.sub(posedBone[parent]);
      boneList[parent].add(boneList[b]);
    }
  }
  const bones = Object.fromEntries(JOINTS.map((j) => [j, boneList[T.jointBone[j]]])) as Record<JointName, THREE.Bone>;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', reshape || moved || morphed ? reshapedNormals(T, pos) : T.shared.normal);
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
    shirt,
    booted: spec.booted ?? !spec.goblin,
    bracers: spec.bracers ?? false,
    goblin: !!spec.goblin,
    face: spec.face,
  };
  const mesh = new THREE.SkinnedMesh(geo, lookMaterial(T, look));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false; // poses reach outside the rest-pose bounds
  mesh.add(boneList[T.boneParent.indexOf(null)]);
  mesh.bind(new THREE.Skeleton(boneList));
  group.add(mesh);

  // 5. Eyes: real eyeballs behind the lids.
  const eyeR = 0.0122 * s * headK * eyeK;
  const eyeGeo = new THREE.SphereGeometry(eyeR, 18, 12);
  for (const l of [lm.eyeL, lm.eyeR]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMaterial(look.eyes, look.goblin));
    eye.position.copy(onHead(l));
    eye.castShadow = false;
    bones.head.add(eye);
  }
  // The skin round each eye, read off the finished head into the head bone's space: the lids' edges for the lashes, the surface for the brows.
  const fieldOf = (l: THREE.Vector3, sign: number): FaceField | undefined => (T.source === 'legacy' ? undefined : new FaceField(pos, T.indices, posed.head, onHead(l), eyeR, sign));
  const skinL = fieldOf(lm.eyeL, 1);
  const skinR = fieldOf(lm.eyeR, -1);
  const lidL = skinL?.lidMargin() ?? undefined;
  const lidR = skinR?.lidMargin() ?? undefined;

  // 6. Measurements for equipment, in the rig's units. The scalp is measured
  //    from the finished head so hair hugs whatever skull this figure has.
  const dist = (a: JointName, b: JointName): number => posed[a].distanceTo(posed[b]);
  const earL = onHead(lm.earL);
  const earR = onHead(lm.earR);
  const headTop = onHead(lm.headTop).y;
  const earY = (earL.y + earR.y) / 2;
  const skullCentre = new THREE.Vector3(0, earY + (headTop - earY) * 0.3, ((lm.skullFront + lm.skullBack) / 2 - rest.head.z) * headK * s);
  const scalp = measureScalp(pos, T, posed.head, skullCentre, [earL, earR], 0.03 * s * headK);
  const chestBands = torsoProfile.filter(([r]) => r > 0.1).map(([r, y]) => [r * torsoWidthAt(y + rest.spine.y), y] as const);
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
    shoulderY: posed.shoulderL.y - posed.spine.y,
    torsoCentreZ: ((lm.chestFront.z + lm.chestBack.z) / 2 - rest.spine.z) * s,
    hipHalf: posed.thighL.x,
    headFlatten: (lm.skullFront - lm.skullBack) / (2 * lm.skullHalfWidth),
    torsoProfile: chestBands.map(([r, y]) => [r * s * torsoK * (1 + belly * 0.25), y * s] as const),
    torsoFlatten: torsoFlatten + belly * 0.2,
    chestR,
    waistR,
    thighR: radii.thigh * s * limbK,
    shinR: radii.shin * s * limbK,
    armR: radii.upperArm * s * limbK,
    forearmR: radii.forearm * s * limbK,
    deltoidR: radii.deltoid * s * limbK,
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
      mouthHalf: lm.mouthHalfWidth * headK * s,
      front: (lm.skullFront - rest.head.z) * headK * s,
      back: (lm.skullBack - rest.head.z) * headK * s,
      earL,
      earR,
      eyeL: onHead(lm.eyeL),
      eyeR: onHead(lm.eyeR),
      eyeRadius: eyeR,
      lidL,
      lidR,
      skinL,
      skinR,
      browPoints: lm.brow.map((v) => onHead(v)),
      headScale: s * headK,
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
    bones: boneList,
    body: mesh,
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
  // Brows and lashes as strands; the painter leaves only a faint shadow under the brow.
  if (!look.goblin) {
    const browColor = spec.browColor ?? new THREE.Color(p.hair).multiplyScalar(0.7).getHex();
    const brows = buildBrows(rig, browColor, spec.browWeight ?? 0.5);
    if (brows) bones.head.add(brows);
    const lashes = buildLashes(rig, (spec.lashes ?? (T.sex === 'female' ? 0.0052 : 0.0038)) * s * headK);
    if (lashes) bones.head.add(lashes);
  }
  spec.extras?.(rig);
  return rig;
}
