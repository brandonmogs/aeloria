import { Entity } from './Entity';
import { Tile } from './coords';

/**
 * The local player (and, later, other connected players). Currently just a
 * named entity — stats, inventory, equipment, and skills will hang off here as
 * the game grows.
 */
export class Player extends Entity {
  constructor(
    id: number,
    position: Tile,
    readonly name = 'Player',
  ) {
    super(id, position);
  }
}
