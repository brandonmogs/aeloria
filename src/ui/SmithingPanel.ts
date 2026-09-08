import { itemDef } from '../sim/items';
import { SMITHING, SmithRecipe } from '../sim/smithing';
import { Player } from '../sim/Player';

export interface SmithingCallbacks {
  /** Make `count` of a recipe's item (-1 = as many as the bars allow). */
  onSmith: (item: string, count: number) => void;
  /** Right-click a recipe: main opens a Make-1/5/All menu. */
  onRecipeMenu: (recipe: SmithRecipe, x: number, y: number) => void;
  onClose?: () => void;
}

/**
 * The anvil interface: everything a bar type can be hammered into, laid out
 * like OSRS's smithing screen — each cell shows the item, how many bars it
 * takes, and the level needed; cells you can't make yet are dimmed. Left-click
 * makes one, right-click offers 1/5/All. Repaints from the backpack each tick
 * so the bar counts stay honest.
 */
export class SmithingPanel {
  private readonly root = document.createElement('div');
  private readonly title = document.createElement('div');
  private readonly grid = document.createElement('div');
  private bar: string | null = null;

  constructor(
    private readonly player: Player,
    private readonly cb: SmithingCallbacks,
  ) {
    this.root.id = 'smithing-panel';
    this.root.hidden = true;
    this.title.className = 'bank-title';
    this.grid.className = 'smith-grid';
    const footer = document.createElement('div');
    footer.className = 'bank-footer';
    const hint = document.createElement('div');
    hint.className = 'shop-hint';
    hint.textContent = 'Left-click to make one; right-click for more.';
    const close = document.createElement('button');
    close.className = 'bank-btn bank-close';
    close.textContent = 'Close';
    close.addEventListener('click', () => this.close());
    footer.append(hint, close);
    this.root.append(this.title, this.grid, footer);
    document.body.appendChild(this.root);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.root.hidden) this.close();
    });
  }

  get isOpen(): boolean {
    return this.bar !== null;
  }

  open(bar: string): void {
    this.bar = bar;
    this.title.textContent = `What would you like to make? (${itemDef(bar).name}s)`;
    this.root.hidden = false;
    this.refresh();
  }

  close(): void {
    if (!this.bar) return;
    this.bar = null;
    this.root.hidden = true;
    this.cb.onClose?.();
  }

  /** Repaint availability. Call once per tick while open. */
  refresh(): void {
    const bar = this.bar;
    if (!bar) return;
    this.grid.textContent = '';
    const level = this.player.skills.levelOf('smithing');
    const bars = this.player.inventory.countOf(bar);
    for (const recipe of SMITHING[bar] ?? []) {
      const def = itemDef(recipe.item);
      const cell = document.createElement('div');
      const can = level >= recipe.level && bars >= recipe.bars;
      cell.className = `smith-cell ${can ? '' : 'locked'}`;
      cell.title = `${def.name}: level ${recipe.level}, ${recipe.bars} bar${recipe.bars === 1 ? '' : 's'}, ${recipe.xp} xp`;
      cell.innerHTML =
        `<span class="smith-icon">${def.icon}</span>` +
        `<span class="smith-name">${def.name.replace(/^(Bronze|Iron|Steel|Mithril|Adamant|Rune) /, '')}</span>` +
        `<span class="smith-req">${recipe.bars} bar${recipe.bars === 1 ? '' : 's'} · lvl ${recipe.level}</span>`;
      cell.addEventListener('click', () => this.cb.onSmith(recipe.item, 1));
      cell.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.cb.onRecipeMenu(recipe, e.clientX, e.clientY);
      });
      this.grid.appendChild(cell);
    }
  }
}
