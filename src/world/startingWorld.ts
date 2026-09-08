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

/** Inclusive tile bounds. */
export interface TileRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The moat ring (outer minus inner) and the bridge gap across its south side. */
export interface MoatLayout {
  outer: WorldRect;
  inner: WorldRect;
  bridge: WorldRect;
}

/**
 * What the ground renderer needs to know about the map's shape: where to stay
 * level, where to pave, where the roads run, and which walkable tiles span
 * water. Height is presentation only; the sim never sees it.
 */
export interface TerrainSpec {
  /** Tile rects held perfectly flat at height 0 (the castle and its moat). */
  readonly flatZones: ReadonlyArray<TileRect>;
  /** Tile rects paved in stone rather than grass (the castle courtyard). */
  readonly stoneZones: ReadonlyArray<TileRect>;
  /** Dirt roads as polylines through tile centres. */
  readonly paths: ReadonlyArray<ReadonlyArray<Tile>>;
  /** Walkable tiles that span water (the moat bridge): held at height 0. */
  readonly bridgeTiles: ReadonlyArray<Tile>;
}

export interface StartingWorld {
  readonly props: Prop[];
  /** A safe, walkable tile to spawn the player on. */
  readonly spawn: Tile;
  /** Geometry for the water moat and its bridge. */
  readonly moat: MoatLayout;
  /**
   * Wandering fishing spots: each group is the set of moat tiles one spot hops
   * between. Spots sit on the outermost water row so the bank below is in reach.
   */
  readonly fishingSpotGroups: Tile[][];
  readonly terrain: TerrainSpec;
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

/** Dirt roads: the main approach up to the bridge, and spurs to the camps. */
const PATHS: ReadonlyArray<ReadonlyArray<Tile>> = [
  [
    { x: 24, y: 1 },
    { x: 24, y: 31 },
  ],
  [
    { x: 24, y: 20 },
    { x: 29, y: 20 },
  ],
  [
    { x: 24, y: 17 },
    { x: 16, y: 18 },
  ],
];

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
  buildRockClusters(map, props);

  // Courtyard furniture: two bank booths along the west wall, an altar to the
  // east, the kitchen range, and a furnace and anvil by the east wall, so the
  // castle earns its keep as a home base.
  place('bank-booth', 20, 43);
  place('bank-booth', 21, 43);
  place('altar', 27, 43);
  place('range', 28, 37); // the castle kitchen, where the Cook works
  place('furnace', 29, 40);
  place('anvil', 29, 42);

  const bridgeTiles: Tile[] = [];
  for (let y = BRIDGE.y0; y <= BRIDGE.y1; y++) {
    for (let x = BRIDGE.x0; x <= BRIDGE.x1; x++) bridgeTiles.push({ x, y });
  }

  return {
    props,
    spawn: SPAWN,
    moat: {
      outer: tileRectToWorld(MOAT_OUTER),
      inner: tileRectToWorld(MOAT_INNER),
      bridge: tileRectToWorld(BRIDGE),
    },
    // Two spots on the moat's southern row: reachable from the grass one tile
    // south, and far enough apart that chasing a moved spot is a real stroll.
    fishingSpotGroups: [
      [
        { x: 17, y: 32 },
        { x: 19, y: 32 },
        { x: 21, y: 32 },
      ],
      [
        { x: 27, y: 32 },
        { x: 29, y: 32 },
        { x: 31, y: 32 },
      ],
    ],
    terrain: {
      flatZones: [
        {
          x0: MOAT_OUTER.x0 - 1,
          y0: MOAT_OUTER.y0 - 1,
          x1: MOAT_OUTER.x1 + 1,
          y1: MOAT_OUTER.y1 + 1,
        },
      ],
      stoneZones: [
        { x0: CASTLE.west + 1, y0: CASTLE.south + 1, x1: CASTLE.east - 1, y1: CASTLE.north - 1 },
      ],
      paths: PATHS,
      bridgeTiles,
    },
  };
}

/**
 * Floods the moat ring: every tile in the outer rectangle but outside the inner
 * one becomes impassable water, except the bridge tiles, which stay walkable so
 * the player can cross to the gate. Water tiles are emitted as 'water' props
 * so the minimap and terrain can colour them; the 3D surface is drawn by WaterView.
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
      else place('castle-wall', x, y, true); // blocked; visually covered by the keep mesh
    }
  }
}

/** Distance from a tile centre to the nearest road, in tiles. */
function pathDistance(x: number, y: number): number {
  let best = Infinity;
  for (const path of PATHS) {
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i];
      const b = path[i + 1];
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const len2 = abx * abx + aby * aby;
      let t = len2 > 0 ? ((x - a.x) * abx + (y - a.y) * aby) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      best = Math.min(best, Math.hypot(x - (a.x + abx * t), y - (a.y + aby * t)));
    }
  }
  return best;
}

/** Whether a tile sits within two tiles of the moat: willow country. */
function nearWater(x: number, y: number): boolean {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      const inOuter = tx >= MOAT_OUTER.x0 && tx <= MOAT_OUTER.x1 && ty >= MOAT_OUTER.y0 && ty <= MOAT_OUTER.y1;
      const inInner = tx >= MOAT_INNER.x0 && tx <= MOAT_INNER.x1 && ty >= MOAT_INNER.y0 && ty <= MOAT_INNER.y1;
      if (inOuter && !inInner) return true;
    }
  }
  return false;
}

/**
 * Two woods flanking the approach, kept clear of the roads and the gate
 * corridor. Most trees are regular; one in seven is an oak (Woodcutting 15),
 * and anything growing by the moat is a willow (30).
 */
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
        if (pathDistance(x, y) < 1.5) continue;
        if (tileSeed(x, y) >= w.density) continue;
        map.setBlocked(x, y);
        const seed = tileSeed(x * 7, y * 7);
        const variant = nearWater(x, y) ? 'willow' : seed < 0.14 ? 'oak' : 'regular';
        props.push({ kind: 'tree', tile: { x, y }, seed, variant });
      }
    }
  }
}

/**
 * Three boulder clusters: copper and tin side by side in the west and east
 * (everything a bronze bar needs), and iron (Mining 15) in the southern
 * treeline.
 */
function buildRockClusters(map: TileMap, props: Prop[]): void {
  const rocks: ReadonlyArray<readonly [number, number, string]> = [
    [12, 18, 'copper'], [13, 18, 'tin'], [12, 19, 'tin'], [14, 19, 'copper'],
    [35, 24, 'tin'], [36, 24, 'copper'], [36, 25, 'copper'], [35, 26, 'tin'],
    [20, 10, 'iron'], [21, 10, 'iron'], [20, 11, 'iron'],
  ];
  for (const [x, y, variant] of rocks) {
    if (!map.inBounds(x, y)) continue;
    map.setBlocked(x, y);
    props.push({ kind: 'rock', tile: { x, y }, seed: tileSeed(x, y), variant });
  }
}
