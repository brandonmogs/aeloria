import { SkillId } from '../sim/Skills';

/** Display name, icon, and accent colour for each skill, shared across the UI. */
export const SKILL_META: Record<SkillId, { label: string; icon: string; color: string }> = {
  attack: { label: 'Attack', icon: '⚔️', color: '#b8453a' },
  hitpoints: { label: 'Hitpoints', icon: '❤️', color: '#c24a4a' },
  mining: { label: 'Mining', icon: '⛏️', color: '#7a8494' },
  strength: { label: 'Strength', icon: '💪', color: '#4f8a45' },
  agility: { label: 'Agility', icon: '🏃', color: '#3f6fb0' },
  smithing: { label: 'Smithing', icon: '🔨', color: '#6d6d75' },
  defense: { label: 'Defence', icon: '🛡️', color: '#3f73b0' },
  herblore: { label: 'Herblore', icon: '🌿', color: '#3f8a5a' },
  fishing: { label: 'Fishing', icon: '🎣', color: '#4f7fa8' },
  range: { label: 'Ranged', icon: '🏹', color: '#6c9a3f' },
  thieving: { label: 'Thieving', icon: '🎭', color: '#7a4f8a' },
  cooking: { label: 'Cooking', icon: '🍳', color: '#a85a8f' },
  prayer: { label: 'Prayer', icon: '✨', color: '#cfc3e8' },
  crafting: { label: 'Crafting', icon: '🧵', color: '#a87a3f' },
  firemaking: { label: 'Firemaking', icon: '🔥', color: '#c77b3a' },
  magic: { label: 'Magic', icon: '🔮', color: '#7d6ad0' },
  fletching: { label: 'Fletching', icon: '🪶', color: '#3f8a8a' },
  woodcutting: { label: 'Woodcutting', icon: '🪓', color: '#8a6b3f' },
  runecraft: { label: 'Runecraft', icon: '🔷', color: '#5a6ac0' },
  slayer: { label: 'Slayer', icon: '💀', color: '#3a3a3a' },
  farming: { label: 'Farming', icon: '🌱', color: '#4a8a3a' },
  construction: { label: 'Construction', icon: '🏠', color: '#8a7a5a' },
  hunter: { label: 'Hunter', icon: '🪤', color: '#8a6a4a' },
};
