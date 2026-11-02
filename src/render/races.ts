import { HairStyle } from './hair';
import { HumanoidSpec, Race, Sex } from './human';

/**
 * Races: a body from the pipeline (sex, build and face baked in: pointed
 * ears, a heavy jaw, a dwarf's short frame) plus proportion knobs on top of
 * HERO_BUILD, and the default colours of a character screen. Shared by the
 * character builder and the preview page.
 */

export interface RaceDef {
  label: string;
  /** Build overrides on top of HERO_BUILD, per sex. */
  build: Record<Sex, Partial<HumanoidSpec>>;
  height: Record<Sex, number>;
  hairStyle: Record<Sex, HairStyle>;
  skin: number;
  hair: number;
  eyes: number;
}

/** The heroic treatment of the woman's body: the frame is baked in, this keeps the waist and jaw of a character screen. */
const FEMALE: Partial<HumanoidSpec> = {
  shoulders: 1.04,
  hips: 1.02,
  waist: 0.84,
  chestWidth: 1.02,
  pecs: 0,
  sternum: 0,
  seat: 0.25,
  jaw: 0.88,
  neck: 1.06,
  bulk: 0.95,
  armScale: 1.02,
  legScale: 1.06,
};

const ELF_MALE: Partial<HumanoidSpec> = {
  headScale: 0.9,
  legScale: 1.1,
  armScale: 1.05,
  bulk: 0.9,
  shoulders: 1.04,
  waist: 0.86,
  chestWidth: 1.02,
  pecs: 0.2,
  jaw: 0.88,
  neck: 1.14,
};
const ELF_FEMALE: Partial<HumanoidSpec> = { ...FEMALE, headScale: 0.9, legScale: 1.1, bulk: 0.88, waist: 0.8, jaw: 0.85, neck: 1.1 };

export const RACES: Record<Race, RaceDef> = {
  human: {
    label: 'Human',
    // The man's body already carries a man's frame, so the heroic knobs ease off; the neck of the base target is short.
    build: { male: { bulk: 1.0, shoulders: 1.08, chestWidth: 1.06, waist: 0.9, pecs: 0.25, neck: 1.12, jaw: 0.94 }, female: FEMALE },
    height: { male: 1.84, female: 1.74 },
    hairStyle: { male: 'long', female: 'long' },
    skin: 0xe3b48d,
    hair: 0x4a2f16,
    eyes: 0x4f7fa8,
  },
  elf: {
    label: 'Elf',
    build: { male: ELF_MALE, female: ELF_FEMALE },
    height: { male: 1.92, female: 1.82 },
    hairStyle: { male: 'long', female: 'long' },
    skin: 0xf2dcc4,
    hair: 0xe9d7a0,
    eyes: 0x6fae8a,
  },
  darkelf: {
    label: 'Dark elf',
    build: { male: ELF_MALE, female: ELF_FEMALE },
    height: { male: 1.92, female: 1.82 },
    hairStyle: { male: 'long', female: 'long' },
    skin: 0x6f6b8f,
    hair: 0xf0eef5,
    eyes: 0xc4474a,
  },
  orc: {
    label: 'Orc',
    build: {
      male: { bulk: 1.12, shoulders: 1.16, waist: 1.02, chestWidth: 1.12, hips: 1.02, pecs: 0.8, jaw: 1.08, neck: 0.95, headScale: 0.98, armScale: 1.08 },
      female: { ...FEMALE, bulk: 1.08, shoulders: 1.1, chestWidth: 1.06, jaw: 0.98, neck: 0.96 },
    },
    height: { male: 1.98, female: 1.88 },
    hairStyle: { male: 'short', female: 'long' },
    skin: 0x5f7a3a,
    hair: 0x141414,
    eyes: 0xd9a13a,
  },
  dwarf: {
    label: 'Dwarf',
    build: {
      male: { headScale: 1.06, legScale: 0.95, armScale: 0.96, bulk: 1.18, shoulders: 1.14, waist: 1.1, chestWidth: 1.14, hips: 1.06, pecs: 0.6, jaw: 1.06, neck: 0.92 },
      female: { ...FEMALE, headScale: 1.04, legScale: 0.95, armScale: 0.96, bulk: 1.1, shoulders: 1.06, waist: 1.0, chestWidth: 1.08, hips: 1.1, jaw: 0.95, neck: 0.9 },
    },
    height: { male: 1.42, female: 1.36 },
    hairStyle: { male: 'long', female: 'long' },
    skin: 0xd9a06c,
    hair: 0x8b3a1a,
    eyes: 0x4a6b8a,
  },
};
