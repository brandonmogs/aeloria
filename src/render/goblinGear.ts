import * as THREE from 'three';
import { Rig, lathe, material, put, shade } from './characters';
import { wedge } from './gear';

/**
 * The goblin's kit and features, after the classic goblin warrior: a lean
 * green brawler with huge swept-back ears, a long hooked nose and a heavy
 * brow, one spiked iron pauldron strapped across a bare chest, a leather
 * bracer on the sword arm, greaves buckled over bare shins, a rusty straight
 * sword and a spiked round shield. Every piece is sized from the rig it hangs
 * on, so it fits whatever proportions the goblin was built with.
 */

const RUST = 0x6e4c38;
const IRON = 0x4d463f;
const HIDE = 0x3f2e20;

function cone(r: number, h: number, sides = 6): THREE.BufferGeometry {
  const geo = new THREE.ConeGeometry(r, h, sides);
  geo.translate(0, h / 2, 0); // base at the origin, tip up
  return shade(geo);
}

/** Point a cone (built tip-up) along `dir`. */
function aim(mesh: THREE.Object3D, dir: THREE.Vector3): void {
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
}

function ring(r: number, y: number, thickness: number, height: number, mat: THREE.Material, segments = 14): THREE.Mesh {
  return put(lathe([[r, y - height / 2], [r + thickness, y - height / 2 + 0.004], [r + thickness, y + height / 2 - 0.004], [r, y + height / 2]], segments), mat);
}

// --- Features ------------------------------------------------------------------------

/** Bat ears, a hooked nose and a brow ridge, placed on the skull's landmarks. */
export function goblinFeatures(rig: Rig): THREE.Object3D {
  const g = new THREE.Group();
  const f = rig.dims.face;
  if (!f) return g;
  const hr = rig.dims.headR;
  const skin = material(0x86963a, 'skin');
  for (const [ear, side] of [
    [f.earL, 1],
    [f.earR, -1],
  ] as const) {
    // Broad bat ears, rooted in the skull and swept up and back.
    const dir = new THREE.Vector3(side * 0.8, 0.55, -0.35);
    const e = put(cone(0.55 * hr, 1.7 * hr, 5), skin, ear.x - side * 0.08 * hr, ear.y + 0.02 * hr, ear.z);
    e.scale.set(1, 1, 0.32);
    aim(e, dir);
    g.add(e);
    // Inner ear: a darker hollow on the front face.
    const inner = put(cone(0.34 * hr, 1.2 * hr, 5), material(0x5c6a2a, 'skin'), ear.x + side * 0.02 * hr, ear.y + 0.08 * hr, ear.z + 0.06 * hr);
    inner.scale.set(1, 1, 0.16);
    aim(inner, dir);
    g.add(inner);
  }
  // Nose: long and hooked, growing from the bridge and drooping past the mouth.
  const nose = put(cone(0.22 * hr, 1.3 * hr, 8), skin, 0, f.noseTip.y + 0.35 * hr, f.noseTip.z - 0.35 * hr);
  aim(nose, new THREE.Vector3(0, -0.75, 1));
  g.add(nose);
  const tip = put(shade(new THREE.SphereGeometry(0.17 * hr, 10, 8)), skin, 0, f.noseTip.y - 0.42 * hr, f.noseTip.z + 0.66 * hr);
  g.add(tip);
  // Brow ridge.
  const brow = put(shade(new THREE.BoxGeometry(1.25 * hr, 0.16 * hr, 0.3 * hr)), skin, 0, f.brow + 0.1 * hr, f.noseTip.z - 0.42 * hr);
  brow.rotation.x = 0.35;
  g.add(brow);
  return g;
}

// --- Armour ---------------------------------------------------------------------------

