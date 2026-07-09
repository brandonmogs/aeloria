import { SkillId } from '../sim/Skills';
import { SKILL_META } from './skillMeta';

/**
 * Floating XP-drop indicators (the "+12 ⚔️" that drifts up near the minimap in
 * OSRS) plus the golden level-up banner. Pure DOM with CSS animations; elements
 * remove themselves when their animation ends.
 */
export class XpDrops {
  private readonly lane = document.createElement('div');

  constructor() {
    this.lane.id = 'xp-lane';
    document.body.appendChild(this.lane);
  }

  drop(skill: SkillId, amount: number): void {
    const meta = SKILL_META[skill];
    const el = document.createElement('div');
    el.className = 'xp-drop';
    el.textContent = `+${Math.round(amount)} ${meta.icon}`;
    // Stagger drops that are in flight together so they don't overlap.
    el.style.top = `${150 - this.lane.children.length * 20}px`;
    el.addEventListener('animationend', () => el.remove());
    this.lane.appendChild(el);
  }

  levelUp(skill: SkillId, level: number): void {
    const meta = SKILL_META[skill];
    const banner = document.createElement('div');
    banner.className = 'levelup-banner';
    banner.innerHTML = `<div class="levelup-title">${meta.icon} Level up!</div>` +
      `<div class="levelup-body">Your ${meta.label} level is now ${level}.</div>`;
    banner.addEventListener('animationend', () => banner.remove());
    document.body.appendChild(banner);
  }
}
