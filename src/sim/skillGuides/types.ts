import type { SkillId } from '../Skills';

/**
 * One line of a skill guide: "Level N — you can now …". Mirrors the in-game
 * OSRS skill guide (the window that opens when you click a skill on the stats
 * tab), whose data the OSRS Wiki publishes as each skill's "Level up table".
 */
export interface SkillGuideEntry {
  /** Level at which this unlocks (1..99). */
  readonly level: number;
  /** What unlocks, in the wiki/in-game wording ("Chop oak logs"). */
  readonly text: string;
  /** Guide sub-tab this belongs to ("Trees", "Axes", "Weapons"…). */
  readonly category: string;
  /** True for members-only content on OSRS; shown dimmed in the guide. */
  readonly members?: boolean;
}

export interface SkillGuide {
  readonly skill: SkillId;
  /** Sub-tab names in display order; entries are grouped under these. */
  readonly categories: readonly string[];
  /** Every unlock, sorted by level (stable within a level). */
  readonly entries: readonly SkillGuideEntry[];
}
