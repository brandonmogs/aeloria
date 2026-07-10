import { TileMap } from './TileMap';
import { Pathfinder } from './Pathfinder';
import { Entity } from './Entity';
import { Player } from './Player';
import { Npc, NpcConfig } from './Npc';
import { Command } from './commands';
import { Tile, chebyshev, tilesEqual } from './coords';
import { EQUIP_SLOTS, Item } from './Inventory';
import { CombatProfile, rollDamage, styleSkill } from './combat';
import { SkillId } from './Skills';
import { GameEvent } from './events';
import { GroundItem, GROUND_ITEM_TTL } from './GroundItem';
import { ResourceKind, ResourceNode, RESOURCE_DEFS, gatherChance } from './gathering';
import { WALK_SPEED, RUN_SPEED } from '../engine/constants';

/**
 * The authoritative game state and the one function that advances it:
 * {@link tick}. The world is a pure simulation — no Three.js, no DOM, no
 * wall-clock time. Given the same starting state and the same per-tick command
 * stream it always produces the same result (the per-tick RNG is seeded), which
 * is exactly what lets the very same code run client-side today and on an
 * authoritative server later.
 */
export class World {
  readonly map: TileMap;
  readonly pathfinder: Pathfinder;
  readonly entities = new Map<number, Entity>();
  tickCount = 0;

  /** Announcements for the UI (XP drops, level-ups, kills). Sim pushes, UI drains. */
  readonly eventQueue: GameEvent[] = [];

  /** Items lying on the ground, keyed by their ground-item id. */
  readonly groundItems = new Map<number, GroundItem>();

  /** Gatherable trees and rocks, keyed by node id. */
  readonly resourceNodes = new Map<number, ResourceNode>();

  private nextEntityId = 1;
  private nextGroundItemId = 1;
  private nextNodeId = 1;
  private playerSpawn: Tile | null = null;
  private readonly rng = mulberry32(0x9e3779b9);

  constructor(map: TileMap) {
    this.map = map;
    this.pathfinder = new Pathfinder(map);
  }

  spawnPlayer(position: Tile, name?: string): Player {
    const player = new Player(this.nextEntityId++, position, name);
    this.entities.set(player.id, player);
    this.playerSpawn = position;
    return player;
  }

  spawnNpc(position: Tile, config: NpcConfig): Npc {
    const npc = new Npc(this.nextEntityId++, position, config);
    this.entities.set(npc.id, npc);
    return npc;
  }

  /** Advance the simulation by exactly one game tick (600ms). Deterministic. */
  tick(commands: Command[]): void {
    this.applyCommands(commands);
    this.updateCombat();
    this.moveEntities();
    this.updatePickups();
    this.updateGathering();
    this.updateGroundItems();
    this.updateRespawns();
    this.tickCount++;
  }

  /** Register a gatherable node (the world builder calls this for trees/rocks). */
  addResourceNode(kind: ResourceKind, tile: Tile): ResourceNode {
    const node: ResourceNode = { id: this.nextNodeId++, kind, tile, regrowTimer: 0 };
    this.resourceNodes.set(node.id, node);
    return node;
  }

  /** The gatherable node on a tile, if any. */
  resourceNodeAt(tile: Tile): ResourceNode | null {
    for (const node of this.resourceNodes.values()) {
      if (tilesEqual(node.tile, tile)) return node;
    }
    return null;
  }

  /** Place an item on the ground; it despawns after {@link GROUND_ITEM_TTL} ticks. */
  dropItem(item: Item, tile: Tile): GroundItem {
    const ground: GroundItem = {
      id: this.nextGroundItemId++,
      item,
      tile,
      despawnAtTick: this.tickCount + GROUND_ITEM_TTL,
    };
    this.groundItems.set(ground.id, ground);
    return ground;
  }

  /** The topmost ground item on a tile, if any. */
  groundItemAt(tile: Tile): GroundItem | null {
    for (const ground of this.groundItems.values()) {
      if (tilesEqual(ground.tile, tile)) return ground;
    }
    return null;
  }

