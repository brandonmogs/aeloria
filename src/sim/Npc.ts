import { Entity } from './Entity';
import { Tile } from './coords';
import { AttackType, combatLevel } from './combat';
import type { Bonuses } from './items';
import type { DialogueFn } from './dialogue';

/** What the renderer should draw this NPC as. */
export type NpcKind =
  | 'goblin'
  | 'rat'
  | 'guard'
  | 'cook'
  | 'captain'
  | 'woodsman'
  | 'fisherman'
  | 'shopkeeper';

/** One entry in an NPC's drop table: the item and its per-kill drop chance. */
export interface DropEntry {
  itemId: string;
  /** 0..1; 1 is a guaranteed drop. */
  chance: number;
  /** Quantity range (inclusive); defaults to exactly 1. */
  min?: number;
  max?: number;
}

export interface NpcConfig {
  name: string;
  kind: NpcKind;
  attack: number;
  strength: number;
  defense: number;
  /** Magic level, for its defence against spells (defaults to 1). */
  magic?: number;
  maxHitpoints: number;
  /** Ticks between attacks (4 ≈ a standard weapon). */
  attackSpeed: number;
  /** The melee type it attacks with (the wiki's "attack style"). */
  attackType?: AttackType;
  /** The wiki's monster bonuses (attack, strength, stab/slash/crush defence). */
  bonuses?: Partial<Bonuses>;
  /** Ticks to stay dead before respawning. */
  respawnTicks: number;
  /** Whether it strikes back when attacked. */
  aggressive?: boolean;
  /** Tiles within which this NPC attacks players unprovoked (0 = passive). */
  aggroRange?: number;
  /** How far from its spawn tile it idles around. */
  wanderRadius?: number;
  /** Items rolled onto the ground when this NPC dies. */
  drops?: DropEntry[];
  /** False for townsfolk: no Attack option, and attacks are refused. */
  attackable?: boolean;
  /** Right-click Examine text. */
  examine?: string;
  /** The conversation this NPC offers (adds a Talk-to option). */
  dialogue?: DialogueFn;
  /** The shop this NPC runs (adds a Trade option). */
  shopId?: string;
}

/**
 * A non-player character: a monster with combat levels and a respawn timer,
 * or a villager with a script to say and maybe a shop to run. When a monster
 * dies it goes dormant for {@link respawnTicks} and then returns to its
 * {@link spawnTile} at full health. The combat and dialogue rules themselves
 * live in {@link World}; this just carries the config.
 */
export class Npc extends Entity {
  readonly name: string;
  readonly kind: NpcKind;
  readonly attack: number;
  readonly strength: number;
  readonly defense: number;
  readonly magic: number;
  readonly attackSpeed: number;
  readonly attackType: AttackType;
  readonly bonuses: Partial<Bonuses>;
  readonly respawnTicks: number;
  readonly aggressive: boolean;
  readonly aggroRange: number;
  readonly wanderRadius: number;
  /** Beyond this distance from spawn an NPC gives up the chase and walks home. */
  readonly leashRange: number;
  readonly spawnTile: Tile;
  readonly drops: DropEntry[];
  readonly attackable: boolean;
  readonly examine: string;
  readonly dialogue: DialogueFn | null;
  readonly shopId: string | null;

  /** Set while dead; counts down to respawn. */
  respawnTimer = 0;

  /**
   * Ticks a player has lingered nearby. Past the OSRS tolerance window
   * (~10 minutes) an aggressive NPC stops attacking unprovoked.
   */
  toleranceTimer = 0;

  constructor(id: number, position: Tile, config: NpcConfig) {
    super(id, position);
    this.name = config.name;
    this.kind = config.kind;
    this.attack = config.attack;
    this.strength = config.strength;
    this.defense = config.defense;
    this.magic = config.magic ?? 1;
    this.attackSpeed = config.attackSpeed;
    this.attackType = config.attackType ?? 'crush';
    this.bonuses = config.bonuses ?? {};
    this.respawnTicks = config.respawnTicks;
    this.aggressive = config.aggressive ?? true;
    this.aggroRange = config.aggroRange ?? 0;
    this.wanderRadius = config.wanderRadius ?? 3;
    this.leashRange = this.wanderRadius + 6;
    this.drops = config.drops ?? [];
    this.attackable = config.attackable ?? true;
    this.examine = config.examine ?? 'A creature.';
    this.dialogue = config.dialogue ?? null;
    this.shopId = config.shopId ?? null;
    this.spawnTile = position;
    this.maxHitpoints = config.maxHitpoints;
    this.hitpoints = config.maxHitpoints;
  }

  get isDead(): boolean {
    return this.hitpoints <= 0;
  }

  /** The OSRS combat level shown in menus and used by the aggro rule. */
  get combatLevel(): number {
    return combatLevel(this.attack, this.strength, this.defense, this.maxHitpoints);
  }
}
