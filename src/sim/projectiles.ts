import { Tile } from './coords';

/**
 * An arrow or spell in flight. OSRS rolls the hit when the projectile leaves
 * and applies it when it lands a tick or two later (further targets take
 * longer), so a projectile carries its pre-rolled damage and a landing tick.
 * The sim only cares about the landing; the render layer animates the arc.
 */
export interface Projectile {
  readonly id: number;
  readonly kind: 'arrow' | 'spell';
  /** For spells, which one (for its colour); for arrows, the ammo item id. */
  readonly itemId: string;
  readonly attackerId: number;
  readonly targetId: number;
  readonly from: Tile;
  readonly launchedAtTick: number;
  readonly landsAtTick: number;
  readonly damage: number;
}

/** Ticks a projectile spends in the air over a given distance, per OSRS. */
export function flightTicks(distance: number): number {
  return 1 + Math.floor((3 + distance) / 6);
}
