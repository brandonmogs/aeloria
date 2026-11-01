import { loadHumanTemplate } from '../../render/human';
import { STYLE_DEFAULTS, characterStyle } from '../../render/characterStyle';
import { itemDef } from '../../sim/items';
import { EquipSlot } from '../../sim/Inventory';
import { CharacterLab } from './CharacterLab';
import {
  ANIMATIONS,
  FRAMINGS,
  HAIR_COLORS,
  HAIR_STYLES,
  LIGHTING_PRESETS,
  LIGHT_LABELS,
  LabConfig,
  OTHER_SLOTS,
  RACES,
  RACE_IDS,
  SET_NAMES,
  SEXES,
  SKIN_TONES,
  STYLE_FEATURES,
  STYLE_LABELS,
  SetName,
  StyleFeature,
  TIERS,
  VISUAL_SLOTS,
  applyRace,
  applySet,
  configFromSearch,
  configToSearch,
  equipItem,
  hex,
  itemsForSlot,
  randomOutfit,
} from './config';

/**
 * The character lab page (/dev/character/): a control panel over the
 * preview stage. The config is the single source of truth; body changes
 * rebuild the figure, view changes apply straight away, and every change
 * is written back to the query string so the look can be shared or
 * screenshotted headlessly. `window.__characterLab` is the test hook.
 */

interface LabHandle {
  lab: CharacterLab;
  cfg: LabConfig;
  /** True once the first figure has been built and drawn. */
  ready: boolean;
  apply(partial: Partial<LabConfig>): void;
}

declare global {
  interface Window {
    __characterLab?: LabHandle;
  }
}

const panel = document.getElementById('panel') as HTMLElement;
const statsEl = document.getElementById('stats') as HTMLElement;
const canvas = document.getElementById('view') as HTMLCanvasElement;

const cfg = configFromSearch(location.search);
if (!cfg.ui) document.body.classList.add('no-ui');

/** Style strengths behind the toggles, so switching one off and on restores its value. */
const strengths: Record<StyleFeature, number> = {
  wrap: STYLE_DEFAULTS.wrap,
  spec: STYLE_DEFAULTS.specBoost,
  rim: STYLE_DEFAULTS.rim,
  glow: STYLE_DEFAULTS.glow,
};
const STYLE_RANGE: Record<StyleFeature, number> = { wrap: 1, spec: 4, rim: 2, glow: 4 };

// --- DOM helpers ---------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function section(title: string): HTMLElement {
  const d = el('details');
  d.open = true;
  d.append(el('summary', '', title));
  panel.append(d);
  return d;
}

function row(parent: HTMLElement, label: string): HTMLElement {
  const r = el('label', 'row');
  r.append(el('span', 'lbl', label));
  parent.append(r);
  return r;
}

function select<T extends string>(
  parent: HTMLElement,
  label: string,
  options: ReadonlyArray<readonly [T, string]>,
  value: T,
  onChange: (v: T) => void,
): HTMLSelectElement {
  const s = el('select');
  for (const [v, text] of options) {
    const o = el('option', '', text);
    o.value = v;
    o.selected = v === value;
    s.append(o);
  }
  s.addEventListener('change', () => onChange(s.value as T));
  row(parent, label).append(s);
  return s;
}

function colour(
  parent: HTMLElement,
  label: string,
  value: number,
  onChange: (v: number) => void,
  presets?: ReadonlyArray<readonly [string, number]>,
): void {
  const r = row(parent, label);
  const input = el('input');
  input.type = 'color';
  input.value = '#' + hex(value);
  input.addEventListener('input', () => onChange(parseInt(input.value.slice(1), 16)));
  r.append(input);
  if (presets) {
    const s = el('select');
    s.append(new Option('preset…', ''));
    for (const [name, c] of presets) s.append(new Option(name, hex(c)));
    s.addEventListener('change', () => {
      if (!s.value) return;
      input.value = '#' + s.value;
      onChange(parseInt(s.value, 16));
    });
    r.append(s);
  }
}

function range(
  parent: HTMLElement,
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  onChange: (v: number) => void,
  format: (v: number) => string = (v) => v.toFixed(2),
): HTMLInputElement {
  const r = row(parent, label);
  const input = el('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  const out = el('span', 'val', format(value));
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    out.textContent = format(v);
    onChange(v);
  });
  r.append(input, out);
  return input;
}

function check(parent: HTMLElement, label: string, value: boolean, onChange: (v: boolean) => void): HTMLElement {
  const r = row(parent, label);
  const input = el('input');
  input.type = 'checkbox';
  input.checked = value;
  input.addEventListener('change', () => onChange(input.checked));
  r.append(input);
  return r;
}

