import { itemDef } from '../sim/items';
import { ShopState, shopBuyPrice } from '../sim/shops';

/** How the shop screen asks the game to move goods and coins. */
export interface ShopCallbacks {
  /** Left-click a stock item: OSRS "Value" — say what it costs. */
  onValue: (itemId: string, price: number) => void;
  /** Right-click a stock item: main opens a Buy-1/5/10 menu. */
  onStockMenu: (itemId: string, x: number, y: number) => void;
  onClose?: () => void;
}

/**
 * A shop window in the OSRS mould: the shop's name across the top, its stock
 * as a grid with quantities, prices on hover. Buying happens through the
 * right-click menu here; selling happens through the inventory panel while
 * the shop is open (main wires the Sell-1/5/10 rows). The window repaints
 * from the shop's live state each tick and reports clicks upward.
 */
export class ShopPanel {
  private readonly root = document.createElement('div');
  private readonly title = document.createElement('div');
  private readonly grid = document.createElement('div');
  private shop: ShopState | null = null;

  constructor(private readonly cb: ShopCallbacks) {
    this.root.id = 'shop-panel';
    this.root.hidden = true;
    this.title.className = 'bank-title';
    this.grid.className = 'bank-grid shop-grid';
    const footer = document.createElement('div');
    footer.className = 'bank-footer';
    const hint = document.createElement('div');
    hint.className = 'shop-hint';
    hint.textContent = 'Right-click stock to buy; right-click your items to sell.';
    const close = document.createElement('button');
    close.className = 'bank-btn bank-close';
    close.textContent = 'Close';
    close.addEventListener('click', () => this.close());
    footer.append(hint, close);
    this.root.append(this.title, this.grid, footer);
    document.body.appendChild(this.root);
  }

  get isOpen(): boolean {
    return this.shop !== null;
  }

  get current(): ShopState | null {
    return this.shop;
  }

  open(shop: ShopState): void {
    this.shop = shop;
    this.title.textContent = shop.def.name;
    this.root.hidden = false;
    this.refresh();
  }

  close(): void {
    if (!this.shop) return;
    this.shop = null;
    this.root.hidden = true;
    this.cb.onClose?.();
  }

  /** Repaint the stock. Call once per tick while open. */
  refresh(): void {
    const shop = this.shop;
    if (!shop) return;
    this.grid.textContent = '';
    for (const [id, qty] of shop.stock) {
      const def = itemDef(id);
      const price = shopBuyPrice(shop, id);
      const cell = document.createElement('div');
      cell.className = `slot filled bank-slot ${qty <= 0 ? 'sold-out' : ''}`;
      cell.title = `${def.name} — ${price} coins`;
      cell.textContent = def.icon;
      const badge = document.createElement('span');
      badge.className = 'slot-qty';
      badge.textContent = String(qty);
      cell.appendChild(badge);
      cell.addEventListener('click', () => this.cb.onValue(id, price));
      cell.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.cb.onStockMenu(id, e.clientX, e.clientY);
      });
      this.grid.appendChild(cell);
    }
  }
}
