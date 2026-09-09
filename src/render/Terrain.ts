import * as THREE from 'three';
import { SimplexNoise } from 'three/examples/jsm/math/SimplexNoise.js';
import { TileMap } from '../sim/TileMap';
import { Prop } from '../sim/Scenery';
import { Tile } from '../sim/coords';
import { TerrainSpec, TileRect } from '../world/startingWorld';
import { seededRandom, smoothstep } from './lowpoly';
import { GroundTextureSet, cobbleTextures, dirtTextures, grassTextures } from './groundTextures';
import { PbrMaps, PhotoLibrary } from './assets';

/** World-space height of the moat's surface. */
export const WATER_LEVEL = -0.28;
/** Height of the moat bed under the water. */
const WATER_BED = -0.72;
/** Tiles of decorative hills drawn beyond the playable map on every side. */
const MARGIN = 28;
/** Vertices per tile edge; two gives the roads and banks half-tile detail. */
const SUB = 2;

/** One ground material as the terrain shader sees it. */
interface GroundLayer {
  albedo: THREE.Texture;
  normal: THREE.Texture;
  /** Grey roughness map, or null for a uniform surface. */
  roughness: THREE.Texture | null;
  /** World units (tiles, roughly metres) one repeat of the texture covers. */
  metres: number;
}

/**
 * The ground: a heightfield with vertices every half tile, textured the way
 * 117 HD textures OSRS ground. Each vertex carries blend weights for grass,
 * dirt, and flagstone; the shader blends the three tiling materials by those
 * weights and by each texture's own height, so roads fray into the grass
 * through the gaps between blades rather than fading in a soft band, and a
 * per-vertex tint drifts the colour across the clearing (117 HD's "ground
 * blending"). Gentle rolling hills across the clearing, a perfectly level pad
 * under the castle, a basin scooped out for the moat, and a ring of steeper
 * hills past the map edge so the horizon isn't a hard drop into the sky.
 *
 * Height is purely visual (the sim's tiles stay 2D) but everything drawn on
 * the ground asks {@link heightAt} where to stand, and mouse picking marches a
 * ray against the same function, so clicks land exactly where they look.
 */
export class Terrain {
  readonly mesh: THREE.Mesh;
  /** Grid cells along x and z (vertices are cells + 1). */
  private readonly nx: number;
  private readonly nz: number;
  private readonly heights: Float32Array;
  /** Per-vertex grass/dirt/stone blend weights, kept for scattering ground cover. */
  private readonly splats: Float32Array;

