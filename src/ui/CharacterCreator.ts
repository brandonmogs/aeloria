import { CharacterStage, Framing } from '../render/CharacterStage';
import { HairStyle } from '../render/hair';
import { MorphGroup, MorphSet, morphSet, randomMorphs } from '../render/morphs';
import { RACES } from '../render/races';
import {
  Appearance,
  BEARD_STYLES,
  BODY_PRESETS,
  BeardStyle,
  CLOTH_COLORS,
  EYE_COLORS,
  FACE_PRESETS,
  HAIR_COLORS,
  HAIR_STYLES,
  LIP_COLORS,
  MorphPreset,
  NAME_MAX,
  PAINT_COLORS,
  PAINT_STYLES,
  PaintStyle,
  RACE_IDS,
  SCAR_STYLES,
  SEXES,
  SHADOW_COLORS,
  SKIN_TONES,
  SLOT_COUNT,
  ScarStyle,
  applyRace,
  cleanName,
  cloneAppearance,
  defaultAppearance,
  heightRange,
  loadSlot,
  randomName,
  saveSlot,
  toCharacterOptions,
} from './appearance';
import './creator.css';

/**
 * The character screen: the figure on the shared stage under its own
 * lighting, with everything about it on buttons, swatches and sliders. Race,
 * sex, name and saved looks sit on the left; the sheet on the right has a tab
 * each for presets, the body, the face, the hair, and the style (brows,
 * lashes, beard, makeup, marks and clothes). Shown
 * before the world on a first visit; `choose()` resolves with the look when
 * the player enters. `window.__creator` is the test hook.
 */

type Tab = 'preset' | 'body' | 'face' | 'hair' | 'style';

const TABS: ReadonlyArray<readonly [Tab, string]> = [
  ['preset', 'Presets'],
  ['body', 'Body'],
  ['face', 'Face'],
  ['hair', 'Hair'],
  ['style', 'Style'],
];

/** Where the view goes when a tab opens, and how much room it leaves round the figure. */
const TAB_FRAMING: Record<Tab, [Framing, number]> = { preset: ['full', 1], body: ['full', 1], face: ['head', 1.3], hair: ['head', 1.45], style: ['head', 1.7] };

const HAIR_LABELS: Record<HairStyle, string> = { long: 'Long', bob: 'Bob', ponytail: 'Ponytail', short: 'Short', cropped: 'Cropped', bald: 'Shaved' };
const BEARD_LABELS: Record<BeardStyle, string> = { none: 'Clean', stubble: 'Stubble', goatee: 'Goatee', short: 'Short', full: 'Full' };
const SCAR_LABELS: Record<ScarStyle, string> = { none: 'None', brow: 'Brow', cheek: 'Cheek', lip: 'Lip', eye: 'Eye' };
const PAINT_LABELS: Record<PaintStyle, string> = { none: 'None', stripe: 'Stripe', bars: 'Bars', claw: 'Claw', dots: 'Dots' };
const pct = (v: number): string => String(Math.round(v * 100));
const SEX_LABELS = { male: 'Male', female: 'Female' } as const;

export interface CreatorHandle {
  look: Appearance;
  /** True once the figure has been built and drawn for a few frames. */
  ready: boolean;
  stage: CharacterStage;
}

