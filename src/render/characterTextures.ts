import * as THREE from 'three';
import { makeCanvas, normalMap, tileableNoise, toTexture } from './texgen';

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

const HEAD_TOP = 2.1; // head height in head-radius units (see headGeometry)

function bytes(hex: number): [number, number, number] {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

function rgba(hex: number, k = 1, a = 1): string {
  const [r, g, b] = bytes(hex);
  const c = (v: number): number => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgba(${c(r)}, ${c(g)}, ${c(b)}, ${a})`;
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

const faceCache = new Map<string, THREE.CanvasTexture>();

/**
 * A face painted for the head's revolve mapping: u runs around the skull with
 * the seam at the back, v runs with height (0 chin, 1 crown). Eyes, brows,
 * nostrils, lips and cheek warmth over a softly mottled skin. Goblins get big
 * amber eyes with slit pupils, heavy angry brows and a toothy grin.
 */
export function faceTexture(skin: number, hair: number, eyes: number, goblin: boolean): THREE.CanvasTexture {
  const key = `${skin}:${hair}:${eyes}:${goblin ? 1 : 0}`;
  const hit = faceCache.get(key);
  if (hit) return hit;

  const size = 512;
  const [canvas, ctx] = makeCanvas(size);

  // Skin with a soft mottle, darker under the jaw.
  const noise = tileableNoise(size, 4, 53, 6);
  const [r, g, b] = bytes(skin);
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    const v = 1 - y / size;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      let k = 0.985 + (noise[i] - 0.5) * (goblin ? 0.16 : 0.09);
      if (v < 0.14) k *= 0.86 + v;
      d[i * 4] = Math.min(255, r * k);
      d[i * 4 + 1] = Math.min(255, g * k);
      d[i * 4 + 2] = Math.min(255, b * k);
      d[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Map head-space coordinates (in head radii) to the canvas.
  const Y = (yHr: number): number => (1 - yHr / HEAD_TOP) * size;
  const X = (xHr: number, radiusHr: number): number =>
    (0.5 + Math.asin(Math.max(-1, Math.min(1, xHr / radiusHr))) / (Math.PI * 2)) * size;
  const eyeY = Y(1.27);
  const eyeR = goblin ? 1.0 : 0.99;
  const ex = [X(-0.34, eyeR), X(0.34, eyeR)];

  // Cheek warmth and a little shadow in the eye sockets.
  for (const cx of [X(-0.55, 0.95), X(0.55, 0.95)]) {
    const blush = ctx.createRadialGradient(cx, Y(1.0), 0, cx, Y(1.0), 40);
    blush.addColorStop(0, goblin ? 'rgba(90, 120, 40, 0.18)' : 'rgba(205, 95, 75, 0.14)');
    blush.addColorStop(1, 'rgba(205, 95, 75, 0)');
    ctx.fillStyle = blush;
    ctx.fillRect(cx - 40, Y(1.0) - 40, 80, 80);
  }
  for (const cx of ex) {
    const socket = ctx.createRadialGradient(cx, eyeY + 2, 0, cx, eyeY + 2, 30);
    socket.addColorStop(0, 'rgba(70, 35, 25, 0.2)');
    socket.addColorStop(1, 'rgba(70, 35, 25, 0)');
    ctx.fillStyle = socket;
    ctx.fillRect(cx - 30, eyeY - 30, 60, 60);
  }

  // Eyes.
  const rx = goblin ? 14 : 10.5;
  const ry = goblin ? 11 : 8;
  for (const cx of ex) {
    ctx.fillStyle = goblin ? '#e9e2c0' : '#f4f0e8';
    ctx.beginPath();
    ctx.ellipse(cx, eyeY, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    // Iris and pupil.
    const ir = goblin ? 8 : 5.6;
    const iris = ctx.createRadialGradient(cx, eyeY, ir * 0.2, cx, eyeY, ir);
    iris.addColorStop(0, rgba(eyes, 1.25));
    iris.addColorStop(1, rgba(eyes, 0.55));
    ctx.fillStyle = iris;
    ctx.beginPath();
    ctx.arc(cx, eyeY, ir, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#100c0a';
    ctx.beginPath();
    if (goblin) ctx.ellipse(cx, eyeY, 1.8, ir * 0.85, 0, 0, Math.PI * 2);
    else ctx.arc(cx, eyeY, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.beginPath();
    ctx.arc(cx - ir * 0.35, eyeY - ir * 0.35, 1.4, 0, Math.PI * 2);
    ctx.fill();
    // Lids: a dark lash line above, a faint line below.
    ctx.strokeStyle = 'rgba(40, 22, 14, 0.9)';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.ellipse(cx, eyeY, rx + 0.5, ry + 0.5, 0, Math.PI * 1.08, Math.PI * 1.92);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(40, 22, 14, 0.35)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(cx, eyeY, rx + 0.5, ry + 0.5, 0, Math.PI * 0.1, Math.PI * 0.9);
    ctx.stroke();
  }

  // Brows: tapered arcs in the hair colour, the outer end a touch lower.
  const browY = Y(goblin ? 1.5 : 1.46);
  ctx.strokeStyle = rgba(hair, 0.75, 0.95);
  ctx.lineCap = 'round';
  ctx.lineWidth = goblin ? 6 : 4.5;
  for (const [cx, side] of [
    [ex[0], -1],
    [ex[1], 1],
  ] as const) {
    ctx.beginPath();
    const w = goblin ? 17 : 15;
    if (goblin) {
      // Angry: inner ends pulled down.
      ctx.moveTo(cx - side * w, browY - 3);
      ctx.quadraticCurveTo(cx, browY - 6, cx + side * w, browY + 4);
    } else {
      ctx.moveTo(cx - side * w, browY + 1);
      ctx.quadraticCurveTo(cx, browY - 5, cx + side * w, browY + 3);
    }
    ctx.stroke();
  }

  // Nostrils under the modelled nose.
  ctx.fillStyle = 'rgba(60, 30, 20, 0.4)';
  for (const nx of [X(-0.1, 0.95), X(0.1, 0.95)]) {
    ctx.beginPath();
    ctx.ellipse(nx, Y(0.95), 3.5, 2.2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const noseShadow = ctx.createRadialGradient(size / 2, Y(0.92), 0, size / 2, Y(0.92), 16);
  noseShadow.addColorStop(0, 'rgba(60, 30, 20, 0.22)');
  noseShadow.addColorStop(1, 'rgba(60, 30, 20, 0)');
  ctx.fillStyle = noseShadow;
  ctx.fillRect(size / 2 - 16, Y(0.92) - 16, 32, 32);

  // Mouth.
  const mouthY = Y(0.66);
  const mw = goblin ? 27 : 18;
  if (!goblin) {
    ctx.fillStyle = 'rgba(150, 70, 60, 0.5)';
    ctx.beginPath();
    ctx.ellipse(size / 2, mouthY + 3.5, mw * 0.85, 4.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(120, 50, 45, 0.45)';
    ctx.beginPath();
    ctx.ellipse(size / 2, mouthY - 2, mw * 0.9, 2.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = goblin ? 'rgba(30, 20, 15, 0.95)' : 'rgba(80, 30, 28, 0.9)';
  ctx.lineWidth = goblin ? 3 : 2;
  ctx.beginPath();
  ctx.moveTo(size / 2 - mw, mouthY - (goblin ? 4 : 0));
  ctx.quadraticCurveTo(size / 2, mouthY + (goblin ? 6 : 2.5), size / 2 + mw, mouthY - (goblin ? 4 : 0));
  ctx.stroke();
  if (goblin) {
    ctx.fillStyle = '#e8e2cc';
    for (const tx of [-14, -4, 6, 16]) {
      ctx.beginPath();
      ctx.moveTo(size / 2 + tx - 3, mouthY + 1);
      ctx.lineTo(size / 2 + tx + 3, mouthY + 1);
      ctx.lineTo(size / 2 + tx, mouthY + 8);
      ctx.closePath();
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  faceCache.set(key, tex);
  return tex;
}
