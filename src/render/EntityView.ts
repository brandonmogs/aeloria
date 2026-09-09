import * as THREE from 'three';
import { World } from '../sim/World';
import { Entity } from '../sim/Entity';
import { Player } from '../sim/Player';
import { Npc } from '../sim/Npc';
import { EquipSlot, EQUIP_SLOTS } from '../sim/Inventory';
import { ItemStack } from '../sim/items';
import { Terrain } from './Terrain';
import {
  Rig,
  addHelm,
  buildBoot,
  buildChest,
  buildGlove,
  buildGoblin,
  buildHelmet,
  buildHuman,
  buildLegGuard,
  buildRat,
  buildShield,
  buildWeapon,
  lathe,
  prism,
  put,
  shade,
  wedge,
} from './models';

/** Cloth geometry plus its undeformed positions, so it can be re-billowed. */
interface Cape {
  geo: THREE.BufferGeometry;
  base: Float32Array;
}

/** A rig plus everything the animator and HUD hang off it. */
interface Avatar extends Rig {
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
  /** Overhead prayer icon (Protect from Melee), created lazily for players. */
  overhead?: THREE.Sprite;
}

/** A hitsplat spawned when an entity is hit. */
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
/** How long a hitsplat stays up — OSRS shows them for roughly a tick and a half. */
const SPLAT_TIME = 1.0;

