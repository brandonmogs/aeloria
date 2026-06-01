import { Tile } from './coords';

/**
 * Anything that lives on the tile grid: players, NPCs, later dropped items and
 * projectiles. An entity's authoritative state is its current tile. We also
 * keep the tile it occupied at the start of the current tick so the render
 * layer can interpolate smoothly between the two — the sim itself never reads
 * `previousPosition`.
 */
export class Entity {
  /** Current logical tile. Changes at most once (walk) or twice (run) per tick. */
  position: Tile;

  /** Tile occupied at the start of this tick. Render-only; for interpolation. */
  previousPosition: Tile;

  /** Remaining tiles to walk, in order. Empty when standing still. */
  path: Tile[] = [];

  /** When true the entity covers two tiles per tick instead of one. */
  running = false;

  constructor(
    readonly id: number,
    position: Tile,
  ) {
    this.position = position;
    this.previousPosition = position;
  }

  get isMoving(): boolean {
    return this.path.length > 0;
  }
}
