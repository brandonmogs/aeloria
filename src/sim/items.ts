import type { EquipSlot } from './Inventory';
import type { SkillId } from './Skills';
import type { WeaponType } from './combat';

/**
 * The item config registry — every item the game knows, keyed by id, in the
 * spirit of the obj configs an OSRS server ships (see the open-source Lost
 * City / 2004Scape engine). Instances in the world are just `{ id, qty }`
 * stacks ({@link ItemStack}); everything static — name, examine, bonuses,
 * value, weight, what it cooks into — lives here, once.
 *
 * Numbers follow the OSRS wiki where an equivalent item exists (scimitar
 * bonuses, food healing, burial XP); the rest are tuned to sit believably on
 * the same curves.
 */
export interface ItemDef {
  readonly id: string;
  readonly name: string;
  /** Placeholder glyph until real sprites exist. */
  readonly icon: string;
  /** Right-click Examine flavor text. */
  readonly examine: string;
  /** Base value in coins; ranks "items kept on death" and prices things later. */
  readonly value: number;
  /** Carried weight — feeds the OSRS run-energy drain formula. */
  readonly weightKg: number;
  /** Stackables occupy one slot at any quantity (coins, ashes). */
  readonly stackable?: boolean;

  // --- Equipment ---------------------------------------------------------
  readonly equip?: EquipSlot;
  /** Stat requirement to wear/wield, e.g. rune tier needs 40 Attack. */
  readonly equipReq?: { readonly skill: SkillId; readonly level: number };
  readonly attackBonus?: number;
  readonly strengthBonus?: number;
  readonly defenseBonus?: number;
  /** Slows prayer drain: resistance = 2 × bonus + 60 (the OSRS formula). */
  readonly prayerBonus?: number;
  /** Weapon attack interval in ticks (scimitar 4, longsword 5...). */
  readonly speed?: number;
  /** Which attack-style set the combat tab shows for this weapon. */
  readonly weaponType?: WeaponType;

  // --- Consumables & skilling --------------------------------------------
  /** Hitpoints restored when eaten; presence marks the item as food. */
  readonly heals?: number;
  /** Prayer XP for burying; presence marks the item as bones. */
  readonly buryXp?: number;
  /** Axe/pickaxe power tier (1 bronze, 2 iron, 3 steel...); tools, not weapons. */
  readonly axeTier?: number;
  readonly pickTier?: number;
  /** Firemaking: XP for burning; presence makes "Light" available. */
  readonly firemakingXp?: number;
  /** Cooking: what this raw item becomes, and the curve that governs burning. */
  readonly cooking?: {
    readonly cooked: string;
    readonly burnt: string;
    readonly xp: number;
    /** Cooking level at which this food stops burning on a fire. */
    readonly stopBurn: number;
  };
}

/** A quantity of one item — what actually sits in a slot or on the ground. */
export interface ItemStack {
  readonly id: string;
  qty: number;
}

export function stackOf(id: string, qty = 1): ItemStack {
  return { id, qty };
}

/** Look up an item's config. Throws on unknown ids — those are content bugs. */
export function itemDef(id: string): ItemDef {
  const def = ITEMS[id];
  if (!def) throw new Error(`Unknown item id: ${id}`);
  return def;
}

const scimitar = (
  tier: string,
  name: string,
  attack: number,
  strength: number,
  attackReq: number,
  value: number,
): ItemDef => ({
  id: `${tier}_scimitar`,
  name,
  icon: '🗡️',
  examine: 'A vicious, curved sword.',
  value,
  weightKg: 1.8,
  equip: 'weapon',
  equipReq: attackReq > 1 ? { skill: 'attack', level: attackReq } : undefined,
  attackBonus: attack,
  strengthBonus: strength,
  speed: 4,
  weaponType: 'scimitar',
});

const ITEMS: Record<string, ItemDef> = {};
function define(def: ItemDef): void {
  ITEMS[def.id] = def;
}

// --- Currency & remains ----------------------------------------------------
define({ id: 'coins', name: 'Coins', icon: '🪙', examine: 'Lovely money!', value: 1, weightKg: 0, stackable: true });
define({ id: 'bones', name: 'Bones', icon: '🦴', examine: 'Bones of a recently deceased creature.', value: 1, weightKg: 0.5, buryXp: 4.5 });
define({ id: 'big_bones', name: 'Big bones', icon: '🦴', examine: 'These would feed a dog for a month.', value: 3, weightKg: 0.9, buryXp: 15 });
define({ id: 'ashes', name: 'Ashes', icon: '🌫️', examine: 'A heap of ashes.', value: 2, weightKg: 0.1 });

// --- Skilling resources ----------------------------------------------------
define({ id: 'logs', name: 'Logs', icon: '🪵', examine: 'A number of wooden logs.', value: 4, weightKg: 2, firemakingXp: 40 });
define({ id: 'copper_ore', name: 'Copper ore', icon: '🥉', examine: 'This ore contains copper.', value: 3, weightKg: 2.2 });

