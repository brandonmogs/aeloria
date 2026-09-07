/**
 * The prayer book — the classic low-level OSRS lineup. Effects and drain rates
 * follow the wiki: stat prayers multiply the base level by 1.05/1.10 before
 * the +8, and each active prayer adds its `drainEffect` to a counter every
 * tick; whenever the counter passes the player's drain resistance
 * (2 × prayer bonus + 60), one prayer point is spent. At +0 prayer bonus that
 * works out to Thick Skin costing a point every 36 seconds and Protect from
 * Melee one every 3 seconds — exactly OSRS.
 */

export type PrayerGroup = 'defense' | 'strength' | 'attack' | 'overhead';

export interface PrayerDef {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  /** Prayer level required. */
  readonly level: number;
  /** Added to the drain counter each tick while active. */
  readonly drainEffect: number;
  /** Prayers in the same group toggle each other off. */
  readonly group: PrayerGroup;
  /** Multiplier applied to the boosted skill's base level. */
  readonly boost?: { readonly skill: 'attack' | 'strength' | 'defense'; readonly mult: number };
  /** Overhead: fully blocks melee damage from NPCs. */
  readonly protectMelee?: boolean;
}

export const PRAYERS: readonly PrayerDef[] = [
  { id: 'thick_skin', name: 'Thick Skin', icon: '🛡️', level: 1, drainEffect: 1, group: 'defense', boost: { skill: 'defense', mult: 1.05 } },
  { id: 'burst_of_strength', name: 'Burst of Strength', icon: '💪', level: 4, drainEffect: 1, group: 'strength', boost: { skill: 'strength', mult: 1.05 } },
  { id: 'clarity_of_thought', name: 'Clarity of Thought', icon: '🎯', level: 7, drainEffect: 1, group: 'attack', boost: { skill: 'attack', mult: 1.05 } },
  { id: 'rock_skin', name: 'Rock Skin', icon: '🪨', level: 10, drainEffect: 6, group: 'defense', boost: { skill: 'defense', mult: 1.1 } },
  { id: 'superhuman_strength', name: 'Superhuman Strength', icon: '🦾', level: 13, drainEffect: 6, group: 'strength', boost: { skill: 'strength', mult: 1.1 } },
  { id: 'improved_reflexes', name: 'Improved Reflexes', icon: '⚡', level: 16, drainEffect: 6, group: 'attack', boost: { skill: 'attack', mult: 1.1 } },
  { id: 'protect_from_melee', name: 'Protect from Melee', icon: '⚔️', level: 43, drainEffect: 12, group: 'overhead', protectMelee: true },
];

export function prayerDef(id: string): PrayerDef {
  const def = PRAYERS.find((p) => p.id === id);
  if (!def) throw new Error(`Unknown prayer id: ${id}`);
  return def;
}
