/**
 * A character's skills: experience points per skill, with levels derived from
 * the classic RuneScape XP curve. Like {@link Inventory}, this is pure
 * simulation state — no UI — so it can move to an authoritative server later.
 *
 * Only the starting set is modelled for now (combat skills). More slot in by
 * extending {@link SkillId} and {@link SKILL_IDS}.
 */
export type SkillId =
  | 'attack'
  | 'strength'
  | 'defense'
  | 'hitpoints'
  | 'range'
  | 'magic'
  | 'woodcutting'
  | 'mining';

/** Display/storage order. */
export const SKILL_IDS: readonly SkillId[] = [
  'attack',
  'strength',
  'defense',
  'hitpoints',
  'range',
  'magic',
  'woodcutting',
  'mining',
];

export const MAX_LEVEL = 99;

// The RuneScape XP table: cumulative experience required to reach each level.
// XP_TABLE[L] is the total XP needed for level L (so level 1 = 0).
const XP_TABLE = ((): number[] => {
  const table: number[] = [0, 0];
  let sum = 0;
  for (let x = 1; x < MAX_LEVEL; x++) {
    sum += Math.floor(x + 300 * Math.pow(2, x / 7));
    table[x + 1] = Math.floor(sum / 4);
  }
  return table;
})();

/** Total XP required to reach `level` (clamped to 1..MAX_LEVEL). */
export function xpForLevel(level: number): number {
  return XP_TABLE[Math.max(1, Math.min(MAX_LEVEL, level))];
}

/** The level a given XP total corresponds to. */
export function levelForXp(xp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && XP_TABLE[level + 1] <= xp) level++;
  return level;
}

export class Skills {
  // Hitpoints starts at level 10 like OSRS; everything else at level 1.
  private readonly xp: Record<SkillId, number> = {
    attack: 0,
    strength: 0,
    defense: 0,
    hitpoints: xpForLevel(10),
    range: 0,
    magic: 0,
    woodcutting: 0,
    mining: 0,
  };

  xpOf(id: SkillId): number {
    return this.xp[id];
  }

  levelOf(id: SkillId): number {
    return levelForXp(this.xp[id]);
  }

  /** Award experience, capped at the XP for the max level. Returns levels gained. */
  addXp(id: SkillId, amount: number): number {
    const before = this.levelOf(id);
    this.xp[id] = Math.min(this.xp[id] + amount, xpForLevel(MAX_LEVEL));
    return this.levelOf(id) - before;
  }

  /** Sum of every skill's level — the headline "total level". */
  totalLevel(): number {
    return SKILL_IDS.reduce((sum, id) => sum + this.levelOf(id), 0);
  }

  /** Progress through the current level toward the next, 0..1 (1 if maxed). */
  progressOf(id: SkillId): number {
    const level = this.levelOf(id);
    if (level >= MAX_LEVEL) return 1;
    const base = xpForLevel(level);
    const next = xpForLevel(level + 1);
    return (this.xp[id] - base) / (next - base);
  }

  /** True once every skill is at the max level — the max-cape condition. */
  isMaxed(): boolean {
    return SKILL_IDS.every((id) => this.levelOf(id) >= MAX_LEVEL);
  }
}
