import { Inventory, EquipSlot, Item, SlotRef, INVENTORY_SIZE } from '../sim/Inventory';
import { Skills, SkillId, SKILL_IDS } from '../sim/Skills';

type Tab = 'inventory' | 'armour' | 'skills';

/** Where each equipment slot sits on the 3-column paper-doll layout. */
interface EquipCell {
  slot: EquipSlot;
  label: string;
  col: number;
  row: number;
}

const EQUIP_LAYOUT: ReadonlyArray<EquipCell> = [
  { slot: 'cape', label: 'Cape', col: 1, row: 1 },
  { slot: 'helmet', label: 'Helmet', col: 2, row: 1 },
  { slot: 'weapon', label: 'Weapon', col: 1, row: 2 },
  { slot: 'chestplate', label: 'Chest', col: 2, row: 2 },
  { slot: 'shield', label: 'Shield', col: 3, row: 2 },
  { slot: 'legs', label: 'Legs', col: 2, row: 3 },
  { slot: 'gloves', label: 'Gloves', col: 1, row: 4 },
  { slot: 'boots', label: 'Boots', col: 2, row: 4 },
  { slot: 'ring', label: 'Ring', col: 3, row: 4 },
];

/** Display name and icon for each skill, plus the accent its progress bar uses. */
const SKILL_META: Record<SkillId, { label: string; icon: string; color: string }> = {
  attack: { label: 'Attack', icon: '⚔️', color: '#b8453a' },
  strength: { label: 'Strength', icon: '💪', color: '#4f8a45' },
  defense: { label: 'Defence', icon: '🛡️', color: '#3f73b0' },
  hitpoints: { label: 'Hitpoints', icon: '❤️', color: '#c24a4a' },
  range: { label: 'Ranged', icon: '🏹', color: '#6c9a3f' },
  magic: { label: 'Magic', icon: '🔮', color: '#7d6ad0' },
};

/** Live elements for one skill cell, so XP gains can repaint just that cell. */
interface SkillCell {
  level: HTMLElement;
  fill: HTMLElement;
}

/**
 * The side panel on the middle-right: a tabbed inventory / equipment / skills
 * screen driven by the player's {@link Inventory} and {@link Skills}.
 *
 * Inventory and equipment slots are interactive: drag an item onto any slot to
 * move/equip it (the model validates the move), or click an item to quick-equip
 * a backpack item / strip a worn one. The skills tab shows each skill's level
 * and progress to the next. All edits go through the model; the UI just calls
 * {@link refresh} afterwards to repaint.
 */
export class InventoryPanel {
  private readonly root = document.createElement('div');
  private readonly invGrid = document.createElement('div');
  private readonly equipGrid = document.createElement('div');
  private readonly skillsGrid = document.createElement('div');
  private readonly tabs = new Map<Tab, HTMLButtonElement>();
  private readonly equipSlots = new Map<EquipSlot, HTMLElement>();
  private readonly invSlots: HTMLElement[] = [];
  private readonly skillCells = new Map<SkillId, SkillCell>();
  private skillsTotal!: HTMLElement;
  private dragFrom: SlotRef | null = null;

  constructor(
    private readonly inventory: Inventory,
    private readonly skills: Skills,
  ) {
    this.root.id = 'inventory-panel';
    this.root.appendChild(this.buildTabBar());

    this.invGrid.className = 'inv-grid';
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const slot = this.makeSlot({ area: 'inventory', index: i });
      this.invSlots.push(slot);
      this.invGrid.appendChild(slot);
    }

    this.equipGrid.className = 'equip-grid';
    for (const cell of EQUIP_LAYOUT) {
      const slot = this.makeSlot({ area: 'equipment', slot: cell.slot }, 'equip');
      slot.style.gridColumn = String(cell.col);
      slot.style.gridRow = String(cell.row);
      slot.dataset.placeholder = cell.label;
      this.equipSlots.set(cell.slot, slot);
      this.equipGrid.appendChild(slot);
    }

    this.buildSkillsTab();

    this.root.appendChild(this.invGrid);
    this.root.appendChild(this.equipGrid);
    this.root.appendChild(this.skillsGrid);
    document.body.appendChild(this.root);

