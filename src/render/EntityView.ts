import * as THREE from 'three';
import { World } from '../sim/World';
import { Entity } from '../sim/Entity';
import { Player } from '../sim/Player';
import { Npc } from '../sim/Npc';
import { itemDef } from '../sim/items';
import { Terrain } from './Terrain';
import { ACTION_DURATION, ActionKind, Animator, Rig, buildRat } from './characters';
import { HERO_BUILD, buildHumanoid } from './human';
import { goblinBracer, goblinFeatures, goblinGreave, goblinPauldron, goblinShield, goblinStrap, goblinSword } from './goblinGear';
import { apron, beard, buildWeapon, plume, skullCap, strawHat, toque } from './gear';
import { Equipment, Outfit, billowCape, dressRig, equipSignature, undress } from './outfit';

/** A rig plus everything the animator and HUD hang off it. */
interface Avatar {
  rig: Rig;
  anim: Animator;
  /** Where the avatar stood last frame, to measure distance travelled. */
  lastPos: THREE.Vector3;
  wasAlive: boolean;
  /** Seconds since the death clip started; -1 while alive. */
  deadFor: number;
  /** Currently worn gear, torn down and rebuilt when equipment changes. */
  outfit: Outfit;
  /** Signature of the rendered equipment, to detect when a rebuild is needed. */
  gearSig: string;
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

/** How long a hitsplat stays up: OSRS shows them for roughly a tick and a half. */
const SPLAT_TIME = 1.0;

/**
 * Renders entities as articulated, realistically proportioned figures and
 * makes their tile-by-tile movement look like walking. The sim teleports an
 * entity from one tile to the next on each tick; here we interpolate between
 * `previousPosition` and `position` using the loop's `alpha`, so the figure
 * glides across the grid while the underlying logic stays a clean
 * 1-tile-per-tick, drop it onto the terrain's height every frame, ease its
 * heading round to the direction of travel, and drive a distance-phased
 * walk or run cycle so the feet plant instead of sliding. Combat swings,
 * skilling, flinches and deaths come from the sim's queues and play as
 * layered clips. Avatars are created and destroyed lazily as entities come
 * and go.
 */
export class EntityView {
  private readonly avatars = new Map<number, Avatar>();
  private readonly splats: Splat[] = [];
  private readonly prev = new THREE.Vector3();
  private readonly curr = new THREE.Vector3();
  private readonly pos = new THREE.Vector3();
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
        this.scene.add(avatar.rig.group);
      }
      const rig = avatar.rig;
      const anim = avatar.anim;

      // Death: play the fall on the tick an NPC dies, hold it a moment, then
      // hide the body until it respawns.
      const dead = entity instanceof Npc && entity.isDead;
      if (dead && avatar.wasAlive) {
        anim.play('death');
        avatar.deadFor = 0;
      }
      if (!dead && !avatar.wasAlive) {
        anim.reset();
        avatar.deadFor = -1;
      }
      avatar.wasAlive = !dead;
      if (dead) avatar.deadFor += dt;
      rig.group.visible = !dead || avatar.deadFor < ACTION_DURATION.death + 0.4;

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

      // Position: glide between the last two tick positions.
      this.prev.set(entity.previousPosition.x, 0, entity.previousPosition.y);
      this.curr.set(entity.position.x, 0, entity.position.y);
      const pos = this.pos.lerpVectors(this.prev, this.curr, alpha);
      const ground = this.terrain.heightAt(pos.x, pos.z);
      const moving = !this.prev.equals(this.curr);
      const tilesThisTick = Math.max(Math.abs(this.curr.x - this.prev.x), Math.abs(this.curr.z - this.prev.z));
      const running = tilesThisTick >= 2;
      const firstFrame = avatar.lastPos.x === Infinity;
      const moved = firstFrame ? 0 : Math.hypot(pos.x - avatar.lastPos.x, pos.z - avatar.lastPos.z);
      avatar.lastPos.set(pos.x, 0, pos.z);

      // Heading: the direction of travel, else whatever the entity is engaged with.
      const heading = this.headingFor(entity, moving);
      if (heading !== null) anim.face(heading, dt, firstFrame);

      // Actions from the sim: attacks, skilling, crafting, flinches.
      this.driveActions(avatar, entity, moving);

      anim.update({ moved, moving, running, time: this.clock + entity.id * 1.7 }, dt);
      rig.group.position.set(pos.x, ground + anim.rootOffset, pos.z);