declare global {
  interface Window {
    __creator?: CreatorHandle;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', cls, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

const hex = (c: number): string => '#' + c.toString(16).padStart(6, '0');

/** The ids of the sliders on one tab of a morph set. */
function tabSliders(set: MorphSet | null, tab: MorphGroup['tab']): Set<string> {
  if (!set) return new Set();
  const groups = new Set(set.groups.filter((g) => g.tab === tab).map((g) => g.id));
  return new Set(set.sliders.filter((s) => groups.has(s.group)).map((s) => s.id));
}

export class CharacterCreator {
  private readonly root = el('div', 'creator');
  private readonly canvas = el('canvas', 'creator-view');
  private readonly side = el('aside', 'creator-side');
  private readonly tabBar = el('nav', 'creator-tabs');
  private readonly sheet = el('div', 'creator-body');
  private readonly nameInput = el('input');
  private readonly turnButton: HTMLButtonElement;
  private readonly stage: CharacterStage;
  private readonly look: Appearance;
  private readonly handle: CreatorHandle;
  private tab: Tab = 'preset';
  private slot = 0;
  private rebuildTimer = 0;
  private frame = 0;
  private framesSinceBuild = 0;
  private last = -1;
  private resolve: ((a: Appearance) => void) | null = null;

  constructor(parent: HTMLElement, initial: Appearance) {
    this.look = cloneAppearance(initial);

    const top = el('header', 'creator-top');
    top.append(el('h1', '', 'Aeloria'), el('p', 'creator-sub', 'Shape the one who walks into the world.'));

    const sheet = el('section', 'creator-sheet');
    sheet.append(this.tabBar, this.sheet);

    const foot = el('footer', 'creator-foot');
    const view = el('div', 'creator-foot-group');
    view.append(el('span', 'creator-hint', 'View'));
    for (const [f, label] of [
      ['full', 'Full'],
      ['torso', 'Torso'],
      ['head', 'Head'],
    ] as const) {
      view.append(button(label, 'creator-frame', () => this.stage.frame(f, f === 'head' ? 1.3 : 1)));
    }
    this.turnButton = button('Turn', 'creator-turn', () => {
      this.stage.turning = !this.stage.turning;
      this.turnButton.classList.toggle('active', this.stage.turning);
    });
    view.append(this.turnButton, el('span', 'creator-hint', 'drag to turn · wheel to zoom'));
    const actions = el('div', 'creator-foot-group');
    actions.append(
      button('Random', 'creator-random', () => this.randomize()),
      button('Reset', 'creator-reset', () => this.reset()),
      button('Enter Aeloria', 'creator-enter', () => this.enter()),
    );
    foot.append(view, actions);

    this.nameInput.id = 'creator-name';
    this.nameInput.type = 'text';
    this.nameInput.maxLength = NAME_MAX;
    this.nameInput.spellcheck = false;
    this.nameInput.autocomplete = 'off';
    this.nameInput.placeholder = 'Name';
    this.nameInput.value = this.look.name;
    this.nameInput.addEventListener('change', () => (this.look.name = cleanName(this.nameInput.value)));
    this.nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.enter();
    });

    this.root.append(this.canvas, top, this.side, sheet, foot);
    parent.append(this.root);

    this.stage = new CharacterStage(this.canvas);
    this.stage.setLighting('creator');
    this.stage.turning = false;
    this.stage.setAnimation('idle');
    this.handle = { look: this.look, ready: false, stage: this.stage };
    window.__creator = this.handle;

    this.renderSide();
    this.renderTabs();
    this.renderSheet();
    this.rebuild();
    this.stage.frame('full');
    this.frame = requestAnimationFrame(this.loop);
  }

  /** Resolves with the chosen look once the player enters the world; the screen takes itself down first. */
  choose(): Promise<Appearance> {
    return new Promise((resolve) => (this.resolve = resolve));
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    clearTimeout(this.rebuildTimer);
    this.stage.dispose();
    this.root.remove();
    if (window.__creator === this.handle) delete window.__creator;
  }

  // --- The figure ----------------------------------------------------------------------

  private rebuild(): void {
    clearTimeout(this.rebuildTimer);
    this.rebuildTimer = 0;
    this.stage.setCharacter({ ...toCharacterOptions(this.look), merged: true });
    this.framesSinceBuild = 0;
    this.handle.ready = false;
  }

  /** Sliders and colour pickers fire continuously; rebuild once the hand pauses. */
  private scheduleRebuild(delay: number): void {
    clearTimeout(this.rebuildTimer);
    this.rebuildTimer = window.setTimeout(() => this.rebuild(), delay);
  }

  private readonly loop = (now: number): void => {
    if (this.last < 0) this.last = now;
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.stage.update(dt);
    if (this.stage.hasCharacter && ++this.framesSinceBuild >= 10) this.handle.ready = true;
    this.frame = requestAnimationFrame(this.loop);
  };

  private enter(): void {
    this.look.name = cleanName(this.nameInput.value);
    const chosen = cloneAppearance(this.look);
    this.dispose();
    this.resolve?.(chosen);
  }

  /** A new face, body, hair, style and name; the race and sex stay. */
  private randomize(): void {
    const look = this.look;
    const set = morphSet(look.sex);
    const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];
    const chance = (p: number): boolean => Math.random() < p;
    const between = (lo: number, hi: number): number => +(lo + Math.random() * (hi - lo)).toFixed(2);
    if (set) look.morphs = { ...randomMorphs(set, 'face', 0.55), ...randomMorphs(set, 'body', 0.45) };
    look.hair = pick(HAIR_STYLES);
    look.hairColor = pick(HAIR_COLORS)[1];
    look.eyes = pick(EYE_COLORS)[1];
    look.tunic = pick(CLOTH_COLORS)[1];
    look.trouser = pick(CLOTH_COLORS)[1];
    look.brows = between(0.2, 0.9);
    look.browColor = chance(0.25) ? pick(HAIR_COLORS)[1] : null;
    look.lashes = between(0.6, 1.4);
    look.beard = look.sex === 'male' ? pick(BEARD_STYLES) : 'none';
    look.beardColor = chance(0.25) ? pick(HAIR_COLORS)[1] : null;
    const made = look.sex === 'female' ? 0.5 : 0.08;
    look.lips = chance(made) ? between(0.4, 1) : 0;
    look.lipColor = pick(LIP_COLORS)[1];
    look.shadow = chance(made * 0.8) ? between(0.3, 1) : 0;
    look.shadowColor = pick(SHADOW_COLORS)[1];
    look.blush = chance(made) ? between(0.3, 0.8) : 0;
    look.freckles = chance(0.3) ? between(0.2, 0.8) : 0;
    look.scar = chance(0.15) ? pick(SCAR_STYLES) : 'none';
    look.paint = chance(0.1) ? pick(PAINT_STYLES) : 'none';
    look.paintColor = pick(PAINT_COLORS)[1];
    const [lo, hi] = heightRange(this.look.race, this.look.sex);
    this.look.height = +(lo + Math.random() * (hi - lo)).toFixed(2);
    this.look.name = randomName(this.look.sex);
    this.nameInput.value = this.look.name;
    this.renderSheet();
    this.rebuild();
  }

  /** Back to the race's stock body, bare face and plain clothes; the name stays. */
  private reset(): void {
    Object.assign(this.look, defaultAppearance(this.look.race, this.look.sex), { name: this.look.name });
    this.renderSheet();
    this.rebuild();
  }

  private setRace(race: Appearance['race'], sex: Appearance['sex']): void {
    applyRace(this.look, race, sex);
    this.renderSide();
    this.renderSheet();
    this.rebuild();
  }

  /** Replace one tab's sliders with a preset's. */
  private applyPreset(tab: MorphGroup['tab'], preset: MorphPreset): void {
    const ids = tabSliders(morphSet(this.look.sex), tab);
    for (const id of ids) delete this.look.morphs[id];
    for (const [id, v] of Object.entries(preset.morphs)) if (ids.has(id) && v) this.look.morphs[id] = v;
    this.rebuild();
  }

  private randomTab(tab: MorphGroup['tab']): void {
    const set = morphSet(this.look.sex);
    if (!set) return;
    for (const id of tabSliders(set, tab)) delete this.look.morphs[id];
    Object.assign(this.look.morphs, randomMorphs(set, tab, tab === 'face' ? 0.55 : 0.45));
    this.rebuild();
  }

  // --- The left column: name, race, sex, saved looks ---------------------------------

  private renderSide(): void {
    this.side.replaceChildren();

    const name = el('div', 'creator-section');
    name.append(el('div', 'creator-label', 'Name'));
    const nameRow = el('div', 'creator-name');
    nameRow.append(
      this.nameInput,
      button('⟳', 'creator-dice', () => {
        this.look.name = randomName(this.look.sex);
        this.nameInput.value = this.look.name;
      }),
    );
    name.append(nameRow);

    const race = el('div', 'creator-section');
    race.append(el('div', 'creator-label', 'Race'));
    const races = el('div', 'creator-grid');
    for (const r of RACE_IDS) {
      const b = button(RACES[r].label, 'creator-race', () => this.setRace(r, this.look.sex));
      b.dataset.race = r;
      b.classList.toggle('active', r === this.look.race);
      races.append(b);
    }
    race.append(races);

    const sex = el('div', 'creator-section');
    sex.append(el('div', 'creator-label', 'Sex'));
    const sexes = el('div', 'creator-grid');
    for (const s of SEXES) {
      const b = button(SEX_LABELS[s], 'creator-sex', () => this.setRace(this.look.race, s));
      b.dataset.sex = s;
      b.classList.toggle('active', s === this.look.sex);
      sexes.append(b);
    }
    sex.append(sexes);

    this.side.append(name, race, sex, this.slotsSection());
  }

  /** Eight numbered slots: pick one, then load it, save over it or clear it. */
  private slotsSection(): HTMLElement {
    const section = el('div', 'creator-section');
    section.append(el('div', 'creator-label', 'Saved looks'));
    const chips = el('div', 'creator-slots');
    const saved = Array.from({ length: SLOT_COUNT }, (_, i) => loadSlot(i));
    const nameLine = el('div', 'creator-slot-name');
    const load = button('Load', 'creator-slot-load', () => {
      const look = loadSlot(this.slot);
      if (!look) return;
      Object.assign(this.look, cloneAppearance(look));
      this.nameInput.value = this.look.name;
      this.renderSide();
      this.renderSheet();
      this.rebuild();
    });
    const save = button('Save', 'creator-slot-save', () => {
      this.look.name = cleanName(this.nameInput.value);
      saveSlot(this.slot, cloneAppearance(this.look));
      this.renderSide();
    });
    const clear = button('Clear', 'creator-slot-clear', () => {
      saveSlot(this.slot, null);
      this.renderSide();
    });
    const paint = (): void => {
      const look = saved[this.slot];
      nameLine.textContent = look ? `${look.name} · ${RACES[look.race].label} ${SEX_LABELS[look.sex].toLowerCase()}` : 'Empty slot';
      load.disabled = clear.disabled = !look;
      for (const [i, chip] of Array.from(chips.children).entries()) chip.classList.toggle('active', i === this.slot);
    };
    for (let i = 0; i < SLOT_COUNT; i++) {
      const chip = button(String(i + 1), 'creator-slot', () => {
        this.slot = i;
        paint();
      });
      chip.classList.toggle('filled', saved[i] !== null);
      chips.append(chip);
    }
    const actions = el('div', 'creator-grid three');
    actions.append(load, save, clear);
    section.append(chips, nameLine, actions);
    paint();
    return section;
  }

  // --- The sheet: tabs of controls ----------------------------------------------------

  private renderTabs(): void {
    this.tabBar.replaceChildren();
    for (const [tab, label] of TABS) {
      const b = button(label, 'creator-tab', () => {
        this.tab = tab;
        this.renderTabs();
        this.renderSheet();
        this.stage.frame(...TAB_FRAMING[tab]);
      });
      b.dataset.tab = tab;
      b.classList.toggle('active', tab === this.tab);
      this.tabBar.append(b);
    }
  }

  private renderSheet(): void {
    const top = this.sheet.scrollTop;
    this.sheet.replaceChildren();
    switch (this.tab) {
      case 'preset':
        this.presetSheet();
        break;
      case 'body':
        this.bodySheet();
        break;
      case 'face':
        this.faceSheet();
        break;
      case 'hair':
        this.hairSheet();
        break;
      case 'style':
        this.styleSheet();
        break;
    }
    this.sheet.scrollTop = top;
  }

  private presetSheet(): void {
    const presets = (tab: MorphGroup['tab'], list: readonly MorphPreset[], title: string): void => {
      this.sheet.append(el('div', 'creator-label', title));
      const grid = el('div', 'creator-grid four');
      for (const p of list) {
        const b = button(p.label, 'creator-preset', () => {
          this.applyPreset(tab, p);
          for (const other of grid.children) other.classList.toggle('active', other === b);
        });
        b.dataset.preset = p.id;
        grid.append(b);
      }
      const actions = el('div', 'creator-grid');
      actions.append(
        button(`Random ${tab}`, 'creator-random-' + tab, () => {
          this.randomTab(tab);
          for (const other of grid.children) other.classList.remove('active');
        }),
        button(`Reset ${tab}`, 'creator-reset-' + tab, () => {
          this.applyPreset(tab, list[0]);
          for (const other of grid.children) other.classList.toggle('active', other === grid.firstElementChild);
        }),
      );
      this.sheet.append(grid, actions);
    };
    presets('face', FACE_PRESETS, 'Face');
    presets('body', BODY_PRESETS, 'Body');
    this.sheet.append(el('p', 'creator-note', 'A preset is a starting point: every slider on the Body and Face tabs moves from there.'));
  }

  private bodySheet(): void {
    const [lo, hi] = heightRange(this.look.race, this.look.sex);
    this.slider(this.sheet, 'Height', lo, hi, 0.01, this.look.height, (v) => {
      this.look.height = v;
      this.scheduleRebuild(40);
    }, (v) => v.toFixed(2) + ' m');
    this.swatches(this.sheet, 'Skin', SKIN_TONES, () => this.look.skin, (v) => (this.look.skin = v));
    this.morphGroups('body');
  }

  private faceSheet(): void {
    this.swatches(this.sheet, 'Eyes', EYE_COLORS, () => this.look.eyes, (v) => (this.look.eyes = v));
    this.morphGroups('face');
  }

  private hairSheet(): void {
    this.choices(this.sheet, 'Style', HAIR_STYLES, HAIR_LABELS, 'hair', () => this.look.hair, (v) => (this.look.hair = v));
    this.swatches(this.sheet, 'Colour', HAIR_COLORS, () => this.look.hairColor, (v) => (this.look.hairColor = v));
  }

  /** Brows, lashes, beard, makeup, marks and clothes: everything painted or grown on the chosen body. */
  private styleSheet(): void {
    const look = this.look;
    const sheet = this.sheet;
    const strength = (label: string, key: 'brows' | 'lashes' | 'lips' | 'shadow' | 'blush' | 'freckles', max = 1): void => {
      const input = this.slider(sheet, label, 0, max, 0.01, look[key], (v) => {
        look[key] = v;
        this.scheduleRebuild(40);
      }, pct);
      input.dataset.style = key;
      input.classList.add('style-slider');
    };
    sheet.append(el('div', 'creator-label', 'Brows and lashes'));
    strength('Brows', 'brows');
    this.tintSwatches(sheet, 'Colour', HAIR_COLORS, () => look.browColor, (v) => (look.browColor = v));
    strength('Lashes', 'lashes', 2);
    if (look.sex === 'male') {
      sheet.append(el('div', 'creator-label', 'Beard'));
      this.choices(sheet, 'Style', BEARD_STYLES, BEARD_LABELS, 'beard', () => look.beard, (v) => (look.beard = v));
      this.tintSwatches(sheet, 'Colour', HAIR_COLORS, () => look.beardColor, (v) => (look.beardColor = v));
    }
    sheet.append(el('div', 'creator-label', 'Makeup'));
    strength('Lips', 'lips');
    this.swatches(sheet, 'Colour', LIP_COLORS, () => look.lipColor, (v) => (look.lipColor = v));
    strength('Shadow', 'shadow');
    this.swatches(sheet, 'Colour', SHADOW_COLORS, () => look.shadowColor, (v) => (look.shadowColor = v));
    strength('Blush', 'blush');
    sheet.append(el('div', 'creator-label', 'Marks'));
    strength('Freckles', 'freckles');
    this.choices(sheet, 'Scar', SCAR_STYLES, SCAR_LABELS, 'scar', () => look.scar, (v) => (look.scar = v));
    this.choices(sheet, 'Paint', PAINT_STYLES, PAINT_LABELS, 'paint', () => look.paint, (v) => (look.paint = v));
    this.swatches(sheet, 'Colour', PAINT_COLORS, () => look.paintColor, (v) => (look.paintColor = v));
    sheet.append(el('div', 'creator-label', 'Clothes'));
    this.swatches(sheet, 'Tunic', CLOTH_COLORS, () => look.tunic, (v) => (look.tunic = v));
    this.swatches(sheet, 'Trousers', CLOTH_COLORS, () => look.trouser, (v) => (look.trouser = v));
    sheet.append(el('p', 'creator-note', 'What you wear into the world; armour goes over it.'));
  }

  /** One collapsible group per morph group of the tab, the first open, each slider labelled from the bake. */
  private morphGroups(tab: MorphGroup['tab']): void {
    const set = morphSet(this.look.sex);
    if (!set) return;
    let first = true;
    for (const group of set.groups) {
      if (group.tab !== tab) continue;
      const sliders = set.sliders.filter((s) => s.group === group.id);
      if (!sliders.length) continue;
      const details = el('details', 'creator-group');
      details.dataset.group = group.id;
      details.open = first;
      first = false;
      const summary = el('summary', '', group.label);
      const badge = el('span', 'creator-badge');
      summary.append(badge);
      details.append(summary);
      const touched = (): void => {
        const n = sliders.filter((s) => this.look.morphs[s.id]).length;
        badge.textContent = n ? String(n) : '';
      };
      for (const s of sliders) {
        const input = this.slider(
          details,
          s.label,
          s.bipolar ? -1 : 0,
          1,
          0.01,
          this.look.morphs[s.id] ?? 0,
          (v) => {
            if (v) this.look.morphs[s.id] = v;
            else delete this.look.morphs[s.id];
            touched();
            this.scheduleRebuild(30);
          },
          (v) => String(Math.round(v * 100)),
        );
        input.dataset.id = s.id;
        input.classList.add('morph-slider');
      }
      touched();
      this.sheet.append(details);
    }
  }

  // --- Controls ---------------------------------------------------------------------------

  private slider(
    parent: HTMLElement,
    label: string,
    min: number,
    max: number,
    step: number,
    value: number,
    onInput: (v: number) => void,
    format: (v: number) => string,
  ): HTMLInputElement {
    const row = el('div', 'creator-slider');
    const lbl = el('span', 'lbl', label);
    const input = el('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    const out = el('span', 'val', format(value));
    const set = (v: number): void => {
      out.textContent = format(v);
      onInput(v);
    };
    input.addEventListener('input', () => set(parseFloat(input.value)));
    // Double-click the label to put a slider back to its rest.
    lbl.title = 'Double-click to reset';
    lbl.addEventListener('dblclick', () => {
      const rest = Math.max(min, Math.min(max, 0));
      input.value = String(rest);
      set(rest);
    });
    row.append(lbl, input, out);
    parent.append(row);
    return input;
  }

  /** A row of named choices, one active; each button carries `data-<key>` with its value. */
  private choices<T extends string>(parent: HTMLElement, label: string, list: readonly T[], labels: Record<T, string>, key: string, get: () => T, set: (v: T) => void): void {
    const row = el('div', 'creator-row');
    row.append(el('span', 'lbl', label));
    const wrap = el('div', 'creator-choices');
    for (const v of list) {
      const b = button(labels[v], `creator-choice creator-${key}`, () => {
        set(v);
        for (const other of wrap.children) other.classList.toggle('active', other === b);
        this.rebuild();
      });
      b.dataset[key] = v;
      b.classList.toggle('active', v === get());
      wrap.append(b);
    }
    row.append(wrap);
    parent.append(row);
  }

  /** Named colours as round swatches, and a picker for any other. */
  private swatches(parent: HTMLElement, label: string, list: ReadonlyArray<readonly [string, number]>, get: () => number, set: (v: number) => void): void {
    this.swatchRow(parent, label, list, get, set);
  }

  /** Swatches with a leading choice that follows the hair's colour (null). */
  private tintSwatches(parent: HTMLElement, label: string, list: ReadonlyArray<readonly [string, number]>, get: () => number | null, set: (v: number | null) => void): void {
    this.swatchRow(parent, label, list, () => get() ?? this.look.hairColor, set, { label: 'Hair', isAuto: () => get() === null, setAuto: () => set(null) });
  }

  private swatchRow(
    parent: HTMLElement,
    label: string,
    list: ReadonlyArray<readonly [string, number]>,
    get: () => number,
    set: (v: number) => void,
    auto?: { label: string; isAuto: () => boolean; setAuto: () => void },
  ): void {
    const row = el('div', 'creator-row');
    row.append(el('span', 'lbl', label));
    const wrap = el('div', 'creator-swatches');
    const picker = el('input');
    picker.type = 'color';
    picker.value = hex(get());
    picker.title = 'Any colour';
    let autoButton: HTMLButtonElement | undefined;
    const paint = (): void => {
      for (const b of wrap.querySelectorAll<HTMLButtonElement>('.creator-swatch')) {
        b.classList.toggle('active', !auto?.isAuto() && parseInt(b.dataset.colour ?? '', 16) === get());
      }
      autoButton?.classList.toggle('active', auto?.isAuto() ?? false);
      picker.value = hex(get());
    };
    if (auto) {
      autoButton = button(auto.label, 'creator-swatch auto', () => {
        auto.setAuto();
        paint();
        this.scheduleRebuild(20);
      });
      autoButton.title = 'The same as the hair';
      wrap.append(autoButton);
    }
    for (const [name, c] of list) {
      const b = button('', 'creator-swatch', () => {
        set(c);
        paint();
        this.scheduleRebuild(20);
      });
      b.title = name;
      b.dataset.colour = c.toString(16).padStart(6, '0');
      b.style.background = hex(c);
      wrap.append(b);
    }
    picker.addEventListener('input', () => {
      set(parseInt(picker.value.slice(1), 16));
      paint();
      this.scheduleRebuild(150);
    });
    wrap.append(picker);
    row.append(wrap);
    parent.append(row);
    paint();
  }
}
