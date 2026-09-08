import * as THREE from 'three';
import { SimplexNoise } from 'three/examples/jsm/math/SimplexNoise.js';
import { TileMap } from '../sim/TileMap';
import { Prop } from '../sim/Scenery';
import { Tile } from '../sim/coords';
import { TerrainSpec, TileRect } from '../world/startingWorld';
import { seededRandom, smoothstep } from './lowpoly';

/** World-space height of the moat's surface. */
export const WATER_LEVEL = -0.28;
/** Height of the moat bed under the water. */
const WATER_BED = -0.72;
/** Tiles of decorative hills drawn beyond the playable map on every side. */
const MARGIN = 28;

/**
 * The ground: a heightfield with one vertex per tile corner, vertex-coloured
 * and flat-shaded the way OSRS terrain is. Gentle rolling hills across the
 * clearing, a perfectly level pad under the castle, a basin scooped out for the
 * moat, dirt roads, a stone courtyard, and a ring of steeper hills past the
 * map edge so the horizon isn't a hard drop into the sky.
 *
 * Height is purely visual — the sim's tiles stay 2D — but everything drawn on
 * the ground asks {@link heightAt} where to stand, and mouse picking marches a
 * ray against the same function, so clicks land exactly where they look.
 */
export class Terrain {
  readonly mesh: THREE.Mesh;
  private readonly nx: number;
  private readonly nz: number;
  private readonly heights: Float32Array;