  constructor(
    private readonly map: TileMap,
    props: ReadonlyArray<Prop>,
    spec: TerrainSpec,
    photos?: PhotoLibrary,
  ) {
    const W = map.width;
    const H = map.height;
    this.nx = (W + 2 * MARGIN) * SUB;
    this.nz = (H + 2 * MARGIN) * SUB;
    const cols = this.nx + 1;
    const rows = this.nz + 1;
    this.heights = new Float32Array(cols * rows);

    const water = new Set<string>();
    for (const p of props) if (p.kind === 'water') water.add(`${p.tile.x},${p.tile.y}`);
    const bridge = new Set<string>();
    for (const t of spec.bridgeTiles) bridge.add(`${t.x},${t.y}`);
    const isWater = (x: number, y: number): boolean => water.has(`${x},${y}`);
    const isBridge = (x: number, y: number): boolean => bridge.has(`${x},${y}`);
    const inRect = (r: TileRect, x: number, y: number): boolean => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
    const isStone = (x: number, y: number): boolean => spec.stoneZones.some((r) => inRect(r, x, y));

    // Weight of a tile predicate at a world point: bilinear over the four
    // nearest tile centres, so the value is exact at centres and eases between.
    const bilinear = (f: (x: number, y: number) => boolean, wx: number, wz: number): number => {
      const x0 = Math.floor(wx);
      const z0 = Math.floor(wz);
      const fx = wx - x0;
      const fz = wz - z0;
      const v = (x: number, y: number): number => (f(x, y) ? 1 : 0);
      return (
        (v(x0, z0) * (1 - fx) + v(x0 + 1, z0) * fx) * (1 - fz) +
        (v(x0, z0 + 1) * (1 - fx) + v(x0 + 1, z0 + 1) * fx) * fz
      );
    };

    // World-space distance from a point to the outside of a tile rect (0 inside).
    const rectDist = (r: TileRect, wx: number, wz: number): number => {
      const dx = Math.max(r.x0 - 0.5 - wx, 0, wx - (r.x1 + 0.5));
      const dz = Math.max(r.y0 - 0.5 - wz, 0, wz - (r.y1 + 0.5));
      return Math.hypot(dx, dz);
    };

    const noise = new SimplexNoise(seededRandom(0x5eed));
    const positions = new Float32Array(cols * rows * 3);
    const colors = new Float32Array(cols * rows * 3);
    const uvs = new Float32Array(cols * rows * 2);
    const splats = new Float32Array(cols * rows * 3);
    const c = new THREE.Color();
    const meadowDark = new THREE.Color(0.8, 0.92, 0.72);
    const meadowLight = new THREE.Color(1.0, 1.06, 0.9);
    const white = new THREE.Color(1, 1, 1);
    const forest = new THREE.Color(0.45, 0.56, 0.4);

    for (let gj = 0; gj < rows; gj++) {
      for (let gi = 0; gi < cols; gi++) {
        const wx = gi / SUB - MARGIN - 0.5;
        const wz = gj / SUB - MARGIN - 0.5;

        // Rolling ground: mostly long swells, with a little micro-relief.
        let h =
          0.62 * noise.noise(wx / 13, wz / 13) +
          0.24 * noise.noise(wx / 6.2 + 11, wz / 6.2 - 7) +
          0.07 * noise.noise(wx / 2.4, wz / 2.4) +
          0.025 * noise.noise(wx / 1.1 + 3, wz / 1.1 + 9) +
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

        // The moat basin and the bridge deck.
        const waterW = bilinear(isWater, wx, wz);
        const bridgeW = bilinear(isBridge, wx, wz);
        const stoneW = bilinear(isStone, wx, wz);
        h = h * (1 - waterW) + WATER_BED * waterW;
        h = h * (1 - bridgeW);

        this.heights[gj * cols + gi] = h;
        const vi = (gj * cols + gi) * 3;
        positions[vi] = wx;
        positions[vi + 1] = h;
        positions[vi + 2] = wz;
        uvs[(gj * cols + gi) * 2] = wx;
        uvs[(gj * cols + gi) * 2 + 1] = wz;

        // Roads: solid down the middle, fraying at the edges by noise, plus a
        // scatter of worn patches out in the grass.
        let pathD = Infinity;
        for (const path of spec.paths) {
          for (let i = 0; i + 1 < path.length; i++) {
            pathD = Math.min(pathD, segmentDistance(wx, wz, path[i], path[i + 1]));
          }
        }
        const fray = noise.noise(wx * 1.7 + 5, wz * 1.7 - 3) * 0.35 + noise.noise(wx * 0.8, wz * 0.8) * 0.3;
        let dirt = 1 - smoothstep(0.85, 1.7, pathD + fray);
        const patch = noise.noise(wx * 0.23 + 70, wz * 0.23 + 20) + noise.noise(wx * 0.9 + 5, wz * 0.9) * 0.25;
        dirt = Math.max(dirt, smoothstep(0.62, 0.85, patch) * 0.9);
        dirt = Math.max(dirt, waterW); // mud in the moat bed and up the banks
        const stone = stoneW * (1 - bridgeW);
        const grass = Math.max(0, 1 - dirt - stone);
        const total = grass + dirt + stone || 1;
        const si = (gj * cols + gi) * 3;
        splats[si] = grass / total;
        splats[si + 1] = dirt / total;
        splats[si + 2] = stone / total;

        // Tint: the textures carry the colour; this drifts it across the map,
        // darkens the wet bed, and cools the far hills into forest.
        const g = noise.noise(wx * 0.19 + 40, wz * 0.19 - 40) * 0.5 + 0.5;
        const speck = noise.noise(wx * 1.3, wz * 1.3) * 0.04;
        c.copy(meadowDark).lerp(meadowLight, g);
        c.offsetHSL(0, 0, speck);
        c.lerp(white, Math.max(dirt * 0.8, stone));
        c.multiplyScalar(1 - 0.5 * waterW);
        if (dOut > 1) c.lerp(forest, smoothstep(1, 12, dOut));

        colors[vi] = c.r;
        colors[vi + 1] = c.g;
        colors[vi + 2] = c.b;
      }
    }

    // Two triangles per cell, diagonal from the (i, j) corner to (i+1, j+1).
    const index = new Uint32Array(this.nx * this.nz * 6);
    let k = 0;
    for (let gj = 0; gj < this.nz; gj++) {
      for (let gi = 0; gi < this.nx; gi++) {
        const a = gj * cols + gi;
        const b = a + 1;
        const cc = a + cols;
        const d = cc + 1;
        index[k++] = a;
        index[k++] = cc;
        index[k++] = d;
        index[k++] = a;
        index[k++] = d;
        index[k++] = b;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute('splat', new THREE.BufferAttribute(splats, 3));
    this.splats = splats;
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.computeVertexNormals();

    // Scanned Poly Haven ground where it loaded (its repeat is its real-world
    // size), otherwise the procedural fallback at a scale that suits it.
    const layer = (photo: PbrMaps | undefined, fallback: () => GroundTextureSet, metres: number, fallbackMetres: number): GroundLayer =>
      photo
        ? { albedo: photo.map, normal: photo.normalMap, roughness: photo.roughnessMap ?? null, metres }
        : { ...fallback(), roughness: null, metres: fallbackMetres };
    this.mesh = new THREE.Mesh(
      geo,
      makeTerrainMaterial(
        layer(photos?.grass, grassTextures, 2.0, 2.4),
        layer(photos?.dirt, dirtTextures, 2.07, 2.0),
        layer(photos?.flagstone, cobbleTextures, 1.8, 3.2),
      ),
    );
    this.mesh.receiveShadow = true;
  }

  /** Ground height at any world (x, z); matches the drawn mesh exactly. */
  heightAt(x: number, z: number): number {
    const cols = this.nx + 1;
    const u = (x + MARGIN + 0.5) * SUB;
    const v = (z + MARGIN + 0.5) * SUB;
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

  /** Grass blend weight (0..1) at a world point, for scattering ground cover. */
  grassWeightAt(x: number, z: number): number {
    const cols = this.nx + 1;
    const u = (x + MARGIN + 0.5) * SUB;
    const v = (z + MARGIN + 0.5) * SUB;
    const i = Math.max(0, Math.min(this.nx - 1, Math.floor(u)));
    const j = Math.max(0, Math.min(this.nz - 1, Math.floor(v)));
    const fu = Math.max(0, Math.min(1, u - i));
    const fv = Math.max(0, Math.min(1, v - j));
    const g = (ii: number, jj: number): number => this.splats[(jj * cols + ii) * 3];
    return (g(i, j) * (1 - fu) + g(i + 1, j) * fu) * (1 - fv) + (g(i, j + 1) * (1 - fu) + g(i + 1, j + 1) * fu) * fv;
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

/** A 1×1 white texture standing in for a missing roughness map. */
function whiteTexture(): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

/**
 * A standard PBR material with the three ground materials splatted in: the
 * `splat` vertex attribute carries the grass/dirt/stone weights, world x/z is
 * the texture coordinate so every material tiles seamlessly across the whole
 * map, and each texture's height (its alpha, where it has one) sharpens the
 * blend. Per-layer roughness maps make packed earth and worn slabs sit
 * flatter under the sun than the grass around them.
 */
function makeTerrainMaterial(grass: GroundLayer, dirt: GroundLayer, stone: GroundLayer): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0.55,
    normalMap: grass.normal, // enables the tangent-frame path; the shader samples its own blend
    normalScale: new THREE.Vector2(1, 1),
  });
  const white = whiteTexture();
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      grassMap: { value: grass.albedo },
      grassNormal: { value: grass.normal },
      grassRough: { value: grass.roughness ?? white },
      dirtMap: { value: dirt.albedo },
      dirtNormal: { value: dirt.normal },
      dirtRough: { value: dirt.roughness ?? white },
      stoneMap: { value: stone.albedo },
      stoneNormal: { value: stone.normal },
      stoneRough: { value: stone.roughness ?? white },
      layerScale: { value: new THREE.Vector3(1 / grass.metres, 1 / dirt.metres, 1 / stone.metres) },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 splat;\nvarying vec3 vSplat;\nvarying vec2 vWorldUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvSplat = splat;\nvWorldUv = position.xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + TERRAIN_FRAG_PREFIX)
      .replace('#include <map_fragment>', TERRAIN_MAP_FRAGMENT)
      .replace('#include <roughnessmap_fragment>', TERRAIN_ROUGHNESS_FRAGMENT)
      .replace('#include <normal_fragment_maps>', TERRAIN_NORMAL_FRAGMENT);
  };
  mat.customProgramCacheKey = () => 'aeloria-terrain';
  return mat;
}

