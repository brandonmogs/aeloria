import { Tile } from './coords';

/**
 * The kinds of static world prop the render layer knows how to draw. The sim
 * itself only ever cares whether a tile is *blocked* (see {@link TileMap}); the
 * prop kind is purely presentational. Keeping the list here — rather than in the
 * render layer — lets world-content code describe a map in gameplay terms ("a
 * castle wall here, a tree there") while the renderer stays free to interpret
 * those kinds however it likes.
 */
export type PropKind =
  | 'tree'
  | 'rock'
  | 'castle-wall'
  | 'castle-tower'
  | 'castle-gate'
  | 'castle-keep'
  | 'water';

/** A single placed piece of scenery. */
export interface Prop {
  readonly kind: PropKind;
  readonly tile: Tile;
  /** Stable 0..1 value for per-prop visual variety (rotation, scale, tint). */
  readonly seed: number;
}

/**
 * A cheap, deterministic hash of a tile coordinate into the range [0, 1). Used
 * to vary scenery (which way a tree leans, how big a boulder is) without any
 * randomness — the same map always looks the same, which matters once the world
 * is authoritative server state rather than something rebuilt per session.
 */
export function tileSeed(x: number, y: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
