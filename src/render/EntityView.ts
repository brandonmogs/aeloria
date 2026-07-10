import * as THREE from 'three';
import { World } from '../sim/World';
import { Entity } from '../sim/Entity';
import { Player } from '../sim/Player';
import { Npc } from '../sim/Npc';
import { EquipSlot, EQUIP_SLOTS, Item } from '../sim/Inventory';
import {
  buildHelmet,
  buildChest,
  buildLegGuard,
  buildBoot,
  buildGlove,
  buildWeapon,
  buildShield,
} from './gear';

/** Cloth geometry plus its undeformed positions, so it can be re-billowed. */
interface Cape {
  geo: THREE.BufferGeometry;
  base: Float32Array;
}

/** The swinging limbs we animate, cached per entity to avoid re-lookups. */
interface Avatar {
  group: THREE.Group;
  legL: THREE.Object3D;
  legR: THREE.Object3D;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  /** The arm holding the weapon; the one that swings on attack. */
  weaponArm: THREE.Object3D;
  /** Eased 0..1 gait weight: 0 standing, 1 walking. */
  gait: number;
  /** Seconds left of the attack-swing animation (0 = not swinging). */
  swingT: number;
  /** Seconds left of the hit-flinch animation (0 = not flinching). */
  flinchT: number;
  /** Seconds left of the death animation; -1 when alive. */
  deathT: number;
  /** Whether the entity was alive last frame, to detect the death transition. */
  wasAlive: boolean;
  /** Currently worn gear meshes, torn down and rebuilt when equipment changes. */
  gear: THREE.Object3D[];
  /** Signature of the rendered equipment, to detect when a rebuild is needed. */
  gearSig: string;
  /** The cape's cloth, present only while a cape is equipped. */
  cape?: Cape;
  /** Floating health bar (a camera-facing sprite above the head). */
  hpBar: THREE.Sprite;
  hpCanvas: HTMLCanvasElement;
  hpTex: THREE.CanvasTexture;
  lastHpFrac: number;
  /** Height above the avatar origin for the health bar / hitsplats. */
  barHeight: number;
}

/** A drifting damage number spawned when an entity is hit. */
interface Splat {
  sprite: THREE.Sprite;
  life: number;
}

const CAPE_HEIGHT = 0.8;

/** Attack swing duration in seconds — snappy, well inside one game tick. */
const SWING_TIME = 0.38;
/** Hit-flinch duration in seconds. */
const FLINCH_TIME = 0.28;
/** Death fall duration in seconds. */
const DEATH_TIME = 0.7;

/**
 * Renders entities as little humanoid adventurers and — crucially — makes their
 * tile-by-tile movement look smooth. The sim teleports an entity from one tile
 * to the next on each tick; here we interpolate between `previousPosition` and
 * `position` using the loop's `alpha`, so the figure glides across the grid at
 * 60fps while the underlying logic stays a clean 1-tile-per-tick. On top of that
 * we swing the arms and legs whenever the figure is actually moving. Avatars are
 * created and destroyed lazily as entities appear and despawn.
 */
