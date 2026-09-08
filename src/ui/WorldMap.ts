import { TileMap } from '../sim/TileMap';
import { World } from '../sim/World';
import { Npc } from '../sim/Npc';
import { Prop } from '../sim/Scenery';
import { Tile } from '../sim/coords';

/** A named place drawn on the world map. */
export interface MapLabel {
  readonly text: string;
  readonly tile: Tile;
}

/** The colours the minimap and world map share for terrain. */
export const MAP_COLORS: Record<string, string> = {
  ground: '#4c6b3a',
  road: '#8c7551',
  blocked: '#5b5f67',
  tree: '#2f5a2c',
  oak: '#264a24',
  rock: '#8b909a',
  'castle-wall': '#c3bcad',
  'castle-tower': '#cfc8b8',
  'castle-gate': '#a89a82',
  'castle-keep': '#d4ccba',
  'bank-booth': '#c79c4e',
  altar: '#efe6c8',
  water: '#3b6a9c',
  stone: '#8f8c82',
};

/**
 * Bake the static map to a canvas at `px` pixels per tile, north up. Shared by
 * the minimap (which scrolls and rotates a window of it) and the world map.
 */
export function bakeTerrain(
  map: TileMap,
  props: ReadonlyArray<Prop>,
  px: number,
  extras: { roads?: ReadonlyArray<ReadonlyArray<Tile>>; stone?: (x: number, y: number) => boolean } = {},
): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = map.width * px;
  c.height = map.height * px;
  const ctx = c.getContext('2d')!;
  const flipY = (y: number) => map.height - 1 - y;

  ctx.fillStyle = MAP_COLORS.ground;
  ctx.fillRect(0, 0, c.width, c.height);

  // Roads: thick strokes along the path polylines.
  if (extras.roads) {
    ctx.strokeStyle = MAP_COLORS.road;
    ctx.lineWidth = px * 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const road of extras.roads) {
      ctx.beginPath();
      road.forEach((t, i) => {
        const x = (t.x + 0.5) * px;
        const y = (flipY(t.y) + 0.5) * px;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  }

  if (extras.stone) {
    ctx.fillStyle = MAP_COLORS.stone;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (extras.stone(x, y)) ctx.fillRect(x * px, flipY(y) * px, px, px);
      }
    }
  }

  // Generic blocked tiles first (covers the keep footprint), props on top.
  ctx.fillStyle = MAP_COLORS.blocked;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (map.isBlocked(x, y)) ctx.fillRect(x * px, flipY(y) * px, px, px);
    }
  }
  for (const prop of props) {
    const kind = prop.kind === 'tree' && prop.seed < 0.14 ? 'oak' : prop.kind;
    ctx.fillStyle = MAP_COLORS[kind] ?? MAP_COLORS.blocked;
    ctx.fillRect(prop.tile.x * px, flipY(prop.tile.y) * px, px, px);
  }
  return c;
}

/**
 * The world map: the whole region drawn large with place names, a key, and
 * the player's position, in a window over the game. Opened from the globe
 * button under the minimap; closed with its X or Escape. Like OSRS, it is
 * for looking, not walking.
 */
export class WorldMap {
  private readonly root = document.createElement('div');
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly terrain: HTMLCanvasElement;
  private readonly px = 9;

  constructor(
    private readonly map: TileMap,
    private readonly world: World,
    private readonly trackedId: number,
    props: ReadonlyArray<Prop>,
    private readonly labels: ReadonlyArray<MapLabel>,
    extras: { roads?: ReadonlyArray<ReadonlyArray<Tile>>; stone?: (x: number, y: number) => boolean } = {},
  ) {
    this.terrain = bakeTerrain(map, props, this.px, extras);
    this.canvas.width = this.terrain.width;
    this.canvas.height = this.terrain.height;
    this.canvas.className = 'world-map-canvas';
    this.ctx = this.canvas.getContext('2d')!;

    this.root.id = 'world-map';
    this.root.hidden = true;

    const frame = document.createElement('div');
    frame.className = 'world-map-frame';
    const header = document.createElement('div');
    header.className = 'world-map-header';
    const title = document.createElement('div');
    title.className = 'world-map-title';
    title.textContent = 'World Map — Aeloria';
    const close = document.createElement('button');
    close.className = 'guide-close';
    close.textContent = '✕';
    close.title = 'Close';
    close.addEventListener('click', () => this.close());
    header.append(title, close);

    const body = document.createElement('div');
    body.className = 'world-map-body';
    body.appendChild(this.canvas);
    body.appendChild(this.buildKey());

    frame.append(header, body);
    this.root.appendChild(frame);
    document.body.appendChild(this.root);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.root.hidden) this.close();
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    this.root.hidden = false;
    this.draw();
  }

  close(): void {
    this.root.hidden = true;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  /** Redraw the live layer while open. Cheap; call once per frame. */
  update(): void {
    if (!this.root.hidden) this.draw();
  }

  private draw(): void {
    const ctx = this.ctx;
    const px = this.px;
    ctx.drawImage(this.terrain, 0, 0);

    // NPCs as small yellow dots, like the minimap.
    for (const entity of this.world.entities.values()) {
      if (!(entity instanceof Npc) || entity.isDead) continue;
      const [x, y] = this.toCanvas(entity.position);
      ctx.fillStyle = '#ffd34d';
      ctx.beginPath();
      ctx.arc(x, y, px * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Place names with the OSRS look: white with a dark outline.
    ctx.font = `700 ${px * 1.6}px "Trebuchet MS", Verdana, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.fillStyle = '#ffffff';
    for (const label of this.labels) {
      const [x, y] = this.toCanvas(label.tile);
      ctx.strokeText(label.text, x, y);
      ctx.fillText(label.text, x, y);
    }

    const tracked = this.world.entities.get(this.trackedId);
    if (tracked) {
      const [x, y] = this.toCanvas(tracked.position);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, px * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.font = `700 ${px * 1.3}px "Trebuchet MS", Verdana, sans-serif`;
      ctx.strokeText('You are here', x, y - px * 1.4);
      ctx.fillText('You are here', x, y - px * 1.4);
    }
  }

  private toCanvas(t: Tile): [number, number] {
    return [(t.x + 0.5) * this.px, (this.map.height - 1 - t.y + 0.5) * this.px];
  }

  private buildKey(): HTMLElement {
    const key = document.createElement('div');
    key.className = 'world-map-key';
    const rows: ReadonlyArray<readonly [string, string]> = [
      ['#ffffff', 'You'],
      ['#ffd34d', 'NPC'],
      [MAP_COLORS.water, 'Water'],
      [MAP_COLORS.road, 'Road'],
      [MAP_COLORS.tree, 'Trees'],
      [MAP_COLORS.rock, 'Mining rocks'],
      [MAP_COLORS['castle-wall'], 'Castle'],
      [MAP_COLORS['bank-booth'], 'Bank'],
      [MAP_COLORS.altar, 'Altar'],
    ];
    const title = document.createElement('div');
    title.className = 'world-map-key-title';
    title.textContent = 'Key';
    key.appendChild(title);
    for (const [color, text] of rows) {
      const row = document.createElement('div');
      row.className = 'world-map-key-row';
      const swatch = document.createElement('span');
      swatch.className = 'world-map-swatch';
      swatch.style.background = color;
      const label = document.createElement('span');
      label.textContent = text;
      row.append(swatch, label);
      key.appendChild(row);
    }
    return key;
  }
}
