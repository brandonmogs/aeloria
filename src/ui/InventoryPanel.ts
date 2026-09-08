import { EquipSlot, SlotRef, INVENTORY_SIZE } from '../sim/Inventory';
import { ItemStack, itemDef } from '../sim/items';
import { SkillId, SKILL_IDS, xpForLevel, MAX_LEVEL } from '../sim/Skills';
import { SKILL_META } from './skillMeta';
import { WEAPON_STYLES } from '../sim/combat';
import { PRAYERS } from '../sim/prayers';
import { SPELLS } from '../sim/spells';
import { Player } from '../sim/Player';
import { World } from '../sim/World';
import { SidePanel } from './SidePanel';

/** Where each equipment slot sits on the 3-column paper-doll layout. */
interface EquipCell {
  slot: EquipSlot;
  label: string;
  col: number;
  row: number;
}

const EQUIP_LAYOUT: ReadonlyArray<EquipCell> = [
  { slot: 'helmet', label: 'Head', col: 2, row: 1 },
  { slot: 'cape', label: 'Cape', col: 1, row: 2 },
  { slot: 'amulet', label: 'Neck', col: 2, row: 2 },
  { slot: 'ammo', label: 'Ammo', col: 3, row: 2 },
  { slot: 'weapon', label: 'Weapon', col: 1, row: 3 },
  { slot: 'chestplate', label: 'Body', col: 2, row: 3 },
  { slot: 'shield', label: 'Shield', col: 3, row: 3 },
  { slot: 'legs', label: 'Legs', col: 2, row: 4 },
  { slot: 'gloves', label: 'Hands', col: 1, row: 5 },
  { slot: 'boots', label: 'Feet', col: 2, row: 5 },
  { slot: 'ring', label: 'Ring', col: 3, row: 5 },
];

/** Live elements for one skill cell, so XP gains can repaint just that cell. */
interface SkillCell {
  cell: HTMLElement;
  current: HTMLElement;
  base: HTMLElement;
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
  /** Click a skill on the stats tab: open its skill guide. */
  onSkillClick?: (skill: SkillId) => void;
  /** The combat tab's Autocast button (only shown with a staff wielded). */
  onAutocastClick?: () => void;
}

/**
 * The tabs of the OSRS interface strip that read the player: combat options,
 * skills, backpack, worn equipment, and the prayer book. The panes are built
 * here and handed to the {@link SidePanel}, which owns the tab buttons. The
 * panel never mutates the model directly; every action funnels through
 * {@link PanelCallbacks} into the command queue, and the panel repaints from
 * state on {@link refresh}.
 */
export class InventoryPanel {
  private readonly combatPane = document.createElement('div');
  private readonly invPane = document.createElement('div');
  private readonly invGrid = document.createElement('div');
  private readonly equipPane = document.createElement('div');
  private readonly equipGrid = document.createElement('div');
  private readonly equipStats = document.createElement('div');
  private readonly skillsPane = document.createElement('div');
  private readonly prayerPane = document.createElement('div');
  private readonly tooltip = document.createElement('div');
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
  private autocastBtn!: HTMLElement;
  private styleSig = '';
  private dragFrom: SlotRef | null = null;
  private hoveredSkill: SkillId | null = null;

  constructor(
    private readonly world: World,
    private readonly player: Player,
    sidePanel: SidePanel,
    private readonly cb: PanelCallbacks = {},
  ) {
    this.buildCombatTab();

    this.invPane.className = 'inv-pane';
    this.invGrid.className = 'inv-grid';
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const slot = this.makeSlot({ area: 'inventory', index: i });
      this.invSlots.push(slot);
      this.invGrid.appendChild(slot);
    }
    this.invPane.appendChild(this.invGrid);

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

    this.tooltip.id = 'skill-tip';
    this.tooltip.hidden = true;
    document.body.appendChild(this.tooltip);

    sidePanel.register('combat', this.combatPane);
    sidePanel.register('skills', this.skillsPane);
    sidePanel.register('inventory', this.invPane);
    sidePanel.register('equipment', this.equipPane);
    sidePanel.register('prayer', this.prayerPane);

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
    this.autocastBtn = document.createElement('button');
    this.autocastBtn.className = 'retaliate-btn autocast-btn';
    this.autocastBtn.hidden = true;
    this.autocastBtn.addEventListener('click', () => this.cb.onAutocastClick?.());
    this.combatPane.append(this.combatWeapon, this.combatLevel, this.styleRow, this.autocastBtn, this.retaliateBtn);
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

