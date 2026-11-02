import * as THREE from 'three';
import { EquipSlot, EQUIP_SLOTS } from '../sim/Inventory';
import { ItemStack } from '../sim/items';
import { Rig, material, put, shade } from './characters';
import { buildBoot, buildChest, buildGlove, buildHelmet, buildLegGuard, buildShield, buildWeapon, weaponInOffHand } from './gear';

/**
 * Dressing a rig in its equipment. Shared by the in-world entity view and the
 * character preview page, so what the lab shows is exactly what the game
 * draws.
 */

export type Equipment = Record<EquipSlot, ItemStack | null>;

/** Cloth geometry plus its undeformed positions, so it can be re-billowed. */
export interface Cape {
  geo: THREE.BufferGeometry;
  base: Float32Array;
}

/** Everything a rig is wearing, to tear down when the equipment changes. */
export interface Outfit {
  gear: THREE.Object3D[];
  /** The cape's cloth, present only while a cape is equipped. */
  cape?: Cape;
  /** The main-hand (or off-hand) weapon, for effects that single it out. */
  weapon?: THREE.Object3D;
}

export function emptyEquipment(): Equipment {
  const eq = {} as Equipment;
  for (const slot of EQUIP_SLOTS) eq[slot] = null;
  return eq;
}

/** Stable string of equipped item ids, so a view can spot a change cheaply. */
export function equipSignature(eq: Equipment): string {
  return EQUIP_SLOTS.map((s) => eq[s]?.id ?? '-').join('|');
}

/** Hang each equipped item on its socket: helmet, armour, boots, gloves, weapon, shield and cape. */
export function dressRig(rig: Rig, eq: Equipment): Outfit {
  const outfit: Outfit = { gear: [] };
  const s = rig.sockets;

  const add = (obj: THREE.Object3D, parent: THREE.Object3D): void => {
    obj.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    parent.add(obj);
    outfit.gear.push(obj);
  };

  // A helmet covers the cap and fringe; long hair still falls out the back.
  if (rig.hair) for (const part of rig.hair.children) part.visible = !eq.helmet || part.name === 'hair-fall';
  if (eq.helmet) add(buildHelmet(eq.helmet, rig), s.head);
  if (eq.chestplate) add(buildChest(eq.chestplate, rig), s.torso);
  if (eq.legs) {
    const [tl, sl] = buildLegGuard(eq.legs, rig, 1);
    const [tr, sr] = buildLegGuard(eq.legs, rig, -1);
    add(tl, s.thighL);
    add(sl, s.shinL);
    add(tr, s.thighR);
    add(sr, s.shinR);
  }
  if (eq.boots) {
    add(buildBoot(eq.boots, rig), s.footL);
    add(buildBoot(eq.boots, rig), s.footR);
  }
  if (eq.gloves) {
    add(buildGlove(eq.gloves, rig), s.handL);
    add(buildGlove(eq.gloves, rig), s.handR);
  }
  if (eq.weapon) {
    outfit.weapon = buildWeapon(eq.weapon, rig);
    add(outfit.weapon, weaponInOffHand(eq.weapon) ? s.handL : s.handR);
  }
  if (eq.shield) add(buildShield(eq.shield, rig), s.handL);

  if (eq.cape) {
    const { cloth, clasp, cape } = createCape(rig);
    add(cloth, s.torso);
    add(clasp, s.torso);
    outfit.cape = cape;
  }
  return outfit;
}

/** Take the outfit off again. */
export function undress(outfit: Outfit): void {
  for (const obj of outfit.gear) obj.parent?.remove(obj);
  outfit.gear = [];
  outfit.cape = undefined;
  outfit.weapon = undefined;
}

const CAPE_HEIGHT = 0.8;
const CAPE_TOP_WIDTH = 0.34;