/**
 * Renders entities as low-poly RuneScape figures and — crucially — makes their
 * tile-by-tile movement look smooth. The sim teleports an entity from one
 * tile to the next on each tick; here we interpolate between
 * `previousPosition` and `position` using the loop's `alpha`, so the figure
 * glides across the grid while the underlying logic stays a clean
 * 1-tile-per-tick, and we drop it onto the terrain's height at every frame.
 * On top of that we swing the arms and legs whenever the figure is actually
 * moving. Avatars are created and destroyed lazily as entities come and go.
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
    private readonly terrain: Terrain,
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
      const ground = this.terrain.heightAt(avatar.group.position.x, avatar.group.position.z);

      const moving = !this.prev.equals(this.curr);
      const partner = this.dialoguePartnerOf(entity);
      if (moving) {
        avatar.group.rotation.y = Math.atan2(this.curr.x - this.prev.x, this.curr.z - this.prev.z);
      } else if (partner) {
        // Talking: the two face each other.
        const dx = partner.position.x - entity.position.x;
        const dz = partner.position.y - entity.position.y;
        if (dx !== 0 || dz !== 0) avatar.group.rotation.y = Math.atan2(dx, dz);
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
      } else if (entity instanceof Player && entity.action && 'tile' in entity.action) {
        // Smelting or smithing: face the furnace or anvil.
        const dx = entity.action.tile.x - entity.position.x;
        const dz = entity.action.tile.y - entity.position.y;
        if (dx !== 0 || dz !== 0) avatar.group.rotation.y = Math.atan2(dx, dz);
      }

      // Drain sim combat events into animation timers.
      if (entity.swingQueue.length > 0) {
        avatar.swingT = SWING_TIME;
        entity.swingQueue.length = 0;
      }
      // Working a node (or a tinderbox/fire/anvil): keep the swing cycling
      // even between the sim's spaced-out rolls.
      if (
        entity instanceof Player &&
        (entity.gatherTarget !== null || entity.action !== null) &&
        !moving &&
        avatar.swingT <= 0
      ) {
        avatar.swingT = SWING_TIME;
      }
      this.animate(avatar, moving, dt, ground);
      this.updateHealthBar(avatar, entity);
      this.updateOverhead(avatar, entity);
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

  /** Show the OSRS-style overhead icon while Protect from Melee is active. */
  private updateOverhead(avatar: Avatar, entity: Entity): void {
    const active = entity instanceof Player && entity.activePrayers.has('protect_from_melee');
    if (!active) {
      if (avatar.overhead) avatar.overhead.visible = false;
      return;
    }
    if (!avatar.overhead) {
      avatar.overhead = makeOverheadSprite();
      avatar.overhead.position.set(0, avatar.barHeight + 0.42, 0);
      avatar.group.add(avatar.overhead);
    }
    avatar.overhead.visible = true;
  }

  /** Drain the sim's hit queue into hitsplats on the entity. */
  private spawnSplats(avatar: Avatar, entity: Entity): void {
    if (entity.splatQueue.length === 0) return;
    const p = avatar.group.position;
    for (const damage of entity.splatQueue) {
      const sprite = makeSplatSprite(damage);
      sprite.position.set(p.x, p.y + avatar.barHeight * 0.55, p.z);
      this.scene.add(sprite);
      this.splats.push({ sprite, life: SPLAT_TIME });
      if (damage > 0) avatar.flinchT = FLINCH_TIME; // recoil from a real hit
    }
    entity.splatQueue.length = 0;
  }

  private updateSplats(dt: number): void {
    for (let i = this.splats.length - 1; i >= 0; i--) {
      const splat = this.splats[i];
      splat.life -= dt;
      const mat = splat.sprite.material as THREE.SpriteMaterial;
      mat.opacity = Math.max(0, Math.min(1, splat.life / 0.2));
      if (splat.life <= 0) {
        this.scene.remove(splat.sprite);
        mat.map?.dispose();
        mat.dispose();
        this.splats.splice(i, 1);
      }
    }
  }

  /** Live world-space position of an entity's avatar, or null if not yet built. */
  positionOf(id: number): THREE.Vector3 | null {
    return this.avatars.get(id)?.group.position ?? null;
  }

  /** Whoever this entity is mid-conversation with, if anyone. */
  private dialoguePartnerOf(entity: Entity): Entity | null {
    if (entity instanceof Player) {
      return entity.dialogue ? (this.world.entities.get(entity.dialogue.npcId) ?? null) : null;
    }
    for (const other of this.world.entities.values()) {
      if (other instanceof Player && other.dialogue?.npcId === entity.id) return other;
    }
    return null;
  }

  /** Swing limbs and add a gentle bob while walking; ease back to rest at a stop. */
  private animate(avatar: Avatar, moving: boolean, dt: number, ground: number): void {
    const target = moving ? 1 : 0;
    avatar.gait += (target - avatar.gait) * Math.min(1, dt * 10);

    const swing = Math.sin(this.clock * 9) * 0.7 * avatar.gait;
    avatar.legL.rotation.x = swing;
    avatar.legR.rotation.x = -swing;
    avatar.armL.rotation.x = -swing;
    avatar.armR.rotation.x = swing;
    avatar.group.position.y = ground + Math.abs(Math.sin(this.clock * 9)) * 0.04 * avatar.gait;

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
    return this.finish(this.rigFor(entity));
  }

  /** Pick a rig for an entity: the monster models, or a dressed-up human. */
  private rigFor(entity: Entity): Rig {
    if (entity instanceof Npc) {
      switch (entity.kind) {
        case 'goblin':
          return buildGoblin();
        case 'rat':
          return buildRat();
        case 'guard':
          // Castle guards: the human rig in chainmail and crimson, plus a helm.
          return buildHuman(
            { skin: 0xd8a06c, tunic: 0x8c93a3, trouser: 0x5a2f2f, boots: 0x3a3f4a, hair: 0x3a2a1a },
            (g) => addHelm(g, 0xb4b8bf),
          );
        case 'captain':
          // Same kit, redder, with an officer's plume.
          return buildHuman(
            { skin: 0xd8a06c, tunic: 0x8c93a3, trouser: 0x8b2b1f, boots: 0x2a2a2a, hair: 0x3a2a1a },
            (g) => {
              addHelm(g, 0xc9ccd2);
              g.add(put(wedge(0.05, 0.22, 0.16, 0.6, 0.9), 0xc0332a, 0, 1.82, -0.04));
            },
          );
        case 'cook':
          return buildHuman(
            { skin: 0xe0ac79, tunic: 0xf0ede4, trouser: 0x4a4a4a, boots: 0x2a2a2a, hair: 0x3a2a1a },
            (g) => {
              g.add(put(lathe([[0.16, 0], [0.18, 0.14], [0.2, 0.24], [0, 0.28]], 8), 0xffffff, 0, 1.66, 0)); // toque
              g.add(put(prism(0.185, 0.185, 0.05, 8), 0xffffff, 0, 1.66, 0));
            },
          );
        case 'woodsman':
          return buildHuman(
            { skin: 0xd9a06c, tunic: 0x6b8f3a, trouser: 0x5a4632, boots: 0x3b2a1c, hair: 0x8b5a2b },
            (g, armL) => {
              // A big beard and a felling axe in hand.
              g.add(put(lathe([[0.12, 0], [0.13, 0.08], [0.06, 0.16], [0, 0.17]], 6, 0.6), 0x8b5a2b, 0, 1.26, 0.12));
              armL.add(buildWeapon({ id: 'steel_axe', qty: 1 }));
            },
          );
        case 'fisherman':
          return buildHuman(
            { skin: 0xd9a06c, tunic: 0x4f6f8f, trouser: 0x6b6b6b, boots: 0x3b2a1c, hair: 0xd0d0d0 },
            (g) => {
              const straw = 0xc9b26a;
              g.add(put(lathe([[0.26, 0], [0.27, 0.03], [0.15, 0.04], [0.14, 0.18], [0, 0.2]], 8), straw, 0, 1.62, 0)); // wide-brimmed hat
              g.add(put(lathe([[0.1, 0], [0.11, 0.08], [0.05, 0.15], [0, 0.16]], 6, 0.6), 0xd0d0d0, 0, 1.27, 0.12)); // grey beard
            },
          );
        case 'shopkeeper':
          return buildHuman(
            { skin: 0xe0ac79, tunic: 0x7a4f8a, trouser: 0x3a3a4a, boots: 0x2a2a2a, hair: 0x2a1a0a },
            (g) => g.add(put(wedge(0.3, 0.44, 0.03, 1.1, 1), 0xd8cfa8, 0, 0.86, 0.15)), // apron
          );
      }
    }
    return buildHuman({ skin: 0xe0ac79, tunic: 0x3f7a4a, trouser: 0x4a4858, boots: 0x3b2a1c, hair: 0x4a2f16 });
  }

  /** Attach the health bar and animation state to a freshly built rig. */
  private finish(rig: Rig): Avatar {
    rig.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    const hp = attachHealthBar(rig.group, rig.barHeight);
    return {
      ...rig,
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
    };
  }

  /** Tear down the worn gear and rebuild it from the current equipment. */
  private rebuildGear(avatar: Avatar, eq: Record<EquipSlot, ItemStack | null>): void {
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
    cloth.position.set(0, 1.23, -0.16); // off the back of the shoulders
    cloth.rotation.x = 0.18;
    const clasp = put(shade(new THREE.OctahedronGeometry(0.05, 0)), 0xe8c66a, 0, 1.26, -0.04);
    return { cloth, clasp, cape };
  }
}