      this.updateHealthBar(avatar, entity);
      this.updateOverhead(avatar, entity);
      this.spawnSplats(avatar, entity);
      if (avatar.outfit.cape) billowCape(avatar.outfit.cape, moving ? (running ? 1 : 0.6) : 0, this.clock);
    }

    this.updateSplats(dt);

    // Drop avatars for entities that no longer exist.
    for (const [id, avatar] of this.avatars) {
      if (!this.world.entities.has(id)) {
        this.scene.remove(avatar.rig.group);
        this.avatars.delete(id);
      }
    }
  }

  /** Live world-space position of an entity's avatar, or null if not yet built. */
  positionOf(id: number): THREE.Vector3 | null {
    return this.avatars.get(id)?.rig.group.position ?? null;
  }

  /** Which way the entity should face, in radians about y, or null to keep its heading. */
  private headingFor(entity: Entity, moving: boolean): number | null {
    if (moving) return Math.atan2(this.curr.x - this.prev.x, this.curr.z - this.prev.z);
    const at = (x: number, y: number): number | null => {
      const dx = x - entity.position.x;
      const dz = y - entity.position.y;
      return dx !== 0 || dz !== 0 ? Math.atan2(dx, dz) : null;
    };
    const partner = this.dialoguePartnerOf(entity);
    if (partner) return at(partner.position.x, partner.position.y);
    if (entity.targetId !== null && entity.isAlive) {
      const foe = this.world.entities.get(entity.targetId);
      if (foe) return at(foe.position.x, foe.position.y);
    }
    if (entity instanceof Player) {
      if (entity.gatherTarget !== null) {
        const node = this.world.resourceNodes.get(entity.gatherTarget);
        if (node) return at(node.tile.x, node.tile.y);
      }
      if (entity.action && 'tile' in entity.action) return at(entity.action.tile.x, entity.action.tile.y);
    }
    return null;
  }

  /** Translate the sim's queues and state into clips on the animator. */
  private driveActions(avatar: Avatar, entity: Entity, moving: boolean): void {
    const anim = avatar.anim;
    if (anim.playing === 'death') return;

    // A looping work clip while gathering or crafting, stopped when it ends.
    let work: ActionKind | null = null;
    if (entity instanceof Player && !moving) {
      if (entity.gatherTarget !== null) {
        const node = this.world.resourceNodes.get(entity.gatherTarget);
        work = node?.kind === 'tree' ? 'chop' : node?.kind === 'rock' ? 'mine' : node ? 'fish' : null;
      } else if (entity.action) {
        work = entity.action.type === 'smith' ? 'hammer' : entity.action.type === 'smelt' ? 'fish' : 'crouch';
      }
    }
    if (work) {
      entity.swingQueue.length = 0; // the loop is the swing
      anim.play(work, true);
      return;
    }
    if (anim.playing && ACTION_DURATION[anim.playing] >= 0.8 && anim.playing !== 'flinch') anim.stopAction();

    if (entity.swingQueue.length > 0) {
      entity.swingQueue.length = 0;
      anim.play(attackClipFor(entity));
      return;
    }
    // Recoil from a real hit, unless mid-swing.
    if (entity.splatQueue.some((d) => d > 0) && !anim.playing) anim.play('flinch');
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
      avatar.overhead.position.set(0, avatar.rig.barHeight + 0.42, 0);
      avatar.rig.group.add(avatar.overhead);
    }
    avatar.overhead.visible = true;
  }

  /** Drain the sim's hit queue into hitsplats on the entity. */
  private spawnSplats(avatar: Avatar, entity: Entity): void {
    if (entity.splatQueue.length === 0) return;
    const p = avatar.rig.group.position;
    for (const damage of entity.splatQueue) {
      const sprite = makeSplatSprite(damage);
      sprite.position.set(p.x, p.y + avatar.rig.barHeight * 0.55, p.z);
      this.scene.add(sprite);
      this.splats.push({ sprite, life: SPLAT_TIME });
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

  private createAvatar(entity: Entity): Avatar {
    const rig = rigFor(entity);
    const hp = attachHealthBar(rig.group, rig.barHeight);
    return {
      rig,
      anim: new Animator(rig),
      lastPos: new THREE.Vector3(Infinity, 0, Infinity),
      wasAlive: true,
      deadFor: -1,
      outfit: { gear: [] },
      gearSig: '',
      hpBar: hp.sprite,
      hpCanvas: hp.canvas,
      hpTex: hp.tex,
      lastHpFrac: -1,
    };
  }

  /** Tear down the worn gear and rebuild it from the current equipment. */
  private rebuildGear(avatar: Avatar, eq: Equipment): void {
    undress(avatar.outfit);
    avatar.outfit = dressRig(avatar.rig, eq);
  }
}

/** Which attack clip an entity's weapon calls for. */
function attackClipFor(entity: Entity): ActionKind {
  if (entity instanceof Npc) {
    return entity.kind === 'rat' ? 'stab' : 'slash';
  }
  if (entity instanceof Player) {
    const weapon = entity.inventory.equipment.weapon;
    const type = weapon ? itemDef(weapon.id).weaponType : undefined;
    switch (type) {
      case 'dagger':
        return 'stab';
      case 'mace':
      case 'warhammer':
      case 'pickaxe':
        return 'crush';
      case 'bow':
        return 'bow';
      case 'staff':
        return entity.autocastSpell ? 'cast' : 'crush';
      default:
        return weapon ? 'slash' : 'stab'; // bare fists jab
    }
  }
  return 'slash';
}

/** Pick a rig for an entity: the monster models, or a dressed-up person. */
function rigFor(entity: Entity): Rig {
  if (entity instanceof Npc) {
    switch (entity.kind) {
      case 'goblin':
        // A lean green brawler: big head and ears, long arms, short bowed
        // legs, bare chest and feet, sword and spiked shield, crouched stance.
        return buildHumanoid({
          height: 1.32,
          headScale: 1.4,
          armScale: 1.18,
          legScale: 0.85,
          bulk: 0.85,
          shoulders: 1.02,
          goblin: true,
          stance: 'brawler',
          palette: { skin: 0x86963a, hair: 0x2a2a1a, tunic: 0x86963a, trouser: 0x4a3626, boots: 0x3a2a1c, eyes: 0xd9a13a },
          extras: (rig) => {
            rig.sockets.head.add(goblinFeatures(rig));
            rig.sockets.handR.add(goblinSword(rig));
            rig.sockets.handL.add(goblinShield(rig));
            rig.joints.shoulderL.add(goblinPauldron(rig));
            rig.sockets.torso.add(goblinStrap(rig));
            rig.sockets.shinL.add(goblinGreave(rig));
            rig.sockets.shinR.add(goblinGreave(rig));
            rig.joints.elbowR.add(goblinBracer(rig));
          },
        });
      case 'rat':
        return buildRat();
      case 'guard':
        // Castle guards: a fighter's build in chainmail and crimson, plus a helm.
        return buildHumanoid({
          ...HERO_BUILD,
          height: 1.86,
          bulk: 1.1,
          shoulders: 1.18,
          waist: 0.9,
          hair: 'short',
          bracers: true,
          palette: { skin: 0xd8a06c, hair: 0x3a2a1a, tunic: 0x8c93a3, trouser: 0x5a2f2f, boots: 0x3a3f4a },
          extras: (rig) => rig.sockets.head.add(skullCap(rig, 0xb4b8bf)),
        });
      case 'captain':
        // Same kit, redder, with an officer's plume.
        return buildHumanoid({
          ...HERO_BUILD,
          height: 1.88,
          bulk: 1.12,
          shoulders: 1.2,
          waist: 0.9,
          hair: 'short',
          bracers: true,
          palette: { skin: 0xd8a06c, hair: 0x3a2a1a, tunic: 0x8c93a3, trouser: 0x8b2b1f, boots: 0x2a2a2a },
          extras: (rig) => {
            rig.sockets.head.add(skullCap(rig, 0xc9ccd2));
            rig.sockets.head.add(plume(rig));
          },
        });
      case 'cook':
        // Stout, but still standing tall.
        return buildHumanoid({
          ...HERO_BUILD,
          height: 1.74,
          belly: 0.6,
          bulk: 1.15,
          waist: 1.04,
          hips: 1,
          pecs: 0.4,
          stance: undefined,
          palette: { skin: 0xe0ac79, hair: 0x3a2a1a, tunic: 0xf0ede4, trouser: 0x4a4a4a, boots: 0x2a2a2a },
          extras: (rig) => rig.sockets.head.add(toque(rig)),
        });
      case 'woodsman':
        return buildHumanoid({
          ...HERO_BUILD,
          height: 1.9,
          bulk: 1.15,
          shoulders: 1.2,
          waist: 0.92,
          hair: 'long',
          bracers: true,
          palette: { skin: 0xd9a06c, hair: 0x8b5a2b, tunic: 0x6b8f3a, trouser: 0x5a4632, boots: 0x3b2a1c },
          extras: (rig) => {
            rig.sockets.head.add(beard(rig, 0x8b5a2b));
            rig.sockets.handR.add(buildWeapon({ id: 'steel_axe', qty: 1 }, rig));
          },
        });
      case 'fisherman':
        // Older and leaner, no hero's chest.
        return buildHumanoid({
          ...HERO_BUILD,
          height: 1.76,
          bulk: 0.95,
          shoulders: 1.1,
          waist: 0.96,
          chestWidth: 1.04,
          pecs: 0.3,
          stance: undefined,
          palette: { skin: 0xd9a06c, hair: 0xd0d0d0, tunic: 0x4f6f8f, trouser: 0x6b6b6b, boots: 0x3b2a1c },
          extras: (rig) => {
            rig.sockets.head.add(strawHat(rig));
            rig.sockets.head.add(beard(rig, 0xd0d0d0));
          },
        });
      case 'shopkeeper':
        return buildHumanoid({
          ...HERO_BUILD,
          height: 1.78,
          belly: 0.35,
          waist: 0.98,
          pecs: 0.5,
          stance: undefined,
          palette: { skin: 0xe0ac79, hair: 0x2a1a0a, tunic: 0x7a4f8a, trouser: 0x3a3a4a, boots: 0x2a2a2a },
          extras: (rig) => rig.sockets.torso.add(apron(rig)),
        });
    }
  }
  // The player: a Lineage 2 human fighter's build and bearing.
  return buildHumanoid({
    ...HERO_BUILD,
    height: 1.84,
    hair: 'long',
    bracers: true,
    palette: { skin: 0xe3b48d, hair: 0x4a2f16, tunic: 0x3f7a4a, trouser: 0x4a4858, boots: 0x3b2a1c, eyes: 0x4f7fa8 },
  });
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

