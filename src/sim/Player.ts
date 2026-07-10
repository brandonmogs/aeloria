import { Entity } from './Entity';
import { Tile } from './coords';
import { Inventory } from './Inventory';
import { Skills } from './Skills';

/**
 * The local player (and, later, other connected players). A named entity that
 * carries an {@link Inventory} and a set of {@link Skills}; equipment bonuses
 * and more will hang off here as the game grows.
 */
export class Player extends Entity {
  readonly inventory = new Inventory();
  readonly skills = new Skills();

  /** Ground item this player is walking toward to pick up, or null. */
  pickupTarget: number | null = null;

  /**
   * Whether this player has earned the max cape (level 99 in every skill). The
   * skills system doesn't exist yet, so this is set manually for now; once it
   * lands this will be derived from "all skills at 99". The render layer reads
   * it to decide whether to drape the animated cape on the avatar.
   */
  maxCape = false;

  constructor(
    id: number,
    position: Tile,
    readonly name = 'Player',
  ) {
    super(id, position);
    this.maxHitpoints = this.skills.levelOf('hitpoints');
    this.hitpoints = this.maxHitpoints;
  }
}
