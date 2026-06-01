import { Tile, tilesEqual, tileKey, chebyshev, DIRECTIONS } from './coords';
import { TileMap } from './TileMap';

/**
 * Breadth-first pathfinding across the tile grid. Because every walk step costs
 * the same (one tile), BFS yields a shortest path without needing weights or a
 * heuristic. Like OSRS, when the exact goal is unreachable we walk to the
 * reachable tile nearest the goal rather than refusing to move.
 *
 * Pathfinding lives in the simulation (not the client) on purpose: in OSRS the
 * server owns movement, so a "move" command carries only a target tile and the
 * authoritative sim computes the route. Keeping it here means the same code
 * runs locally now and server-side later.
 */
export class Pathfinder {
  constructor(private readonly map: TileMap) {}

  /**
   * Returns the ordered list of tiles to step through to get from `start` to
   * `goal`, excluding `start` itself. Returns an empty array when already at the
   * goal or fully boxed in.
   */
  findPath(start: Tile, goal: Tile): Tile[] {
    if (tilesEqual(start, goal)) return [];

    const cameFrom = new Map<string, Tile | null>();
    cameFrom.set(tileKey(start), null);

    // A plain array with a head index is a cheap FIFO queue (avoids O(n) shift).
    const queue: Tile[] = [start];
    let head = 0;

    let best = start;
    let bestDist = chebyshev(start, goal);

    while (head < queue.length) {
      const current = queue[head++];

      if (tilesEqual(current, goal)) {
        best = current;
        break;
      }

      // Track the closest tile seen, as a fallback for unreachable goals.
      const dist = chebyshev(current, goal);
      if (dist < bestDist) {
        bestDist = dist;
        best = current;
      }

      for (const dir of DIRECTIONS) {
        const next: Tile = { x: current.x + dir.x, y: current.y + dir.y };
        const key = tileKey(next);
        if (cameFrom.has(key)) continue;
        if (!this.map.canStep(current, next)) continue;
        cameFrom.set(key, current);
        queue.push(next);
      }
    }

    // Reconstruct the path from `best` (== goal if it was reached) back to start.
    const path: Tile[] = [];
    let node: Tile | null = best;
    while (node && !tilesEqual(node, start)) {
      path.push(node);
      node = cameFrom.get(tileKey(node)) ?? null;
    }
    path.reverse();
    return path;
  }
}
