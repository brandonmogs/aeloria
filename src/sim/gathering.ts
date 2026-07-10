import { Item } from './Inventory';
import { SkillId } from './Skills';
import { Tile } from './coords';

/** The kinds of gatherable resource node in the world. */
export type ResourceKind = 'tree' | 'rock';

/**
 * A gatherable world object: a tree that can be chopped, a rock that can be
 * mined. Nodes live in the {@link World} keyed by id; when harvested they
 * deplete and regrow after a timer, OSRS-style. The prop on the same tile is
 * purely visual — the render layer watches `regrowTimer` to swap in a stump.
 */
export interface ResourceNode {
  readonly id: number;
  readonly kind: ResourceKind;
  readonly tile: Tile;
  /** Ticks until a depleted node regrows; 0 means it is harvestable. */
  regrowTimer: number;
}

export interface ResourceDef {
  readonly skill: SkillId;
  readonly xp: number;
  readonly item: Item;
  /** Ticks the node stays depleted after a successful harvest. */
  readonly regrowTicks: number;
  /** Base per-attempt success chance; grows with level. */
  readonly baseChance: number;
  readonly startMsg: string;
  readonly successMsg: string;
}

export const RESOURCE_DEFS: Record<ResourceKind, ResourceDef> = {
  tree: {
    skill: 'woodcutting',
    xp: 25,
    item: { id: 'logs', name: 'Logs', icon: '🪵' },
    regrowTicks: 40,
    baseChance: 0.3,
    startMsg: 'You swing your axe at the tree.',
    successMsg: 'You get some logs.',
  },
  rock: {
    skill: 'mining',
    xp: 17.5,
    item: { id: 'copper_ore', name: 'Copper ore', icon: '🥉' },
    regrowTicks: 25,
    baseChance: 0.3,
    startMsg: 'You swing your pick at the rock.',
    successMsg: 'You manage to mine some copper ore.',
  },
};

/** Per-attempt success chance at a given skill level. */
export function gatherChance(def: ResourceDef, level: number): number {
  return Math.min(0.85, def.baseChance + level * 0.012);
}
