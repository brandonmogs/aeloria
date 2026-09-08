import { Player } from '../sim/Player';
import { SPELLS, RUNE_NAMES } from '../sim/spells';
import { SidePanel } from './SidePanel';

/**
 * The Magic tab: the standard spellbook as a grid of spell icons, bright once
 * the player's Magic level unlocks them and dimmed until then, with an OSRS
 * hover box (level, runes, base XP, max hit). Casting arrives with magic
 * combat; for now this is the book to plan against.
 */
export class MagicTab {
  private readonly pane = document.createElement('div');
  private readonly grid = document.createElement('div');
  private readonly cells = new Map<string, HTMLElement>();
  private readonly tip = document.createElement('div');

  constructor(
    private readonly player: Player,
    sidePanel: SidePanel,
    private readonly onCast: (spellId: string) => void,
  ) {
    this.pane.className = 'magic-pane';
    this.grid.className = 'spell-grid';
    for (const spell of SPELLS) {
      const cell = document.createElement('div');
      cell.className = 'spell';
      cell.textContent = spell.icon;
      cell.addEventListener('pointerenter', (e) => this.showTip(spell.id, e.clientX, e.clientY));
      cell.addEventListener('pointermove', (e) => this.moveTip(e.clientX, e.clientY));
      cell.addEventListener('pointerleave', () => {
        this.tip.hidden = true;
      });
      cell.addEventListener('click', () => this.onCast(spell.id));
      this.cells.set(spell.id, cell);
      this.grid.appendChild(cell);
    }
    this.pane.appendChild(this.grid);
    this.tip.id = 'spell-tip';
    this.tip.hidden = true;
    document.body.appendChild(this.tip);
    sidePanel.register('magic', this.pane);
    this.refresh();
  }

  refresh(): void {
    const level = this.player.skills.levelOf('magic');
    for (const spell of SPELLS) {
      this.cells.get(spell.id)!.classList.toggle('locked', level < spell.level);
    }
  }

  private showTip(id: string, x: number, y: number): void {
    const spell = SPELLS.find((s) => s.id === id);
    if (!spell) return;
    const runes = spell.runes.map(([rune, n]) => `${n} ${RUNE_NAMES[rune] ?? rune}`).join(', ');
    this.tip.innerHTML =
      `<div class="spell-tip-name">${spell.name}</div>` +
      `<div>Level <span>${spell.level}</span> Magic</div>` +
      `<div>Runes: <span>${runes}</span></div>` +
      `<div>Base XP: <span>${spell.xp}</span></div>` +
      (spell.maxHit !== undefined ? `<div>Max hit: <span>${spell.maxHit}</span></div>` : '');
    this.tip.hidden = false;
    this.moveTip(x, y);
  }

  private moveTip(x: number, y: number): void {
    const rect = this.tip.getBoundingClientRect();
    this.tip.style.left = `${Math.max(4, x - rect.width - 14)}px`;
    this.tip.style.top = `${Math.min(window.innerHeight - rect.height - 4, y + 12)}px`;
  }
}