function buttons(parent: HTMLElement, items: ReadonlyArray<readonly [string, () => void]>): void {
  const r = el('div', 'buttons');
  for (const [label, fn] of items) {
    const b = el('button', '', label);
    b.addEventListener('click', fn);
    r.append(b);
  }
  parent.append(r);
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

// --- The page --------------------------------------------------------------------------

async function main(): Promise<void> {
  // The pipeline's GLB template by default; ?chars=legacy shows the old json/bin body.
  await loadHumanTemplate(new URLSearchParams(location.search).get('chars') === 'legacy' ? 'legacy' : 'glb');
  const lab = new CharacterLab(canvas);

  let rebuildTimer = 0;
  /** Frames drawn since the figure was last built; the pose has settled after a dozen. */
  let framesSinceBuild = 0;
  const syncUrl = (): void => history.replaceState(null, '', '?' + configToSearch(cfg));
  const rebuild = (): void => {
    clearTimeout(rebuildTimer);
    lab.setCharacter(cfg);
    framesSinceBuild = 0;
    handle.ready = false;
    syncUrl();
  };
  /** Colour pickers fire continuously; rebuild once the hand settles. */
  const scheduleRebuild = (): void => {
    clearTimeout(rebuildTimer);
    rebuildTimer = window.setTimeout(rebuild, 150);
  };
  const applyStyle = (): void => {
    characterStyle.wrap.value = cfg.style.wrap ? strengths.wrap : 0;
    characterStyle.specBoost.value = cfg.style.spec ? strengths.spec : 0;
    characterStyle.rim.value = cfg.style.rim ? strengths.rim : 0;
    characterStyle.glow.value = cfg.style.glow ? strengths.glow : 0;
    syncUrl();
  };
  const refresh = (): void => {
    const top = panel.scrollTop;
    renderPanel();
    panel.scrollTop = top;
  };

  let setName: SetName = 'plate';
  let setTier = 'bronze';

  function slotSelect(parent: HTMLElement, slot: EquipSlot, note = ''): void {
    const options: Array<readonly [string, string]> = [['', '— none —'], ...itemsForSlot(slot).map((id) => [id, itemDef(id).name] as const)];
    select(parent, cap(slot) + note, options, cfg.equipment[slot]?.id ?? '', (v) => {
      equipItem(cfg.equipment, slot, v || null);
      refresh();
      rebuild();
    });
  }

  function styleRow(parent: HTMLElement, f: StyleFeature): void {
    const r = check(parent, STYLE_LABELS[f], cfg.style[f], (on) => {
      cfg.style[f] = on;
      applyStyle();
    });
    const input = el('input');
    input.type = 'range';
    input.min = '0';
    input.max = String(STYLE_RANGE[f]);
    input.step = '0.05';
    input.value = String(strengths[f]);
    input.title = 'strength';
    input.addEventListener('input', () => {
      strengths[f] = parseFloat(input.value);
      cfg.style[f] = true;
      applyStyle();
      refresh();
    });
    r.append(input);
  }

  function renderPanel(): void {
    panel.replaceChildren();
    panel.append(el('h1', '', 'Character lab'));
    panel.append(el('div', 'sub', 'The figure as the game draws it. Changes are kept in the URL.'));

    const body = section('Body');
    select(
      body,
      'Race',
      RACE_IDS.map((r) => [r, RACES[r].label] as const),
      cfg.race,
      (v) => {
        applyRace(cfg, v, cfg.sex);
        refresh();
        rebuild();
      },
    );
    select(
      body,
      'Sex',
      SEXES.map((s) => [s, cap(s)] as const),
      cfg.sex,
      (v) => {
        applyRace(cfg, cfg.race, v);
        refresh();
        rebuild();
      },
    );
    range(body, 'Height', 1.2, 2.3, 0.01, cfg.height, (v) => {
      cfg.height = v;
      scheduleRebuild();
    }, (v) => v.toFixed(2) + ' m');
    colour(body, 'Skin', cfg.skin, (v) => {
      cfg.skin = v;
      scheduleRebuild();
    }, SKIN_TONES);
    colour(body, 'Eyes', cfg.eyes, (v) => {
      cfg.eyes = v;
      scheduleRebuild();
    });
    select(
      body,
      'Hair',
      HAIR_STYLES.map((h) => [h, cap(h)] as const),
      cfg.hair,
      (v) => {
        cfg.hair = v;
        rebuild();
      },
    );
    colour(body, 'Hair colour', cfg.hairColor, (v) => {
      cfg.hairColor = v;
      scheduleRebuild();
    }, HAIR_COLORS);
    colour(body, 'Tunic', cfg.tunic, (v) => {
      cfg.tunic = v;
      scheduleRebuild();
    });
    colour(body, 'Trousers', cfg.trouser, (v) => {
      cfg.trouser = v;
      scheduleRebuild();
    });

    const gear = section('Equipment');
    for (const slot of VISUAL_SLOTS) slotSelect(gear, slot);
    for (const slot of OTHER_SLOTS) slotSelect(gear, slot, ' (no visual)');
    const setRow = row(gear, 'Set');
    const names = el('select');
    for (const n of SET_NAMES) names.append(new Option(cap(n), n, false, n === setName));
    names.addEventListener('change', () => (setName = names.value as SetName));
    const tiers = el('select');
    for (const t of TIERS) tiers.append(new Option(cap(t), t, false, t === setTier));
    tiers.addEventListener('change', () => (setTier = tiers.value));
    setRow.append(names, tiers);
    buttons(gear, [
      [
        'Apply set',
        () => {
          applySet(cfg.equipment, setName, setTier);
          refresh();
          rebuild();
        },
      ],
      [
        'Random outfit',
        () => {
          randomOutfit(cfg.equipment);
          refresh();
          rebuild();
        },
      ],
      [
        'Strip',
        () => {
          applySet(cfg.equipment, 'none', setTier);
          refresh();
          rebuild();
        },
      ],
    ]);

    const anim = section('Animation');
    select(
      anim,
      'Clip',
      ANIMATIONS.map((a) => [a, cap(a)] as const),
      cfg.animation,
      (v) => {
        cfg.animation = v;
        lab.setAnimation(v);
        syncUrl();
      },
    );
    buttons(anim, [['Replay', () => lab.replay()]]);

    const view = section('View');
    check(view, 'Turntable', cfg.turntable, (v) => {
      cfg.turntable = v;
      lab.turning = v;
      syncUrl();
    });
    range(view, 'Turn speed', 0, 2, 0.05, lab.turnSpeed, (v) => (lab.turnSpeed = v));
    buttons(
      view,
      FRAMINGS.map(
        (f) =>
          [
            cap(f),
            () => {
              cfg.framing = f;
              lab.frame(f);
              syncUrl();
            },
          ] as const,
      ),
    );
    select(
      view,
      'Lighting',
      LIGHTING_PRESETS.map((l) => [l, LIGHT_LABELS[l]] as const),
      cfg.lighting,
      (v) => {
        cfg.lighting = v;
        lab.setLighting(v);
        syncUrl();
      },
    );

    const style = section('Style (A/B against plain PBR)');
    for (const f of STYLE_FEATURES) styleRow(style, f);
    buttons(style, [
      [
        'Plain PBR',
        () => {
          for (const f of STYLE_FEATURES) cfg.style[f] = false;
          applyStyle();
          refresh();
        },
      ],
      [
        'Styled',
        () => {
          for (const f of STYLE_FEATURES) cfg.style[f] = true;
          applyStyle();
          refresh();
        },
      ],
    ]);
  }

  const handle: LabHandle = {
    lab,
    cfg,
    ready: false,
    apply(partial) {
      Object.assign(cfg, partial);
      refresh();
      lab.setLighting(cfg.lighting);
      lab.turning = cfg.turntable;
      lab.frame(cfg.framing);
      applyStyle();
      rebuild();
      lab.setAnimation(cfg.animation);
    },
  };
  window.__characterLab = handle;

  renderPanel();
  lab.setLighting(cfg.lighting);
  lab.turning = cfg.turntable;
  lab.setAnimation(cfg.animation);
  applyStyle();
  rebuild();
  lab.frame(cfg.framing);

  setInterval(() => {
    const s = lab.stats;
    statsEl.textContent =
      `character  ${s.characterCalls} draw calls · ${s.characterTriangles} tris · ${s.skinnedVertices} skinned verts\n` +
      `frame      ${s.frameMs.toFixed(1)} ms render · ${s.animMs.toFixed(2)} ms animation · ${s.calls} GL calls · ${s.triangles} tris`;
  }, 250);

  // The frame clock starts from the first animation-frame timestamp: a clock
  // sampled before it can read later than that timestamp, and a negative step
  // makes the animator's easing diverge instead of settle.
  let last = -1;
  const loop = (now: number): void => {
    if (last < 0) last = now;
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    lab.update(dt);
    if (lab.hasCharacter && ++framesSinceBuild >= 15) handle.ready = true;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

void main();
