import * as THREE from 'three';
import { mergeAttachments } from './attachments';
import { Animator, Rig } from './characters';
import { styleCharacter } from './characterStyle';
import { HairStyle } from './hair';
import { HERO_BUILD, HumanoidSpec, Race, Sex, bodyFor, buildHumanoid } from './human';
import { MorphValues } from './morphs';
import { Equipment, Outfit, dressRig, emptyEquipment } from './outfit';
import { raceExtras } from './raceGear';
import { RACES } from './races';

/**
 * One call from a description of a character to something to put in the
 * scene: the body from the pipeline for its race and sex, reshaped by the
 * race's build, painted, grown its hair, dressed in its equipment and, by
 * default, merged into two draw calls (the body and one skinned mesh of
 * everything on it) on one shared material set. The animator comes with it.
 */

export interface CharacterOptions {
  race: Race;
  sex: Sex;
  /** Metres; the race's default when left out. */
  height?: number;
  hair?: HairStyle;
  hairColor?: number;
  skinTone?: number;
  eyes?: number;
  /** The painted underlayer: what shows where nothing is worn. */
  tunic?: number;
  trouser?: number;
  equipment?: Partial<Equipment>;
  /** Proportion knobs on top of the race's build. */
  build?: Partial<HumanoidSpec>;
  /** The creator's sliders by id (see morphs.ts). */
  morphs?: MorphValues;
  /** Eyebrow weight (0 fine to 1 heavy) and colour; lash length in metres at the figure's scale, 0 for none. */
  brows?: number;
  browColor?: number;
  lashes?: number;
  /** Leather bracers on bare forearms. */
  bracers?: boolean;
  /** Glow the main-hand weapon's metal. */
  enchant?: boolean;
  /** Merge gear, hair and eyes into one skinned mesh beside the body (the default); false hangs each piece on its bone. */
  merged?: boolean;
}

export interface Character {
  /** Add this to the scene; it carries the skeleton. */
  group: THREE.Group;
  rig: Rig;
  outfit: Outfit;
  animator: Animator;
  /** Free the per-character geometry (materials are shared and stay). */
  dispose(): void;
}

export class CharacterBuilder {
  static build(o: CharacterOptions): Character {
    const race = RACES[o.race];
    const spec: HumanoidSpec = {
      ...HERO_BUILD,
      ...race.build[o.sex],
      ...o.build,
      body: bodyFor(o.race, o.sex),
      morphs: o.morphs,
      browWeight: o.brows,
      browColor: o.browColor,
      lashes: o.lashes,
      height: o.height ?? race.height[o.sex],
      hair: o.hair ?? race.hairStyle[o.sex],
      bracers: o.bracers ?? true,
      palette: {
        skin: o.skinTone ?? race.skin,
        hair: o.hairColor ?? race.hair,
        eyes: o.eyes ?? race.eyes,
        tunic: o.tunic ?? 0x3f7a4a,
        trouser: o.trouser ?? 0x4a4858,
        boots: 0x3b2a1c,
      },
      extras: raceExtras(o.race, o.sex, o.hairColor ?? race.hair),
    };
    const rig = buildHumanoid(spec);
    const equipment = { ...emptyEquipment(), ...o.equipment };
    const outfit = dressRig(rig, equipment);
    if (o.enchant && outfit.weapon) enchantWeapon(outfit.weapon);
    if (o.merged !== false && mergeAttachments(rig)) outfit.cape = undefined; // the cloth is on the cape chain now; nothing to billow
    styleCharacter(rig.group);
    return {
      group: rig.group,
      rig,
      outfit,
      animator: new Animator(rig),
      dispose() {
        rig.group.traverse((obj) => {
          if (obj instanceof THREE.Mesh) obj.geometry.dispose();
        });
      },
    };
  }
}

/**
 * Flag a weapon's metal for the enchant glow. Its materials are shared with
 * every other piece of that metal, so the glowing ones are clones; merged
 * into the attachments mesh the flag becomes a per-vertex value.
 */
export function enchantWeapon(weapon: THREE.Object3D): void {
  weapon.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !(o.material instanceof THREE.MeshStandardMaterial)) return;
    if (o.material.metalness < 0.5) return;
    const m = o.material.clone();
    m.userData.enchant = true;
    o.material = m;
  });
}
