import * as THREE from 'three';
import { ItemStack, itemDef } from '../sim/items';

/**
 * Aeloria's character and equipment models, built the way Old School
 * RuneScape's are: low-poly, tapered, faceted — six- and eight-sided prisms
 * and lathes with smooth (Gouraud) shading, so a figure has shoulders, a
 * waist, and a jaw rather than a stack of cubes. Colour gradients are baked
 * into vertex colours instead of textures, exactly as the 2007 models did.
 */

/** The swinging parts every rig exposes to the animator. */
export interface Rig {
  group: THREE.Group;
  legL: THREE.Object3D;
  legR: THREE.Object3D;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  /** The arm holding the weapon; the one that swings on attack. */
  weaponArm: THREE.Object3D;
  /** Height above the origin for the health bar / hitsplats. */
  barHeight: number;
}

// --- Materials & geometry helpers ------------------------------------------------

const materialCache = new Map<string, THREE.MeshStandardMaterial>();

/** A smooth-shaded matte material with vertex colours enabled, cached by colour. */
export function smooth(color: number): THREE.MeshStandardMaterial {
  const key = `s${color}`;
  let m = materialCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, vertexColors: true, roughness: 0.82, metalness: 0, envMapIntensity: 0.55 });
    materialCache.set(key, m);
  }
  return m;
}

/**
 * Bake a top-to-bottom brightness gradient into vertex colours (the material
 * multiplies these by its base colour). `top`/`bottom` are brightness factors.
 */
export function shade(geo: THREE.BufferGeometry, top = 1.06, bottom = 0.82): THREE.BufferGeometry {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  geo.computeBoundingBox();
  const box = geo.boundingBox!;
  const span = Math.max(1e-5, box.max.y - box.min.y);
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - box.min.y) / span;
    const v = bottom + (top - bottom) * t;
    colors[i * 3] = v;
    colors[i * 3 + 1] = v;
    colors[i * 3 + 2] = v;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

/** A tapered polygonal prism (a low-poly limb, post, or neck). */
export function prism(rTop: number, rBottom: number, height: number, sides = 6): THREE.BufferGeometry {
  return shade(new THREE.CylinderGeometry(rTop, rBottom, height, sides));
}

/** Revolve a [radius, height] profile into a low-poly solid, optionally flattened in z. */
export function lathe(profile: ReadonlyArray<readonly [number, number]>, sides = 8, flattenZ = 1): THREE.BufferGeometry {
  const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
  const geo = new THREE.LatheGeometry(pts, sides);
  if (flattenZ !== 1) geo.scale(1, 1, flattenZ);
  geo.computeVertexNormals();
  return shade(geo);
}

/** A box whose top face is scaled: feet, wedges, blade tips. */
export function wedge(w: number, h: number, d: number, topX: number, topZ = topX): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 0) {
      pos.setX(i, pos.getX(i) * topX);
      pos.setZ(i, pos.getZ(i) * topZ);
    }
  }
  geo.computeVertexNormals();
  return shade(geo);
}

