import { TileMap } from './TileMap';
import { Pathfinder } from './Pathfinder';
import { Entity } from './Entity';
import { Player } from './Player';
import { Command } from './commands';
import { Tile } from './coords';
import { WALK_SPEED, RUN_SPEED } from '../engine/constants';

/**
 * The authoritative game state and the one function that advances it:
 * {@link tick}. The world is a pure simulation — no Three.js, no DOM, no
 * wall-clock time. Given the same starting state and the same per-tick command
 * stream it always produces the same result, which is exactly what lets the
 * very same code run client-side today and on an authoritative server later.
 */
export class World {
  readonly map: TileMap;
  readonly pathfinder: Pathfinder;
  readonly entities = new Map<number, Entity>();
  tickCount = 0;

  private nextEntityId = 1;

  constructor(map: TileMap) {
    this.map = map;
    this.pathfinder = new Pathfinder(map);
  }

  spawnPlayer(position: Tile, name?: string): Player {
    const player = new Player(this.nextEntityId++, position, name);
    this.entities.set(player.id, player);
    return player;
  }

  /** Advance the simulation by exactly one game tick (600ms). Deterministic. */
  tick(commands: Command[]): void {
    this.applyCommands(commands);
    this.moveEntities();
    this.tickCount++;
  }

  private applyCommands(commands: Command[]): void {
    for (const cmd of commands) {
      if (cmd.type === 'move') {
        const entity = this.entities.get(cmd.entityId);
        if (!entity) continue;
        entity.running = cmd.run ?? entity.running;
        entity.path = this.pathfinder.findPath(entity.position, cmd.target);
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
}
