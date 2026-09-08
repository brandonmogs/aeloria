import * as THREE from 'three';
import { ItemStack, itemDef } from '../sim/items';
import { box, flat, place, taperedBox } from './lowpoly';

/**
 * Builds the visible equipment worn on the avatar. Each function returns an
 * Object3D already positioned in the local space of the body part it attaches to
 * (helmet/chest hang off the torso group; boots, gloves, weapon, and shield hang
 * off a limb pivot so they swing with the limb). The cape is handled separately
 * in EntityView because it animates per-frame.
 *
 * Everything is boxes and prisms with a flat-shaded metal colour inferred from
 * the item id (bronze/iron/steel/…), so one set of shapes dresses every tier.
 */

function gearColor(id: string): number {
  if (id.includes('bronze')) return 0xa8703d;
  if (id.includes('iron')) return 0x6f7176;
  if (id.includes('steel')) return 0xb4b8bf;
  if (id.includes('black')) return 0x2e2e33;
  if (id.includes('mithril')) return 0x4d5aa8;
  if (id.includes('adamant')) return 0x3f8a52;
  if (id.includes('rune')) return 0x46b0c4;
  if (id.includes('gold') || id.includes('holy')) return 0xe2bf55;
  if (id.includes('leather')) return 0x7a5533;
  if (id.includes('wood')) return 0x8a5a2e;
  return 0x8a8f99;
}

function gearMaterial(item: ItemStack): THREE.MeshLambertMaterial {
  return flat(gearColor(item.id));
}

/** A helm over the head: a tapered cap with a nose guard. Attaches to the group. */
export function buildHelmet(item: ItemStack): THREE.Object3D {
  const g = new THREE.Group();
  const m = gearMaterial(item);
  g.add(place(taperedBox(0.36, 0.22, 0.36, 0.8), m, 0, 1.58, 0));
  g.add(place(box(0.36, 0.1, 0.36), m, 0, 1.45, 0));
  g.add(place(box(0.06, 0.16, 0.03), m, 0, 1.4, 0.18));
  return g;
}

/** A breastplate over the torso plus squared pauldrons. Attaches to the group. */
export function buildChest(item: ItemStack): THREE.Object3D {
  const g = new THREE.Group();
  const m = gearMaterial(item);
  g.add(place(taperedBox(0.5, 0.54, 0.32, 1.06), m, 0, 0.95, 0));
  for (const sx of [-0.31, 0.31]) g.add(place(box(0.18, 0.12, 0.22), m, sx, 1.22, 0));
  return g;
}

/** A thigh guard. Attaches to a leg pivot (built once per leg). */
export function buildLegGuard(item: ItemStack): THREE.Object3D {
  return place(box(0.2, 0.42, 0.22), gearMaterial(item), 0, -0.24, 0);
}

/** A chunky boot at the foot. Attaches to a leg pivot. */
export function buildBoot(item: ItemStack): THREE.Object3D {
  return place(box(0.19, 0.13, 0.32), gearMaterial(item), 0, -0.62, 0.04);
}

/** A gauntlet over the hand. Attaches to an arm pivot. */
export function buildGlove(item: ItemStack): THREE.Object3D {
  return place(box(0.16, 0.15, 0.16), gearMaterial(item), 0, -0.55, 0);
}

/** A weapon held in the hand, on the body's right as seen facing north. */
export function buildWeapon(item: ItemStack): THREE.Object3D {
  const def = itemDef(item.id);
  const g = new THREE.Group();
  const metal = gearMaterial(item);
  const grip = flat(0x3a2a1c);
  const gold = flat(0xc9a23a);

  if (def.axeTier || def.pickTier) {
    // A tool: long haft with a head on top.
    g.add(place(box(0.05, 0.78, 0.05), grip, 0, 0.3, 0));
    if (def.axeTier) {
      g.add(place(taperedBox(0.06, 0.26, 0.22, 1, 1.4), metal, 0, 0.62, 0.12));
    } else {
      g.add(place(box(0.06, 0.07, 0.42), metal, 0, 0.66, 0.06));
    }
  } else {
    // A sword: a flat blade in two angled segments (a scimitar's sweep),
    // a crossguard, a wrapped hilt, and a pommel.
    g.add(place(box(0.055, 0.34, 0.018), metal, 0, 0.21, 0));
    const tip = place(taperedBox(0.055, 0.24, 0.018, 0.3, 1), metal, 0.03, 0.48, 0);
    tip.rotation.z = -0.22;
    g.add(tip);
    g.add(place(box(0.18, 0.04, 0.05), gold, 0, 0.04, 0));
    g.add(place(box(0.04, 0.12, 0.04), grip, 0, -0.04, 0));
    g.add(place(box(0.06, 0.05, 0.06), gold, 0, -0.12, 0));
  }

  g.position.set(0, -0.5, 0.06); // in the hand
  g.rotation.set(0.35, 0, -0.1); // angled up and slightly forward
  return g;
}

/** A shield facing outward, on the body's left as seen facing north. */
export function buildShield(item: ItemStack): THREE.Object3D {
  const g = new THREE.Group();
  const m = gearMaterial(item);
  const boss = flat(0x5a3a22);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.05, 8), m);
  body.rotation.x = Math.PI / 2; // disc faces forward
  g.add(body);
  g.add(place(box(0.08, 0.08, 0.05), boss, 0, 0, 0.04));
  g.position.set(0.06, -0.4, 0.06);
  g.rotation.y = 0.25;
  return g;
}
