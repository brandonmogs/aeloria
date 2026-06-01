import { Tile } from './coords';

/**
 * A grid of walkable / blocked tiles. This is intentionally minimal for the
 * vertical slice — full OSRS uses per-edge flags (so you can wall off one side
 * of a tile) and multiple height planes. We model whole-tile blocking now and
 * keep the API small enough that richer flags can slot in later.
 */
export class TileMap {
  readonly width: number;
  readonly height: number;
  private readonly blocked: Uint8Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.blocked = new Uint8Array(width * height);
  }

  private index(x: number, y: number): number {
    return y * this.width + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  isBlocked(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return true;
    return this.blocked[this.index(x, y)] === 1;
  }

  setBlocked(x: number, y: number, value = true): void {
    if (!this.inBounds(x, y)) return;
    this.blocked[this.index(x, y)] = value ? 1 : 0;
  }

  /**
   * Whether an entity may step from `from` to the adjacent tile `to`. Enforces
   * the OSRS rule that a diagonal move cannot cut the corner of a blocked tile:
   * to move NE, both the N and E neighbours must also be open. `from` and `to`
   * are assumed to be exactly one tile apart.
   */
  canStep(from: Tile, to: Tile): boolean {
    if (this.isBlocked(to.x, to.y)) return false;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (dx !== 0 && dy !== 0) {
      if (this.isBlocked(from.x + dx, from.y)) return false;
      if (this.isBlocked(from.x, from.y + dy)) return false;
    }
    return true;
  }
}
