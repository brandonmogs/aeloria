import { EquipSlot } from '../../sim/Inventory';
import { allItemIds, itemDef } from '../../sim/items';
import { ACTION_DURATION, ActionKind } from '../../render/characters';
import { HairStyle } from '../../render/hair';
import { Race, Sex } from '../../render/human';
import { Equipment, emptyEquipment } from '../../render/outfit';
import { RACES, RaceDef } from '../../render/races';

/**
 * What the character lab can show: races and sexes (a body from the pipeline
 * plus proportion knobs), the equipment per slot, outfit sets, animations,
 * lighting and the style toggles, all round-tripped through the page's query
 * string so a look can be linked to or screenshotted headlessly.
 */

export type { Race, Sex, RaceDef };
export { RACES };
export type Locomotion = 'idle' | 'walk' | 'run';
export type AnimationName = Locomotion | ActionKind;
export type LightingPreset = 'sun' | 'golden' | 'overcast' | 'moonlit' | 'studio';
export type Framing = 'full' | 'torso' | 'head';
export type StyleFeature = 'wrap' | 'spec' | 'rim' | 'glow';
export type SetName = 'none' | 'cloth' | 'leather' | 'chain' | 'plate';

export const RACE_IDS: readonly Race[] = ['human', 'elf', 'darkelf', 'orc', 'dwarf'];
export const SEXES: readonly Sex[] = ['male', 'female'];
export const HAIR_STYLES: readonly HairStyle[] = ['long', 'short', 'bald'];
export const LOCOMOTION: readonly Locomotion[] = ['idle', 'walk', 'run'];
export const ANIMATIONS: readonly AnimationName[] = [...LOCOMOTION, ...(Object.keys(ACTION_DURATION) as ActionKind[])];
export const LIGHTING_PRESETS: readonly LightingPreset[] = ['sun', 'golden', 'overcast', 'moonlit', 'studio'];
export const FRAMINGS: readonly Framing[] = ['full', 'torso', 'head'];
export const STYLE_FEATURES: readonly StyleFeature[] = ['wrap', 'spec', 'rim', 'glow'];
export const SET_NAMES: readonly SetName[] = ['none', 'cloth', 'leather', 'chain', 'plate'];
export const TIERS: readonly string[] = ['bronze', 'iron', 'steel', 'black', 'mithril', 'adamant', 'rune'];
/** Slots with something to draw, in panel order; the rest are listed for completeness. */
export const VISUAL_SLOTS: readonly EquipSlot[] = ['helmet', 'chestplate', 'legs', 'gloves', 'boots', 'cape', 'weapon', 'shield'];
export const OTHER_SLOTS: readonly EquipSlot[] = ['amulet', 'ring', 'ammo'];

export const STYLE_LABELS: Record<StyleFeature, string> = {
  wrap: 'Soft wrap diffuse',
  spec: 'Metal specular boost',
  rim: 'Coloured rim light',
  glow: 'Enchant glow',
};

export const LIGHT_LABELS: Record<LightingPreset, string> = {
  sun: 'In-game sun',
  golden: 'Golden hour',
  overcast: 'Overcast',
  moonlit: 'Moonlit',
  studio: 'Studio',
};

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

export interface LabConfig {
  race: Race;
  sex: Sex;
  height: number;
  hair: HairStyle;
  hairColor: number;
  skin: number;
  eyes: number;
  /** The painted underlayer, what shows where no armour is worn. */
  tunic: number;
  trouser: number;
  equipment: Equipment;
  animation: AnimationName;
  lighting: LightingPreset;
  turntable: boolean;
  framing: Framing;
  style: Record<StyleFeature, boolean>;
  /** Merge gear, hair and eyes into one skinned mesh beside the body (two draw calls), or hang each piece on its bone. */
  merged: boolean;
  /** Show the control panel (off for clean screenshots). */
  ui: boolean;
}

