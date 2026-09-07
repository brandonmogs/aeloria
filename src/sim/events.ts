import { SkillId } from './Skills';

/** The one-shot sounds the sim can ask the audio layer to play. */
export type SfxName =
  | 'bury'
  | 'splash'
  | 'light'
  | 'cook'
  | 'prayerOn'
  | 'prayerOff'
  | 'recharge';

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
  | { type: 'message'; text: string };
