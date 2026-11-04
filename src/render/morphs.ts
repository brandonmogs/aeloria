import * as THREE from 'three';
import type { Sex } from './human';

/**
 * The character creator's sliders, baked by scripts/build-characters.mjs
 * from MakeHuman's targets into `morphs_<m|f>.json` and `.bin` beside the
 * bodies. A slider has one pole (`+`, 0 to 1) or two (`-` as well, -1 to 1);
 * a pole is the difference between the human body with that target on and
 * the body without it: sparse, quantised vertex deltas per level of detail,
 * and the deltas of the measurements the renderer takes (bone positions,
 * landmarks, limb radii, the torso profile). Every body of a sex shares the
 * topology of the human one, so one set serves the elf, the orc and the
 * dwarf too.
 */

export interface MorphGroup {
  id: string;
  label: string;
  tab: 'face' | 'body';
}

export interface MorphSlider {
  id: string;
  label: string;
  group: string;
  /** -1 to 1 when true (two poles), 0 to 1 when false. */
  bipolar: boolean;
}

/** Vertex deltas at one level of detail: `index[i]` moves by `delta[i*3..] * scale`. */
interface LodDeltas {
  index: Uint16Array;
  delta: Int16Array;
  scale: number;
}

/**
 * A measurement delta mirrors the shape of the GLB's measurements (height,
 * bonePositions, landmarks, radii, torsoProfile, torsoFlatten) with only the
 * entries that change; see {@link addMeasures}.
 */
export type MeasureDelta = number | MeasureDelta[] | { [key: string]: MeasureDelta };

interface MorphPole {
  lods: LodDeltas[];
  measures?: MeasureDelta;
}

export interface MorphSet {
  sex: Sex;
  /** Vertex counts per level of detail, to check a body against. */
  lods: number[];
  groups: MorphGroup[];
  sliders: MorphSlider[];
  poles: Map<string, MorphPole>;
}

/** Slider values by id; missing means 0. */
export type MorphValues = Record<string, number>;

interface MorphJson {
  sex: Sex;
  lods: number[];
  groups: MorphGroup[];
  sliders: MorphSlider[];
  morphs: Record<string, { lods: Array<{ offset: number; count: number; scale: number }>; measures?: MeasureDelta }>;
}

const sets = new Map<Sex, MorphSet>();
const loading = new Map<Sex, Promise<MorphSet>>();

/** Fetch a sex's morph set once. */
export function loadMorphs(sex: Sex, base = '/models/'): Promise<MorphSet> {
  let p = loading.get(sex);
  if (!p) {
    const name = `${base}characters/morphs_${sex === 'female' ? 'f' : 'm'}`;
    p = Promise.all([fetch(`${name}.json`).then((r) => r.json() as Promise<MorphJson>), fetch(`${name}.bin`).then((r) => r.arrayBuffer())]).then(
      ([json, bin]) => {
        const poles = new Map<string, MorphPole>();
        for (const [key, pole] of Object.entries(json.morphs)) {
          poles.set(key, {
            lods: pole.lods.map((l) => ({
              index: new Uint16Array(bin, l.offset, l.count),
              delta: new Int16Array(bin, l.offset + l.count * 2, l.count * 3),
              scale: l.scale,
            })),
            measures: pole.measures,
          });
        }
        const set: MorphSet = { sex: json.sex, lods: json.lods, groups: json.groups, sliders: json.sliders, poles };
        sets.set(sex, set);
        return set;
      },
    );
    loading.set(sex, p);
  }
  return p;
}

/** A loaded morph set, or null before `loadMorphs` resolved. */
export function morphSet(sex: Sex): MorphSet | null {
  return sets.get(sex) ?? null;
}

/** The poles a set of slider values turns on, with their weights (positive). */
function activePoles(set: MorphSet, values: MorphValues): Array<[MorphPole, number]> {
  const out: Array<[MorphPole, number]> = [];
  for (const s of set.sliders) {
    const v = values[s.id];
    if (!v) continue;
    const w = Math.max(-1, Math.min(1, v));
    const key = s.id + (w > 0 ? '+' : '-');
    const pole = set.poles.get(key);
    if (!pole) continue;
    out.push([pole, Math.abs(w)]);
  }
  return out;
}

/** Whether any slider is set. */
export function hasMorphs(values: MorphValues | undefined): values is MorphValues {
  if (!values) return false;
  for (const k in values) if (values[k]) return true;
  return false;
}

/**
 * Add a set's active deltas to `positions` (a level of detail's vertices, in
 * template space) in place, and return the measurement deltas to apply with
 * {@link addMeasures}. The vertex count must match the set's for that LOD.
 */
export function applyMorphs(set: MorphSet, values: MorphValues, lod: number, positions: Float32Array): Array<[MeasureDelta, number]> {
  const active = activePoles(set, values);
  const measures: Array<[MeasureDelta, number]> = [];
  if (!active.length) return measures;
  if (positions.length !== set.lods[lod] * 3) throw new Error(`morphs: LOD${lod} has ${positions.length / 3} vertices, the morph set ${set.lods[lod]}`);
  for (const [pole, w] of active) {
    const l = pole.lods[lod];
    if (l) {
      const k = l.scale * w;
      const { index, delta } = l;
      for (let i = 0; i < index.length; i++) {
        const v = index[i] * 3;
        positions[v] += delta[i * 3] * k;
        positions[v + 1] += delta[i * 3 + 1] * k;
        positions[v + 2] += delta[i * 3 + 2] * k;
      }
    }
    if (pole.measures) measures.push([pole.measures, w]);
  }
  return measures;
}

/**
 * Add `w` times a measurement delta into `target`, which has the same shape
 * (numbers, arrays and objects of them) and is modified in place. Entries
 * the delta does not carry stay as they are.
 */
export function addMeasures<T>(target: T, delta: MeasureDelta, w: number): T {
  if (typeof target === 'number') return ((target as number) + (delta as number) * w) as T;
  if (Array.isArray(target)) {
    const d = delta as MeasureDelta[];
    for (let i = 0; i < target.length && i < d.length; i++) target[i] = addMeasures(target[i], d[i], w);
    return target;
  }
  if (target && typeof target === 'object') {
    const t = target as Record<string, unknown>;
    const d = delta as Record<string, MeasureDelta>;
    for (const k of Object.keys(d)) if (k in t) t[k] = addMeasures(t[k], d[k], w);
    return target;
  }
  return target;
}

/** A deep copy of a measurements object (numbers, arrays, plain objects). */
export function cloneMeasures<T>(m: T): T {
  if (Array.isArray(m)) return m.map(cloneMeasures) as unknown as T;
  if (m && typeof m === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(m as Record<string, unknown>)) out[k] = cloneMeasures(v);
    return out as T;
  }
  return m;
}

/** Slider values for a random face or body: every slider nudged within `spread` of its rest. */
export function randomMorphs(set: MorphSet, tab: MorphGroup['tab'], spread: number, random: () => number = Math.random): MorphValues {
  const groups = new Set(set.groups.filter((g) => g.tab === tab).map((g) => g.id));
  const out: MorphValues = {};
  for (const s of set.sliders) {
    if (!groups.has(s.group)) continue;
    const v = (random() * 2 - 1) * spread;
    out[s.id] = +(s.bipolar ? v : Math.max(0, v)).toFixed(3);
  }
  return out;
}

/** Keep THREE's vector type in scope for callers that convert measurements. */
export const v3 = (a: number[]): THREE.Vector3 => new THREE.Vector3(a[0], a[1], a[2]);
