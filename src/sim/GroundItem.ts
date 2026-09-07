import { ItemStack } from './items';
import { Tile } from './coords';

/** An item stack lying on the ground, waiting to be picked up (or despawn). */
export interface GroundItem {
  readonly id: number;
  readonly item: ItemStack;
  readonly tile: Tile;
  /** Tick at which this item vanishes from the world. */
  readonly despawnAtTick: number;
}

/** How long a dropped item lasts on the ground: 2 minutes of game ticks. */
export const GROUND_ITEM_TTL = 200;
