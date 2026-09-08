/**
 * The standard prayer book — all 29 prayers, in the order the OSRS prayer tab
 * lays them out, with the wiki's levels and drain rates. Effects and drain
 * follow the wiki: stat prayers multiply the base level by 1.05 / 1.10 / 1.15
 * (1.20 / 1.23 / 1.25 for Piety) before the +8, and each active prayer adds
 * its `drainEffect` to a counter every tick; whenever the counter passes the
 * player's drain resistance (2 × prayer bonus + 60), one point is spent. At
 * +0 prayer bonus Thick Skin costs a point every 36 seconds and Protect from
 * Melee one every 3 seconds — exactly OSRS.
 *
 * Melee is the only combat style in Aeloria so far, so the ranged and magic
 * prayers drain but have nothing to boost yet; overheads other than Protect
 * from Melee are likewise inert until their triggers exist.
 */

export type PrayerGroup = 'defense' | 'strength' | 'attack' | 'ranged' | 'magic' | 'overhead' | 'other';

export interface PrayerDef {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  /** Prayer level required. */
  readonly level: number;
  /** Defence level required (Chivalry, Piety). */
  readonly defenceLevel?: number;
  /** Added to the drain counter each tick while active. */
  readonly drainEffect: number;
  /** Prayers sharing a group replace each other; combos list several. */
  readonly groups: readonly PrayerGroup[];
  /** Multipliers applied to boosted skills' base levels. */
  readonly boosts?: Readonly<Partial<Record<'attack' | 'strength' | 'defense', number>>>;
  /** Overhead: fully blocks melee damage from NPCs. */
  readonly protectMelee?: boolean;
  /** Doubles natural hitpoint regeneration (Rapid Heal). */
  readonly rapidHeal?: boolean;
  /** Keep one extra item on death (Protect Item). */
  readonly protectItem?: boolean;
  readonly description: string;
}

const p = (
  id: string,
  name: string,
  icon: string,
  level: number,
  drainEffect: number,
  groups: readonly PrayerGroup[],
  description: string,
  extra: Partial<PrayerDef> = {},
): PrayerDef => ({ id, name, icon, level, drainEffect, groups, description, ...extra });

/** Drain effects: 1 pt/36s = 1, 1 pt/18s = 2, 1 pt/12s = 3, 1 pt/6s = 6, 1 pt/3s = 12, 1 pt/2s = 18, 1 pt/1.5s = 24. */
export const PRAYERS: readonly PrayerDef[] = [
  p('thick_skin', 'Thick Skin', '🛡️', 1, 1, ['defense'], '+5% Defence', { boosts: { defense: 1.05 } }),
  p('burst_of_strength', 'Burst of Strength', '💪', 4, 1, ['strength'], '+5% Strength', { boosts: { strength: 1.05 } }),
  p('clarity_of_thought', 'Clarity of Thought', '🎯', 7, 1, ['attack'], '+5% Attack', { boosts: { attack: 1.05 } }),
  p('sharp_eye', 'Sharp Eye', '👁️', 8, 1, ['ranged'], '+5% Ranged'),
  p('mystic_will', 'Mystic Will', '🔮', 9, 1, ['magic'], '+5% Magic'),
  p('rock_skin', 'Rock Skin', '🪨', 10, 6, ['defense'], '+10% Defence', { boosts: { defense: 1.1 } }),
  p('superhuman_strength', 'Superhuman Strength', '🦾', 13, 6, ['strength'], '+10% Strength', { boosts: { strength: 1.1 } }),
  p('improved_reflexes', 'Improved Reflexes', '⚡', 16, 6, ['attack'], '+10% Attack', { boosts: { attack: 1.1 } }),
  p('rapid_restore', 'Rapid Restore', '♻️', 19, 1, ['other'], '2× restore rate for all stats except Hitpoints and Prayer'),
  p('rapid_heal', 'Rapid Heal', '💗', 22, 2, ['other'], '2× restore rate for Hitpoints', { rapidHeal: true }),
  p('protect_item', 'Protect Item', '📦', 25, 2, ['other'], 'Keep 1 extra item if you die', { protectItem: true }),
  p('hawk_eye', 'Hawk Eye', '🦅', 26, 6, ['ranged'], '+10% Ranged'),
  p('mystic_lore', 'Mystic Lore', '📖', 27, 6, ['magic'], '+10% Magic'),
  p('steel_skin', 'Steel Skin', '🔩', 28, 12, ['defense'], '+15% Defence', { boosts: { defense: 1.15 } }),
  p('ultimate_strength', 'Ultimate Strength', '🏋️', 31, 12, ['strength'], '+15% Strength', { boosts: { strength: 1.15 } }),
  p('incredible_reflexes', 'Incredible Reflexes', '🌩️', 34, 12, ['attack'], '+15% Attack', { boosts: { attack: 1.15 } }),
  p('protect_from_magic', 'Protect from Magic', '🔵', 37, 12, ['overhead'], 'Protection from magical attacks'),
  p('protect_from_missiles', 'Protect from Missiles', '🟢', 40, 12, ['overhead'], 'Protection from ranged attacks'),
  p('protect_from_melee', 'Protect from Melee', '⚔️', 43, 12, ['overhead'], 'Protection from melee attacks', { protectMelee: true }),
  p('eagle_eye', 'Eagle Eye', '🦅', 44, 12, ['ranged'], '+15% Ranged'),
  p('mystic_might', 'Mystic Might', '🌀', 45, 12, ['magic'], '+15% Magic'),
  p('retribution', 'Retribution', '💥', 46, 3, ['overhead'], 'Inflicts damage to nearby targets if you die'),
  p('redemption', 'Redemption', '💖', 49, 6, ['overhead'], 'Heals you when your health falls below 10%'),
  p('smite', 'Smite', '🗲', 52, 18, ['overhead'], "1/4 of damage dealt is also removed from the opponent's Prayer"),
  p('preserve', 'Preserve', '⏳', 55, 2, ['other'], 'Boosted stats last 50% longer'),
  p('chivalry', 'Chivalry', '🐎', 60, 12, ['defense', 'strength', 'attack'], '+15% Attack, +18% Strength, +20% Defence', {
    defenceLevel: 65,
    boosts: { attack: 1.15, strength: 1.18, defense: 1.2 },
  }),
  p('piety', 'Piety', '🙏', 70, 24, ['defense', 'strength', 'attack'], '+20% Attack, +23% Strength, +25% Defence', {
    defenceLevel: 70,
    boosts: { attack: 1.2, strength: 1.23, defense: 1.25 },
  }),
  p('rigour', 'Rigour', '🏹', 74, 24, ['ranged', 'defense'], '+20% Ranged, +23% Ranged Strength, +25% Defence', {
    defenceLevel: 70,
    boosts: { defense: 1.25 },
  }),
  p('augury', 'Augury', '🔯', 77, 24, ['magic', 'defense'], '+25% Magic, +25% Defence', {
    defenceLevel: 70,
    boosts: { defense: 1.25 },
  }),
];

export function prayerDef(id: string): PrayerDef {
  const def = PRAYERS.find((p) => p.id === id);
  if (!def) throw new Error(`Unknown prayer id: ${id}`);
  return def;
}
