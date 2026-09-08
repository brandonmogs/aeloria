import { Tile } from './coords';

/**
 * Something food can be cooked on. A player-lit fire doesn't block movement
 * and burns down to ashes at `expiresAtTick` (fire lifetimes are deliberately
 * unpredictable, like OSRS). A range is a permanent fixture that never goes
 * out and burns food less often.
 */
export interface Fire {
  readonly id: number;
  readonly tile: Tile;
  readonly kind: 'fire' | 'range';
  readonly expiresAtTick: number;
}
