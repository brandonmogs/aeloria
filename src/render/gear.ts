import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ItemStack, itemDef } from '../sim/items';
import { Rig, lathe, material, put, shade } from './characters';

/**
 * Worn equipment and NPC costume pieces, sized against the rig they attach
 * to. Each builder returns an object positioned in the local space of the
 * socket it belongs on (see {@link Rig.sockets}): helmets on the head, body
 * armour on the torso, guards on the thighs and shins, boots on the feet,
 * gloves and weapons on the hands, shields on the off hand.
 */

function metalColor(id: string): number {
  if (id.includes('bronze')) return 0xb07a45;
  if (id.includes('iron')) return 0x7a7c80;
  if (id.includes('steel')) return 0xc2c6cc;
  if (id.includes('black')) return 0x2e2e33;
  if (id.includes('mithril')) return 0x4d5aa8;
  if (id.includes('adamant')) return 0x3f8a52;
  if (id.includes('rune')) return 0x46b0c4;
  if (id.includes('gold') || id.includes('holy')) return 0xe2bf55;
  if (id.includes('leather')) return 0x7a5533;
  if (id.includes('goblin')) return 0x6b4a2f;
  if (id.includes('wood') || id.includes('oak') || id.includes('willow')) return 0x8a5a2e;
  return 0x8a8f99;
}

function finishOf(id: string): 'metal' | 'leather' {
  return id.includes('leather') || id.includes('cowl') || id.includes('goblin') ? 'leather' : 'metal';
}

function box(w: number, h: number, d: number): THREE.BufferGeometry {
  return shade(new THREE.BoxGeometry(w, h, d), 1.02, 0.94);
}

/** A tapered box (feet, wedges, blade tips): the top face scaled by `topX`/`topZ`. */
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

function prism(rTop: number, rBottom: number, height: number, sides = 8): THREE.BufferGeometry {
  return shade(new THREE.CylinderGeometry(rTop, rBottom, height, sides));
}

// --- Head ---------------------------------------------------------------------------

interface HeadFrame {
  /** Skull half-width. */
  hr: number;
  top: number;
  brow: number;
  chin: number;
  chinZ: number;
  /** Centre of the skull front-to-back, and its depth relative to width. */
  cz: number;
  flatten: number;
}

/** Where the skull is, relative to the head socket, so hats sit on it. */
function headFrame(rig: Rig): HeadFrame {
  const d = rig.dims;
  const hr = d.headR;
  const f = d.face;
  if (!f) return { hr, top: 2.1 * hr, brow: 1.45 * hr, chin: 0.05 * hr, chinZ: 0.85 * hr, cz: 0, flatten: d.headFlatten };
  return { hr, top: f.top, brow: f.brow, chin: f.chin, chinZ: f.chinZ, cz: (f.front + f.back) / 2, flatten: (f.front - f.back) / (2 * hr) };
}

function onSkull(h: HeadFrame, geo: THREE.BufferGeometry, m: THREE.Material): THREE.Mesh {
  return put(geo, m, 0, 0, h.cz);
}

/** A steel skull-cap with a nose guard. */
export function skullCap(rig: Rig, color: number, finish: 'metal' | 'leather' = 'metal'): THREE.Object3D {
  const h = headFrame(rig);
  const hr = h.hr;
  const g = new THREE.Group();
  const m = material(color, finish);
  const span = h.top - h.brow;
  g.add(onSkull(h, lathe([[1.07 * hr, h.brow + 0.012], [1.13 * hr, h.brow + span * 0.45], [0.98 * hr, h.brow + span * 0.88], [0.5 * hr, h.top + 0.02], [0, h.top + 0.04]], 24, h.flatten), m));
  g.add(put(box(0.14 * hr, (h.brow - h.chin) * 0.55, 0.1 * hr), m, 0, h.brow - (h.brow - h.chin) * 0.28, h.cz + 1.02 * hr * h.flatten));
  return g;
}

