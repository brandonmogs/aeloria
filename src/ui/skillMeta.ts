import { SkillId } from '../sim/Skills';

/** Display name, icon, and accent color for each skill, shared across the UI. */
export const SKILL_META: Record<SkillId, { label: string; icon: string; color: string }> = {
  attack: { label: 'Attack', icon: '⚔️', color: '#b8453a' },
  strength: { label: 'Strength', icon: '💪', color: '#4f8a45' },
  defense: { label: 'Defence', icon: '🛡️', color: '#3f73b0' },
  hitpoints: { label: 'Hitpoints', icon: '❤️', color: '#c24a4a' },
  range: { label: 'Ranged', icon: '🏹', color: '#6c9a3f' },
  magic: { label: 'Magic', icon: '🔮', color: '#7d6ad0' },
};