const TERRAIN_FRAG_PREFIX = /* glsl */ `
uniform sampler2D grassMap;
uniform sampler2D grassNormal;
uniform sampler2D grassRough;
uniform sampler2D dirtMap;
uniform sampler2D dirtNormal;
uniform sampler2D dirtRough;
uniform sampler2D stoneMap;
uniform sampler2D stoneNormal;
uniform sampler2D stoneRough;
uniform vec3 layerScale;
varying vec3 vSplat;
varying vec2 vWorldUv;

// Height-aware blend: a material only shows where its weight, boosted by its
// own height, beats the others, so edges follow blades and slab lips.
vec3 splatWeights(vec3 height) {
  vec3 w = vSplat * (height + 0.15);
  w = w * w * w;
  return w / (w.x + w.y + w.z + 1e-5);
}
`;

const TERRAIN_MAP_FRAGMENT = /* glsl */ `
vec2 uvG = vWorldUv * layerScale.x;
vec2 uvD = vWorldUv * layerScale.y;
vec2 uvS = vWorldUv * layerScale.z;
vec4 texG = texture2D(grassMap, uvG);
// A second, larger read of the same grass breaks up the tiling.
vec4 texG2 = texture2D(grassMap, uvG * 0.37 + vec2(0.31, 0.77));
texG.rgb = mix(texG.rgb, texG2.rgb, 0.4);
vec4 texD = texture2D(dirtMap, uvD);
vec4 texS = texture2D(stoneMap, uvS);
vec3 splatW = splatWeights(vec3(texG.a, texD.a, texS.a));
diffuseColor.rgb *= texG.rgb * splatW.x + texD.rgb * splatW.y + texS.rgb * splatW.z;
`;

const TERRAIN_ROUGHNESS_FRAGMENT = /* glsl */ `
float roughnessFactor = roughness * (
  texture2D(grassRough, uvG).g * splatW.x +
  texture2D(dirtRough, uvD).g * splatW.y +
  texture2D(stoneRough, uvS).g * splatW.z);
`;

const TERRAIN_NORMAL_FRAGMENT = /* glsl */ `
vec3 nG = texture2D(grassNormal, uvG).xyz * 2.0 - 1.0;
vec3 nD = texture2D(dirtNormal, uvD).xyz * 2.0 - 1.0;
vec3 nS = texture2D(stoneNormal, uvS).xyz * 2.0 - 1.0;
vec3 mapN = normalize(nG * splatW.x + nD * splatW.y + nS * splatW.z);
mapN.xy *= normalScale;
normal = normalize(tbn * mapN);
`;