// --- Tools -----------------------------------------------------------------
define({ id: 'bronze_axe', name: 'Bronze axe', icon: '🪓', examine: 'A woodcutter’s axe.', value: 16, weightKg: 1.5, axeTier: 1, equip: 'weapon', attackBonus: 2, strengthBonus: 3, speed: 5, weaponType: 'axe' });
define({ id: 'steel_axe', name: 'Steel axe', icon: '🪓', examine: 'A powerful axe.', value: 200, weightKg: 1.5, axeTier: 3, equip: 'weapon', equipReq: { skill: 'attack', level: 5 }, attackBonus: 6, strengthBonus: 9, speed: 5, weaponType: 'axe' });
define({ id: 'bronze_pickaxe', name: 'Bronze pickaxe', icon: '⛏️', examine: 'Used for mining.', value: 16, weightKg: 2.2, pickTier: 1, equip: 'weapon', attackBonus: 2, strengthBonus: 1, speed: 5, weaponType: 'pickaxe' });
define({ id: 'iron_pickaxe', name: 'Iron pickaxe', icon: '⛏️', examine: 'Used for mining.', value: 56, weightKg: 2.2, pickTier: 2, equip: 'weapon', attackBonus: 3, strengthBonus: 2, speed: 5, weaponType: 'pickaxe' });
define({ id: 'tinderbox', name: 'Tinderbox', icon: '🔥', examine: 'Useful for lighting a fire.', value: 1, weightKg: 0.1 });
define({ id: 'small_fishing_net', name: 'Small fishing net', icon: '🕸️', examine: 'Useful for catching small fish.', value: 5, weightKg: 0.5 });

// --- Food & fish -----------------------------------------------------------
define({ id: 'bread', name: 'Bread', icon: '🍞', examine: 'Nice crusty bread.', value: 12, weightKg: 0.3, heals: 5 });
define({ id: 'raw_shrimps', name: 'Raw shrimps', icon: '🦐', examine: 'I should try cooking these.', value: 5, weightKg: 0.2, cooking: { cooked: 'shrimps', burnt: 'burnt_shrimps', xp: 30, stopBurn: 34 } });
define({ id: 'shrimps', name: 'Shrimps', icon: '🍤', examine: 'Some nicely cooked shrimps.', value: 5, weightKg: 0.2, heals: 3 });
define({ id: 'burnt_shrimps', name: 'Burnt shrimps', icon: '🍂', examine: 'Oops.', value: 1, weightKg: 0.2 });
define({ id: 'raw_anchovies', name: 'Raw anchovies', icon: '🐟', examine: 'I should try cooking these.', value: 15, weightKg: 0.2, cooking: { cooked: 'anchovies', burnt: 'burnt_anchovies', xp: 30, stopBurn: 34 } });
define({ id: 'anchovies', name: 'Anchovies', icon: '🐟', examine: 'Some nicely cooked anchovies.', value: 15, weightKg: 0.2, heals: 1 });
define({ id: 'burnt_anchovies', name: 'Burnt anchovies', icon: '🍂', examine: 'Oops.', value: 1, weightKg: 0.2 });
define({ id: 'raw_rat_meat', name: 'Raw rat meat', icon: '🥩', examine: 'Freshly killed rat meat.', value: 2, weightKg: 0.3, cooking: { cooked: 'cooked_meat', burnt: 'burnt_meat', xp: 30, stopBurn: 34 } });
define({ id: 'cooked_meat', name: 'Cooked meat', icon: '🍖', examine: 'A piece of cooked meat.', value: 4, weightKg: 0.3, heals: 3 });
define({ id: 'burnt_meat', name: 'Burnt meat', icon: '🍂', examine: 'Oops.', value: 1, weightKg: 0.3 });

// --- Weapons: the scimitar ladder (bonuses per the OSRS wiki) --------------
define(scimitar('bronze', 'Bronze scimitar', 7, 6, 1, 32));
define(scimitar('iron', 'Iron scimitar', 10, 9, 1, 112));
define(scimitar('steel', 'Steel scimitar', 15, 14, 5, 400));
define(scimitar('mithril', 'Mithril scimitar', 21, 20, 20, 1040));
define(scimitar('adamant', 'Adamant scimitar', 29, 28, 30, 2560));
define(scimitar('rune', 'Rune scimitar', 45, 44, 40, 25600));

// --- Armour ----------------------------------------------------------------
define({ id: 'bronze_med_helm', name: 'Bronze med helm', icon: '⛑️', examine: 'A medium-sized bronze helmet.', value: 24, weightKg: 1.8, equip: 'helmet', defenseBonus: 3 });
define({ id: 'iron_platebody', name: 'Iron platebody', icon: '🦺', examine: 'Provides good protection.', value: 560, weightKg: 9.5, equip: 'chestplate', equipReq: { skill: 'defense', level: 1 }, defenseBonus: 15 });
define({ id: 'steel_platelegs', name: 'Steel platelegs', icon: '👖', examine: 'Big, heavy and shiny.', value: 1000, weightKg: 8.5, equip: 'legs', equipReq: { skill: 'defense', level: 5 }, defenseBonus: 12 });
define({ id: 'leather_boots', name: 'Leather boots', icon: '🥾', examine: 'Comfortable walking boots.', value: 6, weightKg: 0.3, equip: 'boots', defenseBonus: 1 });
define({ id: 'leather_gloves', name: 'Leather gloves', icon: '🧤', examine: 'These will keep my hands warm.', value: 6, weightKg: 0.2, equip: 'gloves', defenseBonus: 1 });
define({ id: 'wooden_shield', name: 'Wooden shield', icon: '🛡️', examine: 'A solid wooden shield.', value: 20, weightKg: 1.8, equip: 'shield', defenseBonus: 5 });
define({ id: 'gold_ring', name: 'Gold ring', icon: '💍', examine: 'A valuable ring.', value: 350, weightKg: 0.01, equip: 'ring' });
define({ id: 'holy_symbol', name: 'Holy symbol', icon: '✨', examine: 'A blessed symbol of the gods.', value: 300, weightKg: 0.01, equip: 'ring', prayerBonus: 8 });
define({ id: 'max_cape', name: 'Max cape', icon: '🧥', examine: 'The cape worn by those who have mastered every skill.', value: 99000, weightKg: 0.4, equip: 'cape', defenseBonus: 9, prayerBonus: 2 });
