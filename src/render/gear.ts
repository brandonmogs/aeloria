import * as THREE from 'three';
import { Item } from '../sim/Inventory';

/**
 * Builds the visible equipment worn on the avatar. Each function returns an
 * Object3D already positioned in the local space of the body part it attaches to
 * (helmet/chest hang off the torso group; boots, gloves, weapon, and shield hang
 * off a limb pivot so they swing with the limb). The cape is handled separately
 * in EntityView because it animates per-frame.
 *
 * Colours are inferred from the item id (bronze/iron/steel/gold/leather/wood) so
 * the same shapes serve a whole tier of gear without bespoke meshes per item.
 */

function gearColor(id: string): number {
  if (id.includes('bronze')) return 0x9c6b3f;
  if (id.includes('iron')) return 0x70737a;
  if (id.includes('steel')) return 0xacb1b8;
  if (id.includes('gold')) return 0xe8c66a;
  if (id.includes('leather')) return 0x6b4a2f;
  if (id.includes('wood')) return 0x7a5230;
  return 0x8a8f99;
}

function gearMaterial(item: Item): THREE.MeshStandardMaterial {
  const matte = /leather|wood|cloth/.test(item.id);
  return new THREE.MeshStandardMaterial({
    color: gearColor(item.id),
    metalness: matte ? 0.05 : 0.72,
    roughness: matte ? 0.8 : 0.38,
    envMapIntensity: matte ? 0.4 : 0.85,
  });
}

/** A domed helm over the head with a simple nose guard. Attaches to the group. */
export function buildHelmet(item: Item): THREE.Object3D {
  const g = new THREE.Group();
  const m = gearMaterial(item);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.185, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.62),
    m,
  );
  dome.position.y = 1.33;
  dome.scale.set(1, 1.06, 1.02);
  g.add(dome);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.03), m);
  nose.position.set(0, 1.3, 0.17);
  g.add(nose);
  return g;
}

/** A breastplate over the torso plus rounded pauldrons. Attaches to the group. */
export function buildChest(item: Item): THREE.Object3D {
  const g = new THREE.Group();
  const m = gearMaterial(item);
  const profile = [
    [0.13, 0.0],
    [0.19, 0.12],
    [0.225, 0.3],
    [0.215, 0.44],
    [0.15, 0.52],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const lathe = new THREE.LatheGeometry(profile, 24);
  lathe.scale(1, 1, 0.64);
  const body = new THREE.Mesh(lathe, m);
  body.position.y = 0.64;
  g.add(body);
  for (const sx of [-0.21, 0.21]) {
    const pauldron = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 12), m);
    pauldron.position.set(sx, 1.12, 0);
    pauldron.scale.set(1, 0.8, 0.95);
    g.add(pauldron);
  }
  return g;
}

/** A thigh guard. Attaches to a leg pivot (built once per leg). */
export function buildLegGuard(item: Item): THREE.Object3D {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.108, 0.1, 0.34, 12), gearMaterial(item));
  m.position.y = -0.2;
  return m;
}

/** A chunky boot at the foot. Attaches to a leg pivot. */
export function buildBoot(item: Item): THREE.Object3D {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 12), gearMaterial(item));
  m.position.set(0, -0.54, 0.03);
  m.scale.set(1.0, 0.78, 1.5); // squashed and lengthened into a foot
  return m;
}

/** A gauntlet over the hand. Attaches to an arm pivot. */
export function buildGlove(item: Item): THREE.Object3D {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 12), gearMaterial(item));
  m.position.y = -0.5;
  return m;
}

/** A sword held point-up beside the body, on the body's right as seen facing north. */
export function buildWeapon(item: Item): THREE.Object3D {
  const g = new THREE.Group();
  const steel = gearMaterial(item);
  const grip = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.85 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xc9a23a, metalness: 0.8, roughness: 0.3 });

  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.46, 0.012), steel);
  blade.position.y = 0.27;
  g.add(blade);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.023, 0.08, 4), steel);
  tip.position.y = 0.54;
  g.add(tip);
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.04), gold);
  guard.position.y = 0.04;
  g.add(guard);
  const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.1, 8), grip);
  hilt.position.y = -0.03;
  g.add(hilt);
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), gold);
  pommel.position.y = -0.09;
  g.add(pommel);

  g.position.set(0, -0.5, 0.05); // in the hand
  g.rotation.set(0.35, 0, -0.12); // angled up and slightly forward
  return g;
}

/** A round shield facing outward, on the body's left as seen facing north. */
export function buildShield(item: Item): THREE.Object3D {
  const g = new THREE.Group();
  const m = gearMaterial(item);
  const boss = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.6, metalness: 0.3 });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.04, 22), m);
  body.rotation.x = Math.PI / 2; // disc faces forward
  g.add(body);
  const stud = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 10), boss);
  stud.position.z = 0.035;
  g.add(stud);

  g.position.set(0.06, -0.42, 0.06);
  g.rotation.y = 0.25;
  return g;
}
