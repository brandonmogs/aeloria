/** One row in the context menu. */
export interface MenuOption {
  /** Action verb, drawn in white ("Attack", "Take", "Walk here"). */
  verb: string;
  /** Optional target name, drawn in OSRS yellow ("Goblin (level-2)"). */
  target?: string;
  onSelect?: () => void;
}

/**
 * The OSRS right-click menu: a dark panel titled "Choose Option" listing every
 * action available on the clicked tile. Selecting a row runs its action; any
 * other click, Escape, or moving the pointer well clear dismisses it.
 */
export class ContextMenu {
  private readonly root = document.createElement('div');
  private openFlag = false;

  constructor() {
    this.root.id = 'context-menu';
    this.root.style.display = 'none';
    document.body.appendChild(this.root);

    // Dismiss on any press outside the menu (capture so game clicks count).
    window.addEventListener('pointerdown', (e) => {
      if (this.openFlag && !this.root.contains(e.target as Node)) this.close();
    }, { capture: true });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
    // OSRS closes the menu once the pointer strays away from it.
    this.root.addEventListener('pointerleave', () => this.close());
  }

  get isOpen(): boolean {
    return this.openFlag;
  }

  open(clientX: number, clientY: number, options: MenuOption[]): void {
    this.root.textContent = '';

    const title = document.createElement('div');
    title.className = 'ctx-title';
    title.textContent = 'Choose Option';
    this.root.appendChild(title);

    for (const opt of options) {
      const row = document.createElement('div');
      row.className = 'ctx-row';
      const verb = document.createElement('span');
      verb.textContent = opt.verb;
      row.appendChild(verb);
      if (opt.target) {
        const target = document.createElement('span');
        target.className = 'ctx-target';
        target.textContent = ` ${opt.target}`;
        row.appendChild(target);
      }
      row.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.close();
        opt.onSelect?.();
      });
      this.root.appendChild(row);
    }

    // Show near the cursor, clamped to the viewport; the title bar sits under
    // the pointer like OSRS so the first option is one small move away.
    this.root.style.display = 'block';
    const rect = this.root.getBoundingClientRect();
    const x = Math.min(clientX - rect.width / 2, window.innerWidth - rect.width - 4);
    const y = Math.min(clientY - 10, window.innerHeight - rect.height - 4);
    this.root.style.left = `${Math.max(4, x)}px`;
    this.root.style.top = `${Math.max(4, y)}px`;
    this.openFlag = true;
  }

  close(): void {
    this.root.style.display = 'none';
    this.openFlag = false;
  }
}
