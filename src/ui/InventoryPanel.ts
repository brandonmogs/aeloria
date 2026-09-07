import { EquipSlot, SlotRef, INVENTORY_SIZE } from '../sim/Inventory';
import { ItemStack, itemDef } from '../sim/items';
import { SkillId, SKILL_IDS, xpForLevel, MAX_LEVEL } from '../sim/Skills';
import { SKILL_META } from './skillMeta';
import { WEAPON_STYLES } from '../sim/combat';
import { PRAYERS } from '../sim/prayers';
import { Player } from '../sim/Player';
import { World } from '../sim/World';

type Tab = 'combat' | 'skills' | 'inventory' | 'armour' | 'prayer';

const TAB_META: ReadonlyArray<[Tab, string, string]> = [
  ['combat', '⚔️', 'Combat options'],
  ['skills', '📊', 'Skills'],
  ['inventory', '🎒', 'Inventory'],
  ['armour', '🛡️', 'Worn equipment'],
  ['prayer', '✨', 'Prayer'],
];

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

/** Live elements for one skill cell, so XP gains can repaint just that cell. */
interface SkillCell {
  level: HTMLElement;
  fill: HTMLElement;
  cell: HTMLElement;
}

/** How the panel asks the game to do things — every mutation goes upward. */
export interface PanelCallbacks {
  /** Right-click on a filled backpack slot: (index, stack, cursor). */
  onItemMenu?: (index: number, item: ItemStack, x: number, y: number) => void;
  /** Left-click on a filled backpack slot (eat / bury / wield — main decides). */
  onItemQuick?: (index: number, item: ItemStack) => void;
  /** Drag a backpack item onto the paper doll (or its own equip slot). */
  onEquip?: (index: number) => void;
  /** Click or drag a worn piece back to the backpack. */
  onUnequip?: (slot: EquipSlot) => void;
  onSetStyle?: (index: number) => void;
  onSetAutoRetaliate?: (on: boolean) => void;
  onTogglePrayer?: (id: string) => void;
}

/**
 * The tabbed side panel on the middle-right — the OSRS interface strip:
 * combat options, skills, backpack, worn equipment, and the prayer book, all
 * driven by the player's sim state. The panel never mutates the model
 * directly; every action funnels through {@link PanelCallbacks} into the
 * command queue, and the panel repaints from state on {@link refresh}.
 */
export class InventoryPanel {
  private readonly root = document.createElement('div');
  private readonly combatPane = document.createElement('div');
  private readonly invGrid = document.createElement('div');
  private readonly equipPane = document.createElement('div');
  private readonly equipGrid = document.createElement('div');
  private readonly equipStats = document.createElement('div');
  private readonly skillsGrid = document.createElement('div');
  private readonly prayerPane = document.createElement('div');
  private readonly tabs = new Map<Tab, HTMLButtonElement>();
  private readonly equipSlots = new Map<EquipSlot, HTMLElement>();
  private readonly invSlots: HTMLElement[] = [];
  private readonly skillCells = new Map<SkillId, SkillCell>();
  private readonly prayerCells = new Map<string, HTMLElement>();
  private prayerPoints!: HTMLElement;
  private skillsTotal!: HTMLElement;
  private combatWeapon!: HTMLElement;
  private combatLevel!: HTMLElement;
  private styleRow!: HTMLElement;
  private retaliateBtn!: HTMLElement;
  private styleSig = '';
  private dragFrom: SlotRef | null = null;

  constructor(
    private readonly world: World,
    private readonly player: Player,
    private readonly cb: PanelCallbacks = {},
  ) {
    this.root.id = 'inventory-panel';
    this.root.appendChild(this.buildTabBar());

    this.buildCombatTab();

    this.invGrid.className = 'inv-grid';
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const slot = this.makeSlot({ area: 'inventory', index: i });
      this.invSlots.push(slot);
      this.invGrid.appendChild(slot);
    }

    this.equipPane.className = 'equip-pane';
    this.equipGrid.className = 'equip-grid';
    for (const cell of EQUIP_LAYOUT) {
      const slot = this.makeSlot({ area: 'equipment', slot: cell.slot }, 'equip');
      slot.style.gridColumn = String(cell.col);
      slot.style.gridRow = String(cell.row);
      slot.dataset.placeholder = cell.label;
      this.equipSlots.set(cell.slot, slot);
      this.equipGrid.appendChild(slot);
    }
    this.equipStats.className = 'equip-stats';
    this.equipPane.append(this.equipGrid, this.equipStats);

    this.buildSkillsTab();
    this.buildPrayerTab();