export function buildHelmet(item: ItemStack, rig: Rig): THREE.Object3D {
  const h = headFrame(rig);
  const hr = h.hr;
  const c = metalColor(item.id);
  const span = h.top - h.brow;
  if (item.id.includes('full_helm')) {
    // The whole head boxed in, with a T-shaped face slit.
    const g = new THREE.Group();
    const m = material(c, 'metal');
    g.add(
      onSkull(
        h,
        lathe(
          [
            [0.8 * hr, h.chin - 0.012],
            [1.1 * hr, h.chin + (h.brow - h.chin) * 0.4],
            [1.14 * hr, h.brow],
            [1.12 * hr, h.brow + span * 0.5],
            [0.98 * hr, h.brow + span * 0.88],
            [0.5 * hr, h.top + 0.025],
            [0, h.top + 0.04],
          ],
          24,
          h.flatten,
        ),
        m,
      ),
    );
    const dark = material(0x14120f, 'dark');
    const front = h.cz + 1.06 * hr * h.flatten;
    g.add(put(box(0.16 * hr, (h.brow - h.chin) * 0.8, 0.1 * hr), dark, 0, (h.brow + h.chin) / 2, front));
    g.add(put(box(0.9 * hr, 0.14 * hr, 0.1 * hr), dark, 0, h.brow - 0.03, front));
    return g;
  }
  if (item.id.includes('cowl')) {
    const g = new THREE.Group();
    g.add(onSkull(h, lathe([[1.06 * hr, h.chin + 0.02], [1.15 * hr, h.brow - 0.01], [1.0 * hr, h.brow + span * 0.85], [0.5 * hr, h.top + 0.02], [0, h.top + 0.035]], 20, h.flatten), material(c, 'leather')));
    return g;
  }
  return skullCap(rig, c, finishOf(item.id));
}

/** A tall white chef's hat. */
export function toque(rig: Rig): THREE.Object3D {
  const h = headFrame(rig);
  const hr = h.hr;
  const white = material(0xf4f1ea, 'cloth');
  const g = new THREE.Group();
  g.add(onSkull(h, lathe([[1.05 * hr, h.brow + 0.01], [1.07 * hr, h.top - 0.01], [1.2 * hr, h.top + 0.08], [1.3 * hr, h.top + 0.16], [0.95 * hr, h.top + 0.21], [0, h.top + 0.22]], 20, h.flatten), white));
  return g;
}

/** A wide-brimmed straw hat. */
export function strawHat(rig: Rig): THREE.Object3D {
  const h = headFrame(rig);
  const hr = h.hr;
  const straw = material(0xc9b26a, 'cloth');
  const g = new THREE.Group();
  g.add(onSkull(h, lathe([[0, h.brow + 0.04], [2.2 * hr, h.brow + 0.045], [2.25 * hr, h.brow + 0.06], [1.1 * hr, h.brow + 0.065], [1.06 * hr, h.top + 0.02], [0.7 * hr, h.top + 0.06], [0, h.top + 0.07]], 24, h.flatten), straw));
  return g;
}

/** A red officer's plume rising from the crown. */
export function plume(rig: Rig): THREE.Object3D {
  const h = headFrame(rig);
  const hr = h.hr;
  return put(wedge(0.2 * hr, 1.4 * hr, 0.9 * hr, 0.6, 1.1), material(0xc0332a, 'cloth'), 0, h.top + 0.06, h.cz - 0.2 * hr);
}

/** A full beard hanging from the jaw. */
export function beard(rig: Rig, color: number): THREE.Object3D {
  const h = headFrame(rig);
  const hr = h.hr;
  return put(
    lathe([[0.5 * hr, h.chin - 0.1], [0.7 * hr, h.chin - 0.045], [0.85 * hr, h.chin + 0.025], [0.75 * hr, h.chin + 0.055], [0, h.chin + 0.06]], 14, 0.7),
    material(color, 'hair'),
    0,
    0,
    h.chinZ - 0.5 * hr,
  );
}


