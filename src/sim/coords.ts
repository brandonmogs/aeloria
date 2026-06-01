/**
 * A position on the tile grid. `x` runs east, `y` runs north. These are always
 * integers — the soul of the OSRS feel is that the world is a grid of discrete
 * tiles, and entities only ever *logically* occupy one tile at a time. Smooth
 * motion is purely a rendering concern (see the render layer's interpolation).
 */
export interface Tile {
  readonly x: number;
  readonly y: number;
}

export function tile(x: number, y: number): Tile {
  return { x, y };
}

export function tilesEqual(a: Tile, b: Tile): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Stable string key for using tiles in a Set or Map. */
export function tileKey(t: Tile): string {
  return `${t.x},${t.y}`;
}

/** Chebyshev (chessboard) distance — the number of king's moves between tiles. */
export function chebyshev(a: Tile, b: Tile): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/**
 * The eight movement directions, ordered clockwise from north. Diagonal moves
 * are first-class in OSRS, subject to the corner-cutting rule enforced in
 * {@link TileMap.canStep}.
 */
export const DIRECTIONS: ReadonlyArray<Tile> = [
  { x: 0, y: 1 }, // N
  { x: 1, y: 1 }, // NE
  { x: 1, y: 0 }, // E
  { x: 1, y: -1 }, // SE
  { x: 0, y: -1 }, // S
  { x: -1, y: -1 }, // SW
  { x: -1, y: 0 }, // W
  { x: -1, y: 1 }, // NW
];
