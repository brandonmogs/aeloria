import * as THREE from 'three';

/**
 * The building blocks of Aeloria's look: Old School RuneScape's models are
 * low-poly, hard-edged, and lit per face (Gouraud shading with no textures on
 * most things), so everything here is boxes, prisms, and a few coarse
 * polyhedra under a flat-shaded Lambert material. No PBR, no roundness.
 */

/** A flat-shaded matte material — the one shading model the whole game uses. */
export function flat(
  color: number,
  extra: THREE.MeshStandardMaterialParameters = {},
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, metalness: 0, envMapIntensity: 0.5, ...extra });
}

/** A box whose top face is scaled by `topX`/`topZ` (below 1 pinches, above flares). */
export function taperedBox(
  w: number,
  h: number,
  d: number,
  topX: number,
  topZ = topX,
): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 0) {
      pos.setX(i, pos.getX(i) * topX);
      pos.setZ(i, pos.getZ(i) * topZ);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

/** A plain box. */
export function box(w: number, h: number, d: number): THREE.BoxGeometry {
  return new THREE.BoxGeometry(w, h, d);
}

/** Build a mesh and place it in one call. */
export function place(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

/** Mark every mesh under `obj` as casting (and optionally receiving) shadows. */
export function shadowed<T extends THREE.Object3D>(obj: T, receive = false): T {
  obj.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = receive;
    }
  });
  return obj;
}

/** Deterministic sub-seed in [0, 1) so a prop's parts vary without randomness. */
export function seedAt(seed: number, i: number): number {
  const v = Math.sin(seed * 127.1 + i * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

/** A seeded PRNG in the shape three's SimplexNoise expects. */
export function seededRandom(seed: number): { random: () => number } {
  let state = seed >>> 0;
  return {
    random: () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
