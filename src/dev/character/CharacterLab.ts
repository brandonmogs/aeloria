import { CharacterStage } from '../../render/CharacterStage';
import { LabConfig } from './config';

export { LIGHT_RIGS } from '../../render/CharacterStage';
export type { StageStats as LabStats } from '../../render/CharacterStage';

/**
 * The character preview stage of the lab page: the shared {@link CharacterStage}
 * (the character creation screen stands on the same one), fed from the
 * lab's config.
 */
export class CharacterLab extends CharacterStage {
  /** Build (or rebuild) the figure from the config: body, hair, painted outfit and worn gear. */
  show(cfg: LabConfig): void {
    this.setCharacter({
      race: cfg.race,
      sex: cfg.sex,
      height: cfg.height,
      hair: cfg.hair,
      hairColor: cfg.hairColor,
      skinTone: cfg.skin,
      eyes: cfg.eyes,
      tunic: cfg.tunic,
      trouser: cfg.trouser,
      equipment: cfg.equipment,
      morphs: cfg.morphs,
      brows: cfg.brows,
      browColor: cfg.browColor,
      lashes: cfg.lashes,
      face: cfg.face,
      enchant: true,
      merged: cfg.merged,
    });
  }
}
