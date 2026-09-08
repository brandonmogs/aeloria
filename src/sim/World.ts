import { TileMap } from './TileMap';
import { Pathfinder } from './Pathfinder';
import { Entity } from './Entity';
import { MAX_RUN_ENERGY, Player } from './Player';
import { Npc, NpcConfig } from './Npc';
import { Command } from './commands';
import { Tile, chebyshev, tilesEqual } from './coords';
import { EquipSlot } from './Inventory';
import { ItemStack, itemDef, stackOf } from './items';
import {
  CombatProfile,
  WEAPON_STYLES,
  WeaponType,
  combatLevel,
  rollDamage,
  styleSkills,
} from './combat';
import { prayerDef, PRAYERS } from './prayers';
import { SkillId } from './Skills';
import { GameEvent } from './events';
import { GroundItem, GROUND_ITEM_TTL } from './GroundItem';
import { Fire } from './Fire';
import { DialogueContext, DialogueNode, DialogueScript, DialogueView } from './dialogue';
import { questDef } from './quests';
import {
  SHOPS,
  ShopState,
  createShop,
  shopAccepts,
  shopBuyPrice,
  shopSellPrice,
} from './shops';
import {
  ResourceKind,
  ResourceNode,
  RESOURCE_DEFS,
  interpolateChance,
} from './gathering';
import { WALK_SPEED, RUN_SPEED } from '../engine/constants';

/** A usable world object the player can walk to: a bank booth or an altar. */
export interface Interactable {
  readonly kind: 'bank' | 'altar';
  readonly tile: Tile;
}

/** NPCs stop attacking unprovoked after ~10 minutes of you hanging around. */
const TOLERANCE_TICKS = 1000;

/**
 * Single-way combat, the OSRS default everywhere outside multi-combat zones:
 * after an exchange of blows both sides stay locked to each other for this
 * many ticks, and during that window nobody else can attack either of them.
 */
const SINGLE_COMBAT_TICKS = 8;