export class EntityView {
  private readonly avatars = new Map<number, Avatar>();
  private readonly splats: Splat[] = [];
  private readonly prev = new THREE.Vector3();
  private readonly curr = new THREE.Vector3();
  private clock = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: World,
  ) {}

  sync(alpha: number, dt: number): void {
    this.clock += dt;

    for (const entity of this.world.entities.values()) {
      let avatar = this.avatars.get(entity.id);
      if (!avatar) {
        avatar = this.createAvatar(entity);
        this.avatars.set(entity.id, avatar);
        this.scene.add(avatar.group);
      }

      // Death: play a fall-over animation on the tick an NPC dies, then hide
      // it until it respawns.
      const dead = entity instanceof Npc && entity.isDead;
      if (dead && avatar.wasAlive) avatar.deathT = DEATH_TIME;
      if (!dead && !avatar.wasAlive) {
        // Respawned: stand back up.
        avatar.deathT = -1;
        avatar.group.rotation.x = 0;
      }
      avatar.wasAlive = !dead;
      avatar.group.visible = !dead || avatar.deathT > 0;

      // Reflect equipment changes: rebuild the worn gear when it differs from
      // what's currently drawn. Cheap to check every frame; only rebuilds on a
      // real change (equip/unequip).
      if (entity instanceof Player) {
        const sig = equipSignature(entity.inventory.equipment);
        if (sig !== avatar.gearSig) {
          this.rebuildGear(avatar, entity.inventory.equipment);
          avatar.gearSig = sig;
        }
      }

      this.prev.set(entity.previousPosition.x, 0, entity.previousPosition.y);
      this.curr.set(entity.position.x, 0, entity.position.y);
      avatar.group.position.lerpVectors(this.prev, this.curr, alpha);

      const moving = !this.prev.equals(this.curr);
      if (moving) {
        avatar.group.rotation.y = Math.atan2(this.curr.x - this.prev.x, this.curr.z - this.prev.z);
      } else if (entity.targetId !== null && entity.isAlive) {
        // Standing in combat: square up to the opponent.
        const foe = this.world.entities.get(entity.targetId);
        if (foe) {
          const dx = foe.position.x - entity.position.x;
          const dz = foe.position.y - entity.position.y;
          if (dx !== 0 || dz !== 0) avatar.group.rotation.y = Math.atan2(dx, dz);
        }
      } else if (entity instanceof Player && entity.gatherTarget !== null) {
        // Working a tree or rock: face it.
        const node = this.world.resourceNodes.get(entity.gatherTarget);
        if (node) {
          const dx = node.tile.x - entity.position.x;
          const dz = node.tile.y - entity.position.y;
          if (dx !== 0 || dz !== 0) avatar.group.rotation.y = Math.atan2(dx, dz);
        }
      }

      // Drain sim combat events into animation timers.
      if (entity.swingQueue.length > 0) {
        avatar.swingT = SWING_TIME;
        entity.swingQueue.length = 0;
      }
      this.animate(avatar, moving, dt);
      this.updateHealthBar(avatar, entity);
      this.spawnSplats(avatar, entity);
    }

    this.updateSplats(dt);

    // Drop avatars for entities that no longer exist.
    for (const [id, avatar] of this.avatars) {
      if (!this.world.entities.has(id)) {
        this.scene.remove(avatar.group);
        this.avatars.delete(id);
      }
    }
  }

  private updateHealthBar(avatar: Avatar, entity: Entity): void {
    const frac = entity.maxHitpoints > 0 ? entity.hitpoints / entity.maxHitpoints : 0;
    const show = entity.isAlive && frac < 0.999;
    avatar.hpBar.visible = show;
    if (show && Math.abs(frac - avatar.lastHpFrac) > 0.001) {
      drawHealthBar(avatar.hpCanvas, frac);
      avatar.hpTex.needsUpdate = true;
      avatar.lastHpFrac = frac;
    }
  }

  /** Drain the sim's hit queue into floating damage numbers above the entity. */
  private spawnSplats(avatar: Avatar, entity: Entity): void {
    if (entity.splatQueue.length === 0) return;
    const p = avatar.group.position;
    for (const damage of entity.splatQueue) {
      const sprite = makeSplatSprite(damage);
      sprite.position.set(p.x, avatar.barHeight + 0.28, p.z);
      this.scene.add(sprite);
      this.splats.push({ sprite, life: 0.9 });
      if (damage > 0) avatar.flinchT = FLINCH_TIME; // recoil from a real hit
    }
    entity.splatQueue.length = 0;
  }

  private updateSplats(dt: number): void {
    for (let i = this.splats.length - 1; i >= 0; i--) {
      const splat = this.splats[i];
      splat.life -= dt;
      splat.sprite.position.y += dt * 0.7;
      // Punchy entrance: overshoot the scale for the first instant, then settle.
      const age = 0.9 - splat.life;
      const pop = age < 0.1 ? 0.5 + (age / 0.1) * 0.72 : Math.max(1, 1.22 - (age - 0.1) * 1.4);
      splat.sprite.scale.set(0.5 * pop, 0.5 * pop, 1);
      (splat.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, Math.min(1, splat.life / 0.3));
      if (splat.life <= 0) {
        this.scene.remove(splat.sprite);
        this.splats.splice(i, 1);
      }
    }
  }

  /** Live world-space position of an entity's avatar, or null if not yet built. */
  positionOf(id: number): THREE.Vector3 | null {
    return this.avatars.get(id)?.group.position ?? null;
  }

  /** Swing limbs and add a gentle bob while walking; ease back to rest at a stop. */
  private animate(avatar: Avatar, moving: boolean, dt: number): void {
    const target = moving ? 1 : 0;
    avatar.gait += (target - avatar.gait) * Math.min(1, dt * 10);

    const swing = Math.sin(this.clock * 9) * 0.7 * avatar.gait;
    avatar.legL.rotation.x = swing;
    avatar.legR.rotation.x = -swing;
    avatar.armL.rotation.x = -swing;
    avatar.armR.rotation.x = swing;
    avatar.group.position.y = Math.abs(Math.sin(this.clock * 9)) * 0.04 * avatar.gait;

    // Attack: raise the weapon arm overhead, then snap it down, with a small
    // lunge toward the facing direction at the moment of the strike.
    if (avatar.swingT > 0) {
      avatar.swingT = Math.max(0, avatar.swingT - dt);
      const p = 1 - avatar.swingT / SWING_TIME; // 0 → 1 over the swing
      const wind = Math.min(1, p / 0.45); // raise phase
      const strike = p < 0.45 ? 0 : Math.min(1, (p - 0.45) / 0.3); // downswing
      const raise = -2.3 * Math.sin((wind * Math.PI) / 2);
      avatar.weaponArm.rotation.x = raise * (1 - strike) + 0.5 * strike;

      const lunge = 0.22 * Math.sin(p * Math.PI);
      avatar.group.position.x += Math.sin(avatar.group.rotation.y) * lunge;
      avatar.group.position.z += Math.cos(avatar.group.rotation.y) * lunge;
    }

    // Flinch: a quick lean back after taking a real hit.
    let lean = 0;
    if (avatar.flinchT > 0) {
      avatar.flinchT = Math.max(0, avatar.flinchT - dt);
      lean = -0.22 * Math.sin((1 - avatar.flinchT / FLINCH_TIME) * Math.PI);
    }

    // Death: keel over backwards, then sink slightly before hiding.
    if (avatar.deathT > 0) {
      avatar.deathT = Math.max(0, avatar.deathT - dt);
      const p = 1 - avatar.deathT / DEATH_TIME;
      lean = (-Math.PI / 2) * Math.min(1, p * 1.4);
      if (p > 0.7) avatar.group.position.y -= ((p - 0.7) / 0.3) * 0.15;
    }
    avatar.group.rotation.x = lean;

    if (avatar.cape) this.billowCape(avatar.cape, avatar.gait);
  }

  /**
   * Ripple the cape's vertices: a constant idle flutter, plus a trailing lift
   * that grows with the gait so the cloth streams out behind a running player.
   * Both effects scale with distance from the shoulders so the hem moves most.
   */
  private billowCape(cape: Cape, gait: number): void {
    const pos = cape.geo.attributes.position as THREE.BufferAttribute;
    const amp = 0.03 + 0.025 * gait;
    const trail = 0.26 * gait;
    for (let i = 0; i < pos.count; i++) {
      const bx = cape.base[i * 3];
      const by = cape.base[i * 3 + 1];
      const f = Math.min(1, -by / CAPE_HEIGHT); // 0 at shoulders → 1 at the hem
      const wave = Math.sin(this.clock * 4 + f * 4 + bx * 6) * amp * f;
      pos.setXYZ(
        i,
        bx + Math.sin(this.clock * 5 + f * 5) * 0.02 * f,
        by + trail * 0.12 * f,
        wave - trail * f * f, // -z is behind the player
      );
    }
    pos.needsUpdate = true;
    cape.geo.computeVertexNormals();
  }

  private createAvatar(entity: Entity): Avatar {
    if (entity instanceof Npc && entity.kind === 'goblin') return buildGoblinAvatar();

    const group = new THREE.Group();
    // Yaw first, then lean: flinch/death tilts happen relative to facing.
    group.rotation.order = 'YXZ';

    const skin = mat(0xe0ac79, 0.65);
    const tunic = mat(0x3f6f4a, 0.7);
    const trouser = mat(0x4a4754, 0.8);
    const leather = mat(0x4a3525, 0.8);

    // Torso — a smoothly revolved profile (narrow waist, fuller chest), then
    // flattened front-to-back. A curved surface like this is what stops it
    // reading as a box the way flat-faced geometry does.
    const torso = mesh(makeTorso(), tunic);
    torso.position.y = 0.64;
    group.add(torso);

    // Rounded shoulder caps blend the arms into the torso instead of butting
    // flat tubes against flat sides.
    for (const sx of [-0.21, 0.21]) {
      const cap = mesh(new THREE.SphereGeometry(0.11, 16, 12), tunic);
      cap.position.set(sx, 1.12, 0);
      cap.scale.set(1, 0.85, 0.9);
      group.add(cap);
    }

    // Pelvis fills the gap between waist and legs.
    const pelvis = mesh(new THREE.SphereGeometry(0.16, 18, 12), trouser);
    pelvis.position.y = 0.62;
    pelvis.scale.set(1.05, 0.7, 0.66);
    group.add(pelvis);

    // Belt — a thin ring at the waist rather than a slab.
    const belt = mesh(new THREE.TorusGeometry(0.15, 0.028, 10, 28), leather);
    belt.rotation.x = Math.PI / 2;
    belt.position.y = 0.72;
    belt.scale.set(1, 0.64, 1);
    group.add(belt);

    // Neck + head + a rounded cap of hair.
    const neck = mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.1, 12), skin);
    neck.position.y = 1.2;
    group.add(neck);
    const head = mesh(new THREE.SphereGeometry(0.16, 24, 18), skin);
    head.position.y = 1.34;
    head.scale.set(0.95, 1.05, 0.98);
    group.add(head);
    const hair = mesh(
      new THREE.SphereGeometry(0.172, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.58),
      leather,
    );
    hair.position.y = 1.36;
    group.add(hair);

    // Limbs hang from a pivot at the shoulder/hip so rotation.x swings them.
    const legL = limb(0.09, 0.42, trouser, leather);
    legL.position.set(-0.11, 0.62, 0);
    group.add(legL);
    const legR = limb(0.09, 0.42, trouser, leather);
    legR.position.set(0.11, 0.62, 0);
    group.add(legR);

    const armL = limb(0.07, 0.4, tunic, skin);
    armL.position.set(-0.27, 1.12, 0);
    group.add(armL);
    const armR = limb(0.07, 0.4, tunic, skin);
    armR.position.set(0.27, 1.12, 0);
    group.add(armR);

    group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });

    const barHeight = 1.95;
    const hp = attachHealthBar(group, barHeight);
    return {
      group,
      legL,
      legR,
      armL,
      armR,
      weaponArm: armL, // the sword hand — see rebuildGear
      gait: 0,
      swingT: 0,
      flinchT: 0,
      deathT: -1,
      wasAlive: true,
      gear: [],
      gearSig: '',
      hpBar: hp.sprite,
      hpCanvas: hp.canvas,
      hpTex: hp.tex,
      lastHpFrac: -1,
      barHeight,
    };
  }

  /** Tear down the worn gear and rebuild it from the current equipment. */
  private rebuildGear(avatar: Avatar, eq: Record<EquipSlot, Item | null>): void {
    for (const obj of avatar.gear) obj.parent?.remove(obj);
    avatar.gear = [];
    avatar.cape = undefined;

    const add = (obj: THREE.Object3D, parent: THREE.Object3D): void => {
      obj.traverse((o) => {
        if (o instanceof THREE.Mesh) o.castShadow = true;
      });
      parent.add(obj);
      avatar.gear.push(obj);
    };

    if (eq.helmet) add(buildHelmet(eq.helmet), avatar.group);
    if (eq.chestplate) add(buildChest(eq.chestplate), avatar.group);
    if (eq.legs) {
      add(buildLegGuard(eq.legs), avatar.legL);
      add(buildLegGuard(eq.legs), avatar.legR);
    }
    if (eq.boots) {
      add(buildBoot(eq.boots), avatar.legL);
      add(buildBoot(eq.boots), avatar.legR);
    }
    if (eq.gloves) {
      add(buildGlove(eq.gloves), avatar.armL);
      add(buildGlove(eq.gloves), avatar.armR);
    }
    // armL sits on the body's right side as seen facing north, armR on the left.
    if (eq.weapon) add(buildWeapon(eq.weapon), avatar.armL); // sword on the right
    if (eq.shield) add(buildShield(eq.shield), avatar.armR); // shield on the left

    if (eq.cape) {
      const { cloth, clasp, cape } = this.createCape();
      add(cloth, avatar.group);
      add(clasp, avatar.group);
      avatar.cape = cape;
    }
  }

  /** Build the animated cape cloth plus its gold neck clasp. */
  private createCape(): { cloth: THREE.Mesh; clasp: THREE.Mesh; cape: Cape } {
    const cape = makeCape();
    const cloth = new THREE.Mesh(cape.geo, makeCapeMaterial());
    cloth.position.set(0, 1.17, -0.12); // off the back of the shoulders
    cloth.rotation.x = 0.18;
    const clasp = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xe8c66a, metalness: 0.8, roughness: 0.3 }),
    );
    clasp.position.set(0, 1.21, -0.03);
    return { cloth, clasp, cape };
  }
}