  private applyCommands(commands: Command[]): void {
    for (const cmd of commands) {
      const entity = this.entities.get(cmd.entityId);
      if (!entity) continue;

      // Any new intent replaces the previous one wholesale.
      const clearIntents = (): void => {
        entity.targetId = null;
        if (entity instanceof Player) {
          entity.pickupTarget = null;
          entity.gatherTarget = null;
        }
      };

      if (cmd.type === 'move') {
        clearIntents();
        entity.running = cmd.run ?? entity.running;
        entity.path = this.pathfinder.findPath(entity.position, cmd.target);
      } else if (cmd.type === 'attack') {
        const target = this.entities.get(cmd.targetId);
        if (target && target.isAlive && target.id !== entity.id) {
          clearIntents();
          entity.targetId = cmd.targetId;
        }
      } else if (cmd.type === 'pickup' && entity instanceof Player) {
        const ground = this.groundItems.get(cmd.groundItemId);
        if (ground) {
          clearIntents();
          entity.pickupTarget = ground.id;
          entity.path = this.pathfinder.findPath(entity.position, ground.tile);
        }
      } else if (cmd.type === 'gather' && entity instanceof Player) {
        const node = this.resourceNodes.get(cmd.nodeId);
        if (node && node.regrowTimer <= 0) {
          clearIntents();
          entity.gatherTarget = node.id;
          const dest = this.adjacentDestination(entity.position, node.tile);
          entity.path = dest ? this.pathfinder.findPath(entity.position, dest) : [];
          this.eventQueue.push({ type: 'message', text: RESOURCE_DEFS[node.kind].startMsg });
        }
      }
    }
  }

  /** Approach-and-strike: each fighter closes to melee range, then trades blows. */
  private updateCombat(): void {
    for (const entity of this.entities.values()) {
      if (entity.attackCooldown > 0) entity.attackCooldown--;
      if (entity instanceof Npc && entity.isDead) continue;
      if (entity.targetId === null) continue;

      const target = this.entities.get(entity.targetId);
      if (!target || !target.isAlive) {
        entity.targetId = null;
        continue;
      }

      if (orthogonallyAdjacent(entity.position, target.position)) {
        entity.path.length = 0; // in range — stand and fight
        if (entity.attackCooldown <= 0) {
          this.performAttack(entity, target);
          entity.attackCooldown = this.attackSpeedOf(entity);
        }
      } else {
        const dest = this.adjacentDestination(entity.position, target.position);
        entity.path = dest ? this.pathfinder.findPath(entity.position, dest) : [];
      }
    }
  }

  private performAttack(attacker: Entity, defender: Entity): void {
    const damage = rollDamage(this.profileOf(attacker), this.profileOf(defender), this.rng);
    defender.hitpoints = Math.max(0, defender.hitpoints - damage);
    defender.splatQueue.push(damage);
    attacker.swingQueue.push(defender.id);

    // Combat XP, OSRS-style: 4 per damage to the attack-style skill, plus a
    // third of that (1.33×) to Hitpoints.
    if (attacker instanceof Player && damage > 0) {
      const profile = this.profileOf(attacker);
      this.grantXp(attacker, styleSkill(profile.style), damage * 4);
      this.grantXp(attacker, 'hitpoints', (damage * 4) / 3);
    }

    // Auto-retaliate: an idle defender turns on its attacker.
    if (defender.targetId === null && defender.isAlive) {
      defender.targetId = attacker.id;
    }

    if (!defender.isAlive) this.handleDeath(defender, attacker);
  }

