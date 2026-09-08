import { Entity } from './Entity';
import { Tile } from './coords';
import { Inventory } from './Inventory';
import { Skills } from './Skills';
import { QUESTS, questStatus } from './quests';

/** Run energy is stored in OSRS's internal units: 10,000 = 100%. */
export const MAX_RUN_ENERGY = 10000;

/** A multi-tick skilling activity the player is in the middle of. */
export type PlayerAction =
  | { type: 'light'; slot: number; tile: Tile }
  | { type: 'cook'; fireId: number; itemId: string; cooldown: number };

/** Something in the world the player is walking over to open/use. */
export interface ObjectTarget {
  kind: 'bank' | 'altar';
  tile: Tile;
}

/** An NPC the player is walking up to, and what for. */
export interface TalkTarget {
  npcId: number;
  mode: 'talk' | 'trade';
}

/** Where the player is in a conversation: which NPC, which node of its script. */
export interface DialogueState {
  npcId: number;
  nodeKey: string;
}

/**
 * The local player (and, later, other connected players). A named entity that
 * carries an {@link Inventory}, a set of {@link Skills}, prayer and run-energy
 * state, quest progress, and the interaction targets the per-tick systems in
 * {@link World} advance.
 */
export class Player extends Entity {
  readonly inventory = new Inventory();
  readonly skills = new Skills();

  /** Ground item this player is walking toward to pick up, or null. */
  pickupTarget: number | null = null;

  /** Resource node this player is gathering (or walking toward), or null. */
  gatherTarget: number | null = null;

  /** Ticks until the next harvest roll while gathering. */
  gatherCooldown = 0;

  /** A bank booth or altar the player is walking to, or null. */
  objectTarget: ObjectTarget | null = null;

  /** An NPC the player is walking to talk to or trade with, or null. */
  talkTarget: TalkTarget | null = null;

  /** The conversation in progress, or null. */
  dialogue: DialogueState | null = null;

  /** The shop screen the player has open, or null. */
  shopId: string | null = null;

  /** The lighting/cooking activity in progress, or null. */
  action: PlayerAction | null = null;

  // --- Quests ---------------------------------------------------------------
  /** Quest id → stage (0 or absent = not started). */
  readonly quests = new Map<string, number>();

  /** Per-quest scratch numbers: kill-count baselines, flags. */
  readonly questVars = new Map<string, number>();

  /** Lifetime kills by NPC kind, for quest objectives. */
  readonly killCounts = new Map<string, number>();

  // --- Combat options ------------------------------------------------------
  /** Index into the current weapon's style list (see WEAPON_STYLES). */
  styleIndex = 0;

  /** Fight back automatically when attacked (the OSRS combat-tab toggle). */
  autoRetaliate = true;

  /** Ticks before this player may eat again; eating also delays attacks. */
  eatDelay = 0;

  /** Ticks before this player may bury another set of bones. */
  buryDelay = 0;

  // --- Run energy ----------------------------------------------------------
  /** 0..10000 internal units; the orb shows it as a percentage. */
  energy = MAX_RUN_ENERGY;

  // --- Prayer --------------------------------------------------------------
  /** Current prayer points; the unboosted maximum is the Prayer level. */
  prayerPoints: number;

  /** Ids of active prayers (see PRAYERS). */
  readonly activePrayers = new Set<string>();

  /** Accumulates drain effects each tick; spends a point past the resistance. */
  prayerDrainCounter = 0;

  // --- Bank ----------------------------------------------------------------
  /** Everything stored at the bank stacks, keyed by item id. */
  readonly bank = new Map<string, number>();

  constructor(
    id: number,
    position: Tile,
    readonly name = 'Player',
  ) {
    super(id, position);
    this.maxHitpoints = this.skills.levelOf('hitpoints');
    this.hitpoints = this.maxHitpoints;
    this.prayerPoints = this.skills.levelOf('prayer');
  }

  get maxPrayerPoints(): number {
    return this.skills.levelOf('prayer');
  }

  /** Quest points earned so far — the sum over completed quests. */
  get questPoints(): number {
    let total = 0;
    for (const q of QUESTS) {
      if (questStatus(q, this.quests.get(q.id) ?? 0) === 'complete') total += q.questPoints;
    }
    return total;
  }
}
