/**
 * The OSRS interface strip: two rows of stone tab buttons around one content
 * area, bottom-right of the screen. Other UI modules build a pane and
 * {@link register} it under a tab; the strip owns selection, the F-key
 * shortcuts (F1 combat … F7 magic, like the real client's defaults), and
 * nothing else. Tabs nobody registers still draw, greyed, so the strip keeps
 * the familiar fourteen-button silhouette.
 */
export type TabId =
  | 'combat'
  | 'skills'
  | 'quests'
  | 'inventory'
  | 'equipment'
  | 'prayer'
  | 'magic'
  | 'clan'
  | 'friends'
  | 'account'
  | 'logout'
  | 'settings'
  | 'emotes'
  | 'music';

interface TabMeta {
  id: TabId;
  icon: string;
  tip: string;
  key?: string;
}

const TOP_ROW: readonly TabMeta[] = [
  { id: 'combat', icon: '⚔️', tip: 'Combat Options', key: 'F1' },
  { id: 'skills', icon: '📊', tip: 'Skills', key: 'F2' },
  { id: 'quests', icon: '📜', tip: 'Quest List', key: 'F3' },
  { id: 'inventory', icon: '🎒', tip: 'Inventory', key: 'F4' },
  { id: 'equipment', icon: '🛡️', tip: 'Worn Equipment', key: 'F5' },
  { id: 'prayer', icon: '✨', tip: 'Prayer', key: 'F6' },
  { id: 'magic', icon: '🔮', tip: 'Magic', key: 'F7' },
];

const BOTTOM_ROW: readonly TabMeta[] = [
  { id: 'clan', icon: '🏰', tip: 'Clan Chat' },
  { id: 'friends', icon: '👥', tip: 'Friends List' },
  { id: 'account', icon: '👤', tip: 'Account Management' },
  { id: 'logout', icon: '🚪', tip: 'Logout' },
  { id: 'settings', icon: '⚙️', tip: 'Settings' },
  { id: 'emotes', icon: '😀', tip: 'Emotes' },
  { id: 'music', icon: '🎵', tip: 'Music Player' },
];

export class SidePanel {
  readonly root = document.createElement('div');
  private readonly body = document.createElement('div');
  private readonly buttons = new Map<TabId, HTMLButtonElement>();
  private readonly panes = new Map<TabId, HTMLElement>();
  private readonly listeners: Array<(tab: TabId) => void> = [];
  private current: TabId = 'inventory';

  constructor() {
    // The id is historical: the tests and stylesheet know the strip by it.
    this.root.id = 'inventory-panel';
    this.root.className = 'side-panel';
    this.root.appendChild(this.buildRow(TOP_ROW, 'top'));
    this.body.className = 'side-body';
    this.root.appendChild(this.body);
    this.root.appendChild(this.buildRow(BOTTOM_ROW, 'bottom'));
    document.body.appendChild(this.root);

    window.addEventListener('keydown', (e) => {
      const meta = [...TOP_ROW, ...BOTTOM_ROW].find((t) => t.key === e.key);
      if (!meta) return;
      e.preventDefault();
      this.select(meta.id);
    });
  }

  /** Hand the strip a pane to show under `tab`. Replaces any earlier pane. */
  register(tab: TabId, pane: HTMLElement): void {
    const old = this.panes.get(tab);
    if (old) old.remove();
    pane.classList.add('side-pane');
    pane.hidden = tab !== this.current;
    this.panes.set(tab, pane);
    this.body.appendChild(pane);
    this.buttons.get(tab)?.classList.remove('empty');
  }

  /** The tab currently showing. */
  get selected(): TabId {
    return this.current;
  }

  select(tab: TabId): void {
    this.current = tab;
    for (const [id, btn] of this.buttons) btn.classList.toggle('active', id === tab);
    for (const [id, pane] of this.panes) pane.hidden = id !== tab;
    for (const fn of this.listeners) fn(tab);
  }

  /** Be told whenever the visible tab changes. */
  onSelect(fn: (tab: TabId) => void): void {
    this.listeners.push(fn);
  }

  private buildRow(metas: readonly TabMeta[], where: 'top' | 'bottom'): HTMLElement {
    const row = document.createElement('div');
    row.className = `inv-tabs side-tabs side-tabs-${where}`;
    for (const meta of metas) {
      const btn = document.createElement('button');
      btn.className = 'inv-tab side-tab empty';
      btn.textContent = meta.icon;
      btn.title = meta.key ? `${meta.tip} (${meta.key})` : meta.tip;
      btn.addEventListener('click', () => this.select(meta.id));
      this.buttons.set(meta.id, btn);
      row.appendChild(btn);
    }
    return row;
  }
}