/** Stable string of equipped item ids, so EntityView can spot a change cheaply. */
function equipSignature(eq: Record<EquipSlot, ItemStack | null>): string {
  return EQUIP_SLOTS.map((s) => eq[s]?.id ?? '-').join('|');
}

/** The Protect from Melee overhead: crossed swords on a sky-blue disc. */
function makeOverheadSprite(): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#79c8e8';
  ctx.beginPath();
  ctx.arc(32, 32, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#1d3a4a';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.font = '34px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('⚔️', 32, 34);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false }),
  );
  sprite.scale.set(0.42, 0.42, 1);
  sprite.renderOrder = 11;
  sprite.userData.noAO = true;
  return sprite;
}

const CAPE_TOP_WIDTH = 0.34;

/**
 * The max cape cloth: a panel that flares wider toward the hem and is coloured
 * like the OSRS max cape — a rich red body with a thin rainbow trim running down
 * both side edges and along the bottom. Built with vertex colours (no texture)
 * and recorded `base` positions so {@link EntityView.billowCape} can ripple it.
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
    const edge = Math.max(
      f > 0.85 ? (f - 0.85) / 0.15 : 0,
      side > 0.75 ? (side - 0.75) / 0.25 : 0,
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

/** Create the floating health-bar sprite and parent it above the avatar. */
function attachHealthBar(
  group: THREE.Group,
  barHeight: number,
): { sprite: THREE.Sprite; canvas: HTMLCanvasElement; tex: THREE.CanvasTexture } {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 10;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace; // canvas pixels are sRGB, not linear
  tex.magFilter = THREE.NearestFilter;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false }),
  );
  sprite.scale.set(0.8, 0.125, 1);
  sprite.position.set(0, barHeight, 0);
  sprite.renderOrder = 11;
  sprite.userData.noAO = true;
  sprite.visible = false;
  group.add(sprite);
  return { sprite, canvas, tex };
}

/** The OSRS health bar: bright green over red, no frills. */
function drawHealthBar(canvas: HTMLCanvasElement, frac: number): void {
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#00ff00';
  ctx.fillRect(0, 0, Math.max(0, Math.round(w * frac)), h);
}

/**
 * A RuneScape hitsplat: the red four-lobed splat with a white number for a
 * hit, the blue one for a miss (a 0).
 */
function makeSplatSprite(damage: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 48;
  canvas.height = 48;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = damage > 0 ? '#b3261e' : '#2d5aa8';
  const lobe = (x: number, y: number, r: number): void => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  lobe(24, 24, 15);
  lobe(24, 9, 8);
  lobe(24, 39, 8);
  lobe(9, 24, 8);
  lobe(39, 24, 8);
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 22px Verdana, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 2;
  ctx.fillText(String(damage), 24, 25);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace; // canvas pixels are sRGB, not linear
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false }),
  );
  sprite.scale.set(0.55, 0.55, 1);
  sprite.renderOrder = 12;
  sprite.userData.noAO = true;
  return sprite;
}

function makeCapeMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ roughness: 0.9, envMapIntensity: 0.5,
    vertexColors: true,
    side: THREE.DoubleSide,
  });
}
