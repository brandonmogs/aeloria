import type { SkillId } from './Skills';

/**
 * The quest book. Each quest is a small state machine: stage 0 is "not
 * started", stages climb as the player makes progress, and `completeStage`
 * marks it done. Dialogue scripts (world/npcs.ts) move the stages; this file
 * only describes the quests and writes their journals, in the first-person
 * voice the OSRS quest journal uses ("I spoke to the Cook…").
 */

export interface QuestRequirement {
  readonly skill: SkillId;
  readonly level: number;
}

export interface JournalLine {
  readonly text: string;
  /** Finished steps are struck through in the journal, like OSRS. */
  readonly done: boolean;
}

/** What a journal may look at to describe live progress ("2 of 3 rats"). */
export interface JournalContext {
  questVar(key: string): number;
  killCount(npcKind: string): number;
  countItem(id: string): number;
}

export interface QuestDef {
  readonly id: string;
  readonly name: string;
  readonly difficulty: 'Novice' | 'Intermediate' | 'Experienced';
  readonly length: 'Very Short' | 'Short' | 'Medium';
  readonly questPoints: number;
  /** Where to begin, for the not-started journal page. */
  readonly startHint: string;
  readonly requirements: readonly QuestRequirement[];
  readonly completeStage: number;
  readonly journal: (stage: number, ctx: JournalContext) => JournalLine[];
  /** Reward lines for the completion scroll and the finished journal. */
  readonly rewards: readonly string[];
}

export type QuestStatus = 'not_started' | 'in_progress' | 'complete';

export function questStatus(def: QuestDef, stage: number): QuestStatus {
  if (stage <= 0) return 'not_started';
  return stage >= def.completeStage ? 'complete' : 'in_progress';
}

const line = (text: string, done = false): JournalLine => ({ text, done });

/** Kills of one NPC kind made since a quest was accepted. */
export function killsSince(ctx: JournalContext, kind: string, baselineKey: string): number {
  return Math.max(0, ctx.killCount(kind) - ctx.questVar(baselineKey));
}

export const QUESTS: readonly QuestDef[] = [
  {
    id: 'cooks_rats',
    name: "The Cook's Rat Problem",
    difficulty: 'Novice',
    length: 'Short',
    questPoints: 1,
    startHint: "I can start this quest by speaking to the Cook in the kitchen of Aeloria Castle.",
    requirements: [],
    completeStage: 2,
    journal: (stage, ctx) => {
      if (stage <= 0) return [line("I can start this quest by speaking to the Cook in the kitchen of Aeloria Castle.")];
      const rats = Math.min(3, killsSince(ctx, 'rat', 'cooks_rats.rats'));
      const meat = Math.min(3, ctx.countItem('cooked_meat'));
      const done = stage >= 2;
      return [
        line('I spoke to the Cook. Giant rats have been raiding the castle pantry every night.', true),
        line(done ? 'I killed 3 giant rats in the woods south of the castle.' : `I need to kill 3 giant rats in the woods south of the castle. (${rats}/3)`, done || rats >= 3),
        line(done ? 'I brought the Cook 3 pieces of cooked meat for the guards\' stew.' : `The Cook also wants 3 pieces of cooked meat for the guards' stew. (${meat}/3)`, done || meat >= 3),
        ...(done ? [line('The Cook thanked me and said I may use his range whenever I like.', true)] : []),
      ];
    },
    rewards: ['1 Quest point', '300 Cooking experience', 'Use of the castle kitchen range'],
  },
  {
    id: 'goblin_trouble',
    name: 'Goblin Trouble',
    difficulty: 'Novice',
    length: 'Short',
    questPoints: 1,
    startHint: 'I can start this quest by speaking to Captain Harlan by the gate of Aeloria Castle.',
    requirements: [],
    completeStage: 2,
    journal: (stage, ctx) => {
      if (stage <= 0) return [line('I can start this quest by speaking to Captain Harlan by the gate of Aeloria Castle.')];
      const kills = Math.min(5, killsSince(ctx, 'goblin', 'goblin_trouble.goblins'));
      const done = stage >= 2;
      return [
        line('Captain Harlan asked me to thin out the goblin camp east of the road.', true),
        line(done ? 'I defeated 5 goblins from the camp.' : `I need to defeat 5 goblins at the camp. (${kills}/5)`, done || kills >= 5),
        line(done ? 'I reported back to Captain Harlan and he rewarded me.' : 'Then I should report back to Captain Harlan.', done),
      ];
    },
    rewards: ['1 Quest point', '250 Attack experience', '250 Strength experience', 'An iron scimitar'],
  },
  {
    id: 'woodsmans_wager',
    name: "A Woodsman's Wager",
    difficulty: 'Novice',
    length: 'Short',
    questPoints: 1,
    startHint: 'I can start this quest by speaking to Gareth the woodsman at the edge of the western wood.',
    requirements: [],
    completeStage: 2,
    journal: (stage, ctx) => {
      if (stage <= 0) return [line('I can start this quest by speaking to Gareth the woodsman at the edge of the western wood.')];
      const logs = Math.min(10, ctx.countItem('logs'));
      const fire = ctx.questVar('woodsmans_wager.fire') > 0;
      const done = stage >= 2;
      return [
        line('Gareth bet me I couldn\'t fell ten logs and light a fire beside him before sundown.', true),
        line(done ? 'I gathered 10 logs.' : `I need to bring Gareth 10 logs. (${logs}/10)`, done || logs >= 10),
        line(done ? 'I lit a fire right next to him.' : 'I need to light a fire next to Gareth.', done || fire),
        line(done ? 'Gareth paid up and handed me his spare steel axe.' : 'Then I should talk to Gareth to settle the wager.', done),
      ];
    },
    rewards: ['1 Quest point', '250 Woodcutting experience', '250 Firemaking experience', 'A steel axe'],
  },
  {
    id: 'fishermans_favour',
    name: "Fisherman's Favour",
    difficulty: 'Novice',
    length: 'Short',
    questPoints: 1,
    startHint: 'I can start this quest by speaking to Old Barnaby on the bank of the castle moat.',
    requirements: [{ skill: 'fishing', level: 15 }],
    completeStage: 2,
    journal: (stage, ctx) => {
      if (stage <= 0) return [line('I can start this quest by speaking to Old Barnaby on the bank of the castle moat.')];
      const shrimps = Math.min(5, ctx.countItem('raw_shrimps'));
      const anchovies = Math.min(3, ctx.countItem('raw_anchovies'));
      const done = stage >= 2;
      return [
        line("Old Barnaby's back is too sore to fish, and the guards want their supper.", true),
        line(done ? 'I caught him 5 raw shrimps.' : `I need to catch 5 raw shrimps from the moat. (${shrimps}/5)`, done || shrimps >= 5),
        line(done ? 'I caught him 3 raw anchovies.' : `I need to catch 3 raw anchovies from the moat. (${anchovies}/3)`, done || anchovies >= 3),
        line(done ? 'Barnaby was delighted and showed me a few tricks of the trade.' : 'Then I should bring the catch back to Old Barnaby.', done),
      ];
    },
    rewards: ['1 Quest point', '500 Fishing experience', '100 coins'],
  },
];

export function questDef(id: string): QuestDef {
  const def = QUESTS.find((q) => q.id === id);
  if (!def) throw new Error(`Unknown quest id: ${id}`);
  return def;
}

/** The maximum quest points available. */
export const TOTAL_QUEST_POINTS = QUESTS.reduce((sum, q) => sum + q.questPoints, 0);
