import * as THREE from 'three';
import { normalMap, tileableNoise, toTexture } from './texgen';

/**
 * Textures for people: a painted face per look, and the fine detail maps
 * (skin pores, cloth weave and fibre, leather grain, hair strands) that keep
 * the smooth revolved bodies from reading as plastic. Everything is drawn
 * once at start-up and cached; nothing ships as an image asset.
 */

export interface DetailMaps {
  /** Near-white colour variation the material's base colour multiplies. */
  albedo: THREE.DataTexture;
  /** Tangent-space normal map. */
  normal: THREE.DataTexture;
}

/** Albedo (a grey field around `centre`) and normal map from two height fields. */
function detail(
  albedoHeight: Float32Array,
  normalHeight: Float32Array,
  size: number,
  albedoAmp: number,
  normalStrength: number,
  repeatU: number,
  repeatV: number,
  centre = 0.95,
  normalRepeatU = repeatU,
  normalRepeatV = repeatV,
): DetailMaps {
  const rgb = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const v = Math.round(Math.max(0, Math.min(255, 255 * (centre - albedoAmp / 2 + albedoAmp * albedoHeight[i]))));
    rgb[i * 4] = v;
    rgb[i * 4 + 1] = v;
    rgb[i * 4 + 2] = v;
    rgb[i * 4 + 3] = 255;
  }
  const albedo = toTexture(rgb, size, true);
  const normal = toTexture(normalMap(normalHeight, size, normalStrength), size, false);
  albedo.repeat.set(repeatU, repeatV);
  normal.repeat.set(normalRepeatU, normalRepeatV);
  return { albedo, normal };
}

let skinMaps: DetailMaps | null = null;
let clothMaps: DetailMaps | null = null;
let leatherMaps: DetailMaps | null = null;
let hairMaps: DetailMaps | null = null;

/** Pores and a faint mottle. */
export function skinDetail(): DetailMaps {
  if (!skinMaps) {
    const size = 256;
    const pores = tileableNoise(size, 5, 41, 16);
    const mottle = tileableNoise(size, 3, 42, 3);
    skinMaps = detail(mottle, pores, size, 0.06, 0.22, 4, 2, 0.97, 12, 6);
  }
  return skinMaps;
}

/** A woven weave in the normals and soft fibre variation in the colour. */
export function clothDetail(): DetailMaps {
  if (!clothMaps) {
    const size = 256;
    const n = tileableNoise(size, 3, 77, 8);
    const weave = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const over = ((x >> 1) + (y >> 1)) % 2 === 0 ? 0.6 : 0.4;
        weave[y * size + x] = over * 0.7 + n[y * size + x] * 0.3;
      }
    }
    const fibre = tileableNoise(size, 4, 43, 6);
    // The weave is fine (a few millimetres); the fibre variation is broad.
    clothMaps = detail(fibre, weave, size, 0.12, 1.0, 5, 3, 0.96, 40, 20);
  }
  return clothMaps;
}

/** Grain and creases. */
export function leatherDetail(): DetailMaps {
  if (!leatherMaps) {
    const size = 256;
    const grain = tileableNoise(size, 5, 47, 8);
    const blotch = tileableNoise(size, 3, 48, 3);
    const h = new Float32Array(size * size);
    for (let i = 0; i < h.length; i++) h[i] = grain[i] * 0.65 + blotch[i] * 0.35;
    leatherMaps = detail(blotch, h, size, 0.16, 0.9, 4, 3, 0.95, 10, 6);
  }
  return leatherMaps;
}

/** Strands running with the hair's length: streaks in colour and in the normals. */
export function hairDetail(): DetailMaps {
  if (!hairMaps) {
    const size = 256;
    const fine = tileableNoise(size, 4, 31, 48);
    const slow = tileableNoise(size, 2, 32, 3);
    const h = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      const drift = Math.round(y * 0.15) % size; // strands wander a little down their length
      for (let x = 0; x < size; x++) {
        const streak = fine[drift * size + x];
        h[y * size + x] = streak * 0.7 + slow[y * size + x] * 0.3;
      }
    }
    hairMaps = detail(h, h, size, 0.4, 0.8, 8, 3, 0.95);
  }
  return hairMaps;
}
