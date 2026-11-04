import { CharacterStage, Framing } from '../render/CharacterStage';
import { HairStyle } from '../render/hair';
import { MorphGroup, MorphSet, morphSet, randomMorphs } from '../render/morphs';
import { RACES } from '../render/races';
import {
  Appearance,
  BODY_PRESETS,
  CLOTH_COLORS,
  EYE_COLORS,
  FACE_PRESETS,
  HAIR_COLORS,
  HAIR_STYLES,
  MorphPreset,
  NAME_MAX,
  RACE_IDS,
  SEXES,
  SKIN_TONES,
  SLOT_COUNT,
  applyRace,
  cleanName,
  cloneAppearance,
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
 * each for presets, the body, the face, the hair and the clothes. Shown
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
const TAB_FRAMING: Record<Tab, [Framing, number]> = { preset: ['full', 1], body: ['full', 1], face: ['head', 1.3], hair: ['head', 1.45], style: ['torso', 1.1] };

const HAIR_LABELS: Record<HairStyle, string> = { long: 'Long', short: 'Short', bald: 'Shaved' };
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

  /** A new face, body, hair and name; the race and sex stay. */
  private randomize(): void {
    const set = morphSet(this.look.sex);
    const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];
    if (set) this.look.morphs = { ...randomMorphs(set, 'face', 0.55), ...randomMorphs(set, 'body', 0.45) };
    this.look.hair = pick(HAIR_STYLES);
    this.look.hairColor = pick(HAIR_COLORS)[1];
    this.look.eyes = pick(EYE_COLORS)[1];
    this.look.tunic = pick(CLOTH_COLORS)[1];
    this.look.trouser = pick(CLOTH_COLORS)[1];
    const [lo, hi] = heightRange(this.look.race, this.look.sex);
    this.look.height = +(lo + Math.random() * (hi - lo)).toFixed(2);
    this.look.name = randomName(this.look.sex);
    this.nameInput.value = this.look.name;
    this.renderSheet();
    this.rebuild();
  }

  /** Back to the race's stock body; the name stays. */
  private reset(): void {
    applyRace(this.look, this.look.race, this.look.sex);
    this.look.morphs = {};
    this.look.tunic = 0x3f7a4a;
    this.look.trouser = 0x4a4858;
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
    const row = el('div', 'creator-row');
    row.append(el('span', 'lbl', 'Style'));
    const choices = el('div', 'creator-choices');
    for (const h of HAIR_STYLES) {
      const b = button(HAIR_LABELS[h], 'creator-hair', () => {
        this.look.hair = h;
        for (const other of choices.children) other.classList.toggle('active', other === b);
        this.rebuild();
      });
      b.dataset.hair = h;
      b.classList.toggle('active', h === this.look.hair);
      choices.append(b);
    }
    row.append(choices);
    this.sheet.append(row);
    this.swatches(this.sheet, 'Colour', HAIR_COLORS, () => this.look.hairColor, (v) => (this.look.hairColor = v));
  }

  private styleSheet(): void {
    this.sheet.append(el('div', 'creator-label', 'Clothes'));
    this.swatches(this.sheet, 'Tunic', CLOTH_COLORS, () => this.look.tunic, (v) => (this.look.tunic = v));
    this.swatches(this.sheet, 'Trousers', CLOTH_COLORS, () => this.look.trouser, (v) => (this.look.trouser = v));
    this.sheet.append(el('p', 'creator-note', 'What you wear into the world; armour goes over it.'));
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

  /** Named colours as round swatches, and a picker for any other. */
  private swatches(parent: HTMLElement, label: string, list: ReadonlyArray<readonly [string, number]>, get: () => number, set: (v: number) => void): void {
    const row = el('div', 'creator-row');
    row.append(el('span', 'lbl', label));
    const wrap = el('div', 'creator-swatches');
    const picker = el('input');
    picker.type = 'color';
    picker.value = hex(get());
    picker.title = 'Any colour';
    const paint = (): void => {
      for (const b of wrap.querySelectorAll<HTMLButtonElement>('.creator-swatch')) {
        b.classList.toggle('active', parseInt(b.dataset.colour ?? '', 16) === get());
      }
      picker.value = hex(get());
    };
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
