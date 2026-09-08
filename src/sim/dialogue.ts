import type { Player } from './Player';
import type { SkillId } from './Skills';

/**
 * NPC dialogue, the OSRS way: a conversation is a small graph of nodes — an
 * NPC line, a player line, a set of options, a plain message — that the player
 * clicks through in the chatbox. Scripts are content (see world/npcs.ts) and
 * are written as functions of the player's state, so the cook says something
 * different once you've done his quest. The *state* of a conversation is just
 * `{ npcId, nodeKey }` on the player, which keeps it trivially serializable
 * for the day the sim runs on a server.
 */

export interface DialogueOption {
  readonly text: string;
  readonly next: string;
}

/** Runs when a node is entered; may change quest state, hand over items, etc. */
export type DialogueEffect = (ctx: DialogueContext) => void;

export type DialogueNode =
  | { readonly kind: 'npc'; readonly text: string; readonly next?: string; readonly effect?: DialogueEffect }
  | { readonly kind: 'player'; readonly text: string; readonly next?: string; readonly effect?: DialogueEffect }
  | { readonly kind: 'options'; readonly title?: string; readonly options: readonly DialogueOption[] }
  | { readonly kind: 'message'; readonly text: string; readonly next?: string; readonly effect?: DialogueEffect }
  | { readonly kind: 'end'; readonly effect?: DialogueEffect };

export interface DialogueScript {
  readonly start: string;
  readonly nodes: Readonly<Record<string, DialogueNode>>;
}

/** What a script may read and do. The World implements this against a player. */
export interface DialogueContext {
  readonly player: Player;
  questStage(questId: string): number;
  setQuestStage(questId: string, stage: number): void;
  /** Mark a quest done: awards its quest points and fires the completion screen. */
  completeQuest(questId: string): void;
  /** Per-quest scratch numbers (kill-count baselines, flags). */
  questVar(key: string): number;
  setQuestVar(key: string, value: number): void;
  hasItem(id: string, qty?: number): boolean;
  countItem(id: string): number;
  /** Remove items from the backpack; false (and nothing taken) if short. */
  takeItem(id: string, qty?: number): boolean;
  /** Add items to the backpack; whatever doesn't fit lands at the player's feet. */
  giveItem(id: string, qty?: number): void;
  grantXp(skill: SkillId, amount: number): void;
  killCount(npcKind: string): number;
  skillLevel(skill: SkillId): number;
  message(text: string): void;
  /** Open a shop screen for the player (the shopkeeper's "Trade" option). */
  openShop(shopId: string): void;
}

/** A dialogue script computed from the player's current state. */
export type DialogueFn = (ctx: DialogueContext) => DialogueScript;

/** The snapshot the chatbox renders — plain data, no functions. */
export type DialogueView =
  | { readonly kind: 'npc'; readonly speaker: string; readonly text: string }
  | { readonly kind: 'player'; readonly speaker: string; readonly text: string }
  | { readonly kind: 'options'; readonly title: string; readonly options: readonly string[] }
  | { readonly kind: 'message'; readonly text: string };

/** Sugar for writing scripts: a linear NPC/player exchange plus branches. */
export const D = {
  npc: (text: string, next?: string, effect?: DialogueEffect): DialogueNode => ({ kind: 'npc', text, next, effect }),
  player: (text: string, next?: string, effect?: DialogueEffect): DialogueNode => ({ kind: 'player', text, next, effect }),
  options: (options: readonly DialogueOption[], title = 'Select an option'): DialogueNode => ({ kind: 'options', title, options }),
  message: (text: string, next?: string, effect?: DialogueEffect): DialogueNode => ({ kind: 'message', text, next, effect }),
  end: (effect?: DialogueEffect): DialogueNode => ({ kind: 'end', effect }),
};

/**
 * Build a linear conversation from a list of lines: each line becomes a node
 * chained to the next, keyed `${prefix}0`, `${prefix}1`, …; the last line
 * chains to `tail` (default: ends the conversation).
 */
export function linear(
  prefix: string,
  lines: ReadonlyArray<readonly ['npc' | 'player' | 'message', string]>,
  tail?: string,
  effectOnLast?: DialogueEffect,
): Record<string, DialogueNode> {
  const nodes: Record<string, DialogueNode> = {};
  lines.forEach(([kind, text], i) => {
    const last = i === lines.length - 1;
    const next = last ? tail : `${prefix}${i + 1}`;
    nodes[`${prefix}${i}`] = { kind, text, next, effect: last ? effectOnLast : undefined };
  });
  return nodes;
}
