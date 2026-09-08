/**
 * Smithing, per the OSRS Wiki: smelting ores into bars at a furnace, and
 * hammering bars into gear on an anvil. Levels, bar counts, and XP are the
 * wiki's; iron smelting has its famous 50% failure chance.
 */
export interface SmeltRecipe {
  readonly bar: string;
  readonly level: number;
  readonly xp: number;
  /** Ores consumed: [itemId, count]. */
  readonly ores: ReadonlyArray<readonly [string, number]>;
  /** Chance the ore is lost with nothing to show (iron: 50%). */
  readonly failChance?: number;
}

export const SMELTING: readonly SmeltRecipe[] = [
  { bar: 'bronze_bar', level: 1, xp: 6.2, ores: [['copper_ore', 1], ['tin_ore', 1]] },
  { bar: 'iron_bar', level: 15, xp: 12.5, ores: [['iron_ore', 1]], failChance: 0.5 },
  { bar: 'steel_bar', level: 30, xp: 17.5, ores: [['iron_ore', 1], ['coal', 2]] },
];

export interface SmithRecipe {
  readonly item: string;
  readonly level: number;
  readonly bars: number;
  readonly xp: number;
}

/** What one bar type makes on the anvil, best-first per row of the OSRS menu. */
const bronze = (item: string, level: number, bars: number): SmithRecipe => ({ item: `bronze_${item}`, level, bars, xp: 12.5 * bars });
const iron = (item: string, level: number, bars: number): SmithRecipe => ({ item: `iron_${item}`, level, bars, xp: 25 * bars });
const steel = (item: string, level: number, bars: number): SmithRecipe => ({ item: `steel_${item}`, level, bars, xp: 37.5 * bars });

export const SMITHING: Record<string, readonly SmithRecipe[]> = {
  bronze_bar: [
    bronze('dagger', 1, 1),
    bronze('axe', 1, 1),
    bronze('mace', 2, 1),
    bronze('med_helm', 3, 1),
    bronze('sword', 4, 1),
    bronze('scimitar', 5, 2),
    bronze('longsword', 6, 2),
    bronze('full_helm', 7, 2),
    bronze('sq_shield', 8, 2),
    bronze('warhammer', 9, 3),
    bronze('battleaxe', 10, 3),
    bronze('chainbody', 11, 3),
    bronze('kiteshield', 12, 3),
    bronze('2h_sword', 14, 3),
    bronze('platelegs', 16, 3),
    bronze('platebody', 18, 5),
  ],
  iron_bar: [
    iron('dagger', 15, 1),
    iron('axe', 16, 1),
    iron('mace', 17, 1),
    iron('med_helm', 18, 1),
    iron('sword', 19, 1),
    iron('scimitar', 20, 2),
    iron('longsword', 21, 2),
    iron('full_helm', 22, 2),
    iron('sq_shield', 23, 2),
    iron('warhammer', 24, 3),
    iron('battleaxe', 25, 3),
    iron('chainbody', 26, 3),
    iron('kiteshield', 27, 3),
    iron('2h_sword', 29, 3),
    iron('platelegs', 31, 3),
    iron('platebody', 33, 5),
  ],
  steel_bar: [
    steel('dagger', 30, 1),
    steel('axe', 31, 1),
    steel('mace', 32, 1),
    steel('med_helm', 33, 1),
    steel('sword', 34, 1),
    steel('scimitar', 35, 2),
    steel('longsword', 36, 2),
    steel('full_helm', 37, 2),
    steel('sq_shield', 38, 2),
    steel('warhammer', 39, 3),
    steel('battleaxe', 40, 3),
    steel('chainbody', 41, 3),
    steel('kiteshield', 42, 3),
    steel('2h_sword', 44, 3),
    steel('platelegs', 46, 3),
    steel('platebody', 48, 5),
  ],
};