export function put(geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, smooth(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/**
 * A limb is a pivot group at the joint with a tapered prism hanging below it,
 * so the caller can swing the whole thing with `rotation.x`. The tip is a hand
 * or a foot in a contrasting colour; feet are wedges that poke forward.
 */
export function limb(
  rTop: number,
  rBottom: number,
  length: number,
  color: number,
  tipColor: number,
  foot: boolean,
): THREE.Group {
  const pivot = new THREE.Group();
  pivot.add(put(prism(rTop, rBottom, length), color, 0, -length / 2, 0));
  if (foot) {
    pivot.add(put(wedge(rBottom * 2.1, 0.1, rBottom * 3.6, 0.8, 0.85), tipColor, 0, -length - 0.05, rBottom * 0.9));
  } else {
    pivot.add(put(prism(rBottom * 1.05, rBottom * 0.8, 0.13, 5), tipColor, 0, -length - 0.06, 0));
  }
  return pivot;
}

// --- The human rig ------------------------------------------------------------------

export interface HumanPalette {
  skin: number;
  tunic: number;
  trouser: number;
  boots: number;
  hair: number;
}

/**
 * The player-character rig: broad shoulders, pinched waist, a big angular
 * head, long arms with big hands — RuneScape proportions, about 1.7 tiles
 * tall. Limbs pivot at the shoulders and hips.
 */
export function buildHuman(p: HumanPalette, extras?: (g: THREE.Group, armL: THREE.Group, armR: THREE.Group) => void): Rig {
  const group = new THREE.Group();
  group.rotation.order = 'YXZ';

  // Torso: waist → chest → shoulders → neck, flattened front-to-back.
  const torso = put(
    lathe(
      [
        [0.15, 0],
        [0.2, 0.14],
        [0.24, 0.32],
        [0.27, 0.46],
        [0.2, 0.52],
        [0.1, 0.54],
      ],
      8,
      0.62,
    ),
    p.tunic,
    0,
    0.72,
    0,
  );
  group.add(torso);
  group.add(put(lathe([[0.19, 0], [0.19, 0.06], [0.17, 0.06]], 8, 0.62), p.boots, 0, 0.7, 0)); // belt
  group.add(put(prism(0.06, 0.07, 0.09, 6), p.skin, 0, 1.28, 0)); // neck

  // Head: chin, jaw, cheekbones, brow, crown.
  group.add(
    put(
      lathe(
        [
          [0.07, 0],
          [0.14, 0.05],
          [0.17, 0.17],
          [0.165, 0.29],
          [0.1, 0.37],
          [0, 0.39],
        ],
        8,
        0.9,
      ),
      p.skin,
      0,
      1.32,
      0,
    ),
  );
  // Hair: a crown cap plus a mane down the back, leaving the face open.
  group.add(put(lathe([[0.17, 0.27], [0.19, 0.3], [0.13, 0.39], [0, 0.415]], 8, 0.92), p.hair, 0, 1.325, 0));
  const mane = new THREE.LatheGeometry(
    [new THREE.Vector2(0.185, 0.08), new THREE.Vector2(0.19, 0.2), new THREE.Vector2(0.18, 0.3)],
    6,
    Math.PI * 0.85,
    Math.PI * 1.3,
  );
  mane.scale(1, 1, 0.92);
  mane.computeVertexNormals();
  group.add(put(shade(mane), p.hair, 0, 1.325, 0));
  for (const sx of [-0.055, 0.055]) group.add(put(wedge(0.035, 0.03, 0.02, 0.8), 0x1c1a12, sx, 1.53, 0.152));

  const legL = limb(0.095, 0.07, 0.6, p.trouser, p.boots, true);
  legL.position.set(-0.1, 0.72, 0);
  const legR = limb(0.095, 0.07, 0.6, p.trouser, p.boots, true);
  legR.position.set(0.1, 0.72, 0);
  const armL = limb(0.072, 0.055, 0.5, p.tunic, p.skin, false);
  armL.position.set(-0.3, 1.2, 0);
  const armR = limb(0.072, 0.055, 0.5, p.tunic, p.skin, false);
  armR.position.set(0.3, 1.2, 0);
  group.add(legL, legR, armL, armR);

  extras?.(group, armL, armR);
  return { group, legL, legR, armL, armR, weaponArm: armL, barHeight: 1.98 };
}

/** A steel skull-cap with a nose guard, sized for the human head. */
export function addHelm(g: THREE.Group, color: number): void {
  g.add(put(lathe([[0.19, 0.18], [0.2, 0.26], [0.16, 0.37], [0, 0.42]], 8, 0.92), color, 0, 1.325, 0));
  g.add(put(wedge(0.05, 0.16, 0.03, 0.8), color, 0, 1.44, 0.17));
}

// --- Monsters ---------------------------------------------------------------------------

/** A hunched goblin: pot belly, huge jaw, long nose, bat ears, a crude club. */
export function buildGoblin(): Rig {
  const group = new THREE.Group();
  group.rotation.order = 'YXZ';
  const skin = 0x7d9c3c;
  const cloth = 0x6b4a2f;

  group.add(put(lathe([[0.14, 0], [0.21, 0.12], [0.2, 0.3], [0.13, 0.38], [0.06, 0.4]], 7, 0.78), skin, 0, 0.44, 0));
  group.add(put(lathe([[0.2, 0], [0.19, 0.1], [0.15, 0.1]], 7, 0.8), cloth, 0, 0.36, 0)); // loincloth
  group.add(put(lathe([[0.1, 0], [0.19, 0.06], [0.18, 0.2], [0.15, 0.3], [0, 0.33]], 7, 0.9), skin, 0, 0.84, 0.02)); // head
  const nose = put(new THREE.ConeGeometry(0.045, 0.16, 5), skin, 0, 0.96, 0.22);
  nose.rotation.x = Math.PI / 2;
  group.add(nose);
  for (const sx of [-0.19, 0.19]) {
    const ear = put(new THREE.ConeGeometry(0.06, 0.24, 4), skin, sx, 1.06, 0);
    ear.rotation.z = sx < 0 ? 1.1 : -1.1;
    group.add(ear);
    group.add(put(wedge(0.035, 0.03, 0.02, 0.8), 0x1c1a12, sx * 0.4, 1.02, 0.16));
  }

  const legL = limb(0.065, 0.05, 0.34, skin, cloth, true);
  legL.position.set(-0.09, 0.42, 0);
  const legR = limb(0.065, 0.05, 0.34, skin, cloth, true);
  legR.position.set(0.09, 0.42, 0);
  const armL = limb(0.055, 0.045, 0.4, skin, skin, false);
  armL.position.set(-0.23, 0.76, 0);
  const armR = limb(0.055, 0.045, 0.4, skin, skin, false);
  armR.position.set(0.23, 0.76, 0);
  group.add(legL, legR, armL, armR);

  const club = new THREE.Group();
  club.add(put(prism(0.022, 0.028, 0.36, 5), cloth, 0, 0.16, 0));
  club.add(put(lathe([[0.03, 0], [0.08, 0.06], [0.07, 0.16], [0, 0.2]], 6), 0x7a5230, 0, 0.32, 0));
  club.position.set(0, -0.38, 0.04);
  club.rotation.x = 0.5;
  armR.add(club);

  return { group, legL, legR, armL, armR, weaponArm: armR, barHeight: 1.45 };
}

/** A giant rat: a long lathe body on four stubby legs, wedge snout, bald tail. */
export function buildRat(): Rig {
  const group = new THREE.Group();
  group.rotation.order = 'YXZ';
  const fur = 0x6f5c48;
  const dark = 0x4a3d30;
  const pink = 0xc98b8b;

  // The body lathe is built vertical then laid along z (tail at -z).
  const body = new THREE.LatheGeometry(
    [new THREE.Vector2(0.06, -0.4), new THREE.Vector2(0.15, -0.25), new THREE.Vector2(0.17, 0.05), new THREE.Vector2(0.13, 0.3), new THREE.Vector2(0.09, 0.42), new THREE.Vector2(0.03, 0.62)],
    7,
  );
  body.rotateX(Math.PI / 2);
  body.computeVertexNormals();
  group.add(put(shade(body, 1.02, 0.85), fur, 0, 0.24, 0));
  const snout = put(new THREE.ConeGeometry(0.05, 0.12, 5), pink, 0, 0.2, 0.66);
  snout.rotation.x = Math.PI / 2;
  group.add(snout);
  for (const sx of [-0.08, 0.08]) {
    group.add(put(lathe([[0.06, 0], [0.05, 0.02], [0, 0.03]], 6), pink, sx, 0.36, 0.34));
    group.add(put(wedge(0.03, 0.03, 0.02, 0.8), 0x1c1a12, sx * 0.8, 0.26, 0.5));
  }
  const tail = put(new THREE.ConeGeometry(0.035, 0.7, 5), pink, 0, 0.14, -0.7);
  tail.rotation.x = -Math.PI / 2 - 0.15;
  group.add(tail);

  const legL = limb(0.04, 0.035, 0.14, fur, dark, false);
  legL.position.set(-0.11, 0.16, -0.18);
  const legR = limb(0.04, 0.035, 0.14, fur, dark, false);
  legR.position.set(0.11, 0.16, -0.18);
  const armL = limb(0.04, 0.035, 0.14, fur, dark, false);
  armL.position.set(-0.11, 0.16, 0.2);
  const armR = limb(0.04, 0.035, 0.14, fur, dark, false);
  armR.position.set(0.11, 0.16, 0.2);
  group.add(legL, legR, armL, armR);

  return { group, legL, legR, armL, armR, weaponArm: armR, barHeight: 0.85 };
}

// --- Equipment ------------------------------------------------------------------------------
// Each builder returns an Object3D positioned in the local space of the body
// part it attaches to (helm/body on the group; legs, boots, gloves, weapon and
// shield on a limb pivot so they swing with it).

function metalColor(id: string): number {
  if (id.includes('bronze')) return 0xa8703d;
  if (id.includes('iron')) return 0x6f7176;
  if (id.includes('steel')) return 0xb4b8bf;
  if (id.includes('black')) return 0x2e2e33;
  if (id.includes('mithril')) return 0x4d5aa8;
  if (id.includes('adamant')) return 0x3f8a52;
  if (id.includes('rune')) return 0x46b0c4;
  if (id.includes('gold') || id.includes('holy')) return 0xe2bf55;
  if (id.includes('leather')) return 0x7a5533;
  if (id.includes('goblin')) return 0x6b4a2f;
  if (id.includes('wood')) return 0x8a5a2e;
  return 0x8a8f99;
}

export function buildHelmet(item: ItemStack): THREE.Object3D {
  const g = new THREE.Group();
  const c = metalColor(item.id);
  if (item.id.includes('full_helm')) {
    // A full helm: the whole head boxed in, with a T-shaped face slit.
    g.add(put(lathe([[0.18, 0.02], [0.2, 0.14], [0.2, 0.3], [0.15, 0.38], [0, 0.42]], 8, 0.94), c, 0, 1.325, 0));
    g.add(put(wedge(0.03, 0.14, 0.03, 1), 0x1c1a12, 0, 1.5, 0.19));
    g.add(put(wedge(0.14, 0.03, 0.03, 1), 0x1c1a12, 0, 1.53, 0.19));
  } else if (item.id.includes('cowl')) {
    g.add(put(lathe([[0.19, 0.1], [0.21, 0.24], [0.17, 0.37], [0, 0.41]], 7, 0.94), c, 0, 1.325, 0));
  } else {
    addHelm(g, c);
  }
  return g;
}

export function buildChest(item: ItemStack): THREE.Object3D {
  const g = new THREE.Group();
  const c = metalColor(item.id);
  const plate = item.id.includes('platebody');
  g.add(
    put(
      lathe(
        [
          [0.17, 0],
          [0.22, 0.14],
          [0.26, 0.32],
          [0.29, 0.46],
          [0.21, 0.53],
          [0.11, 0.55],
        ],
        plate ? 8 : 7,
        0.64,
      ),
      c,
      0,
      0.72,
      0,
    ),
  );
  if (plate) {
    for (const sx of [-0.3, 0.3]) g.add(put(lathe([[0.1, 0], [0.13, 0.06], [0.08, 0.12], [0, 0.13]], 6), c, sx, 1.2, 0));
  }
  return g;
}

export function buildLegGuard(item: ItemStack): THREE.Object3D {
  return put(prism(0.11, 0.085, 0.5, 6), metalColor(item.id), 0, -0.26, 0);
}

export function buildBoot(item: ItemStack): THREE.Object3D {
  return put(wedge(0.17, 0.13, 0.3, 0.8, 0.85), metalColor(item.id), 0, -0.63, 0.06);
}

export function buildGlove(item: ItemStack): THREE.Object3D {
  return put(prism(0.075, 0.06, 0.15, 5), metalColor(item.id), 0, -0.55, 0);
}

/** Weapons, by family: blades, blunt heads, axe heads, tools. Held point-up. */
export function buildWeapon(item: ItemStack): THREE.Object3D {
  const def = itemDef(item.id);
  const g = new THREE.Group();
  const metal = metalColor(item.id);
  const grip = 0x3a2a1c;
  const gold = 0xc9a23a;
  const type = def.weaponType ?? 'sword';

  const hilt = (): void => {
    g.add(put(prism(0.02, 0.022, 0.12, 6), grip, 0, -0.04, 0));
    g.add(put(lathe([[0.02, 0], [0.035, 0.02], [0.02, 0.045], [0, 0.05]], 6), gold, 0, -0.12, 0));
  };

  switch (type) {
    case 'dagger':
      g.add(put(wedge(0.05, 0.3, 0.014, 0.15, 0.6), metal, 0, 0.17, 0));
      g.add(put(wedge(0.14, 0.03, 0.04, 0.8), gold, 0, 0.02, 0));
      hilt();
      break;
    case 'sword':
      g.add(put(wedge(0.06, 0.5, 0.016, 0.2, 0.6), metal, 0, 0.27, 0));
      g.add(put(wedge(0.2, 0.035, 0.04, 0.8), gold, 0, 0.02, 0));
      hilt();
      break;
    case 'longsword':
      g.add(put(wedge(0.065, 0.66, 0.016, 0.2, 0.6), metal, 0, 0.35, 0));
      g.add(put(wedge(0.24, 0.035, 0.04, 0.8), gold, 0, 0.02, 0));
      hilt();
      break;
    case '2h':
      g.add(put(wedge(0.08, 0.9, 0.018, 0.18, 0.6), metal, 0, 0.47, 0));
      g.add(put(wedge(0.3, 0.04, 0.05, 0.8), gold, 0, 0.02, 0));
      g.add(put(prism(0.022, 0.024, 0.22, 6), grip, 0, -0.09, 0));
      g.add(put(lathe([[0.025, 0], [0.04, 0.025], [0, 0.05]], 6), gold, 0, -0.22, 0));
      break;
    case 'scimitar': {
      g.add(put(wedge(0.055, 0.32, 0.014, 0.9, 0.7), metal, 0, 0.18, 0));
      const tip = put(wedge(0.05, 0.26, 0.012, 0.15, 0.6), metal, 0.06, 0.46, 0);
      tip.rotation.z = -0.35;
      g.add(tip);
      g.add(put(wedge(0.16, 0.035, 0.04, 0.8), gold, 0, 0.02, 0));
      hilt();
      break;
    }
    case 'mace':
      g.add(put(prism(0.02, 0.024, 0.5, 6), grip, 0, 0.2, 0));
      g.add(put(lathe([[0.03, 0], [0.09, 0.06], [0.09, 0.14], [0.03, 0.2], [0, 0.21]], 6), metal, 0, 0.44, 0));
      break;
    case 'warhammer':
      g.add(put(prism(0.022, 0.026, 0.5, 6), grip, 0, 0.2, 0));
      g.add(put(wedge(0.26, 0.14, 0.12, 0.9), metal, 0, 0.5, 0));
      break;
    case 'battleaxe': {
      g.add(put(prism(0.022, 0.026, 0.62, 6), grip, 0, 0.26, 0));
      for (const side of [-1, 1]) {
        const blade = put(wedge(0.06, 0.28, 0.24, 1, 1.5), metal, side * 0.12, 0.5, 0);
        blade.rotation.z = side * Math.PI / 2;
        g.add(blade);
      }
      break;
    }
    case 'axe': {
      g.add(put(prism(0.02, 0.026, 0.72, 6), grip, 0, 0.3, 0));
      const head = put(wedge(0.06, 0.24, 0.2, 1, 1.5), metal, 0.11, 0.58, 0);
      head.rotation.z = Math.PI / 2;
      g.add(head);
      break;
    }
    case 'pickaxe': {
      g.add(put(prism(0.02, 0.026, 0.74, 6), grip, 0, 0.3, 0));
      const spike = put(new THREE.ConeGeometry(0.035, 0.42, 5), metal, 0, 0.64, 0.14);
      spike.rotation.x = Math.PI / 2;
      g.add(spike);
      g.add(put(wedge(0.05, 0.06, 0.16, 0.9), metal, 0, 0.64, -0.06));
      break;
    }
    default:
      g.add(put(wedge(0.06, 0.5, 0.016, 0.2, 0.6), metal, 0, 0.27, 0));
      hilt();
  }

  g.position.set(0, -0.5, 0.06); // in the hand
  g.rotation.set(0.35, 0, -0.1); // angled up and slightly forward
  return g;
}

/** Shields: a round wooden one, a bevelled square, or a pointed kite. */
export function buildShield(item: ItemStack): THREE.Object3D {
  const g = new THREE.Group();
  const c = metalColor(item.id);
  if (item.id.includes('kiteshield')) {
    const shape = new THREE.Shape();
    shape.moveTo(-0.17, 0.2);
    shape.lineTo(0.17, 0.2);
    shape.lineTo(0.19, 0.02);
    shape.lineTo(0.0, -0.3);
    shape.lineTo(-0.19, 0.02);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.015, bevelSegments: 1 });
    geo.computeVertexNormals();
    g.add(put(shade(geo), c, 0, 0, 0));
  } else if (item.id.includes('sq_shield')) {
    g.add(put(wedge(0.34, 0.06, 0.38, 0.85), c, 0, 0, 0).rotateX(Math.PI / 2));
  } else {
    const disc = put(lathe([[0, 0], [0.2, 0], [0.2, 0.04], [0.08, 0.07], [0, 0.07]], 8), c, 0, 0, 0);
    disc.rotation.x = Math.PI / 2;
    g.add(disc);
  }
  g.position.set(0.06, -0.4, 0.06);
  g.rotation.y = 0.25;
  return g;
}
