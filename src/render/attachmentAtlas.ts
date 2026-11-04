import * as THREE from 'three';
import { strandTextures } from './hair';
import { irisShade, scleraShade } from './humanSkin';
import { normalMap, tileableNoise } from './texgen';

/**
 * One texture set for everything a character wears or grows: the atlas the
 * merged attachments mesh samples (see attachments.ts). It is a grid of
 * square tiles, one per kind of surface, each tileable on its own so a part
 * can repeat it as often as its size needs; the shader wraps the part's uv
 * inside its tile. Three maps share the layout:
 *
 * - albedo: near-white colour variation the vertex colour multiplies (sRGB)
 * - normal: tangent-space detail, its strength baked per tile
 * - orm: alpha in R (only the hair strands use it), roughness in G, metalness in B
 */

export type TileName = 'plain' | 'cloth' | 'leather' | 'metal' | 'rust' | 'hair' | 'strand' | 'eye' | 'fine';
export const TILES: readonly TileName[] = ['plain', 'cloth', 'leather', 'metal', 'rust', 'hair', 'strand', 'eye', 'fine'];
export const TILE_COLS = 3;
export const TILE_ROWS = 3;
export const TILE_PX = 256;
export const ATLAS_W = TILE_COLS * TILE_PX;
export const ATLAS_H = TILE_ROWS * TILE_PX;

/**
 * Metres one repeat of a tile's pattern spans on a surface; a part's uv is
 * scaled so the weave or grain comes out this size whatever the part is.
 * 0 keeps the part's own uv (hair and eyes lay theirs out by hand).
 */
export const TILE_METRES: Record<TileName, number> = { plain: 0, cloth: 0.12, leather: 0.16, metal: 0.3, rust: 0.2, hair: 0, strand: 0, eye: 0, fine: 0 };

/** Where the iris sits on the eye tile, in tile uv, for the iris cap geometry. */
export const EYE_IRIS = { u: 0.75, v: 0.5, radius: 0.16 };

export interface AttachmentAtlas {
  albedo: THREE.DataTexture;
  normal: THREE.DataTexture;
  orm: THREE.DataTexture;
}

let atlas: AttachmentAtlas | null = null;

