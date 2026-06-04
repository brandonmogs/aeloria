import { TileMap } from '../sim/TileMap';
import { Tile } from '../sim/coords';
import { Prop, PropKind, tileSeed } from '../sim/Scenery';

/**
 * Builds Aeloria's starting area: a stone keep guarding a green clearing, framed
 * by two woods and a scatter of mineable boulders. The player spawns on the
 * approach to the south and can walk straight through the gate.
 *
 * This is the single source of truth for the opening map. It mutates `map` to
 * mark blocked tiles and returns the list of {@link Prop}s for the render layer
 * to draw. Gameplay code only ever reads the blocking; nothing here knows that
 * Three.js exists.
 */
/** A rectangle in world (XZ) space: the water moat geometry consumes these. */
export interface WorldRect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** The moat ring (outer minus inner) and the bridge gap across its south side. */
export interface MoatLayout {
  outer: WorldRect;
  inner: WorldRect;
  bridge: WorldRect;
}

export interface StartingWorld {
  readonly props: Prop[];
  /** A safe, walkable tile to spawn the player on. */
  readonly spawn: Tile;
  /** Geometry for the water moat and its bridge. */
  readonly moat: MoatLayout;
}

// Castle footprint (inclusive tile bounds). Odd width so it has a true centre
// column, which lets the gate sit symmetrically in the south wall.
const CASTLE = { west: 18, east: 30, south: 35, north: 45 } as const;
const GATE_X = [23, 24, 25]; // open tiles in the south wall
const SPAWN: Tile = { x: 24, y: 28 };

// Moat: a three-tile water ring hugging the walls, with a three-tile-wide bridge
// on the south side lining up with the gate. Tile bounds are inclusive.
const MOAT_OUTER = { x0: 15, y0: 32, x1: 33, y1: 48 };
const MOAT_INNER = { x0: 18, y0: 35, x1: 30, y1: 45 };
const BRIDGE = { x0: 23, y0: 32, x1: 25, y1: 34 };

export function buildStartingWorld(map: TileMap): StartingWorld {
  const props: Prop[] = [];
  const place = (kind: PropKind, x: number, y: number, block = true): void => {
    if (!map.inBounds(x, y)) return;
    if (block) map.setBlocked(x, y);
    props.push({ kind, tile: { x, y }, seed: tileSeed(x, y) });
  };

  buildCastle(place);
  buildMoat(props, map); // before the forests, so trees never sprout in the water
  buildForests(props, map);
  buildRockClusters(place);

  return {
    props,
    spawn: SPAWN,
    moat: {
      outer: tileRectToWorld(MOAT_OUTER),
      inner: tileRectToWorld(MOAT_INNER),
      bridge: tileRectToWorld(BRIDGE),
    },
  };
}

/**
 * Floods the moat ring: every tile in the outer rectangle but outside the inner
 * one becomes impassable water, except the bridge tiles, which stay walkable so
 * the player can cross to the gate. Water tiles are emitted as 'water' props
 * purely so the minimap can colour them; the 3D surface is drawn by WaterView.
 */
function buildMoat(props: Prop[], map: TileMap): void {
  for (let y = MOAT_OUTER.y0; y <= MOAT_OUTER.y1; y++) {
    for (let x = MOAT_OUTER.x0; x <= MOAT_OUTER.x1; x++) {
      const inInner =
        x >= MOAT_INNER.x0 && x <= MOAT_INNER.x1 && y >= MOAT_INNER.y0 && y <= MOAT_INNER.y1;
      const onBridge = x >= BRIDGE.x0 && x <= BRIDGE.x1 && y >= BRIDGE.y0 && y <= BRIDGE.y1;
      if (inInner || onBridge) continue;
      map.setBlocked(x, y);
      props.push({ kind: 'water', tile: { x, y }, seed: tileSeed(x, y) });
    }
  }
}

/** Convert inclusive tile bounds to a world-space rect (tiles are 1 unit, centred). */
function tileRectToWorld(r: { x0: number; y0: number; x1: number; y1: number }): WorldRect {
  return { x0: r.x0 - 0.5, z0: r.y0 - 0.5, x1: r.x1 + 0.5, z1: r.y1 + 0.5 };
}

/** A walled keep with four corner towers, a south gate, and a central keep. */
function buildCastle(place: (k: PropKind, x: number, y: number, block?: boolean) => void): void {
  const { west, east, south, north } = CASTLE;
  const corners = new Set([`${west},${south}`, `${east},${south}`, `${west},${north}`, `${east},${north}`]);
  const isCorner = (x: number, y: number) => corners.has(`${x},${y}`);
  const isGate = (x: number, y: number) => y === south && GATE_X.includes(x);

  // North and south walls (gate left open and walkable).
  for (let x = west; x <= east; x++) {
    if (isCorner(x, south)) place('castle-tower', x, south);
    else if (isGate(x, south)) place('castle-gate', x, south, false);
    else place('castle-wall', x, south);

    if (isCorner(x, north)) place('castle-tower', x, north);
    else place('castle-wall', x, north);
  }

  // East and west walls (skip the rows the corner towers already filled).
  for (let y = south + 1; y < north; y++) {
    place('castle-wall', west, y);
    place('castle-wall', east, y);
  }

  // Central keep: a 3x3 stone block. One prop draws the whole structure; the
  // surrounding eight tiles are just blocked so nothing can stand inside it.
  const keepCx = 24;
  const keepCy = 41;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = keepCx + dx;
      const y = keepCy + dy;
      if (dx === 0 && dy === 0) place('castle-keep', x, y);
      else place('castle-wall', x, y); // blocked; visually covered by the keep mesh
    }
  }
}

/** Two woods flanking the approach, kept clear of the central walking corridor. */
function buildForests(props: Prop[], map: TileMap): void {
  const woods = [
    { x0: 4, x1: 16, y0: 14, y1: 40, density: 0.24 },
    { x0: 32, x1: 44, y0: 14, y1: 40, density: 0.24 },
    { x0: 10, x1: 38, y0: 4, y1: 12, density: 0.14 }, // sparse treeline to the south
  ];
  const corridor = (x: number) => x >= 21 && x <= 27; // keep the path to the gate open

  for (const w of woods) {
    for (let y = w.y0; y <= w.y1; y++) {
      for (let x = w.x0; x <= w.x1; x++) {
        if (corridor(x) && y < CASTLE.south) continue;
        if (map.isBlocked(x, y)) continue;
        if (tileSeed(x, y) >= w.density) continue;
        map.setBlocked(x, y);
        props.push({ kind: 'tree', tile: { x, y }, seed: tileSeed(x * 7, y * 7) });
      }
    }
  }
}

/** A few boulder clusters to serve as the first mining spots. */
function buildRockClusters(place: (k: PropKind, x: number, y: number, block?: boolean) => void): void {
  const rocks: ReadonlyArray<readonly [number, number]> = [
    [12, 18], [13, 18], [12, 19], [14, 19],
    [35, 24], [36, 24], [36, 25], [35, 26],
    [20, 10], [21, 10], [20, 11],
  ];
  for (const [x, y] of rocks) place('rock', x, y);
}
