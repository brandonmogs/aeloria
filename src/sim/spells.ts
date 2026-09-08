/**
 * The standard spellbook, as the OSRS Wiki lists it: level, runes, base
 * experience, and max hit for the combat spells. For now the Magic tab shows
 * the book and which spells the player's level unlocks; casting comes with
 * ranged/magic combat.
 */
export interface SpellDef {
  readonly id: string;
  readonly name: string;
  readonly level: number;
  /** Rune costs: [runeId, count]. */
  readonly runes: ReadonlyArray<readonly [string, number]>;
  readonly xp: number;
  readonly maxHit?: number;
  readonly kind: 'combat' | 'utility' | 'teleport' | 'enchant';
  readonly icon: string;
}

const s = (
  id: string,
  name: string,
  level: number,
  runes: ReadonlyArray<readonly [string, number]>,
  xp: number,
  kind: SpellDef['kind'],
  icon: string,
  maxHit?: number,
): SpellDef => ({ id, name, level, runes, xp, kind, icon, maxHit });

export const SPELLS: readonly SpellDef[] = [
  s('wind_strike', 'Wind Strike', 1, [['air_rune', 1], ['mind_rune', 1]], 5.5, 'combat', '💨', 2),
  s('confuse', 'Confuse', 3, [['water_rune', 3], ['earth_rune', 2], ['body_rune', 1]], 13, 'combat', '😵'),
  s('water_strike', 'Water Strike', 5, [['water_rune', 1], ['air_rune', 1], ['mind_rune', 1]], 7.5, 'combat', '💧', 4),
  s('lvl1_enchant', 'Lvl-1 Enchant', 7, [['water_rune', 1], ['cosmic_rune', 1]], 17.5, 'enchant', '💍'),
  s('earth_strike', 'Earth Strike', 9, [['earth_rune', 2], ['air_rune', 1], ['mind_rune', 1]], 9.5, 'combat', '🪨', 6),
  s('weaken', 'Weaken', 11, [['water_rune', 3], ['earth_rune', 2], ['body_rune', 1]], 21, 'combat', '🥀'),
  s('fire_strike', 'Fire Strike', 13, [['fire_rune', 3], ['air_rune', 2], ['mind_rune', 1]], 11.5, 'combat', '🔥', 8),
  s('bones_to_bananas', 'Bones to Bananas', 15, [['earth_rune', 2], ['water_rune', 2], ['nature_rune', 1]], 25, 'utility', '🍌'),
  s('wind_bolt', 'Wind Bolt', 17, [['air_rune', 2], ['chaos_rune', 1]], 13.5, 'combat', '💨', 9),
  s('curse', 'Curse', 19, [['water_rune', 2], ['earth_rune', 3], ['body_rune', 1]], 29, 'combat', '👁️'),
  s('bind', 'Bind', 20, [['water_rune', 3], ['earth_rune', 3], ['nature_rune', 2]], 30, 'combat', '⛓️'),
  s('low_alchemy', 'Low Level Alchemy', 21, [['fire_rune', 3], ['nature_rune', 1]], 31, 'utility', '🪙'),
  s('water_bolt', 'Water Bolt', 23, [['water_rune', 2], ['air_rune', 2], ['chaos_rune', 1]], 16.5, 'combat', '💧', 10),
  s('varrock_teleport', 'Varrock Teleport', 25, [['air_rune', 3], ['fire_rune', 1], ['law_rune', 1]], 35, 'teleport', '🏰'),
  s('lvl2_enchant', 'Lvl-2 Enchant', 27, [['air_rune', 3], ['cosmic_rune', 1]], 37, 'enchant', '💍'),
  s('earth_bolt', 'Earth Bolt', 29, [['earth_rune', 3], ['air_rune', 2], ['chaos_rune', 1]], 19.5, 'combat', '🪨', 11),
  s('lumbridge_teleport', 'Lumbridge Teleport', 31, [['air_rune', 3], ['earth_rune', 1], ['law_rune', 1]], 41, 'teleport', '🏰'),
  s('telekinetic_grab', 'Telekinetic Grab', 33, [['air_rune', 1], ['law_rune', 1]], 43, 'utility', '🤏'),
  s('fire_bolt', 'Fire Bolt', 35, [['fire_rune', 4], ['air_rune', 3], ['chaos_rune', 1]], 22.5, 'combat', '🔥', 12),
  s('falador_teleport', 'Falador Teleport', 37, [['air_rune', 3], ['water_rune', 1], ['law_rune', 1]], 48, 'teleport', '🏰'),
  s('crumble_undead', 'Crumble Undead', 39, [['earth_rune', 2], ['air_rune', 2], ['chaos_rune', 1]], 24.5, 'combat', '💀', 15),
  s('wind_blast', 'Wind Blast', 41, [['air_rune', 3], ['death_rune', 1]], 25.5, 'combat', '💨', 13),
  s('superheat_item', 'Superheat Item', 43, [['fire_rune', 4], ['nature_rune', 1]], 53, 'utility', '🔩'),
  s('camelot_teleport', 'Camelot Teleport', 45, [['air_rune', 5], ['law_rune', 1]], 55.5, 'teleport', '🏰'),
  s('water_blast', 'Water Blast', 47, [['water_rune', 3], ['air_rune', 3], ['death_rune', 1]], 28.5, 'combat', '💧', 14),
  s('lvl3_enchant', 'Lvl-3 Enchant', 49, [['fire_rune', 5], ['cosmic_rune', 1]], 59, 'enchant', '💍'),
  s('snare', 'Snare', 50, [['water_rune', 4], ['earth_rune', 4], ['nature_rune', 3]], 60, 'combat', '⛓️'),
  s('earth_blast', 'Earth Blast', 53, [['earth_rune', 4], ['air_rune', 3], ['death_rune', 1]], 31.5, 'combat', '🪨', 15),
  s('high_alchemy', 'High Level Alchemy', 55, [['fire_rune', 5], ['nature_rune', 1]], 65, 'utility', '🪙'),
  s('lvl4_enchant', 'Lvl-4 Enchant', 57, [['earth_rune', 10], ['cosmic_rune', 1]], 67, 'enchant', '💍'),
  s('fire_blast', 'Fire Blast', 59, [['fire_rune', 5], ['air_rune', 4], ['death_rune', 1]], 34.5, 'combat', '🔥', 16),
  s('wind_wave', 'Wind Wave', 62, [['air_rune', 5], ['blood_rune', 1]], 36, 'combat', '💨', 17),
  s('water_wave', 'Water Wave', 65, [['water_rune', 7], ['air_rune', 5], ['blood_rune', 1]], 37.5, 'combat', '💧', 18),
  s('earth_wave', 'Earth Wave', 70, [['earth_rune', 7], ['air_rune', 5], ['blood_rune', 1]], 40, 'combat', '🪨', 19),
  s('fire_wave', 'Fire Wave', 75, [['fire_rune', 7], ['air_rune', 5], ['blood_rune', 1]], 42.5, 'combat', '🔥', 20),
  s('entangle', 'Entangle', 79, [['water_rune', 5], ['earth_rune', 5], ['nature_rune', 4]], 89, 'combat', '⛓️'),
  s('wind_surge', 'Wind Surge', 81, [['air_rune', 7], ['wrath_rune', 1]], 44.5, 'combat', '💨', 21),
  s('water_surge', 'Water Surge', 85, [['water_rune', 10], ['air_rune', 7], ['wrath_rune', 1]], 46.5, 'combat', '💧', 22),
  s('earth_surge', 'Earth Surge', 90, [['earth_rune', 10], ['air_rune', 7], ['wrath_rune', 1]], 48.5, 'combat', '🪨', 23),
  s('fire_surge', 'Fire Surge', 95, [['fire_rune', 10], ['air_rune', 7], ['wrath_rune', 1]], 50.5, 'combat', '🔥', 24),
];

/** Display names for rune ids that aren't (yet) items in the registry. */
export const RUNE_NAMES: Record<string, string> = {
  air_rune: 'Air',
  water_rune: 'Water',
  earth_rune: 'Earth',
  fire_rune: 'Fire',
  mind_rune: 'Mind',
  body_rune: 'Body',
  cosmic_rune: 'Cosmic',
  chaos_rune: 'Chaos',
  nature_rune: 'Nature',
  law_rune: 'Law',
  death_rune: 'Death',
  blood_rune: 'Blood',
  wrath_rune: 'Wrath',
};