/** Stable string of equipped item ids, so EntityView can spot a change cheaply. */
function equipSignature(eq: Record<EquipSlot, Item | null>): string {
  return EQUIP_SLOTS.map((s) => eq[s]?.id ?? '-').join('|');
}

const CAPE_TOP_WIDTH = 0.34;

/**
 * The max cape cloth: a panel that flares wider toward the hem and is coloured
 * like the OSRS max cape — a rich red body with a thin rainbow trim running down
 * both side edges and along the bottom. Built with vertex colours (no texture)
 * and recorded `base` positions so {@link EntityView.billowCape} can ripple it.
 */
function makeCape(): Cape {
  const geo = new THREE.PlaneGeometry(CAPE_TOP_WIDTH, CAPE_HEIGHT, 10, 18);
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
    const edge = Math.max(
      f > 0.9 ? (f - 0.9) / 0.1 : 0,
      side > 0.82 ? (side - 0.82) / 0.18 : 0,
    );
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

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** A small, hunched green goblin clutching a crude club. */
function buildGoblinAvatar(): Avatar {
  const group = new THREE.Group();
  // Yaw first, then lean: flinch/death tilts happen relative to facing.
  group.rotation.order = 'YXZ';
  const skin = mat(0x6f8f3d, 0.85);
  const cloth = mat(0x6b4a2f, 0.9);
  const eye = mat(0x1c1a12, 0.5);

  const torso = mesh(new THREE.SphereGeometry(0.2, 16, 12), skin);
  torso.position.y = 0.62;
  torso.scale.set(1, 1.15, 0.85);
  group.add(torso);

  const loin = mesh(new THREE.SphereGeometry(0.17, 12, 10), cloth);
  loin.position.y = 0.46;
  loin.scale.set(1.1, 0.6, 0.85);
  group.add(loin);

  const head = mesh(new THREE.SphereGeometry(0.17, 16, 14), skin);
  head.position.set(0, 0.92, 0.02);
  group.add(head);
  for (const sx of [-0.16, 0.16]) {
    const ear = mesh(new THREE.ConeGeometry(0.05, 0.17, 6), skin);
    ear.position.set(sx, 0.97, 0);
    ear.rotation.z = sx < 0 ? 1.0 : -1.0;
    group.add(ear);
  }
  const nose = mesh(new THREE.ConeGeometry(0.045, 0.13, 6), skin);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 0.89, 0.18);
  group.add(nose);
  for (const sx of [-0.06, 0.06]) {
    const e = mesh(new THREE.SphereGeometry(0.026, 8, 6), eye);
    e.position.set(sx, 0.96, 0.15);
    group.add(e);
  }

  const legL = limb(0.07, 0.26, skin, cloth);
  legL.position.set(-0.09, 0.42, 0);
  group.add(legL);
  const legR = limb(0.07, 0.26, skin, cloth);
  legR.position.set(0.09, 0.42, 0);
  group.add(legR);
  const armL = limb(0.06, 0.3, skin, skin);
  armL.position.set(-0.2, 0.78, 0);
  group.add(armL);
  const armR = limb(0.06, 0.3, skin, skin);
  armR.position.set(0.2, 0.78, 0);
  group.add(armR);

  // A crude club in the right hand.
  const club = new THREE.Group();
  const handle = mesh(new THREE.CylinderGeometry(0.022, 0.028, 0.3, 6), cloth);
  handle.position.y = 0.15;
  club.add(handle);
  const knob = mesh(new THREE.SphereGeometry(0.07, 8, 7), mat(0x7a5230, 0.9));
  knob.position.y = 0.32;
  club.add(knob);
  club.position.set(0, -0.32, 0.03);
  club.rotation.x = 0.5;
  armR.add(club);

  group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  group.scale.setScalar(0.95);

  const barHeight = 1.45;
  const hp = attachHealthBar(group, barHeight);
  return {
    group,
    legL,
    legR,
    armL,
    armR,
    weaponArm: armR, // the goblin's club hand
    gait: 0,
    swingT: 0,
    flinchT: 0,
    deathT: -1,
    wasAlive: true,
    gear: [],
    gearSig: '',
    hpBar: hp.sprite,
    hpCanvas: hp.canvas,
    hpTex: hp.tex,
    lastHpFrac: -1,
    barHeight,
  };
}

