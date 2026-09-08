import { SkillId } from './Skills';
import type { DialogueView } from './dialogue';

/** The one-shot sounds the sim can ask the audio layer to play. */
export type SfxName =
  | 'bury'
  | 'splash'
  | 'light'
  | 'cook'
  | 'prayerOn'
  | 'prayerOff'
  | 'recharge'
  | 'coins'
  | 'bow'
  | 'cast';

/**
 * Things that happened during a tick that the UI wants to announce: XP drops,
 * level-ups, kills, plain messages. The sim pushes onto {@link World.eventQueue}
 * and the UI drains it every frame — the same producer/consumer seam as
 * splatQueue, so the sim stays free of any rendering concerns.
 */
export type GameEvent =
  | { type: 'xp'; entityId: number; skill: SkillId; amount: number }
  | { type: 'levelup'; entityId: number; skill: SkillId; level: number }
  | { type: 'kill'; killerId: number; victimName: string }
  | { type: 'died'; entityId: number }
  | { type: 'hit'; entityId: number; damage: number }
  | { type: 'swing'; kind: 'chop' | 'mine' | 'fish' }
  | { type: 'pickup' }
  | { type: 'ate'; itemName: string }
  | { type: 'sfx'; name: SfxName }
  /** The player reached a bank booth; the UI should open the bank screen. */
  | { type: 'openBank'; entityId: number }
  /** The conversation changed: show this node, or close the box when null. */
  | { type: 'dialogue'; entityId: number; view: DialogueView | null }
  /** A quest was just finished: show the completion scroll. */
  | { type: 'questComplete'; entityId: number; questId: string }
  /** Open (or, with null, close) the shop screen. */
  | { type: 'shop'; entityId: number; shopId: string | null }
  /** The player reached an anvil with bars and a hammer: show the smithing screen. */
  | { type: 'openSmithing'; entityId: number; bar: string }
  | { type: 'message'; text: string };
