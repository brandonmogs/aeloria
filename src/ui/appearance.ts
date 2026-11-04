import { CharacterOptions } from '../render/characterBuilder';
import { HairStyle } from '../render/hair';
import { Race, Sex } from '../render/human';
import { BEARD_STYLES, BeardStyle, PAINT_STYLES, PaintStyle, SCAR_STYLES, ScarStyle } from '../render/humanSkin';
import { MorphValues } from '../render/morphs';
import { RACES } from '../render/races';

/**
 * The player's look: what the character screen decides, what the browser
 * keeps between visits, and what the world builds the player from. Eight
 * extra slots hold looks the player saved to come back to.
 */

export const RACE_IDS: readonly Race[] = ['human', 'elf', 'darkelf', 'orc', 'dwarf'];
export const SEXES: readonly Sex[] = ['male', 'female'];
export const HAIR_STYLES: readonly HairStyle[] = ['long', 'bob', 'ponytail', 'short', 'cropped', 'bald'];
export const NAME_MAX = 12;
export const SLOT_COUNT = 8;

export interface Appearance {
  name: string;
  race: Race;
  sex: Sex;
  /** Metres. */
  height: number;
  skin: number;
  eyes: number;
  hair: HairStyle;
  hairColor: number;
  /** The starting clothes. */
  tunic: number;
  trouser: number;
  /** Brow weight, 0 fine to 1 heavy; the colour is the hair's when null. */
  brows: number;
  browColor: number | null;
  /** Lash length as a fraction of the sex's usual, 0 to 2. */
  lashes: number;
  /** Facial hair, its colour the hair's when null. */
  beard: BeardStyle;
  beardColor: number | null;
  /** Makeup strengths 0 to 1 and their colours. */
  lips: number;
  lipColor: number;
  shadow: number;
  shadowColor: number;
  blush: number;
  /** Marks: freckles 0 to 1, a scar, war paint and its colour. */
  freckles: number;
  scar: ScarStyle;
  paint: PaintStyle;
  paintColor: number;
  /** The creator's sliders by id, -1 to 1 (see morphs.ts). */
  morphs: MorphValues;
}

export { BEARD_STYLES, PAINT_STYLES, SCAR_STYLES };
export type { BeardStyle, PaintStyle, ScarStyle };

export const SKIN_TONES: ReadonlyArray<readonly [string, number]> = [
  ['Pale', 0xf2dcc4],
  ['Fair', 0xe3b48d],
  ['Tan', 0xd9a06c],
  ['Olive', 0xc08f5e],
  ['Brown', 0x8d5a3a],
  ['Deep', 0x5a3a28],
  ['Ashen violet', 0x6f6b8f],
  ['Green', 0x5f7a3a],
];

export const HAIR_COLORS: ReadonlyArray<readonly [string, number]> = [
  ['Black', 0x141414],
  ['Dark brown', 0x4a2f16],
  ['Chestnut', 0x8b5a2b],
  ['Red', 0x8b3a1a],
  ['Blonde', 0xe9d7a0],
  ['Silver', 0xd0d0d0],
  ['White', 0xf0eef5],
];

export const EYE_COLORS: ReadonlyArray<readonly [string, number]> = [
  ['Brown', 0x5a3a1e],
  ['Hazel', 0x8a6a2e],
  ['Green', 0x4e8a4a],
  ['Blue', 0x4f7fa8],
  ['Grey', 0x8a97a3],
  ['Amber', 0xd9a13a],
  ['Violet', 0x7a5aa8],
  ['Crimson', 0xc4474a],
];

export const CLOTH_COLORS: ReadonlyArray<readonly [string, number]> = [
  ['Forest', 0x3f7a4a],
  ['Slate', 0x4a4858],
  ['Wine', 0x6b2a36],
  ['Navy', 0x2d3f6b],
  ['Ochre', 0x9a7a2a],
  ['Rust', 0x8a4a2a],
  ['Plum', 0x5a3a6b],
  ['Umber', 0x5a4632],
  ['Cream', 0xd8ccb0],
  ['Charcoal', 0x2a2a2e],
];

export const LIP_COLORS: ReadonlyArray<readonly [string, number]> = [
  ['Rose', 0xb84a5a],
  ['Red', 0x9a2f3a],
  ['Wine', 0x6b2030],
  ['Coral', 0xd4624a],
  ['Plum', 0x5a2a4a],
  ['Nude', 0xc48a74],
  ['Black', 0x1a1014],
];

