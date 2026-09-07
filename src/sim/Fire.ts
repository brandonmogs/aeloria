import { Tile } from './coords';

/**
 * A player-lit fire. It doesn't block movement; food can be cooked on it until
 * it burns down to ashes at `expiresAtTick` (fire lifetimes are deliberately
 * unpredictable, like OSRS).
 */
export interface Fire {
  readonly id: number;
  readonly tile: Tile;
  readonly expiresAtTick: number;
}