/** Create the floating health-bar sprite and parent it above the avatar. */
function attachHealthBar(
  group: THREE.Group,
  barHeight: number,
): { sprite: THREE.Sprite; canvas: HTMLCanvasElement; tex: THREE.CanvasTexture } {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 12;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace; // canvas pixels are sRGB, not linear
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }),
  );
  sprite.scale.set(0.95, 0.16, 1);
  sprite.position.set(0, barHeight, 0);
  sprite.renderOrder = 11;
  sprite.visible = false;
  group.add(sprite);
  return { sprite, canvas, tex };
}

function drawHealthBar(canvas: HTMLCanvasElement, frac: number): void {
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#1d0c0c';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = frac > 0.5 ? '#46c83c' : frac > 0.25 ? '#d9b13a' : '#cc3b34';
  ctx.fillRect(1, 1, Math.max(0, Math.round((w - 2) * frac)), h - 2);
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
}

/** A RuneScape-style hitsplat: red for a hit, blue for a 0, with the number. */
function makeSplatSprite(damage: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 48;
  canvas.height = 48;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = damage > 0 ? '#9e2b25' : '#3a6ea5';
  ctx.beginPath();
  ctx.arc(24, 24, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 24px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(damage), 24, 25);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace; // canvas pixels are sRGB, not linear
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }),
  );
  sprite.scale.set(0.5, 0.5, 1);
  sprite.renderOrder = 12;
  return sprite;
}

function makeCapeMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 0.62,
    metalness: 0.06,
    envMapIntensity: 0.6,
  });
}

function mat(color: number, roughness: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, envMapIntensity: 0.5 });
}

/**
 * A torso built by revolving a side profile (radius at each height) around the
 * vertical axis, then squashing it front-to-back. The curved surface — wider at
 * the chest, pinched at the waist — is what reads as a body instead of a box.
 */
function makeTorso(): THREE.BufferGeometry {
  const profile = [
    [0.11, 0.0], // waist
    [0.16, 0.12],
    [0.2, 0.3], // chest
    [0.19, 0.44],
    [0.13, 0.54], // shoulders / neck base
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const geo = new THREE.LatheGeometry(profile, 24);
  geo.scale(1, 1, 0.62); // flatten depth so it isn't a barrel
  return geo;
}

function mesh(geo: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(geo, material);
}

/**
 * A limb is a pivot group at the joint with the limb hanging below it, so the
 * caller can swing the whole thing with `rotation.x`. A capsule gives smooth,
 * rounded shoulders/knees; the rounded tip is a hand or boot in a contrasting
 * material.
 */
function limb(radius: number, length: number, main: THREE.Material, cap: THREE.Material): THREE.Group {
  const pivot = new THREE.Group();
  const total = length + radius * 2;
  const seg = mesh(new THREE.CapsuleGeometry(radius, length, 6, 14), main);
  seg.position.y = -total / 2;
  pivot.add(seg);
  const tip = mesh(new THREE.SphereGeometry(radius * 1.15, 14, 10), cap);
  tip.position.y = -total + radius * 0.3;
  tip.scale.set(1.1, 0.85, 1.25); // flatten into a foot/hand
  pivot.add(tip);
  return pivot;
}