    this.root.appendChild(this.combatPane);
    this.root.appendChild(this.invGrid);
    this.root.appendChild(this.equipPane);
    this.root.appendChild(this.skillsGrid);
    this.root.appendChild(this.prayerPane);
    document.body.appendChild(this.root);

    this.select('inventory');
    this.refresh();
  }

  /** Repaint everything from the model. Call after the sim ticks. */
  refresh(): void {
    const inv = this.player.inventory;
    inv.slots.forEach((item, i) => fillSlot(this.invSlots[i], item));
    for (const [slot, el] of this.equipSlots) {
      fillSlot(el, inv.equipment[slot]);
    }
    this.renderSkills();
    this.renderCombat();
    this.renderPrayer();
    this.renderEquipStats();
  }

  // --- Combat tab -----------------------------------------------------------

  private buildCombatTab(): void {
    this.combatPane.className = 'combat-pane';
    this.combatWeapon = document.createElement('div');
    this.combatWeapon.className = 'combat-weapon';
    this.combatLevel = document.createElement('div');
    this.combatLevel.className = 'combat-level';
    this.styleRow = document.createElement('div');
    this.styleRow.className = 'style-grid';
    this.retaliateBtn = document.createElement('button');
    this.retaliateBtn.className = 'retaliate-btn';
    this.retaliateBtn.addEventListener('click', () => {
      this.cb.onSetAutoRetaliate?.(!this.player.autoRetaliate);
    });
    this.combatPane.append(this.combatWeapon, this.combatLevel, this.styleRow, this.retaliateBtn);
  }

  private renderCombat(): void {
    const weapon = this.player.inventory.equipment.weapon;
    const weaponName = weapon ? itemDef(weapon.id).name : 'Unarmed';
    const type = this.world.weaponTypeOf(this.player);
    this.combatWeapon.textContent = weaponName;
    this.combatLevel.textContent = `Combat Lvl: ${this.world.combatLevelOf(this.player)}`;

    // Rebuild the style buttons only when the weapon category changes.
    const styles = WEAPON_STYLES[type];
    if (this.styleSig !== type) {
      this.styleSig = type;
      this.styleRow.textContent = '';
      styles.forEach((style, i) => {
        const btn = document.createElement('button');
        btn.className = 'style-btn';
        btn.innerHTML = `<span class="style-name">${style.name}</span><span class="style-kind">${style.style}</span>`;
        btn.addEventListener('click', () => this.cb.onSetStyle?.(i));
        this.styleRow.appendChild(btn);
      });
    }
    const active = Math.min(this.player.styleIndex, styles.length - 1);
    Array.from(this.styleRow.children).forEach((el, i) => {
      el.classList.toggle('active', i === active);
    });

    this.retaliateBtn.textContent = `Auto retaliate: ${this.player.autoRetaliate ? 'On' : 'Off'}`;
    this.retaliateBtn.classList.toggle('active', this.player.autoRetaliate);
  }

  // --- Skills tab -----------------------------------------------------------

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
      this.skillCells.set(id, { level, fill, cell });
    }

    this.skillsTotal = document.createElement('div');
    this.skillsTotal.className = 'skills-total';
    this.skillsGrid.appendChild(this.skillsTotal);
  }

  private renderSkills(): void {
    const skills = this.player.skills;
    for (const [id, cell] of this.skillCells) {
      const level = skills.levelOf(id);
      cell.level.textContent = String(level);
      cell.fill.style.width = `${Math.round(skills.progressOf(id) * 100)}%`;
      const xp = Math.floor(skills.xpOf(id));
      cell.cell.title =
        level >= MAX_LEVEL
          ? `${SKILL_META[id].label}: ${xp.toLocaleString()} xp (maxed)`
          : `${SKILL_META[id].label}: ${xp.toLocaleString()} xp — ` +
            `${(xpForLevel(level + 1) - xp).toLocaleString()} to level ${level + 1}`;
    }
    this.skillsTotal.textContent = `Total level: ${skills.totalLevel()}`;
  }

  // --- Prayer tab -----------------------------------------------------------

  private buildPrayerTab(): void {
    this.prayerPane.className = 'prayer-pane';
    this.prayerPoints = document.createElement('div');
    this.prayerPoints.className = 'prayer-points';
    this.prayerPane.appendChild(this.prayerPoints);

    const grid = document.createElement('div');
    grid.className = 'prayer-grid';
    for (const prayer of PRAYERS) {
      const cell = document.createElement('button');
      cell.className = 'prayer-cell';
      cell.innerHTML =
        `<span class="prayer-icon">${prayer.icon}</span>` +
        `<span class="prayer-name">${prayer.name}</span>` +
        `<span class="prayer-req">Lvl ${prayer.level}</span>`;
      cell.addEventListener('click', () => this.cb.onTogglePrayer?.(prayer.id));
      this.prayerCells.set(prayer.id, cell);
      grid.appendChild(cell);
    }
    this.prayerPane.appendChild(grid);
  }

  private renderPrayer(): void {
    this.prayerPoints.textContent = `Prayer points: ${this.player.prayerPoints}/${this.player.maxPrayerPoints}`;
    const level = this.player.skills.levelOf('prayer');
    for (const prayer of PRAYERS) {
      const cell = this.prayerCells.get(prayer.id)!;
      cell.classList.toggle('active', this.player.activePrayers.has(prayer.id));
      cell.classList.toggle('locked', level < prayer.level);
    }
  }

  // --- Equipment stats ------------------------------------------------------

  private renderEquipStats(): void {
    const bonus = this.player.inventory.equipmentBonuses();
    const weight = this.player.inventory.totalWeightKg();
    this.equipStats.innerHTML =
      `<div>Attack ${fmtBonus(bonus.attack)} · Strength ${fmtBonus(bonus.strength)}</div>` +
      `<div>Defence ${fmtBonus(bonus.defense)} · Prayer ${fmtBonus(bonus.prayer)}</div>` +
      `<div class="equip-weight">Weight: ${weight.toFixed(1)} kg</div>`;
  }

  private buildTabBar(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'inv-tabs';
    for (const [tab, icon, tip] of TAB_META) {
      const btn = document.createElement('button');
      btn.className = 'inv-tab';
      btn.textContent = icon;
      btn.title = tip;
      btn.addEventListener('click', () => this.select(tab));
      this.tabs.set(tab, btn);
      bar.appendChild(btn);
    }
    return bar;
  }

  private select(tab: Tab): void {
    for (const [name, btn] of this.tabs) btn.classList.toggle('active', name === tab);
    this.combatPane.style.display = tab === 'combat' ? 'block' : 'none';
    this.invGrid.style.display = tab === 'inventory' ? 'grid' : 'none';
    this.equipPane.style.display = tab === 'armour' ? 'block' : 'none';
    this.skillsGrid.style.display = tab === 'skills' ? 'grid' : 'none';
    this.prayerPane.style.display = tab === 'prayer' ? 'block' : 'none';
  }

  /** Create a slot element wired for click + drag-and-drop against `ref`. */
  private makeSlot(ref: SlotRef, extra?: string): HTMLElement {
    const el = document.createElement('div');
    el.className = extra ? `slot ${extra}` : 'slot';

    el.addEventListener('click', () => this.quickAction(ref));

    if (ref.area === 'inventory') {
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const item = this.player.inventory.slots[ref.index];
        if (item) this.cb.onItemMenu?.(ref.index, item, e.clientX, e.clientY);
      });
    }

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
      this.handleDrop(ref);
    });

    return el;
  }

  private handleDrop(to: SlotRef): void {
    const from = this.dragFrom;
    if (!from) return;
    if (from.area === 'inventory' && to.area === 'inventory') {
      // Rearranging the backpack is presentation-only; do it locally.
      if (this.player.inventory.move(from, to)) this.refresh();
    } else if (from.area === 'inventory' && to.area === 'equipment') {
      this.cb.onEquip?.(from.index);
    } else if (from.area === 'equipment' && to.area === 'inventory') {
      this.cb.onUnequip?.(from.slot);
    }
  }

  /** A bare click: act on a backpack item, or strip a worn piece off. */
  private quickAction(ref: SlotRef): void {
    if (ref.area === 'inventory') {
      const item = this.player.inventory.slots[ref.index];
      if (item) this.cb.onItemQuick?.(ref.index, item);
    } else {
      this.cb.onUnequip?.(ref.slot);
    }
  }
}

function fmtBonus(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

/** OSRS-style stack count: plain to 99,999, then 100K, then 10M. */
function fmtQty(qty: number): string {
  if (qty >= 10_000_000) return `${Math.floor(qty / 1_000_000)}M`;
  if (qty >= 100_000) return `${Math.floor(qty / 1000)}K`;
  return String(qty);
}

/** Show an item's icon (and stack size), or the slot's placeholder label. */
function fillSlot(el: HTMLElement, item: ItemStack | null): void {
  el.classList.toggle('filled', item !== null);
  el.draggable = item !== null;
  if (item) {
    const def = itemDef(item.id);
    el.textContent = def.icon;
    el.title = def.name;
    if (item.qty > 1) {
      const badge = document.createElement('span');
      badge.className = 'slot-qty';
      badge.textContent = fmtQty(item.qty);
      el.appendChild(badge);
    }
  } else {
    el.textContent = el.dataset.placeholder ?? '';
    el.title = '';
  }
}