/**
 * Ripple the cape's vertices: a constant idle flutter, plus a trailing lift
 * that grows with the gait so the cloth streams out behind a running player.
 * Both effects scale with distance from the shoulders so the hem moves most.
 */
export function billowCape(cape: Cape, gait: number, clock: number): void {
  const pos = cape.geo.attributes.position as THREE.BufferAttribute;
  const amp = 0.03 + 0.025 * gait;
  const trail = 0.26 * gait;
  for (let i = 0; i < pos.count; i++) {
    const bx = cape.base[i * 3];
    const by = cape.base[i * 3 + 1];
    const f = Math.min(1, -by / CAPE_HEIGHT); // 0 at shoulders → 1 at the hem
    const wave = Math.sin(clock * 4 + f * 4 + bx * 6) * amp * f;
    pos.setXYZ(
      i,
      bx + Math.sin(clock * 5 + f * 5) * 0.02 * f,
      by + trail * 0.12 * f,
      wave - trail * f * f, // -z is behind the player
    );
  }
  pos.needsUpdate = true;
  cape.geo.computeVertexNormals();
}

/** Build the animated cape cloth plus its gold neck clasp, hung from the torso. */
function createCape(rig: Rig): { cloth: THREE.Mesh; clasp: THREE.Mesh; cape: Cape } {
  const s = rig.dims.scale;
  const cape = makeCape();
  const cloth = new THREE.Mesh(cape.geo, makeCapeMaterial());
  cloth.name = 'cape-cloth'; // the attachments baker hangs it on the cape chain by name
  cloth.scale.setScalar(s);
  cloth.position.set(0, rig.dims.torso - 0.06 * s, -(rig.dims.chestR * rig.dims.torsoFlatten + 0.01 * s)); // off the back of the shoulders
  cloth.rotation.x = 0.18;
  const clasp = put(shade(new THREE.OctahedronGeometry(0.05 * s, 0)), material(0xe8c66a, 'metal'), 0, rig.dims.torso - 0.04 * s, 0.1 * s);
  return { cloth, clasp, cape };
}

/**
 * The max cape cloth: a panel that flares wider toward the hem and is coloured
 * like the OSRS max cape, a rich red body with a thin rainbow trim running
 * down both side edges and along the bottom. Built with vertex colours and
 * recorded `base` positions so {@link billowCape} can ripple it.
 */
function makeCape(): Cape {
  const geo = new THREE.PlaneGeometry(CAPE_TOP_WIDTH, CAPE_HEIGHT, 4, 8);
  geo.translate(0, -CAPE_HEIGHT / 2, 0); // pivot at the top edge

  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const dark = new THREE.Color(0x6a0f0f);
  const bright = new THREE.Color(0xb42626);
  const c = new THREE.Color();
  const trim = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const ox = pos.getX(i);
    const y = pos.getY(i);
    const f = clamp01(-y / CAPE_HEIGHT); // 0 at shoulders → 1 at the hem
    const u = ox / CAPE_TOP_WIDTH + 0.5; // 0 left → 1 right

    // Flare the cloth outward toward the hem so it reads as a cape, not a strip.
    pos.setX(i, ox * (1 + f * 0.95));

    // Red body, brightest around mid-height.
    c.copy(dark).lerp(bright, clamp01(1 - Math.abs(f - 0.45) / 0.6));

    // Rainbow trim hugging the two side edges and the bottom hem.
    const side = Math.abs(u - 0.5) * 2; // 0 centre → 1 edge
    const edge = Math.max(f > 0.85 ? (f - 0.85) / 0.15 : 0, side > 0.75 ? (side - 0.75) / 0.25 : 0);
    if (edge > 0) {
      trim.setHSL((u * 0.55 + f * 0.45) % 1, 0.85, 0.56);
      c.lerp(trim, clamp01(edge));
    }

    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  return { geo, base: Float32Array.from(pos.array) };
}

function makeCapeMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 0.85,
    envMapIntensity: 0.4,
  });
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