export const SHADOW_COLORS: ReadonlyArray<readonly [string, number]> = [
  ['Smoke', 0x4a3a5a],
  ['Plum', 0x5a2a5a],
  ['Bronze', 0x8a5a2a],
  ['Teal', 0x2a5a5a],
  ['Charcoal', 0x2a2a30],
  ['Gold', 0xb08a3a],
  ['Rose', 0xa05060],
];

export const PAINT_COLORS: ReadonlyArray<readonly [string, number]> = [
  ['Bone', 0xf0f0f0],
  ['Blood', 0xc02a2a],
  ['Ash', 0x303030],
  ['Woad', 0x2a4a9a],
  ['Ochre', 0xc08a2a],
  ['Moss', 0x3a6a3a],
];

/** What a race and sex start with on the chin: a dwarf man's full beard, bare faces otherwise. */
export const defaultBeard = (race: Race, sex: Sex): BeardStyle => (race === 'dwarf' && sex === 'male' ? 'full' : 'none');

/** A named set of slider values for one tab of the creator. */
export interface MorphPreset {
  id: string;
  label: string;
  morphs: MorphValues;
}

export const FACE_PRESETS: readonly MorphPreset[] = [
  { id: 'natural', label: 'Natural', morphs: {} },
  { id: 'fine', label: 'Fine', morphs: { faceOval: 0.6, jawAngle: -0.3, chinPointed: 0.4, cheekbones: 0.35, noseWidth: -0.3, eyeSize: 0.25, upperLipFullness: 0.2, lowerLipFullness: 0.2 } },
  { id: 'strong', label: 'Strong', morphs: { faceSquare: 0.6, jawAngle: 0.4, chinWidth: 0.3, browRidge: 0.4, noseWidth: 0.2, cheekbones: 0.3, mouthWidth: 0.2 } },
  { id: 'soft', label: 'Soft', morphs: { faceRound: 0.6, cheekFullness: 0.4, chinHeight: -0.2, eyeSize: 0.2, lowerLipFullness: 0.3, noseLength: -0.15 } },
  { id: 'sharp', label: 'Sharp', morphs: { faceDiamond: 0.5, cheekbones: 0.6, cheekFullness: -0.4, chinPointed: 0.6, eyeOuterCornerHeight: 0.3, browAngle: 0.3, noseBridgeWidth: -0.3 } },
  { id: 'noble', label: 'Noble', morphs: { faceRectangular: 0.4, foreheadHeight: 0.3, noseGreek: 0.4, noseLength: 0.2, chinProminence: 0.2, eyeSpacing: -0.1 } },
  { id: 'weathered', label: 'Weathered', morphs: { faceAge: 0.6, eyeBags: 0.4, laughLines: 0.5, cheekFullness: -0.3, browRidge: 0.2 } },
  { id: 'youthful', label: 'Youthful', morphs: { faceAge: -0.5, eyeSize: 0.3, faceRound: 0.3, noseLength: -0.2, cheekFullness: 0.2 } },
];

export const BODY_PRESETS: readonly MorphPreset[] = [
  { id: 'average', label: 'Average', morphs: {} },
  { id: 'lean', label: 'Lean', morphs: { weight: -0.4, muscle: 0.2, waistGirth: -0.3, torsoWidth: -0.1, thighFat: -0.3, upperArmFat: -0.3 } },
  { id: 'athletic', label: 'Athletic', morphs: { muscle: 0.6, weight: -0.1, shoulderWidth: 0.3, deltoids: 0.4, abs: 0.5, vShape: 0.4, waistGirth: -0.2, thighMuscle: 0.3, calfMuscle: 0.3 } },
  { id: 'powerful', label: 'Powerful', morphs: { muscle: 0.9, weight: 0.3, shoulderWidth: 0.5, deltoids: 0.6, backMuscles: 0.5, pectorals: 0.5, chestGirth: 0.3, upperArmMuscle: 0.5, forearmMuscle: 0.4, thighMuscle: 0.5, neckGirth: 0.3 } },
  { id: 'stocky', label: 'Stocky', morphs: { weight: 0.5, muscle: 0.3, torsoWidth: 0.3, torsoLength: -0.1, shoulderWidth: 0.2, waistGirth: 0.3, thighWidth: 0.3 } },
  { id: 'heavy', label: 'Heavy', morphs: { weight: 0.9, belly: 0.6, waistGirth: 0.5, hipGirth: 0.4, chestGirth: 0.3, upperArmFat: 0.5, thighFat: 0.5, doubleChin: 0.4, neckGirth: 0.3 } },
  { id: 'slight', label: 'Slight', morphs: { weight: -0.6, muscle: -0.3, shoulderWidth: -0.3, torsoWidth: -0.2, upperArmWidth: -0.2, thighWidth: -0.2 } },
  { id: 'willowy', label: 'Willowy', morphs: { weight: -0.4, torsoLength: 0.2, upperArmLength: 0.2, thighLength: 0.2, shinLength: 0.2, neckLength: 0.2, shoulderWidth: -0.1 } },
];

