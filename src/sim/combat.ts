/**
 * Old School RuneScape melee combat maths, kept as pure functions over a
 * {@link CombatProfile} so the same code resolves a player swing and an NPC's
 * retaliation. Numbers (effective-level +8, style +3, the /640 max-hit divisor,
 * the accuracy curve) follow the published OSRS formulas; we'll tune balance
 * later by feeding different profiles, not by changing these.
 */

export type AttackStyle = 'accurate' | 'aggressive' | 'defensive';

export interface CombatProfile {
  attack: number;
  strength: number;
  defense: number;
  /** Equipment bonuses (summed across worn gear). */
  attackBonus: number;
  strengthBonus: number;
  defenseBonus: number;
  style: AttackStyle;
}

/**
 * A simplified OSRS combat level: defence and hitpoints weigh in at a quarter
 * each, attack and strength together at 0.325. Matches the classic numbers for
 * low-level monsters (a goblin lands on 2).
 */
export function combatLevel(attack: number, strength: number, defense: number, hitpoints: number): number {
  return Math.max(1, Math.floor(0.25 * (defense + hitpoints) + 0.325 * (attack + strength)));
}

/** The skill an attack trains, given its style (controlled/shared XP comes later). */
export function styleSkill(style: AttackStyle): 'attack' | 'strength' | 'defense' {
  if (style === 'aggressive') return 'strength';
  if (style === 'defensive') return 'defense';
  return 'attack';
}

/** Highest damage a single hit can roll. */
export function maxHit(p: CombatProfile): number {
  const styleBonus = p.style === 'aggressive' ? 3 : 0;
  const effectiveStrength = p.strength + styleBonus + 8;
  return Math.floor(0.5 + (effectiveStrength * (p.strengthBonus + 64)) / 640);
}

function attackRoll(p: CombatProfile): number {
  const styleBonus = p.style === 'accurate' ? 3 : 0;
  const effective = p.attack + styleBonus + 8;
  return effective * (p.attackBonus + 64);
}

function defenseRoll(p: CombatProfile): number {
  const styleBonus = p.style === 'defensive' ? 3 : 0;
  const effective = p.defense + styleBonus + 8;
  return effective * (p.defenseBonus + 64);
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
