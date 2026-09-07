import { Player } from '../sim/Player';
import { itemDef } from '../sim/items';

/** How the bank screen asks the game to move items. */
export interface BankCallbacks {
  /** Left-click a bank stack: withdraw one. */
  onWithdraw: (itemId: string, qty: number) => void;
  /** Right-click a bank stack: main opens a Withdraw-1/5/All menu. */
  onStackMenu?: (itemId: string, x: number, y: number) => void;
  onDepositAll: () => void;
  onClose?: () => void;
}

/**
 * The Bank of Aeloria — a centred window over the game listing everything the
 * player has stored (the bank stacks all items, like OSRS). Deposits happen
 * through the inventory panel while the bank is open; withdrawals happen here.
 * The window is dumb on purpose: it repaints from `player.bank` and reports
 * clicks upward into the command queue.
 */
export class BankPanel {
  private readonly root = document.createElement('div');
  private readonly grid = document.createElement('div');
  private openFlag = false;

  constructor(
    private readonly player: Player,
    private readonly cb: BankCallbacks,
  ) {
    this.root.id = 'bank-panel';
    this.root.style.display = 'none';

    const title = document.createElement('div');
    title.className = 'bank-title';
    title.textContent = 'The Bank of Aeloria';

    this.grid.className = 'bank-grid';

    const footer = document.createElement('div');
    footer.className = 'bank-footer';
    const deposit = document.createElement('button');
    deposit.className = 'bank-btn';
    deposit.textContent = 'Deposit inventory';
    deposit.addEventListener('click', () => this.cb.onDepositAll());
    const close = document.createElement('button');
    close.className = 'bank-btn bank-close';
    close.textContent = 'Close';
    close.addEventListener('click', () => this.close());
    footer.append(deposit, close);

    this.root.append(title, this.grid, footer);
    document.body.appendChild(this.root);
  }

  get isOpen(): boolean {
    return this.openFlag;
  }

  open(): void {
    this.openFlag = true;
    this.root.style.display = 'flex';
    this.refresh();
  }

  close(): void {
    if (!this.openFlag) return;
    this.openFlag = false;
    this.root.style.display = 'none';
    this.cb.onClose?.();
  }

  /** Repaint the stacks from the player's bank. Call once per tick while open. */
  refresh(): void {
    if (!this.openFlag) return;
    this.grid.textContent = '';
    if (this.player.bank.size === 0) {
      const empty = document.createElement('div');
      empty.className = 'bank-empty';
      empty.textContent = 'Your bank is empty.';
      this.grid.appendChild(empty);
      return;
    }
    for (const [id, qty] of this.player.bank) {
      const def = itemDef(id);
      const cell = document.createElement('div');
      cell.className = 'slot filled bank-slot';
      cell.title = `${def.name} × ${qty.toLocaleString()}`;
      cell.textContent = def.icon;
      const badge = document.createElement('span');
      badge.className = 'slot-qty';
      badge.textContent = qty >= 100_000 ? `${Math.floor(qty / 1000)}K` : String(qty);
      cell.appendChild(badge);
      cell.addEventListener('click', () => this.cb.onWithdraw(id, 1));
      cell.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.cb.onStackMenu?.(id, e.clientX, e.clientY);
      });
      this.grid.appendChild(cell);
    }
  }
}