    this.select('inventory');
    this.refresh();
  }

  /** Repaint everything from the model. Call after the inventory/skills change. */
  refresh(): void {
    this.inventory.slots.forEach((item, i) => fillSlot(this.invSlots[i], item));
    for (const [slot, el] of this.equipSlots) {
      fillSlot(el, this.inventory.equipment[slot]);
    }
    this.renderSkills();
  }

  private renderSkills(): void {
    for (const [id, cell] of this.skillCells) {
      cell.level.textContent = String(this.skills.levelOf(id));
      cell.fill.style.width = `${Math.round(this.skills.progressOf(id) * 100)}%`;
    }
    this.skillsTotal.textContent = `Total level: ${this.skills.totalLevel()}`;
  }

  private buildTabBar(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'inv-tabs';
    for (const [tab, label] of [
      ['inventory', 'Inventory'],
      ['armour', 'Armour'],
      ['skills', 'Skills'],
    ] as ReadonlyArray<[Tab, string]>) {
      const btn = document.createElement('button');
      btn.className = 'inv-tab';
      btn.textContent = label;
      btn.addEventListener('click', () => this.select(tab));
      this.tabs.set(tab, btn);
      bar.appendChild(btn);
    }
    return bar;
  }

  private buildSkillsTab(): void {
    this.skillsGrid.className = 'skills-grid';
    for (const id of SKILL_IDS) {
      const meta = SKILL_META[id];
      const cell = document.createElement('div');
      cell.className = 'skill';
      cell.title = meta.label;

      const icon = document.createElement('span');
      icon.className = 'skill-icon';
      icon.textContent = meta.icon;

      const level = document.createElement('span');
      level.className = 'skill-level';

      const bar = document.createElement('div');
      bar.className = 'skill-bar';
      const fill = document.createElement('div');
      fill.className = 'skill-bar-fill';
      fill.style.background = meta.color;
      bar.appendChild(fill);

      cell.append(icon, level, bar);
      this.skillsGrid.appendChild(cell);
      this.skillCells.set(id, { level, fill });
    }

    this.skillsTotal = document.createElement('div');
    this.skillsTotal.className = 'skills-total';
    this.skillsGrid.appendChild(this.skillsTotal);
  }

  private select(tab: Tab): void {
    for (const [name, btn] of this.tabs) btn.classList.toggle('active', name === tab);
    this.invGrid.style.display = tab === 'inventory' ? 'grid' : 'none';
    this.equipGrid.style.display = tab === 'armour' ? 'grid' : 'none';
    this.skillsGrid.style.display = tab === 'skills' ? 'grid' : 'none';
  }

  /** Create a slot element wired for click + drag-and-drop against `ref`. */
  private makeSlot(ref: SlotRef, extra?: string): HTMLElement {
    const el = document.createElement('div');
    el.className = extra ? `slot ${extra}` : 'slot';

    el.addEventListener('click', () => this.quickAction(ref));

    el.addEventListener('dragstart', (e) => {
      this.dragFrom = ref;
      e.dataTransfer?.setData('text/plain', ''); // Firefox requires some payload
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => {
      this.dragFrom = null;
      el.classList.remove('dragging');
    });
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      el.classList.add('drop-hover');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-hover'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drop-hover');
      if (this.dragFrom && this.inventory.move(this.dragFrom, ref)) this.refresh();
    });

    return el;
  }

  /** A bare click: equip a backpack item, or strip a worn one back to the bag. */
  private quickAction(ref: SlotRef): void {
    const changed =
      ref.area === 'inventory'
        ? this.inventory.equip(ref.index)
        : this.inventory.unequip(ref.slot);
    if (changed) this.refresh();
  }
}

/** Show an item's icon/name, or fall back to the slot's placeholder label. */
function fillSlot(el: HTMLElement, item: Item | null): void {
  el.classList.toggle('filled', item !== null);
  el.draggable = item !== null;
  if (item) {
    el.textContent = item.icon ?? item.name.slice(0, 2);
    el.title = item.name;
  } else {
    el.textContent = el.dataset.placeholder ?? '';
    el.title = '';
  }
}