// --- Body ---------------------------------------------------------------------------

export function buildChest(item: ItemStack, rig: Rig): THREE.Object3D {
  const s = rig.dims.scale;
  const d = rig.dims;
  const c = metalColor(item.id);
  const plate = item.id.includes('platebody');
  const finish = finishOf(item.id);
  const m = material(c, finish);
  const g = new THREE.Group();
  // The body's own tunic profile, let out a little so the armour sits over it.
  const profile = d.torsoProfile.filter(([, y]) => y > -0.1 * s).map(([r, y]) => [r * 1.06 + 0.004 * s, y] as const);
  g.add(put(lathe(profile, plate ? 28 : 20, d.torsoFlatten), m));
  if (plate) {
    // Pauldrons over the shoulders.
    for (const sx of [-1, 1]) {
      const p = put(shade(new THREE.SphereGeometry(d.deltoidR * 1.3, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55)), m, sx * d.shoulderHalf, d.torso - 0.05 * s, 0);
      p.scale.set(1, 0.85, 1);
      g.add(p);
    }
  }
  return g;
}

/** A leather work apron over the front of the torso. */
export function apron(rig: Rig): THREE.Object3D {
  const s = rig.dims.scale;
  return put(wedge(0.3 * s, 0.5 * s, 0.03 * s, 1.15, 1), material(0xd8cfa8, 'cloth'), 0, 0.1 * s, rig.dims.chestR * rig.dims.torsoFlatten + 0.02 * s);
}

// --- Legs, feet, hands --------------------------------------------------------------

/** Guards for one leg: returns [thigh piece, shin piece]. */
export function buildLegGuard(item: ItemStack, rig: Rig): [THREE.Object3D, THREE.Object3D] {
  const s = rig.dims.scale;
  const m = material(metalColor(item.id), finishOf(item.id));
  const d = rig.dims;
  const thigh = put(prism(d.thighR * 1.1, d.shinR * 1.06, d.thigh * 0.94, 14), m, 0, -d.thigh / 2, 0);
  const shin = put(prism(d.shinR * 1.1, d.shinR * 0.74, d.shin * 0.86, 14), m, 0, -d.shin / 2 - 0.005 * s, 0);
  return [thigh, shin];
}

export function buildBoot(item: ItemStack, rig: Rig): THREE.Object3D {
  const s = rig.dims.scale;
  const d = rig.dims;
  const m = material(metalColor(item.id), finishOf(item.id));
  const g = new THREE.Group();
  g.add(put(prism(0.066 * s, 0.072 * s, 0.12 * s, 16), m, 0, 0.02 * s, -0.004 * s));
  g.add(put(wedge(d.footW * 1.14, d.ankle * 0.95, d.footL * 1.02, 0.85, 0.92), m, 0, -d.ankle * 0.5 - 0.005 * s, 0.065 * s));
  return g;
}

export function buildGlove(item: ItemStack, rig: Rig): THREE.Object3D {
  const s = rig.dims.scale;
  return put(box(0.05 * s, rig.dims.handL, 0.1 * s), material(metalColor(item.id), finishOf(item.id)), 0, -rig.dims.handL / 2 + 0.01 * s, 0.004 * s);
}

// --- Weapons and shields ------------------------------------------------------------

/**
 * Weapons, by family, held in the right hand with the blade running up the
 * forearm and tipped a little forward, the way a swordsman rests a sword.
 */
