/**
 * A character's skills: experience points per skill, with levels derived from
 * the RuneScape XP curve. Like {@link Inventory}, this is pure simulation
 * state — no UI — so it can move to an authoritative server later.
 *
 * All twenty-three Old School skills are here even though only some are
 * trainable in Aeloria so far: the stats tab, the total level, and the skill
 * guides are the real thing, and content just has to catch up.
 */
export type SkillId =
  | 'attack'
  | 'hitpoints'
  | 'mining'
  | 'strength'
  | 'agility'
  | 'smithing'
  | 'defense'
  | 'herblore'
  | 'fishing'
  | 'range'
  | 'thieving'
  | 'cooking'
  | 'prayer'
  | 'crafting'
  | 'firemaking'
  | 'magic'
  | 'fletching'
  | 'woodcutting'
  | 'runecraft'
  | 'slayer'
  | 'farming'
  | 'construction'
  | 'hunter';

/**
 * Display/storage order: the OSRS stats tab, read row by row across its
 * three columns (Attack, Hitpoints, Mining / Strength, Agility, Smithing / …).
 */
export const SKILL_IDS: readonly SkillId[] = [
  'attack',
  'hitpoints',
  'mining',
  'strength',
  'agility',
  'smithing',
  'defense',
  'herblore',
  'fishing',
  'range',
  'thieving',
  'cooking',
  'prayer',
  'crafting',
  'firemaking',
  'magic',
  'fletching',
  'woodcutting',
  'runecraft',
  'slayer',
  'farming',
  'construction',
  'hunter',
];

export const MAX_LEVEL = 99;

/** The most experience a skill can hold — 200 million, as in OSRS. */
export const MAX_XP = 200_000_000;

// The RuneScape XP table: cumulative experience required to reach each level.
// XP_TABLE[L] is the total XP needed for level L (so level 1 = 0, level 2 = 83,
// level 99 = 13,034,431) — the wiki's formula, floor(¼ Σ floor(ℓ + 300·2^(ℓ/7))).
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
  private readonly xp: Record<SkillId, number> = Object.fromEntries(
    SKILL_IDS.map((id) => [id, id === 'hitpoints' ? xpForLevel(10) : 0]),
  ) as Record<SkillId, number>;

  xpOf(id: SkillId): number {
    return this.xp[id];
  }

  levelOf(id: SkillId): number {
    return levelForXp(this.xp[id]);
  }

  /**
   * Award experience. OSRS tracks XP in tenths of a point (4.5 for burying
   * bones, 1.33 per damage in combat), so totals are kept to one decimal and
   * capped at 200M. Returns the number of levels gained.
   */
  addXp(id: SkillId, amount: number): number {
    const before = this.levelOf(id);
    this.xp[id] = Math.min(MAX_XP, Math.round((this.xp[id] + amount) * 10) / 10);
    return this.levelOf(id) - before;
  }

  /** Sum of every skill's level — the headline "total level" (32 for a new account). */
  totalLevel(): number {
    return SKILL_IDS.reduce((sum, id) => sum + this.levelOf(id), 0);
  }

  /** Sum of every skill's experience. */
  totalXp(): number {
    return SKILL_IDS.reduce((sum, id) => sum + this.xp[id], 0);
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