  /** Award XP with UI events: an XP drop, plus a level-up announcement. */
  private grantXp(player: Player, skill: SkillId, amount: number): void {
    const gained = player.skills.addXp(skill, amount);
    this.eventQueue.push({ type: 'xp', entityId: player.id, skill, amount });
    if (gained > 0) {
      const level = player.skills.levelOf(skill);
      this.eventQueue.push({ type: 'levelup', entityId: player.id, skill, level });
      // Hitpoints level-ups raise the health pool (and heal the difference).
      if (skill === 'hitpoints') {
        const grow = level - player.maxHitpoints;
        player.maxHitpoints = level;
        player.hitpoints = Math.min(player.maxHitpoints, player.hitpoints + Math.max(0, grow));
      }
    }
  }

  private handleDeath(victim: Entity, killer?: Entity): void {
    for (const other of this.entities.values()) {
      if (other.targetId === victim.id) other.targetId = null;
    }
    victim.targetId = null;
    victim.path.length = 0;

    if (victim instanceof Npc) {
      victim.respawnTimer = victim.respawnTicks; // stays dead, then returns
      if (killer instanceof Player) {
        this.eventQueue.push({ type: 'kill', killerId: killer.id, victimName: victim.name });
      }
      // Roll the drop table onto the tile the NPC died on.
      for (const entry of victim.drops) {
        if (this.rng() < entry.chance) this.dropItem(entry.item, victim.position);
      }
    } else if (victim instanceof Player) {
      this.eventQueue.push({ type: 'died', entityId: victim.id });
      // Simple death for now: full heal and back to the spawn tile.
      victim.hitpoints = victim.maxHitpoints;
      victim.attackCooldown = 0;
      if (this.playerSpawn) {
        victim.position = this.playerSpawn;
        victim.previousPosition = this.playerSpawn;
      }
    }
  }

  /** Players standing on their pickup target collect it into the backpack. */
  private updatePickups(): void {
    for (const entity of this.entities.values()) {
      if (!(entity instanceof Player) || entity.pickupTarget === null) continue;

      const ground = this.groundItems.get(entity.pickupTarget);
      if (!ground) {
        entity.pickupTarget = null; // despawned or someone else took it
        continue;
      }
      if (!tilesEqual(entity.position, ground.tile)) continue; // still walking

      const free = entity.inventory.firstFreeSlot();
      if (free < 0) {
        this.eventQueue.push({ type: 'message', text: "You don't have enough inventory space." });
      } else {
        entity.inventory.slots[free] = ground.item;
        this.groundItems.delete(ground.id);
        this.eventQueue.push({ type: 'message', text: `You pick up the ${ground.item.name}.` });
      }
      entity.pickupTarget = null;
    }
  }

  /** Players beside their gather target chop/mine: a success roll per tick. */
  private updateGathering(): void {
    for (const entity of this.entities.values()) {
      if (!(entity instanceof Player) || entity.gatherTarget === null) continue;

      const node = this.resourceNodes.get(entity.gatherTarget);
      if (!node || node.regrowTimer > 0) {
        entity.gatherTarget = null; // depleted under us (or gone)
        continue;
      }
      if (chebyshev(entity.position, node.tile) > 1) continue; // still walking

      entity.path.length = 0; // in position — stand and work
      const def = RESOURCE_DEFS[node.kind];

      const free = entity.inventory.firstFreeSlot();
      if (free < 0) {
        this.eventQueue.push({
          type: 'message',
          text: `Your backpack is too full to hold any more ${def.item.name.toLowerCase()}.`,
        });
        entity.gatherTarget = null;
        continue;
      }

      // Swing every tick (the renderer animates it); roll for the harvest.
      entity.swingQueue.push(node.id);
      if (this.rng() < gatherChance(def, entity.skills.levelOf(def.skill))) {
        entity.inventory.slots[free] = def.item;
        this.grantXp(entity, def.skill, def.xp);
        this.eventQueue.push({ type: 'message', text: def.successMsg });
        node.regrowTimer = def.regrowTicks;
        entity.gatherTarget = null;
      }
    }
  }