export function buildWeapon(item: ItemStack, rig: Rig): THREE.Object3D {
  const s = rig.dims.scale;
  const def = itemDef(item.id);
  const g = new THREE.Group();
  const metal = material(metalColor(item.id), 'metal');
  const grip = material(0x3a2a1c, 'leather');
  const gold = material(0xc9a23a, 'metal');
  const wood = material(0x6e4a2a, 'leather');
  const type = def.weaponType ?? 'sword';

  const hilt = (): void => {
    g.add(put(prism(0.02, 0.022, 0.12, 8), grip, 0, -0.04, 0));
    g.add(put(lathe([[0.02, 0], [0.035, 0.02], [0.02, 0.045], [0, 0.05]], 8), gold, 0, -0.12, 0));
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
      g.add(put(prism(0.022, 0.024, 0.22, 8), grip, 0, -0.09, 0));
      g.add(put(lathe([[0.025, 0], [0.04, 0.025], [0, 0.05]], 8), gold, 0, -0.22, 0));
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
      g.add(put(prism(0.02, 0.024, 0.5, 8), grip, 0, 0.2, 0));
      g.add(put(lathe([[0.03, 0], [0.09, 0.06], [0.09, 0.14], [0.03, 0.2], [0, 0.21]], 8), metal, 0, 0.44, 0));
      break;
    case 'warhammer':
      g.add(put(prism(0.022, 0.026, 0.5, 8), grip, 0, 0.2, 0));
      g.add(put(wedge(0.26, 0.14, 0.12, 0.9), metal, 0, 0.5, 0));
      break;
    case 'battleaxe': {
      g.add(put(prism(0.022, 0.026, 0.62, 8), wood, 0, 0.26, 0));
      for (const side of [-1, 1]) {
        const blade = put(wedge(0.06, 0.28, 0.24, 1, 1.5), metal, side * 0.12, 0.5, 0);
        blade.rotation.z = (side * Math.PI) / 2;
        g.add(blade);
      }
      break;
    }
    case 'axe': {
      g.add(put(prism(0.02, 0.026, 0.72, 8), wood, 0, 0.3, 0));
      const head = put(wedge(0.06, 0.24, 0.2, 1, 1.5), metal, 0.11, 0.58, 0);
      head.rotation.z = Math.PI / 2;
      g.add(head);
      break;
    }
    case 'pickaxe': {
      g.add(put(prism(0.02, 0.026, 0.74, 8), wood, 0, 0.3, 0));
      const spike = put(shade(new THREE.ConeGeometry(0.035, 0.42, 6)), metal, 0, 0.64, 0.14);
      spike.rotation.x = Math.PI / 2;
      g.add(spike);
      g.add(put(wedge(0.05, 0.06, 0.16, 0.9), metal, 0, 0.64, -0.06));
      break;
    }
    case 'bow': {
      // A recurve stave bent about the grip, strung between its tips.
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(0, -0.55, 0.02),
        new THREE.Vector3(0, 0, 0.2),
        new THREE.Vector3(0, 0.55, 0.02),
      );
      g.add(put(shade(new THREE.TubeGeometry(curve, 16, 0.014, 6, false)), wood));
      g.add(put(prism(0.018, 0.018, 0.14, 6), grip, 0, 0, 0.1));
      const string = put(prism(0.003, 0.003, 1.1, 4), material(0xe8e2d0, 'dark'), 0, 0, 0.02);
      g.add(string);
      break;
    }
    case 'staff': {
      g.add(put(prism(0.02, 0.026, 1.3, 8), wood, 0, 0.35, 0));
      g.add(put(lathe([[0.03, 0], [0.06, 0.03], [0.065, 0.1], [0.03, 0.16], [0, 0.17]], 10), gold, 0, 0.98, 0));
      const orb = put(shade(new THREE.SphereGeometry(0.055, 12, 10)), material(0x77c4ff, 'metal'), 0, 1.12, 0);
      g.add(orb);
      break;
    }
    default:
      g.add(put(wedge(0.06, 0.5, 0.016, 0.2, 0.6), metal, 0, 0.27, 0));
      hilt();
  }

  g.scale.setScalar(s);
  if (type === 'bow') {
    // Held out in front of the fist, limbs vertical.
    g.position.set(0, -0.075 * s, 0.05 * s);
    g.rotation.set(0, 0, 0);
  } else {
    g.position.set(0, -0.075 * s, 0.03 * s); // in the fist
    g.rotation.set(0.3, 0, -0.08); // up the forearm, tipped a little forward
  }
  return g;
}