export function defaultConfig(race: Race = 'human', sex: Sex = 'male'): LabConfig {
  const r = RACES[race];
  return {
    race,
    sex,
    height: r.height[sex],
    hair: r.hairStyle[sex],
    hairColor: r.hair,
    skin: r.skin,
    eyes: r.eyes,
    tunic: 0x3f7a4a,
    trouser: 0x4a4858,
    equipment: emptyEquipment(),
    animation: 'idle',
    lighting: 'sun',
    turntable: true,
    framing: 'full',
    style: { wrap: true, spec: true, rim: true, glow: true },
    merged: true,
    ui: true,
  };
}

/** Reset the body to a race and sex's defaults, keeping the outfit and view. */
export function applyRace(cfg: LabConfig, race: Race, sex: Sex): void {
  const d = defaultConfig(race, sex);
  Object.assign(cfg, { race, sex, height: d.height, hair: d.hair, hairColor: d.hairColor, skin: d.skin, eyes: d.eyes });
}

// --- Equipment ------------------------------------------------------------------------

let slotItems: Map<EquipSlot, string[]> | null = null;
let known: Set<string> | null = null;

/** Every item that goes in `slot`, by id. */
export function itemsForSlot(slot: EquipSlot): string[] {
  if (!slotItems) {
    slotItems = new Map();
    for (const id of allItemIds()) {
      const s = itemDef(id).equip;
      if (!s) continue;
      let list = slotItems.get(s);
      if (!list) slotItems.set(s, (list = []));
      list.push(id);
    }
    for (const list of slotItems.values()) list.sort();
  }
  return slotItems.get(slot) ?? [];
}

function isItem(id: string): boolean {
  known ??= new Set(allItemIds());
  return known.has(id);
}

/** Equip `id` (or nothing) in `slot`, keeping two-handed weapons and shields exclusive. */
export function equipItem(eq: Equipment, slot: EquipSlot, id: string | null): void {
  eq[slot] = id ? { id, qty: 1 } : null;
  if (slot === 'weapon' && id && itemDef(id).twoHanded) eq.shield = null;
  if (slot === 'shield' && id && eq.weapon && itemDef(eq.weapon.id).twoHanded) eq.weapon = null;
}

/** The items of an outfit set at a metal tier; the painted tunic is the cloth layer for now. */
export function outfitSet(name: SetName, tier: string): Partial<Record<EquipSlot, string>> {
  switch (name) {
    case 'none':
      return {};
    case 'cloth':
      return { weapon: 'staff_of_air' };
    case 'leather':
      return {
        helmet: 'leather_cowl',
        chestplate: 'leather_body',
        legs: 'leather_chaps',
        gloves: 'leather_gloves',
        boots: 'leather_boots',
        weapon: 'shortbow',
      };
    case 'chain':
      return {
        helmet: `${tier}_med_helm`,
        chestplate: `${tier}_chainbody`,
        legs: `${tier}_platelegs`,
        gloves: 'leather_gloves',
        boots: 'leather_boots',
        weapon: `${tier}_scimitar`,
        shield: `${tier}_sq_shield`,
      };
    case 'plate':
      return {
        helmet: `${tier}_full_helm`,
        chestplate: `${tier}_platebody`,
        legs: `${tier}_platelegs`,
        gloves: 'leather_gloves',
        boots: 'leather_boots',
        cape: 'max_cape',
        weapon: `${tier}_longsword`,
        shield: `${tier}_kiteshield`,
      };
  }
}

export function applySet(eq: Equipment, name: SetName, tier: string): void {
  for (const slot of VISUAL_SLOTS) eq[slot] = null;
  for (const [slot, id] of Object.entries(outfitSet(name, tier)) as Array<[EquipSlot, string]>) {
    if (isItem(id)) equipItem(eq, slot, id);
  }
}

/** Dress the visual slots at random; some stay empty so bare arms and heads get reviewed too. */
export function randomOutfit(eq: Equipment, rand: () => number = Math.random): void {
  const chance: Partial<Record<EquipSlot, number>> = {
    helmet: 0.7,
    chestplate: 0.85,
    legs: 0.85,
    gloves: 0.6,
    boots: 0.75,
    cape: 0.45,
    weapon: 0.85,
    shield: 0.5,
  };
  for (const slot of VISUAL_SLOTS) {
    const list = itemsForSlot(slot);
    const pick = rand() < (chance[slot] ?? 0) && list.length ? list[Math.floor(rand() * list.length)] : null;
    equipItem(eq, slot, pick);
  }
}

