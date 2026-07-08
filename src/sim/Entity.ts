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

  // --- Combat state --------------------------------------------------------
  /** Current and maximum hitpoints. */
  hitpoints = 10;
  maxHitpoints = 10;

  /** The entity this one is fighting, or null when not in combat. */
  targetId: number | null = null;

  /** Ticks remaining before this entity can attack again. */
  attackCooldown = 0;

  /**
   * Damage amounts applied to this entity since the renderer last looked, so it
   * can pop a hitsplat. Render-only: the sim pushes, the view drains.
   */
  readonly splatQueue: number[] = [];

  /**
   * Target ids of attacks this entity performed since the renderer last looked,
   * so it can play a swing animation. Render-only: the sim pushes, the view
   * drains.
   */
  readonly swingQueue: number[] = [];

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

  get isAlive(): boolean {
    return this.hitpoints > 0;
  }
}
