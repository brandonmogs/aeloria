import { Entity } from './Entity';
import { Tile } from './coords';
import { AttackStyle } from './combat';
import { Item } from './Inventory';

/** What the renderer should draw this NPC as. */
export type NpcKind = 'goblin';

/** One entry in an NPC's drop table: the item and its per-kill drop chance. */
export interface DropEntry {
  item: Item;
  /** 0..1; 1 is a guaranteed drop. */
  chance: number;
}

export interface NpcConfig {
  name: string;
  kind: NpcKind;
  attack: number;
  strength: number;
  defense: number;
  maxHitpoints: number;
  /** Ticks between attacks (4 ≈ a standard weapon). */
  attackSpeed: number;
  /** Ticks to stay dead before respawning. */
  respawnTicks: number;
  /** Whether it strikes back when attacked. */
  aggressive?: boolean;
  /** Items rolled onto the ground when this NPC dies. */
  drops?: DropEntry[];
}

/**
 * A non-player combatant. Holds its combat levels and a respawn timer: when it
 * dies it goes dormant for {@link respawnTicks} and then returns to its
 * {@link spawnTile} at full health. The combat rules themselves live in
 * {@link World}; this just carries the stats.
 */
export class Npc extends Entity {
  readonly name: string;
  readonly kind: NpcKind;
  readonly attack: number;
  readonly strength: number;
  readonly defense: number;
  readonly attackSpeed: number;
  readonly respawnTicks: number;
  readonly aggressive: boolean;
  readonly spawnTile: Tile;
  readonly style: AttackStyle = 'aggressive';
  readonly drops: DropEntry[];

  /** Set while dead; counts down to respawn. */
  respawnTimer = 0;

  constructor(id: number, position: Tile, config: NpcConfig) {
    super(id, position);
    this.name = config.name;
    this.kind = config.kind;
    this.attack = config.attack;
    this.strength = config.strength;
    this.defense = config.defense;
    this.attackSpeed = config.attackSpeed;
    this.respawnTicks = config.respawnTicks;
    this.aggressive = config.aggressive ?? true;
    this.drops = config.drops ?? [];
    this.spawnTile = position;
    this.maxHitpoints = config.maxHitpoints;
    this.hitpoints = config.maxHitpoints;
  }

  get isDead(): boolean {
    return this.hitpoints <= 0;
  }
}