/** How far the height slider goes either side of the race's stature. */
export function heightRange(race: Race, sex: Sex): [number, number] {
  const h = RACES[race].height[sex];
  return [+(h * 0.9).toFixed(2), +(h * 1.1).toFixed(2)];
}

export function defaultAppearance(race: Race = 'human', sex: Sex = 'male'): Appearance {
  const r = RACES[race];
  return {
    name: 'Adventurer',
    race,
    sex,
    height: r.height[sex],
    skin: r.skin,
    eyes: r.eyes,
    hair: r.hairStyle[sex],
    hairColor: r.hair,
    tunic: 0x3f7a4a,
    trouser: 0x4a4858,
    brows: 0.5,
    browColor: null,
    lashes: 1,
    beard: defaultBeard(race, sex),
    beardColor: null,
    lips: 0,
    lipColor: 0x9a2f3a,
    shadow: 0,
    shadowColor: 0x4a3a5a,
    blush: 0,
    freckles: 0,
    scar: 'none',
    paint: 'none',
    paintColor: 0xf0f0f0,
    morphs: {},
  };
}

/** Switch race or sex, taking that body's colours, hair, stature and beard; the name, clothes, makeup and sliders stay. */
export function applyRace(a: Appearance, race: Race, sex: Sex): void {
  const d = defaultAppearance(race, sex);
  Object.assign(a, { race, sex, height: d.height, skin: d.skin, eyes: d.eyes, hair: d.hair, hairColor: d.hairColor, beard: d.beard });
}

export function cloneAppearance(a: Appearance): Appearance {
  return { ...a, morphs: { ...a.morphs } };
}

export function toCharacterOptions(a: Appearance): CharacterOptions {
  return {
    race: a.race,
    sex: a.sex,
    height: a.height,
    hair: a.hair,
    hairColor: a.hairColor,
    skinTone: a.skin,
    eyes: a.eyes,
    tunic: a.tunic,
    trouser: a.trouser,
    brows: a.brows,
    browColor: a.browColor ?? undefined,
    lashes: a.lashes,
    face: {
      beard: a.sex === 'male' ? a.beard : 'none',
      beardColor: a.beardColor ?? a.hairColor,
      lips: a.lips,
      lipColor: a.lipColor,
      shadow: a.shadow,
      shadowColor: a.shadowColor,
      blush: a.blush,
      freckles: a.freckles,
      scar: a.scar,
      paint: a.paint,
      paintColor: a.paintColor,
    },
    morphs: { ...a.morphs },
  };
}

// --- Names -------------------------------------------------------------------------

const NAME_PARTS: Record<Sex, { first: string[]; last: string[] }> = {
  male: {
    first: ['Al', 'Bran', 'Cor', 'Dar', 'Eld', 'Fen', 'Gar', 'Hal', 'Ith', 'Kael', 'Lor', 'Mar', 'Ned', 'Or', 'Per', 'Ren', 'Sar', 'Tor', 'Ul', 'Var'],
    last: ['an', 'ric', 'ion', 'us', 'en', 'ir', 'oth', 'ek', 'in', 'ar', 'wyn', 'dor'],
  },
  female: {
    first: ['Ael', 'Bri', 'Cel', 'Dan', 'Eli', 'Fae', 'Gwen', 'Hel', 'Ili', 'Kir', 'Lys', 'Mir', 'Nae', 'Ori', 'Pri', 'Ros', 'Sel', 'Tal', 'Una', 'Vel'],
    last: ['a', 'ia', 'wen', 'is', 'ine', 'ara', 'eth', 'ya', 'iel', 'ora', 'ith', 'ess'],
  },
};