// --- Query string --------------------------------------------------------------------

export const hex = (c: number): string => c.toString(16).padStart(6, '0');

function pick<T extends string>(v: string | null, list: readonly T[], fallback: T): T {
  return v !== null && (list as readonly string[]).includes(v) ? (v as T) : fallback;
}

export function configToSearch(c: LabConfig): string {
  const p = new URLSearchParams();
  p.set('race', c.race);
  p.set('sex', c.sex);
  p.set('height', c.height.toFixed(2));
  p.set('hair', c.hair);
  p.set('hairColor', hex(c.hairColor));
  p.set('skin', hex(c.skin));
  p.set('eyes', hex(c.eyes));
  p.set('tunic', hex(c.tunic));
  p.set('trouser', hex(c.trouser));
  for (const slot of [...VISUAL_SLOTS, ...OTHER_SLOTS]) {
    const item = c.equipment[slot];
    if (item) p.set(slot, item.id);
  }
  p.set('anim', c.animation);
  p.set('light', c.lighting);
  p.set('turntable', c.turntable ? '1' : '0');
  p.set('frame', c.framing);
  const on = STYLE_FEATURES.filter((f) => c.style[f]);
  p.set('style', on.length === STYLE_FEATURES.length ? 'all' : on.length ? on.join(',') : 'off');
  if (!c.merged) p.set('gear', 'props');
  if (!c.ui) p.set('ui', '0');
  return p.toString();
}

/**
 * Read a config back from a query string. Unknown or missing values fall
 * back to the race defaults; `set=plate:rune` dresses a whole outfit before
 * the per-slot keys apply on top of it.
 */
export function configFromSearch(search: string): LabConfig {
  const p = new URLSearchParams(search);
  const race = pick(p.get('race'), RACE_IDS, 'human');
  const sexRaw = p.get('sex');
  const sex = sexRaw === 'f' ? 'female' : sexRaw === 'm' ? 'male' : pick(sexRaw, SEXES, 'male');
  const c = defaultConfig(race, sex);
  const num = (key: string, lo: number, hi: number, apply: (v: number) => void): void => {
    const v = parseFloat(p.get(key) ?? '');
    if (Number.isFinite(v)) apply(Math.min(hi, Math.max(lo, v)));
  };
  const colour = (key: string, apply: (v: number) => void): void => {
    const raw = p.get(key);
    if (raw && /^[0-9a-fA-F]{6}$/.test(raw)) apply(parseInt(raw, 16));
  };
  num('height', 1.2, 2.3, (v) => (c.height = v));
  c.hair = pick(p.get('hair'), HAIR_STYLES, c.hair);
  colour('hairColor', (v) => (c.hairColor = v));
  colour('skin', (v) => (c.skin = v));
  colour('eyes', (v) => (c.eyes = v));
  colour('tunic', (v) => (c.tunic = v));
  colour('trouser', (v) => (c.trouser = v));
  const set = p.get('set');
  if (set) {
    const [name, tier] = set.split(':');
    applySet(c.equipment, pick(name, SET_NAMES, 'none'), pick(tier ?? '', TIERS, 'bronze'));
  }
  for (const slot of [...VISUAL_SLOTS, ...OTHER_SLOTS]) {
    const id = p.get(slot);
    if (id === '-' || id === '') c.equipment[slot] = null;
    else if (id && isItem(id)) equipItem(c.equipment, slot, id);
  }
  c.animation = pick(p.get('anim'), ANIMATIONS, 'idle');
  c.lighting = pick(p.get('light'), LIGHTING_PRESETS, 'sun');
  if (p.get('turntable') === '0') c.turntable = false;
  c.framing = pick(p.get('frame'), FRAMINGS, 'full');
  const style = p.get('style');
  if (style === 'off') for (const f of STYLE_FEATURES) c.style[f] = false;
  else if (style && style !== 'all') {
    const on = style.split(',');
    for (const f of STYLE_FEATURES) c.style[f] = on.includes(f);
  }
  if (p.get('gear') === 'props') c.merged = false;
  if (p.get('ui') === '0') c.ui = false;
  return c;
}