/** Whether a weapon is carried in the off (left) hand. */
export function weaponInOffHand(item: ItemStack): boolean {
  return itemDef(item.id).weaponType === 'bow';
}

/** Shields: a round wooden one, a bevelled square, or a pointed kite, strapped to the left forearm. */
export function buildShield(item: ItemStack, rig: Rig): THREE.Object3D {
  const s = rig.dims.scale;
  const g = new THREE.Group();
  const m = material(metalColor(item.id), finishOf(item.id));
  if (item.id.includes('kiteshield')) {
    const shape = new THREE.Shape();
    shape.moveTo(-0.17, 0.2);
    shape.lineTo(0.17, 0.2);
    shape.lineTo(0.19, 0.02);
    shape.lineTo(0.0, -0.3);
    shape.lineTo(-0.19, 0.02);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.015, bevelSegments: 2 });
    geo.computeVertexNormals();
    g.add(put(shade(geo), m));
  } else if (item.id.includes('sq_shield')) {
    const sq = put(wedge(0.34, 0.06, 0.38, 0.85), m);
    sq.rotation.x = Math.PI / 2;
    g.add(sq);
  } else {
    const disc = put(lathe([[0, 0], [0.2, 0], [0.2, 0.04], [0.08, 0.07], [0, 0.07]], 14), m);
    disc.rotation.x = Math.PI / 2;
    g.add(disc);
  }
  g.scale.setScalar(s);
  g.position.set(0.06 * s, 0.02 * s, 0.03 * s);
  g.rotation.y = 0.35;
  return g;
}

// --- Base boots ---------------------------------------------------------------------

/** A tapered box without baked shading, for merging with other plain geometries. */
function rawWedge(w: number, h: number, d: number, topX: number, topZ = topX): THREE.BufferGeometry {
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

/** Merge geometries after placing them, so a boot is one draw call per material. */
function mergeParts(parts: Array<[THREE.BufferGeometry, number, number, number]>): THREE.BufferGeometry {
  const placed = parts.map(([geo, x, y, z]) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.translate(x, y, z);
    return g;
  });
  return mergeGeometries(placed, false);
}

/**
 * Plain leather boots over the body's bare feet: a cuff at the ankle, a
 * wedge over the foot, a rounded toe and a thick sole. Returns [left, right].
 */
export function buildBaseBoots(rig: Rig, color: number): [THREE.Object3D, THREE.Object3D] {
  const d = rig.dims;
  const s = d.scale;
  const make = (): THREE.Object3D => {
    const g = new THREE.Group();
    const H = d.ankle + 0.006 * s;
    const W = d.footW * 1.12;
    const L = d.footL * 1.04;
    const cz = d.footL * 0.29; // the foot's centre sits ahead of the ankle
    const toe = new THREE.SphereGeometry(W / 2, 12, 8);
    toe.scale(1, H / W, 1.25);
    const leather = mergeParts([
      [new THREE.CylinderGeometry(d.shinR * 0.92 + 0.005 * s, d.shinR + 0.005 * s, 0.11 * s, 16), 0, 0.035 * s, -0.008 * s],
      [rawWedge(W, H, L * 0.82, 0.86, 0.95), 0, -d.ankle + H / 2 - 0.002 * s, cz - 0.01 * s],
      [toe, 0, -d.ankle + H / 2 - 0.002 * s, cz - 0.01 * s + L * 0.41],
    ]);
    g.add(put(shade(leather, 1.02, 0.9), material(color, 'leather')));
    g.add(put(box(W * 1.06, 0.014 * s, L * 1.08), material(0x2a2420, 'leather'), 0, -d.ankle + 0.005 * s, cz + 0.01 * s));
    return g;
  };
  return [make(), make()];
}
