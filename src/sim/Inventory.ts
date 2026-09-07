import { ItemStack, itemDef, stackOf } from './items';

/**
 * A player's carried items and worn equipment. This is plain simulation state —
 * no rendering, no DOM — so it can later live on an authoritative server exactly
 * as it does on the client. The UI only ever reads it; mutations arrive through
 * {@link World} commands.
 *
 * Slots hold {@link ItemStack}s ({ id, qty }); all static item data lives in the
 * {@link itemDef} registry. Stackable items (coins, ashes) merge into a single
 * slot at any quantity, like OSRS.
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

/** A reference to one slot, in the backpack or on the paper doll. */
export type SlotRef =
  | { readonly area: 'inventory'; readonly index: number }
  | { readonly area: 'equipment'; readonly slot: EquipSlot };

/** Classic RuneScape carries 28 items in a 4×7 grid. */
export const INVENTORY_SIZE = 28;

export class Inventory {
  /** Backpack slots; `null` is an empty slot. Length is always INVENTORY_SIZE. */
  readonly slots: (ItemStack | null)[] = new Array(INVENTORY_SIZE).fill(null);

  /** Worn gear, keyed by slot. A `null` value means that slot is empty. */
  readonly equipment: Record<EquipSlot, ItemStack | null> = {
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
   * Add `qty` of an item to the backpack: stackables merge into an existing
   * stack (or claim one slot), others take one slot each. Returns the quantity
   * that did NOT fit (0 on full success).
   */
  add(id: string, qty = 1): number {
    if (qty <= 0) return 0;
    if (itemDef(id).stackable) {
      const existing = this.slots.find((s) => s?.id === id);
      if (existing) {
        existing.qty += qty;
        return 0;
      }
      const free = this.firstFreeSlot();
      if (free < 0) return qty;
      this.slots[free] = stackOf(id, qty);
      return 0;
    }
    let remaining = qty;
    while (remaining > 0) {
      const free = this.firstFreeSlot();
      if (free < 0) break;
      this.slots[free] = stackOf(id, 1);
      remaining--;
    }
    return remaining;
  }

  /** Total quantity of an item across the backpack. */
  countOf(id: string): number {
    return this.slots.reduce((sum, s) => sum + (s?.id === id ? s.qty : 0), 0);
  }

  /** Whether the item is in the backpack or worn (tools count either way). */
  has(id: string): boolean {
    if (this.slots.some((s) => s?.id === id)) return true;
    return EQUIP_SLOTS.some((slot) => this.equipment[slot]?.id === id);
  }

  /** Index of the first backpack slot holding `id`, or -1. */
  firstSlotOf(id: string): number {
    return this.slots.findIndex((s) => s?.id === id);
  }

  /** Remove up to `qty` of an item from the backpack. Returns amount removed. */
  removeById(id: string, qty = 1): number {
    let remaining = qty;
    for (let i = 0; i < this.slots.length && remaining > 0; i++) {
      const s = this.slots[i];
      if (!s || s.id !== id) continue;
      const take = Math.min(s.qty, remaining);
      s.qty -= take;
      remaining -= take;
      if (s.qty <= 0) this.slots[i] = null;
    }
    return qty - remaining;
  }

  /** Carried weight in kg across backpack and worn gear (feeds run energy). */
  totalWeightKg(): number {
    let kg = 0;
    for (const s of this.slots) if (s) kg += itemDef(s.id).weightKg * (itemDef(s.id).stackable ? 1 : s.qty);
    for (const slot of EQUIP_SLOTS) {
      const s = this.equipment[slot];
      if (s) kg += itemDef(s.id).weightKg;
    }
    return kg;
  }

  /** Summed combat bonuses across worn gear. */
  equipmentBonuses(): { attack: number; strength: number; defense: number; prayer: number } {
    let attack = 0;
    let strength = 0;
    let defense = 0;
    let prayer = 0;
    for (const slot of EQUIP_SLOTS) {
      const s = this.equipment[slot];
      if (!s) continue;
      const def = itemDef(s.id);
      attack += def.attackBonus ?? 0;
      strength += def.strengthBonus ?? 0;
      defense += def.defenseBonus ?? 0;
      prayer += def.prayerBonus ?? 0;
    }
    return { attack, strength, defense, prayer };
  }

  /**
   * Move an item from one slot to another, validating the rules: any backpack
   * slot accepts any item (a swap, or a merge for matching stackables), but an
   * equipment slot only accepts items that fit it. Returns whether anything
   * changed, so the UI knows when to repaint. Level requirements are enforced
   * by the World before it calls this.
   */
  move(from: SlotRef, to: SlotRef): boolean {
    if (sameRef(from, to)) return false;

    if (from.area === 'inventory' && to.area === 'inventory') {
      const a = this.slots[from.index];
      const b = this.slots[to.index];
      if (a && b && a.id === b.id && itemDef(a.id).stackable) {
        b.qty += a.qty;
        this.slots[from.index] = null;
        return true;
      }
      this.slots[from.index] = b;
      this.slots[to.index] = a;
      return true;
    }

    if (from.area === 'inventory' && to.area === 'equipment') {
      const item = this.slots[from.index];
      if (!item || itemDef(item.id).equip !== to.slot) return false;
      this.slots[from.index] = this.equipment[to.slot]; // swap any worn item back
      this.equipment[to.slot] = item;
      return true;
    }

    if (from.area === 'equipment' && to.area === 'inventory') {
      const item = this.equipment[from.slot];
      if (!item) return false;
      const target = this.slots[to.index];
      if (target && itemDef(target.id).equip !== from.slot) return false; // can't swap in mismatched gear
      this.equipment[from.slot] = target;
      this.slots[to.index] = item;
      return true;
    }

    return false; // equipment → equipment is meaningless
  }

  /** Quick-equip the backpack item at `index` into its slot. */
  equip(index: number): boolean {
    const item = this.slots[index];
    if (!item) return false;
    const slot = itemDef(item.id).equip;
    if (!slot) return false;
    return this.move({ area: 'inventory', index }, { area: 'equipment', slot });
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