  constructor(
    private readonly map: TileMap,
    props: ReadonlyArray<Prop>,
    spec: TerrainSpec,
  ) {
    const W = map.width;
    const H = map.height;
    this.nx = W + 2 * MARGIN;
    this.nz = H + 2 * MARGIN;
    const cols = this.nx + 1;
    const rows = this.nz + 1;
    this.heights = new Float32Array(cols * rows);

    const water = new Set<string>();
    for (const p of props) if (p.kind === 'water') water.add(`${p.tile.x},${p.tile.y}`);
    const bridge = new Set<string>();
    for (const t of spec.bridgeTiles) bridge.add(`${t.x},${t.y}`);
    const isWater = (x: number, y: number) => water.has(`${x},${y}`);
    const isBridge = (x: number, y: number) => bridge.has(`${x},${y}`);
    const inRect = (r: TileRect, x: number, y: number) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;

    // World-space distance from a point to the outside of a tile rect (0 inside).
    const rectDist = (r: TileRect, wx: number, wz: number): number => {
      const dx = Math.max(r.x0 - 0.5 - wx, 0, wx - (r.x1 + 0.5));
      const dz = Math.max(r.y0 - 0.5 - wz, 0, wz - (r.y1 + 0.5));
      return Math.hypot(dx, dz);
    };

    const noise = new SimplexNoise(seededRandom(0x5eed));
    const positions = new Float32Array(cols * rows * 3);
    const colors = new Float32Array(cols * rows * 3);
    const c = new THREE.Color();
    const grassDark = new THREE.Color(0x3d6a2c);
    const grassLight = new THREE.Color(0x6a9a42);
    const dirt = new THREE.Color(0x8c7551);
    const bed = new THREE.Color(0x4b4a33);
    const bank = new THREE.Color(0x6e6a48);
    const stoneA = new THREE.Color(0x8f8c82);
    const stoneB = new THREE.Color(0x7f7c73);
    const forest = new THREE.Color(0x2c4a25);

    for (let gj = 0; gj < rows; gj++) {
      for (let gi = 0; gi < cols; gi++) {
        const wx = gi - MARGIN - 0.5;
        const wz = gj - MARGIN - 0.5;

        // Rolling ground: three octaves, mostly long swells.
        let h =
          0.62 * noise.noise(wx / 13, wz / 13) +
          0.24 * noise.noise(wx / 6.2 + 11, wz / 6.2 - 7) +
          0.07 * noise.noise(wx / 2.4, wz / 2.4) +
          0.12;

        // Hills climbing away past the map edge.
        const dOut = Math.max(0, -0.5 - wx, wx - (W - 0.5), -0.5 - wz, wz - (H - 0.5));
        if (dOut > 3) h += 0.075 * Math.pow(dOut - 3, 1.35);

        // Level pads: fully flat inside, easing out over a few tiles.
        let flatW = 0;
        for (const zone of spec.flatZones) {
          flatW = Math.max(flatW, 1 - smoothstep(0, 3.5, rectDist(zone, wx, wz)));
        }
        h = h * (1 - flatW);

        // The moat basin: corners are shared by four tiles; average their targets.
        const tx = gi - MARGIN;
        const ty = gj - MARGIN;
        let waterCount = 0;
        let bridgeCount = 0;
        let stoneCount = 0;
        for (const [ax, ay] of [
          [tx - 1, ty - 1],
          [tx, ty - 1],
          [tx - 1, ty],
          [tx, ty],
        ] as const) {
          if (isWater(ax, ay)) waterCount++;
          if (isBridge(ax, ay)) bridgeCount++;
          if (spec.stoneZones.some((r) => inRect(r, ax, ay))) stoneCount++;
        }
        if (bridgeCount > 0) h = 0;
        else if (waterCount > 0) h = (waterCount * WATER_BED) / 4;

        this.heights[gj * cols + gi] = h;
        const vi = (gj * cols + gi) * 3;
        positions[vi] = wx;
        positions[vi + 1] = h;
        positions[vi + 2] = wz;

        // Colour: grass tones drifting with noise, roads, courtyard stone,
        // mud under the water, darker forest floor out in the hills.
        const g = noise.noise(wx * 0.19 + 40, wz * 0.19 - 40) * 0.5 + 0.5;
        const speck = noise.noise(wx * 1.3, wz * 1.3) * 0.05;
        c.copy(grassDark).lerp(grassLight, g);
        c.offsetHSL(0, 0, speck);

        let pathD = Infinity;
        for (const path of spec.paths) {
          for (let i = 0; i + 1 < path.length; i++) {
            pathD = Math.min(pathD, segmentDistance(wx, wz, path[i], path[i + 1]));
          }
        }
        if (pathD < 1.7) c.lerp(dirt, 1 - smoothstep(0.75, 1.7, pathD + noise.noise(wx * 0.9, wz * 0.9) * 0.3));

        if (stoneCount === 4) c.copy((gi + gj) % 2 === 0 ? stoneA : stoneB);
        else if (stoneCount > 0) c.lerp(stoneA, stoneCount / 5);

        if (waterCount === 4) c.copy(bed);
        else if (waterCount > 0 && bridgeCount === 0) c.lerp(bank, 0.75);

        if (dOut > 1) c.lerp(forest, smoothstep(1, 12, dOut));

        colors[vi] = c.r;
        colors[vi + 1] = c.g;
        colors[vi + 2] = c.b;
      }
    }

    // Two triangles per cell, diagonal from the (i, j) corner to (i+1, j+1).
    const index: number[] = [];
    for (let gj = 0; gj < this.nz; gj++) {
      for (let gi = 0; gi < this.nx; gi++) {
        const a = gj * cols + gi;
        const b = a + 1;
        const cc = a + cols;
        const d = cc + 1;
        index.push(a, cc, d, a, d, b);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();

    // Smooth (Gouraud) shading: the vertex colours carry the tile-to-tile
    // variation, and the facets show only where the ground actually turns.
    this.mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.mesh.receiveShadow = true;
  }

  /** Ground height at any world (x, z); matches the drawn mesh exactly. */
  heightAt(x: number, z: number): number {
    const cols = this.nx + 1;
    const u = x + MARGIN + 0.5;
    const v = z + MARGIN + 0.5;
    const i = Math.max(0, Math.min(this.nx - 1, Math.floor(u)));
    const j = Math.max(0, Math.min(this.nz - 1, Math.floor(v)));
    const fu = Math.max(0, Math.min(1, u - i));
    const fv = Math.max(0, Math.min(1, v - j));
    const ha = this.heights[j * cols + i];
    const hb = this.heights[j * cols + i + 1];
    const hc = this.heights[(j + 1) * cols + i];
    const hd = this.heights[(j + 1) * cols + i + 1];
    // Same diagonal as the index buffer, so we sit on the rendered triangle.
    return fv >= fu
      ? ha + (hd - hc) * fu + (hc - ha) * fv
      : ha + (hb - ha) * fu + (hd - hb) * fv;
  }

  /** Ground height at the centre of a tile. */
  tileHeight(t: Tile): number {
    return this.heightAt(t.x, t.y);
  }

  /**
   * Where a picking ray meets the ground, or null. Marches the ray in small
   * steps against {@link heightAt} and bisects the crossing, which is far
   * cheaper than testing thousands of triangles on every mouse move.
   */
  intersectRay(ray: THREE.Ray, out: THREE.Vector3): THREE.Vector3 | null {
    const o = ray.origin;
    const d = ray.direction;
    if (d.y >= -1e-4) return null; // looking up or level: never hits the ground
    const top = 8;
    const bottom = -1.2;
    let t = o.y > top ? (top - o.y) / d.y : 0;
    const tEnd = (bottom - o.y) / d.y;
    const step = 0.12;
    let prev = t;
    for (; t <= tEnd; t += step) {
      const px = o.x + d.x * t;
      const pz = o.z + d.z * t;
      if (o.y + d.y * t < this.heightAt(px, pz)) {
        // Crossed the surface between prev and t: refine.
        let lo = prev;
        let hi = t;
        for (let k = 0; k < 10; k++) {
          const mid = (lo + hi) / 2;
          const below = o.y + d.y * mid < this.heightAt(o.x + d.x * mid, o.z + d.z * mid);
          if (below) hi = mid;
          else lo = mid;
        }
        const hit = (lo + hi) / 2;
        out.set(o.x + d.x * hit, o.y + d.y * hit, o.z + d.z * hit);
        return out;
      }
      prev = t;
    }
    return null;
  }

  /** Whether a world point lies over the playable map. */
  inBoundsWorld(x: number, z: number): boolean {
    return this.map.inBounds(Math.round(x), Math.round(z));
  }
}

/** Distance from a point to the segment between two tile centres. */
function segmentDistance(px: number, pz: number, a: Tile, b: Tile): number {
  const abx = b.x - a.x;
  const abz = b.y - a.y;
  const len2 = abx * abx + abz * abz;
  let t = len2 > 0 ? ((px - a.x) * abx + (pz - a.y) * abz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + abx * t), pz - (a.y + abz * t));
}
