import { SkillId } from './Skills';

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
  | { type: 'swing'; kind: 'chop' | 'mine' }
  | { type: 'pickup' }
  | { type: 'message'; text: string };
