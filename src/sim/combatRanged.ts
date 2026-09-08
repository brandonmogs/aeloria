import { Bonuses } from './items';

/**
 * OSRS ranged and magic maths (Wiki: "Damage per second/Ranged" and "/Magic"),
 * as pure functions so a player's arrow and a spell resolve through the same
 * accuracy curve melee uses: an attack roll against a defence roll, then a
 * uniform damage roll up to the max hit.
 */

export type RangedStyle = 'accurate' | 'rapid' | 'longrange';

export interface RangedProfile {
  ranged: number;
  bonuses: Bonuses;
  style: RangedStyle;
  prayerRanged?: number;
}

export interface MagicProfile {
  magic: number;
  bonuses: Bonuses;
  /** Autocasting through a staff gets the accurate-style +3. */
  autocast: boolean;
  prayerMagic?: number;
}

/** What a projectile is rolled against. */
export interface DefenderProfile {
  defense: number;
  magic: number;
  bonuses: Bonuses;
  prayerDefense?: number;
  /** Monsters get the documented +9 instead of a player's +8. */
  npc: boolean;
}

function effectiveRanged(p: RangedProfile): number {
  return Math.floor(p.ranged * (p.prayerRanged ?? 1)) + (p.style === 'accurate' ? 3 : 0) + 8;
}

/** Highest damage an arrow can roll: ⌊0.5 + eff × (ranged strength + 64) / 640⌋. */
export function rangedMaxHit(p: RangedProfile): number {
  return Math.floor(0.5 + (effectiveRanged(p) * (p.bonuses.rstr + 64)) / 640);
}

function rangedAttackRoll(p: RangedProfile): number {
  return effectiveRanged(p) * (p.bonuses.arange + 64);
}

function defenceRollAgainstRanged(d: DefenderProfile): number {
  const eff = Math.floor(d.defense * (d.prayerDefense ?? 1)) + (d.npc ? 9 : 8);
  return eff * (d.bonuses.drange + 64);
}

function effectiveMagic(p: MagicProfile): number {
  return Math.floor(p.magic * (p.prayerMagic ?? 1)) + (p.autocast ? 3 : 0) + 8;
}

function magicAttackRoll(p: MagicProfile): number {
  return effectiveMagic(p) * (p.bonuses.amagic + 64);
}

/**
 * Magic defence: monsters use their Magic level; players blend 70% magic
 * with 30% defence, as the wiki documents.
 */
function defenceRollAgainstMagic(d: DefenderProfile): number {
  const effDef = Math.floor(d.defense * (d.prayerDefense ?? 1)) + (d.npc ? 9 : 8);
  const eff = d.npc ? d.magic + 9 : Math.floor(0.7 * (d.magic + 8) + 0.3 * effDef);
  return eff * (d.bonuses.dmagic + 64);
}

function chance(attack: number, defence: number): number {
  return attack > defence ? 1 - (defence + 2) / (2 * (attack + 1)) : attack / (2 * (defence + 1));
}

export function rangedHitChance(a: RangedProfile, d: DefenderProfile): number {
  return chance(rangedAttackRoll(a), defenceRollAgainstRanged(d));
}

export function magicHitChance(a: MagicProfile, d: DefenderProfile): number {
  return chance(magicAttackRoll(a), defenceRollAgainstMagic(d));
}

/** A spell's max hit is fixed per spell, scaled by any magic damage bonus (%). */
export function spellMaxHit(base: number, p: MagicProfile): number {
  return Math.floor(base * (1 + p.bonuses.mdmg / 100));
}

/** Resolve a ranged attack: accuracy roll, then uniform damage over 0..max. */
export function rollRanged(a: RangedProfile, d: DefenderProfile, rng: () => number): number {
  if (rng() >= rangedHitChance(a, d)) return 0;
  return Math.floor(rng() * (rangedMaxHit(a) + 1));
}

/** Resolve a spell: a splash (0) on a failed accuracy roll, else 0..max. */
export function rollSpell(a: MagicProfile, d: DefenderProfile, baseMaxHit: number, rng: () => number): number {
  if (rng() >= magicHitChance(a, d)) return 0;
  return Math.floor(rng() * (spellMaxHit(baseMaxHit, a) + 1));
}
