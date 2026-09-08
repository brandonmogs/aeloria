import { itemDef } from './items';

/**
 * Shops, priced the way OSRS prices them (per the wiki's Shop page): a general
 * store sells at 130% of an item's value and buys at 40%, and every unit the
 * stock sits above or below its default nudges the price by 3%. No shop ever
 * pays less than 10% of value. Stock drifts back toward its default one unit
 * a minute, so a flooded shop slowly recovers and a bought-out one restocks.
 */
export interface ShopDef {
  readonly id: string;
  readonly name: string;
  /** General stores buy anything tradeable; specialist shops only their own stock. */
  readonly general: boolean;
  readonly sellPercent: number;
  readonly buyPercent: number;
  readonly changePercent: number;
  /** Default stock: [itemId, quantity]. */
  readonly stock: ReadonlyArray<readonly [string, number]>;
}

export const SHOPS: readonly ShopDef[] = [
  {
    id: 'general_store',
    name: 'Aeloria General Store',
    general: true,
    sellPercent: 130,
    buyPercent: 40,
    changePercent: 3,
    stock: [
      ['tinderbox', 2],
      ['small_fishing_net', 2],
      ['fishing_rod', 2],
      ['fishing_bait', 100],
      ['hammer', 5],
      ['knife', 5],
      ['bronze_axe', 2],
      ['bronze_pickaxe', 2],
      ['bread', 5],
      ['shortbow', 2],
      ['bronze_arrow', 200],
      ['staff_of_air', 1],
      ['air_rune', 200],
      ['mind_rune', 200],
      ['water_rune', 100],
      ['earth_rune', 100],
      ['fire_rune', 100],
    ],
  },
];

export function shopDef(id: string): ShopDef {
  const def = SHOPS.find((s) => s.id === id);
  if (!def) throw new Error(`Unknown shop id: ${id}`);
  return def;
}

/** Live stock for one shop; a Map so item order is stable for the UI. */
export interface ShopState {
  readonly def: ShopDef;
  readonly stock: Map<string, number>;
  readonly defaults: Map<string, number>;
}

export function createShop(def: ShopDef): ShopState {
  const stock = new Map<string, number>();
  const defaults = new Map<string, number>();
  for (const [id, qty] of def.stock) {
    stock.set(id, qty);
    defaults.set(id, qty);
  }
  return { def, stock, defaults };
}

/** What the shop charges the player for one unit right now. */
export function shopBuyPrice(shop: ShopState, itemId: string): number {
  const value = itemDef(itemId).value;
  const stock = shop.stock.get(itemId) ?? 0;
  const base = shop.defaults.get(itemId) ?? 0;
  const pct = shop.def.sellPercent + shop.def.changePercent * Math.max(0, base - stock);
  return Math.max(1, Math.floor((value * pct) / 100));
}

/** What the shop pays the player for one unit right now (never under 10%). */
export function shopSellPrice(shop: ShopState, itemId: string): number {
  const value = itemDef(itemId).value;
  const stock = shop.stock.get(itemId) ?? 0;
  const base = shop.defaults.get(itemId) ?? 0;
  const pct = Math.max(10, shop.def.buyPercent - shop.def.changePercent * Math.max(0, stock - base));
  return Math.max(0, Math.floor((value * pct) / 100));
}

/** Whether this shop will take the item off the player's hands at all. */
export function shopAccepts(shop: ShopState, itemId: string): boolean {
  if (itemId === 'coins') return false;
  return shop.def.general || shop.defaults.has(itemId);
}
