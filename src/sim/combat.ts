import { SkillId } from './Skills';

/**
 * Old School RuneScape melee combat maths, kept as pure functions over a
 * {@link CombatProfile} so the same code resolves a player swing and an NPC's
 * retaliation. Numbers (effective-level +8, style bonuses +3/+1, prayer
 * multipliers, the /640 max-hit divisor, the accuracy curve) follow the
 * published OSRS formulas; we tune balance by feeding different profiles, not
 * by changing these.
 */

export type AttackStyle = 'accurate' | 'aggressive' | 'defensive' | 'controlled';

/** The attack-style sets weapons expose, mirroring OSRS combat-tab layouts. */
export type WeaponType = 'unarmed' | 'scimitar' | 'axe' | 'pickaxe';

export interface StyleOption {
  /** Button label ("Chop", "Slash", "Punch"...). */
  readonly name: string;
  readonly style: AttackStyle;
}

export const WEAPON_STYLES: Record<WeaponType, readonly StyleOption[]> = {
  unarmed: [
    { name: 'Punch', style: 'accurate' },
    { name: 'Kick', style: 'aggressive' },
    { name: 'Block', style: 'defensive' },
  ],
  scimitar: [
    { name: 'Chop', style: 'accurate' },
    { name: 'Slash', style: 'aggressive' },
    { name: 'Lunge', style: 'controlled' },
    { name: 'Block', style: 'defensive' },
  ],
  axe: [
    { name: 'Chop', style: 'accurate' },
    { name: 'Hack', style: 'aggressive' },
    { name: 'Block', style: 'defensive' },
  ],
  pickaxe: [
    { name: 'Spike', style: 'accurate' },
    { name: 'Impale', style: 'aggressive' },
    { name: 'Block', style: 'defensive' },
  ],
};

export interface CombatProfile {
  attack: number;
  strength: number;
  defense: number;
  /** Equipment bonuses (summed across worn gear). */
  attackBonus: number;
  strengthBonus: number;
  defenseBonus: number;
  style: AttackStyle;
  /**
   * Prayer multipliers on the base levels (1.0 = no prayer). Applied before
   * the style bonus and the +8, exactly as OSRS computes effective levels.
   */
  prayerAttack?: number;
  prayerStrength?: number;
  prayerDefense?: number;
}

/**
 * The OSRS combat level: defence, hitpoints, and half of prayer weigh in at a
 * quarter each, plus 0.325 × whichever is largest of attack+strength, 1.5 ×
 * ranged, or 1.5 × magic. A goblin lands on 2, a fresh player on 3, and a
 * maxed melee account on 126.
 */
export function combatLevel(
  attack: number,
  strength: number,
  defense: number,
  hitpoints: number,
  prayer = 0,
  ranged = 1,
  magic = 1,
): number {
  const base = 0.25 * (defense + hitpoints + Math.floor(prayer / 2));
  const melee = 0.325 * (attack + strength);
  const range = 0.325 * Math.floor((ranged * 3) / 2);
  const mage = 0.325 * Math.floor((magic * 3) / 2);
  return Math.max(1, Math.floor(base + Math.max(melee, range, mage)));
}

/** The skills an attack trains with a given style (controlled trains three). */
export function styleSkills(style: AttackStyle): readonly SkillId[] {
  if (style === 'aggressive') return ['strength'];
  if (style === 'defensive') return ['defense'];
  if (style === 'controlled') return ['attack', 'strength', 'defense'];
  return ['attack'];
}

function styleBonus(style: AttackStyle, wants: AttackStyle): number {
  if (style === wants) return 3;
  if (style === 'controlled') return 1;
  return 0;
}

function effective(level: number, prayerMult: number | undefined, bonus: number): number {
  return Math.floor(level * (prayerMult ?? 1)) + bonus + 8;
}

/** Highest damage a single hit can roll. */
export function maxHit(p: CombatProfile): number {
  const eff = effective(p.strength, p.prayerStrength, styleBonus(p.style, 'aggressive'));
  return Math.floor(0.5 + (eff * (p.strengthBonus + 64)) / 640);
}

function attackRoll(p: CombatProfile): number {
  const eff = effective(p.attack, p.prayerAttack, styleBonus(p.style, 'accurate'));
  return eff * (p.attackBonus + 64);
}

function defenseRoll(p: CombatProfile): number {
  const eff = effective(p.defense, p.prayerDefense, styleBonus(p.style, 'defensive'));
  return eff * (p.defenseBonus + 64);
}

/** Probability in [0, 1] that an attack lands against a defender. */
export function hitChance(attacker: CombatProfile, defender: CombatProfile): number {
  const a = attackRoll(attacker);
  const d = defenseRoll(defender);
  return a > d ? 1 - (d + 2) / (2 * (a + 1)) : a / (2 * (d + 1));
}

/**
 * Resolve a single attack. First an accuracy roll; on a hit, damage is uniform
 * over 0..maxHit (a landed hit can still be a 0 in OSRS). `rng` returns [0, 1).
 */
export function rollDamage(attacker: CombatProfile, defender: CombatProfile, rng: () => number): number {
  if (rng() >= hitChance(attacker, defender)) return 0;
  return Math.floor(rng() * (maxHit(attacker) + 1));
}