  /** Remove ground items whose despawn tick has passed; regrow spent nodes. */
  private updateGroundItems(): void {
    for (const [id, ground] of this.groundItems) {
      if (this.tickCount >= ground.despawnAtTick) this.groundItems.delete(id);
    }
    for (const node of this.resourceNodes.values()) {
      if (node.regrowTimer > 0) node.regrowTimer--;
    }
  }

  private updateRespawns(): void {
    for (const entity of this.entities.values()) {
      if (!(entity instanceof Npc) || !entity.isDead) continue;
      if (entity.respawnTimer > 0) entity.respawnTimer--;
      if (entity.respawnTimer <= 0) {
        entity.hitpoints = entity.maxHitpoints;
        entity.position = entity.spawnTile;
        entity.previousPosition = entity.spawnTile;
        entity.attackCooldown = 0;
        entity.path.length = 0;
        entity.targetId = null;
      }
    }
  }

  private moveEntities(): void {
    for (const entity of this.entities.values()) {
      entity.previousPosition = entity.position;
      if (entity.path.length === 0) continue;

      const steps = entity.running ? RUN_SPEED : WALK_SPEED;
      for (let i = 0; i < steps && entity.path.length > 0; i++) {
        const next = entity.path[0];
        // The map can change beneath a queued path (a door closes, etc.); bail
        // cleanly rather than walking through a wall.
        if (!this.map.canStep(entity.position, next)) {
          entity.path.length = 0;
          break;
        }
        entity.position = next;
        entity.path.shift();
      }
    }
  }

  /** Build the combat profile for an entity from its levels and worn gear. */
  private profileOf(entity: Entity): CombatProfile {
    if (entity instanceof Player) {
      const bonus = this.equipmentBonuses(entity);
      return {
        attack: entity.skills.levelOf('attack'),
        strength: entity.skills.levelOf('strength'),
        defense: entity.skills.levelOf('defense'),
        attackBonus: bonus.attack,
        strengthBonus: bonus.strength,
        defenseBonus: bonus.defense,
        style: 'accurate',
      };
    }
    if (entity instanceof Npc) {
      return {
        attack: entity.attack,
        strength: entity.strength,
        defense: entity.defense,
        attackBonus: 0,
        strengthBonus: 0,
        defenseBonus: 0,
        style: entity.style,
      };
    }
    return { attack: 1, strength: 1, defense: 1, attackBonus: 0, strengthBonus: 0, defenseBonus: 0, style: 'accurate' };
  }

  private equipmentBonuses(player: Player): { attack: number; strength: number; defense: number } {
    let attack = 0;
    let strength = 0;
    let defense = 0;
    for (const slot of EQUIP_SLOTS) {
      const item = player.inventory.equipment[slot];
      if (!item) continue;
      attack += item.attackBonus ?? 0;
      strength += item.strengthBonus ?? 0;
      defense += item.defenseBonus ?? 0;
    }
    return { attack, strength, defense };
  }

  private attackSpeedOf(entity: Entity): number {
    if (entity instanceof Npc) return entity.attackSpeed;
    return 4; // standard weapon speed until weapons carry their own
  }

  /** The walkable, orthogonally-adjacent tile of `target` nearest to `from`. */
  private adjacentDestination(from: Tile, target: Tile): Tile | null {
    const candidates: Tile[] = [
      { x: target.x + 1, y: target.y },
      { x: target.x - 1, y: target.y },
      { x: target.x, y: target.y + 1 },
      { x: target.x, y: target.y - 1 },
    ];
    let best: Tile | null = null;
    let bestDist = Infinity;
    for (const tile of candidates) {
      if (this.map.isBlocked(tile.x, tile.y)) continue;
      const dist = chebyshev(from, tile);
      if (dist < bestDist) {
        bestDist = dist;
        best = tile;
      }
    }
    return best;
  }
}

function orthogonallyAdjacent(a: Tile, b: Tile): boolean {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
}

/** Small deterministic PRNG so combat rolls are reproducible from a seed. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