/** A spiked iron dome over the shield shoulder; hangs from the shoulder joint so it moves with the arm. */
export function goblinPauldron(rig: Rig): THREE.Object3D {
  const d = rig.dims;
  const s = d.scale;
  const g = new THREE.Group();
  const rust = material(RUST, 'rust');
  const R = d.deltoidR * 1.45;
  const dome = put(shade(new THREE.SphereGeometry(R, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.52)), rust, 0, -0.012 * s, 0);
  dome.scale.set(1, 0.85, 1);
  g.add(dome);
  g.add(ring(R * 0.97, -0.012 * s, 0.006 * s, 0.018 * s, rust, 20));
  // Spikes out along the surface normals.
  const spikes: Array<[number, number]> = [
    [0.15, 0],
    [0.7, 0.3],
    [0.7, 2.4],
    [0.7, 4.3],
  ];
  for (const [phi, theta] of spikes) {
    const n = new THREE.Vector3(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
    const spike = put(cone(0.014 * s, 0.07 * s, 5), rust);
    spike.position.copy(n).multiply(new THREE.Vector3(R, R * 0.85, R)).add(new THREE.Vector3(0, -0.012 * s, 0));
    aim(spike, n);
    g.add(spike);
  }
  return g;
}

/** The pauldron's strap: over the shield shoulder, across the chest and back to the far hip. */
export function goblinStrap(rig: Rig): THREE.Object3D {
  const d = rig.dims;
  const s = d.scale;
  const g = new THREE.Group();
  const hide = material(HIDE, 'leather');
  const profile = d.torsoProfile;
  const radiusAt = (y: number): number => {
    if (y <= profile[0][1]) return profile[0][0];
    for (let i = 0; i + 1 < profile.length; i++) {
      const [r0, y0] = profile[i];
      const [r1, y1] = profile[i + 1];
      if (y >= y0 && y <= y1) return r0 + ((r1 - r0) * (y - y0)) / Math.max(1e-6, y1 - y0);
    }
    return profile[profile.length - 1][0];
  };
  const on = (psi: number, y: number): THREE.Vector3 => {
    const r = radiusAt(y) * 1.04 + 0.006 * s;
    return new THREE.Vector3(r * Math.sin(psi), y, r * d.torsoFlatten * Math.cos(psi));
  };
  const top = d.torso - 0.075 * s;
  const bottom = -0.04 * s;
  const front = new THREE.CatmullRomCurve3([on(1.15, top), on(0.7, top - 0.09 * s), on(0.1, (top + bottom) / 2), on(-0.75, bottom + 0.06 * s), on(-1.35, bottom)]);
  const back = new THREE.CatmullRomCurve3([on(1.15, top), on(1.9, top - 0.07 * s), on(Math.PI, (top + bottom) / 2 + 0.02 * s), on(4.2, bottom + 0.06 * s), on(Math.PI * 2 - 1.35, bottom)]);
  for (const curve of [front, back]) {
    const tube = new THREE.TubeGeometry(curve, 28, 0.011 * s, 6, false);
    tube.scale(1, 1.6, 1); // a flat strap, not a rope
    g.add(put(shade(tube), hide));
  }
  return g;
}

/** A leather shin guard with iron straps, wrapped around the front of the shin. */
export function goblinGreave(rig: Rig): THREE.Object3D {
  const d = rig.dims;
  const s = d.scale;
  const g = new THREE.Group();
  const hide = material(HIDE, 'leather');
  const iron = material(IRON, 'rust');
  const shinAt = (t: number): number => d.shinR * (1.0 - 0.34 * t); // radius from the knee (t = 0) to the ankle (t = 1)
  const pts = [0.95, 0.75, 0.5, 0.25, 0.1].map((t) => new THREE.Vector2(shinAt(t) * 1.12 + 0.004 * s, -d.shin * t));
  const guard = new THREE.LatheGeometry(pts, 14, -Math.PI * 0.72, Math.PI * 1.44);
  guard.computeVertexNormals();
  g.add(put(shade(guard), hide));
  for (const t of [0.2, 0.55, 0.88]) g.add(ring(shinAt(t) * 1.12 + 0.004 * s, -d.shin * t, 0.007 * s, 0.014 * s, iron));
  return g;
}

/** A leather bracer with an iron band on the sword arm; hangs from the elbow. */
export function goblinBracer(rig: Rig): THREE.Object3D {
  const d = rig.dims;
  const s = d.scale;
  const g = new THREE.Group();
  const hide = material(HIDE, 'leather');
  const iron = material(IRON, 'rust');
  const fr = d.forearmR;
  g.add(put(lathe([[fr * 0.7 + 0.004 * s, -d.forearm + 0.012 * s], [fr * 0.82 + 0.004 * s, -d.forearm * 0.8], [fr * 0.98 + 0.004 * s, -d.forearm * 0.55], [fr * 1.02 + 0.004 * s, -d.forearm * 0.42]], 14), hide));
  g.add(ring(fr * 0.98 + 0.006 * s, -d.forearm * 0.62, 0.006 * s, 0.014 * s, iron));
  g.add(ring(fr * 0.78 + 0.006 * s, -d.forearm * 0.88, 0.006 * s, 0.012 * s, iron));
  return g;
}

// --- Weapons --------------------------------------------------------------------------

/** A crude straight sword, pitted with rust, held up the forearm like the other blades. */
export function goblinSword(rig: Rig): THREE.Object3D {
  const s = rig.dims.scale;
  const g = new THREE.Group();
  const rust = material(RUST, 'rust');
  const iron = material(IRON, 'rust');
  const grip = material(0x2f2218, 'leather');
  g.add(put(wedge(0.062, 0.64, 0.014, 0.3, 0.5), rust, 0, 0.34, 0));
  g.add(put(shade(new THREE.BoxGeometry(0.18, 0.028, 0.036)), iron, 0, 0.015, 0));
  g.add(put(shade(new THREE.CylinderGeometry(0.017, 0.02, 0.11, 8)), grip, 0, -0.045, 0));
  g.add(put(shade(new THREE.BoxGeometry(0.036, 0.03, 0.03)), iron, 0, -0.11, 0));
  g.scale.setScalar(s * 1.15);
  g.position.set(0, -0.075 * s, 0.03 * s);
  g.rotation.set(0.3, 0, -0.08);
  return g;
}

/** A round hide-faced shield with an iron rim, boss and a ring of spikes, on the left forearm. */
export function goblinShield(rig: Rig): THREE.Object3D {
  const s = rig.dims.scale;
  const g = new THREE.Group();
  const face = material(0x4a392b, 'leather');
  const rust = material(RUST, 'rust');
  const disc = put(lathe([[0, 0], [0.2, 0], [0.2, 0.035], [0.1, 0.05], [0, 0.06]], 20), face);
  disc.rotation.x = Math.PI / 2;
  g.add(disc);
  const rim = put(lathe([[0.19, 0.03], [0.215, 0.035], [0.215, 0.06], [0.19, 0.065]], 20), rust);
  rim.rotation.x = Math.PI / 2;
  g.add(rim);
  const boss = put(cone(0.032, 0.07, 6), rust, 0, 0, 0.055);
  boss.rotation.x = Math.PI / 2;
  g.add(boss);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    const spike = put(cone(0.02, 0.065, 5), rust, Math.cos(a) * 0.125, Math.sin(a) * 0.125, 0.05);
    spike.rotation.x = Math.PI / 2;
    g.add(spike);
  }
  g.scale.setScalar(s * 1.2);
  g.position.set(0.06 * s, 0.02 * s, 0.03 * s);
  g.rotation.y = 0.35;
  return g;
}
