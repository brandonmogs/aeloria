import { Tile } from './coords';

/**
 * Commands are the *intents* fed into the simulation each tick — "this entity
 * wants to walk to that tile". They are plain, serializable data on purpose:
 * this is precisely the boundary that becomes the network protocol. Today the
 * input layer produces commands locally; tomorrow a client serializes them to
 * an authoritative server, which validates and applies them in `World.tick`.
 */
export type Command =
  | {
      type: 'move';
      entityId: number;
      target: Tile;
      run?: boolean;
    }
  | {
      type: 'attack';
      entityId: number;
      targetId: number;
    }
  | {
      type: 'pickup';
      entityId: number;
      groundItemId: number;
    }
  | {
      type: 'gather';
      entityId: number;
      nodeId: number;
    }
  | {
      type: 'useItem';
      entityId: number;
      slot: number;
    }
  | {
      type: 'dropItem';
      entityId: number;
      slot: number;
    };

export function moveCommand(entityId: number, target: Tile, run = false): Command {
  return { type: 'move', entityId, target, run };
}

export function attackCommand(entityId: number, targetId: number): Command {
  return { type: 'attack', entityId, targetId };
}

export function pickupCommand(entityId: number, groundItemId: number): Command {
  return { type: 'pickup', entityId, groundItemId };
}

export function gatherCommand(entityId: number, nodeId: number): Command {
  return { type: 'gather', entityId, nodeId };
}

export function useItemCommand(entityId: number, slot: number): Command {
  return { type: 'useItem', entityId, slot };
}

export function dropItemCommand(entityId: number, slot: number): Command {
  return { type: 'dropItem', entityId, slot };
}