    this.retaliateBtn.textContent = `Auto Retaliate: ${this.player.autoRetaliate ? 'On' : 'Off'}`;
    this.retaliateBtn.classList.toggle('active', this.player.autoRetaliate);

    // Staves offer autocast, like the real combat tab.
    this.autocastBtn.hidden = type !== 'staff';
    const autocast = SPELLS.find((s) => s.id === this.player.autocastSpell);
    this.autocastBtn.textContent = `Autocast: ${autocast ? autocast.name : 'None'}`;
    this.autocastBtn.classList.toggle('active', autocast !== undefined);
  }

  // --- Skills tab -----------------------------------------------------------

  /**
   * The OSRS stats tab: three columns of skill cells showing "level/level"
   * (current over base), the total level in the last cell, an XP tooltip on
   * hover, and a click that opens the skill guide.
   */
  private buildSkillsTab(): void {
    this.skillsPane.className = 'skills-pane';
    const grid = document.createElement('div');
    grid.className = 'skills-grid';
    for (const id of SKILL_IDS) {
      const meta = SKILL_META[id];
      const cell = document.createElement('div');
      cell.className = 'skill';
      cell.dataset.skill = id;

      const icon = document.createElement('span');
      icon.className = 'skill-icon';
      icon.textContent = meta.icon;

      const levels = document.createElement('span');
      levels.className = 'skill-levels';
      const current = document.createElement('span');
      current.className = 'skill-cur';
      const sep = document.createElement('span');
      sep.className = 'skill-sep';
      sep.textContent = '/';
      const base = document.createElement('span');
      base.className = 'skill-base';
      levels.append(current, sep, base);

      cell.append(icon, levels);
      cell.addEventListener('pointerenter', (e) => this.showSkillTip(id, e.clientX, e.clientY));
      cell.addEventListener('pointermove', (e) => this.moveSkillTip(e.clientX, e.clientY));
      cell.addEventListener('pointerleave', () => this.hideSkillTip());
      cell.addEventListener('click', () => this.cb.onSkillClick?.(id));
      grid.appendChild(cell);
      this.skillCells.set(id, { cell, current, base });
    }

    const total = document.createElement('div');
    total.className = 'skill skill-total';
    total.title = 'Total level';
    const label = document.createElement('span');
    label.className = 'skill-total-label';
    label.textContent = 'Total level:';
    this.skillsTotal = document.createElement('span');
    this.skillsTotal.className = 'skill-total-num';
    total.append(label, this.skillsTotal);
    total.addEventListener('pointerenter', (e) => this.showTotalTip(e.clientX, e.clientY));
    total.addEventListener('pointermove', (e) => this.moveSkillTip(e.clientX, e.clientY));
    total.addEventListener('pointerleave', () => this.hideSkillTip());
    grid.appendChild(total);

    this.skillsPane.appendChild(grid);
  }

  private renderSkills(): void {
    const skills = this.player.skills;
    for (const [id, cell] of this.skillCells) {
      const level = skills.levelOf(id);
      cell.current.textContent = String(level);
      cell.base.textContent = String(level);
      cell.cell.classList.toggle('maxed', level >= MAX_LEVEL);
    }
    this.skillsTotal.textContent = String(skills.totalLevel());
    if (this.hoveredSkill) this.paintSkillTip(this.hoveredSkill);
  }

  private showSkillTip(id: SkillId, x: number, y: number): void {
    this.hoveredSkill = id;
    this.paintSkillTip(id);
    this.tooltip.hidden = false;
    this.moveSkillTip(x, y);
  }

  private showTotalTip(x: number, y: number): void {
    this.hoveredSkill = null;
    const skills = this.player.skills;
    this.tooltip.innerHTML =
      `<div>Total level: <span>${skills.totalLevel().toLocaleString()}</span></div>` +
      `<div>Total XP: <span>${Math.floor(skills.totalXp()).toLocaleString()}</span></div>`;
    this.tooltip.hidden = false;
    this.moveSkillTip(x, y);
  }

  /** The OSRS hover box: current XP, the next level's threshold, what's left. */
  private paintSkillTip(id: SkillId): void {
    const skills = this.player.skills;
    const level = skills.levelOf(id);
    const xp = Math.floor(skills.xpOf(id));
    const label = SKILL_META[id].label;
    if (level >= MAX_LEVEL) {
      this.tooltip.innerHTML =
        `<div>${label} XP: <span>${xp.toLocaleString()}</span></div>` +
        `<div>Skill mastery — level ${MAX_LEVEL}</div>`;
      return;
    }
    const next = xpForLevel(level + 1);
    this.tooltip.innerHTML =
      `<div>${label} XP: <span>${xp.toLocaleString()}</span></div>` +
      `<div>Next level at: <span>${next.toLocaleString()}</span></div>` +
      `<div>Remaining XP: <span>${(next - xp).toLocaleString()}</span></div>`;
  }

  private moveSkillTip(x: number, y: number): void {
    // Sit to the left of the cursor so the box never hides the cell under it.
    const rect = this.tooltip.getBoundingClientRect();
    this.tooltip.style.left = `${Math.max(4, x - rect.width - 14)}px`;
    this.tooltip.style.top = `${Math.min(window.innerHeight - rect.height - 4, y + 12)}px`;
  }

  private hideSkillTip(): void {
    this.hoveredSkill = null;
    this.tooltip.hidden = true;
  }

  // --- Prayer tab -----------------------------------------------------------

  /** The prayer book as OSRS lays it out: a five-column grid of icons with a hover box. */
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
      cell.textContent = prayer.icon;
      cell.addEventListener('click', () => this.cb.onTogglePrayer?.(prayer.id));
      cell.addEventListener('pointerenter', (e) => {
        this.tooltip.innerHTML =
          `<div>${prayer.name} <span>(Level ${prayer.level}${prayer.defenceLevel ? `, ${prayer.defenceLevel} Defence` : ''})</span></div>` +
          `<div>${prayer.description}</div>`;
        this.tooltip.hidden = false;
        this.moveSkillTip(e.clientX, e.clientY);
      });
      cell.addEventListener('pointermove', (e) => this.moveSkillTip(e.clientX, e.clientY));
      cell.addEventListener('pointerleave', () => {
        this.tooltip.hidden = true;
      });
      this.prayerCells.set(prayer.id, cell);
      grid.appendChild(cell);
    }
    this.prayerPane.appendChild(grid);
  }

  private renderPrayer(): void {
    this.prayerPoints.textContent = `Prayer points: ${this.player.prayerPoints}/${this.player.maxPrayerPoints}`;
    const level = this.player.skills.levelOf('prayer');
    const defence = this.player.skills.levelOf('defense');
    for (const prayer of PRAYERS) {
      const cell = this.prayerCells.get(prayer.id)!;
      cell.classList.toggle('active', this.player.activePrayers.has(prayer.id));
      cell.classList.toggle('locked', level < prayer.level || (prayer.defenceLevel ?? 0) > defence);
    }
  }

  // --- Equipment stats ------------------------------------------------------

  /** The OSRS "Equipment Stats" sheet: attack and defence bonuses by type, then the rest. */
  private renderEquipStats(): void {
    const b = this.player.inventory.equipmentBonuses();
    const weight = this.player.inventory.totalWeightKg();
    const row = (label: string, v: number): string => `<span class="es-row">${label}: <b>${fmtBonus(v)}</b></span>`;
    this.equipStats.innerHTML =
      `<div class="es-col"><div class="es-head">Attack bonus</div>` +
      row('Stab', b.astab) + row('Slash', b.aslash) + row('Crush', b.acrush) + row('Magic', b.amagic) + row('Range', b.arange) +
      `</div><div class="es-col"><div class="es-head">Defence bonus</div>` +
      row('Stab', b.dstab) + row('Slash', b.dslash) + row('Crush', b.dcrush) + row('Magic', b.dmagic) + row('Range', b.drange) +
      `</div><div class="es-col es-other"><div class="es-head">Other bonuses</div>` +
      row('Melee strength', b.str) + row('Prayer', b.prayer) +
      `<span class="es-row equip-weight">Weight: <b>${weight.toFixed(1)} kg</b></span></div>`;
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
