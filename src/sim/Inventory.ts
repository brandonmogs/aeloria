/**
 * A player's carried items and worn equipment. This is plain simulation state —
 * no rendering, no DOM — so it can later live on an authoritative server exactly
 * as it does on the client. The UI ({@link InventoryPanel}) only ever reads it.
 *
 * For now items are bare name/icon stubs and nothing fills the slots yet; the
 * shape is here so the inventory screen is data-driven and pickups/equipping can
 * slot in without reworking the UI.
 */

/** The equipment slots a character can wear gear in. */
export type EquipSlot =
  | 'helmet'
  | 'cape'
  | 'chestplate'
  | 'legs'
  | 'boots'
  | 'ring'
  | 'gloves'
  | 'weapon'
  | 'shield';

export const EQUIP_SLOTS: readonly EquipSlot[] = [
  'helmet',
  'cape',
  'chestplate',
  'legs',
  'boots',
  'ring',
  'gloves',
  'weapon',
  'shield',
];

export interface Item {
  readonly id: string;
  readonly name: string;
  /** Short glyph/emoji used as a placeholder icon until we have real sprites. */
  readonly icon?: string;
  /** Which equipment slot this item can be worn in, if any. */
  readonly equip?: EquipSlot;
  /** Equipment combat bonuses, applied while worn. */
  readonly attackBonus?: number;
  readonly strengthBonus?: number;
  readonly defenseBonus?: number;
  /** Hitpoints restored when eaten; presence marks the item as food. */
  readonly heals?: number;
}

/** A reference to one slot, in the backpack or on the paper doll. */
export type SlotRef =
  | { readonly area: 'inventory'; readonly index: number }
  | { readonly area: 'equipment'; readonly slot: EquipSlot };

/** Classic RuneScape carries 28 items in a 4×7 grid. */
export const INVENTORY_SIZE = 28;

export class Inventory {
  /** Backpack slots; `null` is an empty slot. Length is always INVENTORY_SIZE. */
  readonly slots: (Item | null)[] = new Array(INVENTORY_SIZE).fill(null);

  /** Worn gear, keyed by slot. A `null` value means that slot is empty. */
  readonly equipment: Record<EquipSlot, Item | null> = {
    helmet: null,
    cape: null,
    chestplate: null,
    legs: null,
    boots: null,
    ring: null,
    gloves: null,
    weapon: null,
    shield: null,
  };

  /** Index of the first empty backpack slot, or -1 if the bag is full. */
  firstFreeSlot(): number {
    return this.slots.findIndex((s) => s === null);
  }

  /**
   * Move an item from one slot to another, validating the rules: any backpack
   * slot accepts any item (a swap), but an equipment slot only accepts items
   * that fit it. Returns whether anything actually changed, so the UI knows when
   * to repaint. This lives in the model — not the UI — so the same rules hold if
   * an authoritative server runs them later.
   */
  move(from: SlotRef, to: SlotRef): boolean {
    if (sameRef(from, to)) return false;

    if (from.area === 'inventory' && to.area === 'inventory') {
      const tmp = this.slots[from.index];
      this.slots[from.index] = this.slots[to.index];
      this.slots[to.index] = tmp;
      return true;
    }

    if (from.area === 'inventory' && to.area === 'equipment') {
      const item = this.slots[from.index];
      if (!item || item.equip !== to.slot) return false;
      this.slots[from.index] = this.equipment[to.slot]; // swap any worn item back
      this.equipment[to.slot] = item;
      return true;
    }

    if (from.area === 'equipment' && to.area === 'inventory') {
      const item = this.equipment[from.slot];
      if (!item) return false;
      const target = this.slots[to.index];
      if (target && target.equip !== from.slot) return false; // can't swap in mismatched gear
      this.equipment[from.slot] = target;
      this.slots[to.index] = item;
      return true;
    }

    return false; // equipment → equipment is meaningless
  }

  /** Quick-equip the backpack item at `index` into its slot. */
  equip(index: number): boolean {
    const item = this.slots[index];
    if (!item?.equip) return false;
    return this.move({ area: 'inventory', index }, { area: 'equipment', slot: item.equip });
  }

  /** Quick-unequip a worn slot back into the first free backpack slot. */
  unequip(slot: EquipSlot): boolean {
    if (!this.equipment[slot]) return false;
    const free = this.firstFreeSlot();
    if (free < 0) return false;
    return this.move({ area: 'equipment', slot }, { area: 'inventory', index: free });
  }
}

function sameRef(a: SlotRef, b: SlotRef): boolean {
  if (a.area !== b.area) return false;
  return a.area === 'inventory' && b.area === 'inventory'
    ? a.index === b.index
    : (a as { slot: EquipSlot }).slot === (b as { slot: EquipSlot }).slot;
}
