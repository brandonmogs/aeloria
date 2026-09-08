import { SkillId } from './Skills';
import { Tile } from './coords';

/** The kinds of gatherable resource node in the world. */
export type ResourceKind = 'tree' | 'rock' | 'fishing_spot';

/** How a fishing spot is worked: a small net, or a rod with bait. */
export type FishingMethod = 'net' | 'bait';

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
  /** Which tree / ore this is ("oak", "tin"); fishing spots use the method instead. */
  readonly variant: string;
  /** Mutable because fishing spots relocate; trees and rocks never move. */
  tile: Tile;
  /** Ticks until a depleted node regrows; 0 means it is harvestable. */
  regrowTimer: number;
  /** Fishing spots: the tiles this spot wanders between. */
  candidates?: readonly Tile[];
  /** Fishing spots: ticks until the spot next moves. */
  moveTimer?: number;
}

/** One thing a node can yield, gated by level. Listed best-first per variant. */
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

export interface ResourceVariant {
  /** Display name ("Oak", "Tin rocks"). */
  readonly name: string;
  /** Level to work it at all. */
  readonly level: number;
  readonly yields: readonly ResourceYield[];
  /** Ticks the node stays depleted after a harvest; 0 = never depletes. */
  readonly regrowTicks: number;
  /** Chance a successful harvest depletes the node (1 = always, like regular trees). */
  readonly depleteChance: number;
  readonly examine: string;
}

export interface ResourceDef {
  readonly skill: SkillId;
  /** Ticks between harvest rolls — OSRS trees roll every 4, nets every 5. */
  readonly cadence: number;
  /** Tool family required in the backpack (or wielded). */
  readonly tool: 'axe' | 'pick' | 'net' | null;
  readonly variants: Readonly<Record<string, ResourceVariant>>;
  readonly noToolMsg: string;
}

export const RESOURCE_DEFS: Record<ResourceKind, ResourceDef> = {
  tree: {
    skill: 'woodcutting',
    cadence: 4,
    tool: 'axe',
    noToolMsg: 'You need an axe to chop down this tree.',
    variants: {
      regular: {
        name: 'Tree',
        level: 1,
        yields: [{ itemId: 'logs', level: 1, xp: 25, low: 64, high: 200 }],
        regrowTicks: 40,
        depleteChance: 1,
        examine: 'A leafy tree, good for logs.',
      },
      oak: {
        name: 'Oak',
        level: 15,
        yields: [{ itemId: 'oak_logs', level: 15, xp: 37.5, low: 32, high: 100 }],
        regrowTicks: 14,
        depleteChance: 1 / 8,
        examine: 'A grand old oak tree.',
      },
      willow: {
        name: 'Willow',
        level: 30,
        yields: [{ itemId: 'willow_logs', level: 30, xp: 67.5, low: 16, high: 50 }],
        regrowTicks: 14,
        depleteChance: 1 / 8,
        examine: 'A weeping willow, trailing its branches in the moat.',
      },
    },
  },
  rock: {
    skill: 'mining',
    // Base cadence for a bronze pick; better picks shave ticks off (OSRS picks
    // swing on an 8/7/6... cycle).
    cadence: 8,
    tool: 'pick',
    noToolMsg: 'You need a pickaxe to mine this rock.',
    variants: {
      copper: {
        name: 'Copper rocks',
        level: 1,
        yields: [{ itemId: 'copper_ore', level: 1, xp: 17.5, low: 64, high: 200 }],
        regrowTicks: 8,
        depleteChance: 1,
        examine: 'A rocky outcrop with a seam of copper.',
      },
      tin: {
        name: 'Tin rocks',
        level: 1,
        yields: [{ itemId: 'tin_ore', level: 1, xp: 17.5, low: 64, high: 200 }],
        regrowTicks: 8,
        depleteChance: 1,
        examine: 'A rocky outcrop with a seam of tin.',
      },
      iron: {
        name: 'Iron rocks',
        level: 15,
        yields: [{ itemId: 'iron_ore', level: 15, xp: 35, low: 32, high: 100 }],
        regrowTicks: 9,
        depleteChance: 1,
        examine: 'A rocky outcrop with a seam of iron.',
      },
    },
  },
  fishing_spot: {
    skill: 'fishing',
    cadence: 5,
    tool: 'net',
    noToolMsg: 'You need a small fishing net to fish here.',
    variants: {
      net: {
        name: 'Fishing spot',
        level: 1,
        yields: [
          { itemId: 'raw_anchovies', level: 15, xp: 40, low: 24, high: 192 },
          { itemId: 'raw_shrimps', level: 1, xp: 10, low: 48, high: 256 },
        ],
        regrowTicks: 0,
        depleteChance: 0,
        examine: 'Something is stirring beneath the surface.',
      },
      bait: {
        name: 'Fishing spot',
        level: 5,
        yields: [
          { itemId: 'raw_herring', level: 10, xp: 30, low: 32, high: 192 },
          { itemId: 'raw_sardine', level: 5, xp: 20, low: 40, high: 224 },
        ],
        regrowTicks: 0,
        depleteChance: 0,
        examine: 'Something is stirring beneath the surface.',
      },
    },
  },
};

/** The variant a node is worked as (fishing spots pick by method). */
export function variantOf(node: ResourceNode, method: FishingMethod = 'net'): ResourceVariant {
  const def = RESOURCE_DEFS[node.kind];
  const key = node.kind === 'fishing_spot' ? method : node.variant;
  return def.variants[key] ?? def.variants[Object.keys(def.variants)[0]];
}

/**
 * The OSRS skilling success curve: a straight line between a `low`/256 chance
 * at level 1 and `high`/256 at level 99, clamped to [0, 1]. `high` above 256
 * simply means the roll caps out before 99 (firemaking logs hit 100% at 43).
 */
export function interpolateChance(low: number, high: number, level: number): number {
  const roll = (low * (99 - level) + high * (level - 1)) / 98;
  return Math.min(1, Math.max(0, roll / 256));
}
