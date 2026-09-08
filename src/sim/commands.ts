import { Tile } from './coords';
import { EquipSlot } from './Inventory';

/**
 * Commands are the *intents* fed into the simulation each tick — "this entity
 * wants to walk to that tile". They are plain, serializable data on purpose:
 * this is precisely the boundary that becomes the network protocol. Today the
 * input layer produces commands locally; tomorrow a client serializes them to
 * an authoritative server, which validates and applies them in `World.tick`.
 */
export type Command =
  | { type: 'move'; entityId: number; target: Tile; run?: boolean }
  | { type: 'attack'; entityId: number; targetId: number }
  | { type: 'pickup'; entityId: number; groundItemId: number }
  /** Work a tree, rock, or fishing spot (`method` picks net vs bait at a spot). */
  | { type: 'gather'; entityId: number; nodeId: number; method?: 'net' | 'bait' }
  /** Use a backpack item on itself: eat food, bury bones. */
  | { type: 'useItem'; entityId: number; slot: number }
  | { type: 'dropItem'; entityId: number; slot: number }
  | { type: 'equipItem'; entityId: number; slot: number }
  | { type: 'unequipItem'; entityId: number; slot: EquipSlot }
  /** Toggle the persistent run mode (the orb next to the minimap). */
  | { type: 'setRun'; entityId: number; on: boolean }
  /** Pick an attack style on the combat tab. */
  | { type: 'setStyle'; entityId: number; index: number }
  | { type: 'setAutoRetaliate'; entityId: number; on: boolean }
  | { type: 'togglePrayer'; entityId: number; prayerId: string }
  /** Strike a tinderbox against the logs in `slot`. */
  | { type: 'lightFire'; entityId: number; slot: number }
  /** Cook every `itemId` in the backpack on the given fire (or range). */
  | { type: 'cook'; entityId: number; fireId: number; itemId: string }
  /** Walk to and use a world object (bank booth, altar, anvil). */
  | { type: 'interact'; entityId: number; kind: 'bank' | 'altar' | 'anvil' | 'furnace'; target: Tile }
  /** Walk to the furnace at `target` and smelt `count` bars of `bar`. */
  | { type: 'smelt'; entityId: number; bar: string; count: number; target: Tile }
  /** Hammer `count` of `item` on the anvil the player stands beside. */
  | { type: 'smith'; entityId: number; item: string; count: number }
  | { type: 'bankDeposit'; entityId: number; slot: number; qty: number }
  | { type: 'bankWithdraw'; entityId: number; itemId: string; qty: number }
  | { type: 'bankDepositAll'; entityId: number }
  /** Walk up to an NPC and start its conversation. */
  | { type: 'talk'; entityId: number; npcId: number }
  /** Walk up to a shopkeeper and open the shop. */
  | { type: 'trade'; entityId: number; npcId: number }
  /** "Click here to continue" in the dialogue box. */
  | { type: 'dialogueContinue'; entityId: number }
  /** Pick the n-th option in the dialogue box. */
  | { type: 'dialogueChoose'; entityId: number; index: number }
  | { type: 'shopBuy'; entityId: number; itemId: string; qty: number }
  /** Sell `qty` of the item in backpack `slot` to the open shop. */
  | { type: 'shopSell'; entityId: number; slot: number; qty: number };

export function moveCommand(entityId: number, target: Tile, run?: boolean): Command {
  return { type: 'move', entityId, target, run };
}

export function attackCommand(entityId: number, targetId: number): Command {
  return { type: 'attack', entityId, targetId };
}

export function pickupCommand(entityId: number, groundItemId: number): Command {
  return { type: 'pickup', entityId, groundItemId };
}

export function gatherCommand(entityId: number, nodeId: number, method?: 'net' | 'bait'): Command {
  return { type: 'gather', entityId, nodeId, method };
}

export function useItemCommand(entityId: number, slot: number): Command {
  return { type: 'useItem', entityId, slot };
}

export function dropItemCommand(entityId: number, slot: number): Command {
  return { type: 'dropItem', entityId, slot };
}

export function equipItemCommand(entityId: number, slot: number): Command {
  return { type: 'equipItem', entityId, slot };
}

export function unequipItemCommand(entityId: number, slot: EquipSlot): Command {
  return { type: 'unequipItem', entityId, slot };
}

export function talkCommand(entityId: number, npcId: number): Command {
  return { type: 'talk', entityId, npcId };
}
