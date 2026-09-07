import { SkillId } from './Skills';
import { Tile } from './coords';

/** The kinds of gatherable resource node in the world. */
export type ResourceKind = 'tree' | 'rock' | 'fishing_spot';

/**
 * A gatherable world object: a tree to chop, a rock to mine, a fishing spot to
 * net. Nodes live in the {@link World} keyed by id; trees and rocks deplete on
 * harvest and regrow after a timer, while fishing spots never deplete but
 * wander between candidate tiles like OSRS spots do. The prop on the tile is
 * purely visual — the render layer watches `regrowTimer` to swap in a stump.
 */
export interface ResourceNode {
  readonly id: number;
  readonly kind: ResourceKind;
  /** Mutable because fishing spots relocate; trees and rocks never move. */
  tile: Tile;
  /** Ticks until a depleted node regrows; 0 means it is harvestable. */
  regrowTimer: number;
  /** Fishing spots: the tiles this spot wanders between. */
  candidates?: readonly Tile[];
  /** Fishing spots: ticks until the spot next moves. */
  moveTimer?: number;
}

/** One thing a node can yield, gated by level. Listed best-first per node. */
export interface ResourceYield {
  readonly itemId: string;
  readonly level: number;
  readonly xp: number;
  /**
   * Success roll bounds out of 256 at levels 1 and 99 — the OSRS "low/high"
   * pair that {@link interpolateChance} stretches a line between.
   */
  readonly low: number;
  readonly high: number;
}

export interface ResourceDef {
  readonly skill: SkillId;
  /** Ticks between harvest rolls — OSRS trees roll every 4, nets every 5. */
  readonly cadence: number;
  readonly yields: readonly ResourceYield[];
  /** Ticks the node stays depleted after a harvest; 0 = never depletes. */
  readonly regrowTicks: number;
  /** Tool family required in the backpack (or wielded). */
  readonly tool: 'axe' | 'pick' | 'net' | null;
  readonly startMsg: string;
  readonly noToolMsg: string;
}

export const RESOURCE_DEFS: Record<ResourceKind, ResourceDef> = {
  tree: {
    skill: 'woodcutting',
    cadence: 4,
    yields: [{ itemId: 'logs', level: 1, xp: 25, low: 64, high: 200 }],
    regrowTicks: 40,
    tool: 'axe',
    startMsg: 'You swing your axe at the tree.',
    noToolMsg: 'You need an axe to chop down this tree.',
  },
  rock: {
    skill: 'mining',
    // Base cadence for a bronze pick; better picks shave ticks off (OSRS picks
    // swing on an 8/7/6... cycle).
    cadence: 8,
    yields: [{ itemId: 'copper_ore', level: 1, xp: 17.5, low: 64, high: 200 }],
    regrowTicks: 8,
    tool: 'pick',
    startMsg: 'You swing your pick at the rock.',
    noToolMsg: 'You need a pickaxe to mine this rock.',
  },
  fishing_spot: {
    skill: 'fishing',
    cadence: 5,
    yields: [
      { itemId: 'raw_anchovies', level: 15, xp: 40, low: 24, high: 192 },
      { itemId: 'raw_shrimps', level: 1, xp: 10, low: 48, high: 256 },
    ],
    regrowTicks: 0,
    tool: 'net',
    startMsg: 'You cast out your net...',
    noToolMsg: 'You need a small fishing net to fish here.',
  },
};

/**
 * The OSRS skilling success curve: a straight line between a `low`/256 chance
 * at level 1 and `high`/256 at level 99, clamped to [0, 1]. `high` above 256
 * simply means the roll caps out before 99 (firemaking logs hit 100% at 43).
 */
export function interpolateChance(low: number, high: number, level: number): number {
  const roll = (low * (99 - level) + high * (level - 1)) / 98;
  return Math.min(1, Math.max(0, roll / 256));
}