export function attachmentAtlas(): AttachmentAtlas {
  if (atlas) return atlas;
  const albedo = new Uint8Array(new ArrayBuffer(ATLAS_W * ATLAS_H * 4));
  const normal = new Uint8Array(new ArrayBuffer(ATLAS_W * ATLAS_H * 4));
  const orm = new Uint8Array(new ArrayBuffer(ATLAS_W * ATLAS_H * 4));
  const N = TILE_PX * TILE_PX;

  interface Paint {
    /** Colour per tile pixel, 0..1 (grey when one number). */
    albedo: (i: number) => number | [number, number, number];
    height?: Float32Array;
    strength?: number;
    roughness: number;
    metalness: number;
    alpha?: (i: number) => number;
  }
  const paint = (name: TileName, p: Paint): void => {
    const index = TILES.indexOf(name);
    const col = index % TILE_COLS;
    const row = Math.floor(index / TILE_COLS);
    const nrm = p.height ? normalMap(p.height, TILE_PX, p.strength ?? 1) : null;
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const ti = y * TILE_PX + x;
        const ai = ((row * TILE_PX + y) * ATLAS_W + col * TILE_PX + x) * 4;
        const c = p.albedo(ti);
        const [r, g, b] = typeof c === 'number' ? [c, c, c] : c;
        albedo[ai] = byte(r);
        albedo[ai + 1] = byte(g);
        albedo[ai + 2] = byte(b);
        albedo[ai + 3] = 255;
        if (nrm) {
          normal[ai] = nrm[ti * 4];
          normal[ai + 1] = nrm[ti * 4 + 1];
          normal[ai + 2] = nrm[ti * 4 + 2];
        } else {
          normal[ai] = 128;
          normal[ai + 1] = 128;
          normal[ai + 2] = 255;
        }
        normal[ai + 3] = 255;
        orm[ai] = byte(p.alpha ? p.alpha(ti) : 1);
        orm[ai + 1] = byte(p.roughness);
        orm[ai + 2] = byte(p.metalness);
        orm[ai + 3] = 255;
      }
    }
  };

  paint('plain', { albedo: () => 1, roughness: 0.5, metalness: 0 });

  {
    // Cloth: a fine weave in the normals (64 threads across the tile) and broad fibre variation in the colour.
    const n = tileableNoise(TILE_PX, 3, 77, 8);
    const weave = new Float32Array(N);
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const over = ((x >> 1) + (y >> 1)) % 2 === 0 ? 0.6 : 0.4;
        weave[y * TILE_PX + x] = over * 0.7 + n[y * TILE_PX + x] * 0.3;
      }
    }
    const fibre = tileableNoise(TILE_PX, 4, 43, 6);
    paint('cloth', { albedo: (i) => 0.9 + 0.12 * fibre[i], height: weave, strength: 0.35, roughness: 0.9, metalness: 0 });
  }

  // Leather: grain and creases; rust reuses the grain as pitting under darker blotches.
  const grain = tileableNoise(TILE_PX, 5, 47, 8);
  const blotch = tileableNoise(TILE_PX, 3, 48, 3);
  const hide = new Float32Array(N);
  for (let i = 0; i < N; i++) hide[i] = grain[i] * 0.65 + blotch[i] * 0.35;
  paint('leather', { albedo: (i) => 0.87 + 0.16 * blotch[i], height: hide, strength: 0.63, roughness: 0.6, metalness: 0.03 });
  paint('rust', { albedo: (i) => 0.7 + 0.3 * blotch[i], height: hide, strength: 0.5, roughness: 0.78, metalness: 0.55 });

  {
    // Metal: a faintly brushed finish, soft streaks running across the tile
    // under broad smudges, kept gentle so the boosted specular does not band.
    const streak = tileableNoise(TILE_PX, 3, 31, 6);
    const smudge = tileableNoise(TILE_PX, 2, 33, 3);
    const brushed = new Float32Array(N);
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) brushed[y * TILE_PX + x] = 0.6 * streak[y * TILE_PX] + 0.4 * smudge[y * TILE_PX + x];
    }
    paint('metal', { albedo: (i) => 0.97 + 0.03 * brushed[i], height: brushed, strength: 0.05, roughness: 0.42, metalness: 0.9 });
  }

  {
    // Hair: the painted strands, the cap's opaque and the cards' thinning to
    // wisps. The canvases are 256 × 512 and drawn for a flipped canvas
    // texture, so the tile takes every other row, bottom up, to keep the
    // same orientation the hair uvs were laid out for.
    const tex = strandTextures();
    const read = (canvas: HTMLCanvasElement): Uint8ClampedArray => canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    const cap = read(tex.albedo.image as HTMLCanvasElement);
    const card = read(tex.card.image as HTMLCanvasElement);
    const fine = read(tex.fine.image as HTMLCanvasElement);
    const src = (i: number): number => {
      const y = TILE_PX - 1 - Math.floor(i / TILE_PX);
      return ((y * 2 + 1) * TILE_PX + (i % TILE_PX)) * 4;
    };
    const streaks = new Float32Array(N);
    for (let i = 0; i < N; i++) streaks[i] = cap[src(i)] / 255;
    const colour = (d: Uint8ClampedArray) => (i: number): [number, number, number] => {
      const s = src(i);
      return [d[s] / 255, d[s + 1] / 255, d[s + 2] / 255];
    };
    paint('hair', { albedo: colour(cap), height: streaks, strength: 0.5, roughness: 0.55, metalness: 0 });
    paint('strand', { albedo: colour(card), height: streaks, strength: 0.5, roughness: 0.55, metalness: 0, alpha: (i) => card[src(i) + 3] / 255 });
    // The fine hair of the face: the same streaks without the gaps, and matte.
    paint('fine', { albedo: colour(fine), height: streaks, strength: 0.3, roughness: 0.8, metalness: 0, alpha: (i) => fine[src(i) + 3] / 255 });
  }

  {
    // Eye: the sclera, pink toward the corners and shaded toward the iris,
    // and the iris in grey for the iris cap's vertex colour to tint (the same
    // painted iris as the eyeball material's, see humanSkin.ts).
    const cx = EYE_IRIS.u * TILE_PX;
    const cy = EYE_IRIS.v * TILE_PX;
    const R = EYE_IRIS.radius * TILE_PX;
    paint('eye', {
      albedo: (i) => {
        const x = i % TILE_PX;
        const y = Math.floor(i / TILE_PX);
        const rr = Math.hypot(x - cx, y - cy) / R;
        if (rr < 1) return Math.min(1, 0.8 * irisShade(rr, Math.atan2(y - cy, x - cx)));
        const u = x / TILE_PX;
        const corner = Math.max(0, 1 - Math.min(u, Math.abs(u - 0.5), 1 - u) / 0.09);
        const k = scleraShade(rr);
        return [(0.95 - 0.1 * corner) * k, (0.94 - 0.28 * corner) * k, (0.92 - 0.3 * corner) * k];
      },
      roughness: 0.14,
      metalness: 0,
    });
  }

  const texture = (data: Uint8Array<ArrayBuffer>, srgb: boolean): THREE.DataTexture => {
    const t = new THREE.DataTexture(data, ATLAS_W, ATLAS_H, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  };
  atlas = { albedo: texture(albedo, true), normal: texture(normal, false), orm: texture(orm, false) };
  return atlas;
}

function byte(v: number): number {
  return Math.round(Math.max(0, Math.min(1, v)) * 255);
}