/**
 * The authoritative game state and the one function that advances it:
 * {@link tick}. The world is a pure simulation — no Three.js, no DOM, no
 * wall-clock time. Given the same starting state and the same per-tick command
 * stream it always produces the same result (the per-tick RNG is seeded), which
 * is exactly what lets the very same code run client-side today and on an
 * authoritative server later.
 *
 * The per-tick systems mirror the jobs an OSRS server performs each 600ms
 * cycle — apply client input, run NPC turns, resolve combat, move everyone,
 * then advance timers (skilling actions, prayer drain, run energy, fires,
 * respawns). See the open-source Lost City (2004Scape) engine for the shape
 * this follows.
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

  /** Gatherable trees, rocks, and fishing spots, keyed by node id. */
  readonly resourceNodes = new Map<number, ResourceNode>();

  /** Player-lit fires, keyed by fire id. */
  readonly fires = new Map<number, Fire>();

  /** Bank booths and altars registered by the world builder. */
  readonly interactables: Interactable[] = [];

  /** Every shop's live stock, keyed by shop id. */
  readonly shops = new Map<string, ShopState>();

  /** The script each player is currently conversing through, by player id. */
  private readonly scripts = new Map<number, DialogueScript>();

  private nextEntityId = 1;
  private nextGroundItemId = 1;
  private nextNodeId = 1;
  private nextFireId = 1;
  private playerSpawn: Tile | null = null;
  private readonly rng = mulberry32(0x9e3779b9);

  constructor(map: TileMap) {
    this.map = map;
    this.pathfinder = new Pathfinder(map);
    for (const def of SHOPS) this.shops.set(def.id, createShop(def));
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
    this.updateTimers();
    this.applyCommands(commands);
    this.updateNpcAi();
    this.updateCombat();
    this.moveEntities();
    this.updatePickups();
    this.updateGathering();
    this.updateActions();
    this.updateObjectInteractions();
    this.updateTalk();
    this.updateFires();
    this.updateFishingSpots();
    this.updateGroundItems();
    this.updatePrayer();
    this.updateRegen();
    this.updateRespawns();
    this.updateShops();
    this.tickCount++;
  }

  // --- World-building registrations ---------------------------------------

  /** Register a gatherable node (the world builder calls this for trees/rocks). */
  addResourceNode(kind: ResourceKind, tile: Tile): ResourceNode {
    const node: ResourceNode = { id: this.nextNodeId++, kind, tile, regrowTimer: 0 };
    this.resourceNodes.set(node.id, node);
    return node;
  }

  /** Register a wandering fishing spot that hops between `candidates`. */
  addFishingSpotGroup(candidates: Tile[]): ResourceNode {
    const node: ResourceNode = {
      id: this.nextNodeId++,
      kind: 'fishing_spot',
      tile: candidates[0],
      regrowTimer: 0,
      candidates,
      moveTimer: 60 + Math.floor(this.rng() * 120),
    };
    this.resourceNodes.set(node.id, node);
    return node;
  }

  addInteractable(kind: 'bank' | 'altar', tile: Tile): void {
    this.interactables.push({ kind, tile });
  }

  /** Register a kitchen range: a fire that never goes out and burns less. */
  addRange(tile: Tile): Fire {
    const range: Fire = { id: this.nextFireId++, tile, kind: 'range', expiresAtTick: Infinity };
    this.fires.set(range.id, range);
    return range;
  }

  // --- Lookups the input layer uses to build menus -------------------------

  /** The gatherable node on a tile, if any. */
  resourceNodeAt(tile: Tile): ResourceNode | null {
    for (const node of this.resourceNodes.values()) {
      if (tilesEqual(node.tile, tile)) return node;
    }
    return null;
  }

  /** The topmost ground item on a tile, if any. */
  groundItemAt(tile: Tile): GroundItem | null {
    for (const ground of this.groundItems.values()) {
      if (tilesEqual(ground.tile, tile)) return ground;
    }
    return null;
  }

  fireAt(tile: Tile): Fire | null {
    for (const fire of this.fires.values()) {
      if (tilesEqual(fire.tile, tile)) return fire;
    }
    return null;
  }

  interactableAt(tile: Tile): Interactable | null {
    return this.interactables.find((i) => tilesEqual(i.tile, tile)) ?? null;
  }

  /** Place an item stack on the ground; despawns after {@link GROUND_ITEM_TTL}. */
  dropItem(item: ItemStack, tile: Tile): GroundItem {
    const ground: GroundItem = {
      id: this.nextGroundItemId++,
      item,
      tile,
      despawnAtTick: this.tickCount + GROUND_ITEM_TTL,
    };
    this.groundItems.set(ground.id, ground);
    return ground;
  }

  /** The player's full OSRS combat level (prayer included). */
  combatLevelOf(player: Player): number {
    const s = player.skills;
    return combatLevel(
      s.levelOf('attack'),
      s.levelOf('strength'),
      s.levelOf('defense'),
      s.levelOf('hitpoints'),
      s.levelOf('prayer'),
      s.levelOf('range'),
      s.levelOf('magic'),
    );
  }

  /** The style set the player's current weapon exposes on the combat tab. */
  weaponTypeOf(player: Player): WeaponType {
    const weapon = player.inventory.equipment.weapon;
    return (weapon && itemDef(weapon.id).weaponType) || 'unarmed';
  }

  // --- Command intake ------------------------------------------------------

  private applyCommands(commands: Command[]): void {
    for (const cmd of commands) {
      const entity = this.entities.get(cmd.entityId);
      if (!entity) continue;

      // Any new *intent* replaces the previous one wholesale — and walking
      // off mid-sentence ends a conversation, like OSRS.
      const clearIntents = (): void => {
        entity.targetId = null;
        if (entity instanceof Player) {
          entity.pickupTarget = null;
          entity.gatherTarget = null;
          entity.objectTarget = null;
          entity.talkTarget = null;
          entity.action = null;
          this.closeDialogue(entity);
        }
      };

      switch (cmd.type) {
        case 'move': {
          clearIntents();
          if (cmd.run !== undefined) entity.running = cmd.run;
          entity.path = this.pathfinder.findPath(entity.position, cmd.target);
          break;
        }
        case 'attack': {
          const target = this.entities.get(cmd.targetId);
          if (target instanceof Npc && !target.attackable) {
            if (entity instanceof Player) this.say("You can't attack that.");
            break;
          }
          if (target && target.isAlive && target.id !== entity.id) {
            if (!this.canEngage(entity, target)) {
              if (entity instanceof Player) this.refuseEngagement(entity, target);
              break;
            }
            clearIntents();
            entity.targetId = cmd.targetId;
          }
          break;
        }
        case 'pickup': {
          if (!(entity instanceof Player)) break;
          const ground = this.groundItems.get(cmd.groundItemId);
          if (ground) {
            clearIntents();
            entity.pickupTarget = ground.id;
            entity.path = this.pathfinder.findPath(entity.position, ground.tile);
          }
          break;
        }
        case 'gather': {
          if (!(entity instanceof Player)) break;
          const node = this.resourceNodes.get(cmd.nodeId);
          if (node && node.regrowTimer <= 0) {
            clearIntents();
            entity.gatherTarget = node.id;
            entity.gatherCooldown = this.gatherCadence(entity, node.kind);
            const dest = this.adjacentDestination(entity.position, node.tile);
            entity.path = dest ? this.pathfinder.findPath(entity.position, dest) : [];
            this.say(RESOURCE_DEFS[node.kind].startMsg);
          }
          break;
        }
        case 'useItem':
          if (entity instanceof Player) this.useItem(entity, cmd.slot);
          break;
        case 'dropItem': {
          if (!(entity instanceof Player)) break;
          const item = entity.inventory.slots[cmd.slot];
          if (item) {
            entity.inventory.slots[cmd.slot] = null;
            this.dropItem(item, entity.position);
          }
          break;
        }
        case 'equipItem':
          if (entity instanceof Player) this.equipItem(entity, cmd.slot);
          break;
        case 'unequipItem': {
          if (!(entity instanceof Player)) break;
          if (entity.inventory.equipment[cmd.slot] && !entity.inventory.unequip(cmd.slot)) {
            this.say("You don't have enough inventory space.");
          }
          break;
        }
        case 'setRun': {
          if (!(entity instanceof Player)) break;
          if (cmd.on && entity.energy <= 0) this.say("You don't have enough run energy left.");
          else entity.running = cmd.on;
          break;
        }
        case 'setStyle': {
          if (!(entity instanceof Player)) break;
          const styles = WEAPON_STYLES[this.weaponTypeOf(entity)];
          entity.styleIndex = Math.max(0, Math.min(styles.length - 1, cmd.index));
          break;
        }
        case 'setAutoRetaliate':
          if (entity instanceof Player) entity.autoRetaliate = cmd.on;
          break;
        case 'togglePrayer':
          if (entity instanceof Player) this.togglePrayer(entity, cmd.prayerId);
          break;
        case 'lightFire':
          if (entity instanceof Player) this.startLighting(entity, cmd.slot, clearIntents);
          break;
        case 'cook':
          if (entity instanceof Player) this.startCooking(entity, cmd.fireId, cmd.itemId, clearIntents);
          break;
        case 'interact': {
          if (!(entity instanceof Player)) break;
          clearIntents();
          entity.objectTarget = { kind: cmd.kind, tile: cmd.target };
          const dest = this.adjacentDestination(entity.position, cmd.target);
          entity.path = dest ? this.pathfinder.findPath(entity.position, dest) : [];
          break;
        }
        case 'bankDeposit':
          if (entity instanceof Player) this.bankDeposit(entity, cmd.slot, cmd.qty);
          break;
        case 'bankWithdraw':
          if (entity instanceof Player) this.bankWithdraw(entity, cmd.itemId, cmd.qty);
          break;
        case 'bankDepositAll': {
          if (!(entity instanceof Player) || !this.nearBank(entity)) break;
          for (let i = 0; i < entity.inventory.slots.length; i++) {
            this.bankDeposit(entity, i, -1);
          }
          break;
        }
        case 'talk':
        case 'trade': {
          if (!(entity instanceof Player)) break;
          const npc = this.entities.get(cmd.npcId);
          if (!(npc instanceof Npc) || npc.isDead) break;
          clearIntents();
          entity.talkTarget = { npcId: npc.id, mode: cmd.type };
          const dest = this.adjacentDestination(entity.position, npc.position);
          entity.path = dest ? this.pathfinder.findPath(entity.position, dest) : [];
          break;
        }
        case 'dialogueContinue':
          if (entity instanceof Player) this.advanceDialogue(entity);
          break;
        case 'dialogueChoose':
          if (entity instanceof Player) this.chooseDialogue(entity, cmd.index);
          break;
        case 'shopBuy':
          if (entity instanceof Player) this.shopBuy(entity, cmd.itemId, cmd.qty);
          break;
        case 'shopSell':
          if (entity instanceof Player) this.shopSell(entity, cmd.slot, cmd.qty);
          break;
      }
    }
  }

  // --- Talking, quests, and shops ------------------------------------------

  /** Players walking up to an NPC: open the conversation (or shop) on arrival. */
  private updateTalk(): void {
    for (const entity of this.entities.values()) {
      if (!(entity instanceof Player) || !entity.talkTarget) continue;
      const npc = this.entities.get(entity.talkTarget.npcId);
      if (!(npc instanceof Npc) || npc.isDead) {
        entity.talkTarget = null;
        continue;
      }
      if (chebyshev(entity.position, npc.position) <= 1) {
        const mode = entity.talkTarget.mode;
        entity.path.length = 0;
        entity.talkTarget = null;
        npc.path.length = 0; // stop and listen
        if (mode === 'trade' && npc.shopId) this.openShop(entity, npc.shopId);
        else this.openDialogue(entity, npc);
      } else if (entity.path.length === 0) {
        const dest = this.adjacentDestination(entity.position, npc.position);
        entity.path = dest ? this.pathfinder.findPath(entity.position, dest) : [];
        if (entity.path.length === 0) entity.talkTarget = null; // unreachable
      }
    }
  }

  /** Whether some player is mid-conversation with this NPC (it stands still). */
  inDialogueWith(npcId: number): boolean {
    for (const entity of this.entities.values()) {
      if (entity instanceof Player && entity.dialogue?.npcId === npcId) return true;
    }
    return false;
  }

  private openDialogue(player: Player, npc: Npc): void {
    if (!npc.dialogue) {
      this.say(`${npc.name} doesn't seem interested in talking.`);
      return;
    }
    const script = npc.dialogue(this.dialogueContext(player));
    this.scripts.set(player.id, script);
    player.dialogue = { npcId: npc.id, nodeKey: script.start };
    this.enterNode(player, script.start);
  }

  /** Step into a node: run its effect, then show it (or finish on 'end'). */
  private enterNode(player: Player, key: string): void {
    const script = this.scripts.get(player.id);
    const npc = player.dialogue ? this.entities.get(player.dialogue.npcId) : null;
    const node = script?.nodes[key];
    if (!script || !node || !(npc instanceof Npc)) {
      this.closeDialogue(player);
      return;
    }
    player.dialogue = { npcId: npc.id, nodeKey: key };
    if (node.kind !== 'options' && node.effect) node.effect(this.dialogueContext(player));
    if (node.kind === 'end') {
      this.closeDialogue(player);
      return;
    }
    if (!player.dialogue) return; // an effect (a shop opening) ended the chat
    this.eventQueue.push({ type: 'dialogue', entityId: player.id, view: this.viewOf(node, npc, player) });
  }

  private advanceDialogue(player: Player): void {
    const script = player.dialogue && this.scripts.get(player.id);
    const node = script && player.dialogue ? script.nodes[player.dialogue.nodeKey] : undefined;
    if (!node || node.kind === 'options' || node.kind === 'end') return;
    if (node.next === undefined) this.closeDialogue(player);
    else this.enterNode(player, node.next);
  }

  private chooseDialogue(player: Player, index: number): void {
    const script = player.dialogue && this.scripts.get(player.id);
    const node = script && player.dialogue ? script.nodes[player.dialogue.nodeKey] : undefined;
    if (!node || node.kind !== 'options') return;
    const option = node.options[index];
    if (option) this.enterNode(player, option.next);
  }

  private closeDialogue(player: Player): void {
    if (!player.dialogue) return;
    player.dialogue = null;
    this.scripts.delete(player.id);
    this.eventQueue.push({ type: 'dialogue', entityId: player.id, view: null });
  }

  private viewOf(node: DialogueNode, npc: Npc, player: Player): DialogueView {
    switch (node.kind) {
      case 'npc':
        return { kind: 'npc', speaker: npc.name, text: node.text };
      case 'player':
        return { kind: 'player', speaker: player.name, text: node.text };
      case 'options':
        return { kind: 'options', title: node.title ?? 'Select an option', options: node.options.map((o) => o.text) };
      default:
        return { kind: 'message', text: node.kind === 'message' ? node.text : '' };
    }
  }

  /** The sim's side of the dialogue contract: what scripts may read and do. */
  private dialogueContext(player: Player): DialogueContext {
    return {
      player,
      questStage: (id) => player.quests.get(id) ?? 0,
      setQuestStage: (id, stage) => {
        player.quests.set(id, stage);
      },
      completeQuest: (id) => this.completeQuest(player, id),
      questVar: (key) => player.questVars.get(key) ?? 0,
      setQuestVar: (key, value) => {
        player.questVars.set(key, value);
      },
      hasItem: (id, qty = 1) => player.inventory.countOf(id) >= qty,
      countItem: (id) => player.inventory.countOf(id),
      takeItem: (id, qty = 1) => {
        if (player.inventory.countOf(id) < qty) return false;
        player.inventory.removeById(id, qty);
        return true;
      },
      giveItem: (id, qty = 1) => this.giveItem(player, id, qty),
      grantXp: (skill, amount) => this.grantXp(player, skill, amount),
      killCount: (kind) => player.killCounts.get(kind) ?? 0,
      skillLevel: (skill) => player.skills.levelOf(skill),
      message: (text) => this.say(text),
      openShop: (shopId) => {
        this.closeDialogue(player);
        this.openShop(player, shopId);
      },
    };
  }

  /** Put items in the backpack; anything that doesn't fit drops at the feet. */
  private giveItem(player: Player, id: string, qty: number): void {
    const leftover = player.inventory.add(id, qty);
    if (leftover > 0) {
      this.dropItem(stackOf(id, leftover), player.position);
      this.say("Your backpack is full, so the rest is on the ground.");
    }
  }

  private completeQuest(player: Player, questId: string): void {
    const def = questDef(questId);
    player.quests.set(questId, def.completeStage);
    this.say(`Congratulations! You have completed ${def.name}.`);
    this.eventQueue.push({ type: 'questComplete', entityId: player.id, questId });
  }

  /** Quest hook: a fire lit beside Gareth settles the woodsman's wager. */
  private onFireLit(player: Player, tile: Tile): void {
    if ((player.quests.get('woodsmans_wager') ?? 0) !== 1) return;
    if (player.questVars.get('woodsmans_wager.fire')) return;
    for (const other of this.entities.values()) {
      if (other instanceof Npc && other.kind === 'woodsman' && chebyshev(other.position, tile) <= 2) {
        player.questVars.set('woodsmans_wager.fire', 1);
        this.say('Gareth nods approvingly at your fire.');
        return;
      }
    }
  }

  private openShop(player: Player, shopId: string): void {
    if (!this.shops.has(shopId)) return;
    player.shopId = shopId;
    this.eventQueue.push({ type: 'shop', entityId: player.id, shopId });
  }

  private closeShop(player: Player): void {
    if (!player.shopId) return;
    player.shopId = null;
    this.eventQueue.push({ type: 'shop', entityId: player.id, shopId: null });
  }

  /** The shop the player has open, if they're still standing by its keeper. */
  private openShopOf(player: Player): ShopState | null {
    if (!player.shopId) return null;
    const shop = this.shops.get(player.shopId);
    if (!shop) return null;
    for (const other of this.entities.values()) {
      if (other instanceof Npc && other.shopId === player.shopId && chebyshev(other.position, player.position) <= 2) {
        return shop;
      }
    }
    this.closeShop(player);
    return null;
  }

  /** Buy up to `qty` units; each unit is priced at the stock level of the moment. */
  private shopBuy(player: Player, itemId: string, qty: number): void {
    const shop = this.openShopOf(player);
    if (!shop || !shop.stock.has(itemId)) return;
    let bought = 0;
    for (let i = 0; i < qty; i++) {
      const stock = shop.stock.get(itemId) ?? 0;
      if (stock <= 0) {
        if (bought === 0) this.say("The shop has run out of stock.");
        break;
      }
      const price = shopBuyPrice(shop, itemId);
      if (player.inventory.countOf('coins') < price) {
        if (bought === 0) this.say("You don't have enough coins.");
        break;
      }
      if (player.inventory.add(itemId, 1) > 0) {
        if (bought === 0) this.say("You don't have enough inventory space.");
        break;
      }
      player.inventory.removeById('coins', price);
      shop.stock.set(itemId, stock - 1);
      bought++;
    }
    if (bought > 0) this.eventQueue.push({ type: 'sfx', name: 'coins' });
  }

  private shopSell(player: Player, slot: number, qty: number): void {
    const shop = this.openShopOf(player);
    const item = player.inventory.slots[slot];
    if (!shop || !item) return;
    if (!shopAccepts(shop, item.id)) {
      this.say("You can't sell this item to this shop.");
      return;
    }
    const want = Math.min(qty, player.inventory.countOf(item.id));
    let sold = 0;
    for (let i = 0; i < want; i++) {
      const price = shopSellPrice(shop, item.id);
      if (player.inventory.removeById(item.id, 1) < 1) break;
      if (player.inventory.add('coins', price) > 0) {
        player.inventory.add(item.id, 1); // no room for the coins: undo
        this.say("You don't have enough inventory space.");
        break;
      }
      shop.stock.set(item.id, (shop.stock.get(item.id) ?? 0) + 1);
      sold++;
    }
    if (sold > 0) this.eventQueue.push({ type: 'sfx', name: 'coins' });
  }

  /** Stock drifts one unit a minute toward its default, like OSRS shops. */
  private updateShops(): void {
    if (this.tickCount % 100 !== 0 || this.tickCount === 0) return;
    for (const shop of this.shops.values()) {
      for (const [id, qty] of shop.stock) {
        const base = shop.defaults.get(id) ?? 0;
        if (qty < base) shop.stock.set(id, qty + 1);
        else if (qty > base) {
          if (qty - 1 <= 0 && base === 0) shop.stock.delete(id);
          else shop.stock.set(id, qty - 1);
        }
      }
    }
  }

  // --- NPC behaviour -------------------------------------------------------

  /**
   * NPC behaviour outside combat: leash back home when dragged too far, pick a
   * fight with nearby players when aggressive, otherwise idle-wander around the
   * spawn tile. Aggression follows the OSRS rules: an NPC only jumps players
   * whose combat level is at most twice its own plus one, never one already
   * locked in single-way combat with someone else, and it becomes tolerant
   * after a player lingers ~10 minutes. All rolls use the seeded rng.
   */
  private updateNpcAi(): void {
    for (const entity of this.entities.values()) {
      if (!(entity instanceof Npc) || entity.isDead) continue;

      // Chasing something: give up and stroll home once past the leash.
      if (entity.targetId !== null) {
        if (chebyshev(entity.position, entity.spawnTile) > entity.leashRange) {
          entity.targetId = null;
          entity.path = this.pathfinder.findPath(entity.position, entity.spawnTile);
        }
        continue;
      }

      // Aggro: jump a living, low-enough-level player inside the radius.
      if (entity.aggroRange > 0) {
        let anyNear = false;
        let picked = false;
        for (const other of this.entities.values()) {
          if (!(other instanceof Player) || !other.isAlive) continue;
          const dist = chebyshev(entity.position, other.position);
          if (dist <= entity.aggroRange + 6) anyNear = true;
          if (
            !picked &&
            dist <= entity.aggroRange &&
            entity.toleranceTimer < TOLERANCE_TICKS &&
            this.combatLevelOf(other) <= 2 * entity.combatLevel + 1 &&
            this.canEngage(entity, other)
          ) {
            entity.targetId = other.id;
            picked = true;
          }
        }
        // The tolerance clock runs while someone camps nearby and winds back
        // down once they leave.
        entity.toleranceTimer = anyNear
          ? entity.toleranceTimer + 1
          : Math.max(0, entity.toleranceTimer - 5);
        if (picked) continue;
      }

      // Idle wander: occasionally amble to a nearby tile around the spawn —
      // unless someone is talking to us.
      if (entity.path.length === 0 && this.rng() < 0.06 && !this.inDialogueWith(entity.id)) {
        const r = entity.wanderRadius;
        const dest = {
          x: entity.spawnTile.x + Math.floor(this.rng() * (2 * r + 1)) - r,
          y: entity.spawnTile.y + Math.floor(this.rng() * (2 * r + 1)) - r,
        };
        if (this.map.inBounds(dest.x, dest.y) && !this.map.isBlocked(dest.x, dest.y)) {
          entity.path = this.pathfinder.findPath(entity.position, dest);
        }
      }
    }
  }

  // --- Combat --------------------------------------------------------------

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

      if (!this.canEngage(entity, target)) {
        // Single-way combat: that fight belongs to someone else. Players hear
        // the classic refusal; NPCs stand down and try again once it is free.
        if (entity instanceof Player) this.refuseEngagement(entity, target);
        entity.targetId = null;
        entity.path.length = 0;
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

  /** Who `entity` is currently locked to in single-way combat, if anyone. */
  private combatPartnerOf(entity: Entity): number | null {
    if (this.tickCount - entity.lastCombatTick >= SINGLE_COMBAT_TICKS) return null;
    return entity.lastCombatPartnerId;
  }

  /**
   * Single-way combat: `attacker` may fight `target` only while neither of
   * them is locked to somebody else.
   */
  private canEngage(attacker: Entity, target: Entity): boolean {
    const theirs = this.combatPartnerOf(target);
    if (theirs !== null && theirs !== attacker.id) return false;
    const ours = this.combatPartnerOf(attacker);
    if (ours !== null && ours !== target.id) return false;
    return true;
  }

  /** The OSRS refusal lines for an attack single-way combat blocks. */
  private refuseEngagement(player: Player, target: Entity): void {
    const ours = this.combatPartnerOf(player);
    this.say(
      ours !== null && ours !== target.id ? "I'm already under attack." : 'Someone else is fighting that.',
    );
  }

  private performAttack(attacker: Entity, defender: Entity): void {
    // Both sides are now locked to each other for the single-way window.
    attacker.lastCombatTick = this.tickCount;
    attacker.lastCombatPartnerId = defender.id;
    defender.lastCombatTick = this.tickCount;
    defender.lastCombatPartnerId = attacker.id;

    let damage = rollDamage(this.profileOf(attacker), this.profileOf(defender), this.rng);

    // Protect from Melee fully blocks NPC melee, exactly like OSRS.
    if (
      damage > 0 &&
      attacker instanceof Npc &&
      defender instanceof Player &&
      this.hasProtectMelee(defender)
    ) {
      damage = 0;
    }

    defender.hitpoints = Math.max(0, defender.hitpoints - damage);
    defender.splatQueue.push(damage);
    attacker.swingQueue.push(defender.id);
    this.eventQueue.push({ type: 'hit', entityId: defender.id, damage });

    // Combat XP, OSRS-style: 4 × damage to the style skill (or 1.33 × damage
    // to each of attack/strength/defence on controlled), plus 1.33 × damage
    // to Hitpoints.
    if (attacker instanceof Player && damage > 0) {
      const style = this.styleOf(attacker);
      const skills = styleSkills(style);
      const per = style === 'controlled' ? (damage * 4) / 3 : damage * 4;
      for (const skill of skills) this.grantXp(attacker, skill, per);
      this.grantXp(attacker, 'hitpoints', (damage * 4) / 3);
    }

    // Auto-retaliate: an idle defender turns on its attacker (players can turn
    // this off on the combat tab). Retaliating interrupts skilling/looting.
    if (defender.targetId === null && defender.isAlive) {
      const retaliates = defender instanceof Player ? defender.autoRetaliate : true;
      if (retaliates) {
        defender.targetId = attacker.id;
        if (defender instanceof Player) {
          defender.gatherTarget = null;
          defender.pickupTarget = null;
          defender.action = null;
          defender.objectTarget = null;
        }
      }
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
    victim.lastCombatTick = Number.NEGATIVE_INFINITY;
    victim.lastCombatPartnerId = null;

    if (victim instanceof Npc) {
      victim.respawnTimer = victim.respawnTicks; // stays dead, then returns
      if (killer instanceof Player) {
        this.eventQueue.push({ type: 'kill', killerId: killer.id, victimName: victim.name });
        killer.killCounts.set(victim.kind, (killer.killCounts.get(victim.kind) ?? 0) + 1);
      }
      // Roll the drop table onto the tile the NPC died on.
      for (const entry of victim.drops) {
        if (this.rng() >= entry.chance) continue;
        const min = entry.min ?? 1;
        const max = entry.max ?? min;
        const qty = min + Math.floor(this.rng() * (max - min + 1));
        this.dropItem(stackOf(entry.itemId, qty), victim.position);
      }
    } else if (victim instanceof Player) {
      this.eventQueue.push({ type: 'died', entityId: victim.id });
      this.dropItemsOnDeath(victim);
      // Respawn refreshed at the spawn tile, prayers off and points restored.
      victim.hitpoints = victim.maxHitpoints;
      victim.attackCooldown = 0;
      victim.activePrayers.clear();
      victim.prayerPoints = victim.maxPrayerPoints;
      victim.action = null;
      victim.gatherTarget = null;
      victim.pickupTarget = null;
      victim.objectTarget = null;
      victim.talkTarget = null;
      this.closeDialogue(victim);
      this.closeShop(victim);
      if (this.playerSpawn) {
        victim.position = this.playerSpawn;
        victim.previousPosition = this.playerSpawn;
      }
    }
  }

  /**
   * The OSRS "items kept on death" rule: the three most valuable single items
   * are protected (a stack counts one unit at a time); everything else drops
   * where you fell.
   */
  private dropItemsOnDeath(victim: Player): void {
    const inv = victim.inventory;
    const carried: ItemStack[] = [];
    for (let i = 0; i < inv.slots.length; i++) {
      const s = inv.slots[i];
      if (s) carried.push(s);
      inv.slots[i] = null;
    }
    for (const slot of Object.keys(inv.equipment) as EquipSlot[]) {
      const s = inv.equipment[slot];
      if (s) carried.push(s);
      inv.equipment[slot] = null;
    }
    if (carried.length === 0) return;

    // Protect the three most valuable units.
    for (let keep = 0; keep < 3; keep++) {
      let best: ItemStack | null = null;
      for (const s of carried) {
        if (s.qty <= 0) continue;
        if (!best || itemDef(s.id).value > itemDef(best.id).value) best = s;
      }
      if (!best) break;
      best.qty--;
      inv.add(best.id, 1);
    }

    for (const s of carried) {
      if (s.qty > 0) this.dropItem(stackOf(s.id, s.qty), victim.position);
    }
    this.say('You keep your three most valuable items; the rest is left where you fell.');
  }

  // --- Inventory actions ---------------------------------------------------

  /** Use a backpack item on itself: eat food, bury bones. */
  private useItem(player: Player, slot: number): void {
    const item = player.inventory.slots[slot];
    if (!item) return;
    const def = itemDef(item.id);

    if (def.heals !== undefined) {
      if (player.eatDelay > 0) return;
      this.consumeOne(player, slot);
      player.hitpoints = Math.min(player.maxHitpoints, player.hitpoints + def.heals);
      // Eating takes a beat: ~1.8s before the next bite or swing, like OSRS.
      player.eatDelay = 3;
      player.attackCooldown = Math.max(player.attackCooldown, 3);
      this.eventQueue.push({ type: 'ate', itemName: def.name });
      this.say(`You eat the ${def.name.toLowerCase()}. It heals some health.`);
      return;
    }

    if (def.buryXp !== undefined) {
      if (player.buryDelay > 0) return;
      this.consumeOne(player, slot);
      player.buryDelay = 2;
      this.say('You dig a hole in the ground... You bury the bones.');
      this.eventQueue.push({ type: 'sfx', name: 'bury' });
      this.grantXp(player, 'prayer', def.buryXp);
      return;
    }

    this.say('Nothing interesting happens.');
  }

  private equipItem(player: Player, slot: number): void {
    const item = player.inventory.slots[slot];
    if (!item) return;
    const def = itemDef(item.id);
    if (!def.equip) return;
    const req = def.equipReq;
    if (req && player.skills.levelOf(req.skill) < req.level) {
      const skillName = req.skill.charAt(0).toUpperCase() + req.skill.slice(1);
      const verb = def.equip === 'weapon' ? 'wield' : 'wear';
      this.say(`You need ${req.skill === 'attack' ? 'an' : 'a'} ${skillName} level of ${req.level} to ${verb} this.`);
      return;
    }
    if (player.inventory.equip(slot)) {
      // Weapon categories carry different style lists; keep the index valid.
      const styles = WEAPON_STYLES[this.weaponTypeOf(player)];
      if (player.styleIndex >= styles.length) player.styleIndex = 0;
    }
  }

  /** Remove one unit from a slot (stack-aware). */
  private consumeOne(player: Player, slot: number): void {
    const item = player.inventory.slots[slot];
    if (!item) return;
    item.qty--;
    if (item.qty <= 0) player.inventory.slots[slot] = null;
  }

  // --- Pickups -------------------------------------------------------------

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

      const leftover = entity.inventory.add(ground.item.id, ground.item.qty);
      if (leftover === ground.item.qty) {
        this.say("You don't have enough inventory space.");
      } else if (leftover > 0) {
        ground.item.qty = leftover;
        this.eventQueue.push({ type: 'pickup' });
      } else {
        this.groundItems.delete(ground.id);
        this.eventQueue.push({ type: 'pickup' });
      }
      entity.pickupTarget = null;
    }
  }

  // --- Gathering (chop / mine / fish) --------------------------------------

  /** Players beside their gather target work it on the OSRS roll cadence. */
  private updateGathering(): void {
    for (const entity of this.entities.values()) {
      if (!(entity instanceof Player) || entity.gatherTarget === null) continue;

      const node = this.resourceNodes.get(entity.gatherTarget);
      if (!node || node.regrowTimer > 0) {
        entity.gatherTarget = null; // depleted under us (or gone)
        continue;
      }
      if (chebyshev(entity.position, node.tile) > 1) {
        // Still out of reach — the node may have moved (fishing spots do), or
        // a fight interrupted the approach. Path back rather than stand dumb.
        if (entity.path.length === 0) {
          const dest = this.adjacentDestination(entity.position, node.tile);
          entity.path = dest ? this.pathfinder.findPath(entity.position, dest) : [];
          if (entity.path.length === 0) entity.gatherTarget = null; // unreachable
        }
        continue;
      }

      entity.path.length = 0; // in position — stand and work
      const def = RESOURCE_DEFS[node.kind];

      const toolTier = this.toolTier(entity, def.tool);
      if (def.tool && toolTier <= 0) {
        this.say(def.noToolMsg);
        entity.gatherTarget = null;
        continue;
      }

      if (entity.inventory.firstFreeSlot() < 0) {
        this.say('Your backpack is too full to carry anything else.');
        entity.gatherTarget = null;
        continue;
      }

      // Only roll on the cadence tick (trees every 4, nets every 5...), but
      // keep the swing animation running in between.
      entity.gatherCooldown--;
      if (entity.gatherCooldown > 0) continue;
      entity.gatherCooldown = this.gatherCadence(entity, node.kind);

      entity.swingQueue.push(node.id);
      this.eventQueue.push({
        type: 'swing',
        kind: node.kind === 'tree' ? 'chop' : node.kind === 'rock' ? 'mine' : 'fish',
      });

      const level = entity.skills.levelOf(def.skill);
      // Better axes raise the success line; better picks swing more often.
      const toolMult = def.tool === 'axe' ? 1 + 0.15 * (toolTier - 1) : 1;
      for (const y of def.yields) {
        if (level < y.level) continue;
        if (this.rng() >= interpolateChance(y.low, y.high, level) * toolMult) continue;
        entity.inventory.add(y.itemId, 1);
        this.grantXp(entity, def.skill, y.xp);
        this.say(successMessage(y.itemId));
        if (def.regrowTicks > 0) {
          node.regrowTimer = def.regrowTicks;
          entity.gatherTarget = null;
        }
        break;
      }
    }
  }

  /** Ticks between harvest rolls; better pickaxes shave the mining cycle. */
  private gatherCadence(player: Player, kind: ResourceKind): number {
    const def = RESOURCE_DEFS[kind];
    if (def.tool === 'pick') {
      return Math.max(3, def.cadence - (this.toolTier(player, 'pick') - 1));
    }
    return def.cadence;
  }

  /** Best tier of the required tool the player carries or wields (0 = none). */
  private toolTier(player: Player, tool: 'axe' | 'pick' | 'net' | null): number {
    if (!tool) return 1;
    if (tool === 'net') return player.inventory.has('small_fishing_net') ? 1 : 0;
    let best = 0;
    const consider = (id: string | undefined): void => {
      if (!id) return;
      const def = itemDef(id);
      const tier = tool === 'axe' ? def.axeTier : def.pickTier;
      if (tier && tier > best) best = tier;
    };
    for (const s of player.inventory.slots) consider(s?.id);
    consider(player.inventory.equipment.weapon?.id);
    return best;
  }

  // --- Firemaking & cooking -------------------------------------------------

  private startLighting(player: Player, slot: number, clearIntents: () => void): void {
    const item = player.inventory.slots[slot];
    if (!item) return;
    const def = itemDef(item.id);
    if (def.firemakingXp === undefined) {
      this.say('Nothing interesting happens.');
      return;
    }
    if (!player.inventory.has('tinderbox')) {
      this.say('You need a tinderbox to light a fire.');
      return;
    }
    if (this.fireAt(player.position)) {
      this.say("You can't light a fire here.");
      return;
    }
    clearIntents();
    player.path.length = 0;
    player.action = { type: 'light', slot, tile: { ...player.position } };
    this.say('You attempt to light the logs.');
  }

  private startCooking(
    player: Player,
    fireId: number,
    itemId: string,
    clearIntents: () => void,
  ): void {
    const fire = this.fires.get(fireId);
    if (!fire) return;
    const def = itemDef(itemId);
    if (!def.cooking) return;
    if (player.inventory.countOf(itemId) <= 0) {
      this.say(`You don't have any ${def.name.toLowerCase()} to cook.`);
      return;
    }
    // The castle range is the Cook's until you've done him a favour.
    if (fire.kind === 'range' && (player.quests.get('cooks_rats') ?? 0) < 2) {
      this.say('The Cook shoos you away from his range. Perhaps if you helped him first...');
      return;
    }
    clearIntents();
    player.action = { type: 'cook', fireId, itemId, cooldown: 2 };
    if (chebyshev(player.position, fire.tile) > 1) {
      const dest = this.adjacentDestination(player.position, fire.tile);
      player.path = dest ? this.pathfinder.findPath(player.position, dest) : [];
    }
  }

  /** Advance multi-tick actions: striking the tinderbox, cooking on a fire. */
  private updateActions(): void {
    for (const entity of this.entities.values()) {
      if (!(entity instanceof Player) || !entity.action) continue;
      const action = entity.action;

      if (action.type === 'light') {
        const item = entity.inventory.slots[action.slot];
        const def = item ? itemDef(item.id) : null;
        if (!def?.firemakingXp || !tilesEqual(entity.position, action.tile)) {
          entity.action = null;
          continue;
        }
        // One attempt per tick on the OSRS firemaking curve: 65/256 at level 1,
        // certain from level 43.
        const level = entity.skills.levelOf('firemaking');
        if (this.rng() >= interpolateChance(65, 513, level)) continue;

        this.consumeOne(entity, action.slot);
        const fire: Fire = {
          id: this.nextFireId++,
          tile: action.tile,
          kind: 'fire',
          // Fire lifetimes are unpredictable, like OSRS: one to three minutes.
          expiresAtTick: this.tickCount + 100 + Math.floor(this.rng() * 200),
        };
        this.fires.set(fire.id, fire);
        this.grantXp(entity, 'firemaking', def.firemakingXp);
        this.say('The fire catches and the logs begin to burn.');
        this.eventQueue.push({ type: 'sfx', name: 'light' });
        entity.action = null;
        this.stepOffFire(entity);
        this.onFireLit(entity, fire.tile);
        continue;
      }

      // Cooking: one attempt every 4 ticks while raw food and the fire remain.
      const fire = this.fires.get(action.fireId);
      if (!fire) {
        this.say('Your fire has burnt out.');
        entity.action = null;
        continue;
      }
      if (chebyshev(entity.position, fire.tile) > 1) {
        if (entity.path.length === 0) {
          const dest = this.adjacentDestination(entity.position, fire.tile);
          entity.path = dest ? this.pathfinder.findPath(entity.position, dest) : [];
          if (entity.path.length === 0) entity.action = null;
        }
        continue;
      }
      entity.path.length = 0;

      action.cooldown--;
      if (action.cooldown > 0) continue;
      action.cooldown = 4;

      const def = itemDef(action.itemId);
      const cooking = def.cooking!;
      const slot = entity.inventory.firstSlotOf(action.itemId);
      if (slot < 0) {
        entity.action = null;
        continue;
      }
      this.consumeOne(entity, slot);
      const level = entity.skills.levelOf('cooking');
      const stopBurn = fire.kind === 'range' ? (cooking.stopBurnRange ?? cooking.stopBurn) : cooking.stopBurn;
      if (this.rng() < cookSuccessChance(level, stopBurn)) {
        entity.inventory.add(cooking.cooked, 1);
        this.grantXp(entity, 'cooking', cooking.xp);
        this.say(`You successfully cook some ${itemDef(cooking.cooked).name.toLowerCase()}.`);
        this.eventQueue.push({ type: 'sfx', name: 'cook' });
      } else {
        entity.inventory.add(cooking.burnt, 1);
        this.say(`You accidentally burn the ${itemDef(cooking.cooked).name.toLowerCase()}.`);
      }
      if (entity.inventory.countOf(action.itemId) <= 0) entity.action = null;
    }
  }

  /** After lighting a fire, step west like OSRS (east/south/north as fallback). */
  private stepOffFire(player: Player): void {
    const { x, y } = player.position;
    const options: Tile[] = [
      { x: x - 1, y }, // west
      { x: x + 1, y }, // east
      { x, y: y - 1 }, // south
      { x, y: y + 1 }, // north
    ];
    for (const next of options) {
      if (this.map.canStep(player.position, next)) {
        player.path = [next];
        return;
      }
    }
  }

  private updateFires(): void {
    for (const [id, fire] of this.fires) {
      if (fire.kind === 'fire' && this.tickCount >= fire.expiresAtTick) {
        this.fires.delete(id);
        this.dropItem(stackOf('ashes', 1), fire.tile);
      }
    }
  }

  // --- Bank & altar ---------------------------------------------------------

  private updateObjectInteractions(): void {
    for (const entity of this.entities.values()) {
      if (!(entity instanceof Player) || !entity.objectTarget) continue;
      const target = entity.objectTarget;

      if (chebyshev(entity.position, target.tile) <= 1) {
        entity.path.length = 0;
        entity.objectTarget = null;
        if (target.kind === 'bank') {
          this.eventQueue.push({ type: 'openBank', entityId: entity.id });
        } else if (entity.prayerPoints < entity.maxPrayerPoints) {
          entity.prayerPoints = entity.maxPrayerPoints;
          entity.prayerDrainCounter = 0;
          this.say('You recharge your Prayer points.');
          this.eventQueue.push({ type: 'sfx', name: 'recharge' });
        } else {
          this.say('You already have full Prayer points.');
        }
      } else if (entity.path.length === 0) {
        const dest = this.adjacentDestination(entity.position, target.tile);
        entity.path = dest ? this.pathfinder.findPath(entity.position, dest) : [];
        if (entity.path.length === 0) entity.objectTarget = null; // unreachable
      }
    }
  }

  private nearBank(player: Player): boolean {
    const near = this.interactables.some(
      (i) => i.kind === 'bank' && chebyshev(player.position, i.tile) <= 2,
    );
    if (!near) this.say("You aren't standing at a bank.");
    return near;
  }

  private bankDeposit(player: Player, slot: number, qty: number): void {
    if (!this.nearBank(player)) return;
    const item = player.inventory.slots[slot];
    if (!item) return;
    const id = item.id;
    const want = qty < 0 ? player.inventory.countOf(id) : Math.min(qty, player.inventory.countOf(id));
    const moved = player.inventory.removeById(id, want);
    if (moved > 0) this.bankAdd(player, id, moved);
  }

  private bankAdd(player: Player, id: string, qty: number): void {
    player.bank.set(id, (player.bank.get(id) ?? 0) + qty);
  }

  private bankWithdraw(player: Player, itemId: string, qty: number): void {
    if (!this.nearBank(player)) return;
    const available = player.bank.get(itemId) ?? 0;
    if (available <= 0) return;
    const want = Math.min(qty < 0 ? available : qty, available);
    const leftover = player.inventory.add(itemId, want);
    const moved = want - leftover;
    if (moved <= 0) {
      this.say("You don't have enough inventory space.");
      return;
    }
    const remaining = available - moved;
    if (remaining > 0) player.bank.set(itemId, remaining);
    else player.bank.delete(itemId);
  }

  // --- Prayer ---------------------------------------------------------------

  private togglePrayer(player: Player, prayerId: string): void {
    const def = prayerDef(prayerId);
    if (player.activePrayers.has(prayerId)) {
      player.activePrayers.delete(prayerId);
      this.eventQueue.push({ type: 'sfx', name: 'prayerOff' });
      return;
    }
    if (player.skills.levelOf('prayer') < def.level) {
      this.say(`You need a Prayer level of ${def.level} to use ${def.name}.`);
      return;
    }
    if (player.prayerPoints <= 0) {
      this.say('You have run out of prayer points; you can recharge at an altar.');
      return;
    }
    // Prayers in the same group (defence / strength / attack) replace each other.
    for (const other of PRAYERS) {
      if (other.group === def.group) player.activePrayers.delete(other.id);
    }
    player.activePrayers.add(prayerId);
    this.eventQueue.push({ type: 'sfx', name: 'prayerOn' });
  }

  /**
   * The OSRS drain formula: active prayers add their drain effects to a counter
   * each tick; each time it passes the resistance (2 × prayer bonus + 60) one
   * point is spent. Thick Skin alone: a point every 36 seconds.
   */
  private updatePrayer(): void {
    for (const entity of this.entities.values()) {
      if (!(entity instanceof Player) || entity.activePrayers.size === 0) continue;
      let drain = 0;
      for (const id of entity.activePrayers) drain += prayerDef(id).drainEffect;
      entity.prayerDrainCounter += drain;

      const resistance = 2 * entity.inventory.equipmentBonuses().prayer + 60;
      while (entity.prayerDrainCounter >= resistance && entity.prayerPoints > 0) {
        entity.prayerDrainCounter -= resistance;
        entity.prayerPoints--;
      }
      if (entity.prayerPoints <= 0) {
        entity.activePrayers.clear();
        entity.prayerDrainCounter = 0;
        this.say('You have run out of prayer points; you can recharge at an altar.');
        this.eventQueue.push({ type: 'sfx', name: 'prayerOff' });
      }
    }
  }

  private hasProtectMelee(player: Player): boolean {
    for (const id of player.activePrayers) {
      if (prayerDef(id).protectMelee) return true;
    }
    return false;
  }

  // --- Movement & upkeep ----------------------------------------------------

  private moveEntities(): void {
    for (const entity of this.entities.values()) {
      entity.previousPosition = entity.position;
      let moved = 0;
      if (entity.path.length > 0) {
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
          moved++;
        }
      }

      // Run energy, straight from the wiki: running drains
      // (60 + 67·weight/64) × (1 − agility/300) units per tick (agility isn't
      // trainable here yet, so it sits at 1); resting restores ⌊agility/10⌋+15.
      if (entity instanceof Player) {
        if (entity.running && moved > 0) {
          const weight = Math.max(0, Math.min(64, entity.inventory.totalWeightKg()));
          const drain = Math.floor((60 + (67 * weight) / 64) * (1 - 1 / 300));
          entity.energy = Math.max(0, entity.energy - drain);
          if (entity.energy <= 0) entity.running = false; // the orb un-toggles
        } else {
          entity.energy = Math.min(MAX_RUN_ENERGY, entity.energy + 15);
        }
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

  /** Fishing spots wander between their candidate tiles every minute or two. */
  private updateFishingSpots(): void {
    for (const node of this.resourceNodes.values()) {
      if (node.kind !== 'fishing_spot' || !node.candidates) continue;
      node.moveTimer = (node.moveTimer ?? 100) - 1;
      if (node.moveTimer > 0) continue;
      node.moveTimer = 80 + Math.floor(this.rng() * 120);
      const others = node.candidates.filter((c) => !tilesEqual(c, node.tile));
      if (others.length > 0) {
        node.tile = others[Math.floor(this.rng() * others.length)];
      }
    }
  }

  /** Passive recovery, OSRS-style: players regain 1 HP per 100 ticks (~1min). */
  private updateRegen(): void {
    if (this.tickCount % 100 !== 0 || this.tickCount === 0) return;
    for (const entity of this.entities.values()) {
      if (entity instanceof Player && entity.isAlive && entity.hitpoints < entity.maxHitpoints) {
        entity.hitpoints++;
      }
    }
  }

  /** Per-tick countdowns: eat and bury delays. Runs before commands apply. */
  private updateTimers(): void {
    for (const entity of this.entities.values()) {
      if (!(entity instanceof Player)) continue;
      if (entity.eatDelay > 0) entity.eatDelay--;
      if (entity.buryDelay > 0) entity.buryDelay--;
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

  // --- Combat profiles ------------------------------------------------------

  /** The style the player's current weapon + selected index resolve to. */
  private styleOf(player: Player) {
    const styles = WEAPON_STYLES[this.weaponTypeOf(player)];
    return styles[Math.min(player.styleIndex, styles.length - 1)].style;
  }

  /** Build the combat profile for an entity from its levels and worn gear. */
  private profileOf(entity: Entity): CombatProfile {
    if (entity instanceof Player) {
      const bonus = entity.inventory.equipmentBonuses();
      const profile: CombatProfile = {
        attack: entity.skills.levelOf('attack'),
        strength: entity.skills.levelOf('strength'),
        defense: entity.skills.levelOf('defense'),
        attackBonus: bonus.attack,
        strengthBonus: bonus.strength,
        defenseBonus: bonus.defense,
        style: this.styleOf(entity),
      };
      for (const id of entity.activePrayers) {
        const boost = prayerDef(id).boost;
        if (!boost) continue;
        if (boost.skill === 'attack') profile.prayerAttack = boost.mult;
        if (boost.skill === 'strength') profile.prayerStrength = boost.mult;
        if (boost.skill === 'defense') profile.prayerDefense = boost.mult;
      }
      return profile;
    }
    if (entity instanceof Npc) {
      // NPCs fight at effective level + 9, the documented OSRS monster maths
      // (+8 like everyone, +1 as if on controlled).
      return {
        attack: entity.attack,
        strength: entity.strength,
        defense: entity.defense,
        attackBonus: 0,
        strengthBonus: 0,
        defenseBonus: 0,
        style: 'controlled',
      };
    }
    return {
      attack: 1,
      strength: 1,
      defense: 1,
      attackBonus: 0,
      strengthBonus: 0,
      defenseBonus: 0,
      style: 'accurate',
    };
  }

  private attackSpeedOf(entity: Entity): number {
    if (entity instanceof Npc) return entity.attackSpeed;
    if (entity instanceof Player) {
      const weapon = entity.inventory.equipment.weapon;
      return (weapon && itemDef(weapon.id).speed) || 4; // unarmed swings at 4
    }
    return 4;
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

  private say(text: string): void {
    this.eventQueue.push({ type: 'message', text });
  }
}

/** Success messages for gathered items. */
function successMessage(itemId: string): string {
  switch (itemId) {
    case 'logs':
      return 'You get some logs.';
    case 'copper_ore':
      return 'You manage to mine some copper ore.';
    case 'raw_shrimps':
      return 'You catch some shrimps.';
    case 'raw_anchovies':
      return 'You catch some anchovies.';
    default:
      return `You get some ${itemDef(itemId).name.toLowerCase()}.`;
  }
}

/**
 * Cooking success: rises from ~55% at the food's level-1 floor to certain at
 * its stop-burn level (shrimps stop burning at 34, like OSRS).
 */
function cookSuccessChance(level: number, stopBurn: number): number {
  if (level >= stopBurn) return 1;
  return Math.min(1, 0.55 + (0.45 * (level - 1)) / (stopBurn - 1));
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