/** A name from two syllables, the way the random-name button of a character screen does it. */
export function randomName(sex: Sex, random: () => number = Math.random): string {
  const parts = NAME_PARTS[sex];
  const pick = (list: string[]): string => list[Math.floor(random() * list.length)];
  return cleanName(pick(parts.first) + pick(parts.last));
}

/** Letters, digits, spaces and the odd apostrophe or hyphen, trimmed to the limit. */
export function cleanName(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9 '-]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
  return cleaned || 'Adventurer';
}

// --- Persistence -------------------------------------------------------------------

const KEY = 'aeloria.appearance';
const SLOT_KEY = 'aeloria.appearance.slot';

const isColour = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffff;

/** A saved look, checked field by field; anything odd falls back to the defaults for the race and sex. */
export function sanitizeAppearance(raw: unknown): Appearance | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const race = RACE_IDS.includes(r.race as Race) ? (r.race as Race) : null;
  const sex = SEXES.includes(r.sex as Sex) ? (r.sex as Sex) : null;
  if (!race || !sex) return null;
  const a = defaultAppearance(race, sex);
  if (typeof r.name === 'string') a.name = cleanName(r.name);
  const [lo, hi] = heightRange(race, sex);
  if (typeof r.height === 'number' && Number.isFinite(r.height)) a.height = Math.min(hi, Math.max(lo, r.height));
  if (isColour(r.skin)) a.skin = r.skin;
  if (isColour(r.eyes)) a.eyes = r.eyes;
  if (isColour(r.hairColor)) a.hairColor = r.hairColor;
  if (isColour(r.tunic)) a.tunic = r.tunic;
  if (isColour(r.trouser)) a.trouser = r.trouser;
  if (HAIR_STYLES.includes(r.hair as HairStyle)) a.hair = r.hair as HairStyle;
  const unit = (v: unknown, hi = 1): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(hi, v)) : undefined);
  a.brows = unit(r.brows) ?? a.brows;
  a.lashes = unit(r.lashes, 2) ?? a.lashes;
  a.lips = unit(r.lips) ?? a.lips;
  a.shadow = unit(r.shadow) ?? a.shadow;
  a.blush = unit(r.blush) ?? a.blush;
  a.freckles = unit(r.freckles) ?? a.freckles;
  if (r.browColor === null || isColour(r.browColor)) a.browColor = r.browColor;
  if (r.beardColor === null || isColour(r.beardColor)) a.beardColor = r.beardColor;
  if (isColour(r.lipColor)) a.lipColor = r.lipColor;
  if (isColour(r.shadowColor)) a.shadowColor = r.shadowColor;
  if (isColour(r.paintColor)) a.paintColor = r.paintColor;
  if (BEARD_STYLES.includes(r.beard as BeardStyle)) a.beard = r.beard as BeardStyle;
  if (SCAR_STYLES.includes(r.scar as ScarStyle)) a.scar = r.scar as ScarStyle;
  if (PAINT_STYLES.includes(r.paint as PaintStyle)) a.paint = r.paint as PaintStyle;
  if (r.morphs && typeof r.morphs === 'object') {
    for (const [id, v] of Object.entries(r.morphs as Record<string, unknown>)) {
      if (typeof v !== 'number' || !Number.isFinite(v) || !v || !/^[A-Za-z0-9]{1,40}$/.test(id)) continue;
      a.morphs[id] = Math.max(-1, Math.min(1, v));
    }
  }
  return a;
}

function read(key: string): Appearance | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? sanitizeAppearance(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function write(key: string, a: Appearance | null): void {
  try {
    if (a) localStorage.setItem(key, JSON.stringify(a));
    else localStorage.removeItem(key);
  } catch {
    // Private windows and blocked storage: the look lasts the visit.
  }
}

/** The look the player goes into the world with. */
export const loadAppearance = (): Appearance | null => read(KEY);
export const saveAppearance = (a: Appearance): void => write(KEY, a);

/** The saved-look slots of the character screen. */
export const loadSlot = (i: number): Appearance | null => read(`${SLOT_KEY}.${i}`);
export const saveSlot = (i: number, a: Appearance | null): void => write(`${SLOT_KEY}.${i}`, a);
