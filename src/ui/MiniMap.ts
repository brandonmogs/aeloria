import { TileMap } from '../sim/TileMap';
import { World } from '../sim/World';
import { Entity } from '../sim/Entity';
import { Prop } from '../sim/Scenery';
import { Tile, tile } from '../sim/coords';
import { OrbitCamera } from '../render/OrbitCamera';

/**
 * A top-right "world view": the whole map drawn from above, north-up, with the
 * static terrain baked once and the live actors painted on each frame. The
 * tracked player sits as a bright dot with a wedge showing which way the camera
 * is looking, so the minimap and the on-screen view always agree. Pairs with the
 * {@link Compass}, which shares the same heading.
 */
export class MiniMap {
  private readonly px = 4; // pixels per tile in the baked terrain
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly terrain: HTMLCanvasElement;

  private static readonly COLORS: Record<string, string> = {
    ground: '#45603e',
    blocked: '#5b5f67',
    tree: '#2f5a2c',
    rock: '#8b909a',
    'castle-wall': '#c3bcad',
    'castle-tower': '#cfc8b8',
    'castle-gate': '#a89a82',
    'castle-keep': '#d4ccba',
    water: '#2f6f9e',
  };

  constructor(
    private readonly map: TileMap,
    private readonly world: World,
    private readonly trackedId: number,
    private readonly camera: OrbitCamera,
    props: ReadonlyArray<Prop>,
    onClickTile?: (target: Tile) => void,
  ) {
    const res = map.width * this.px;
    this.canvas.width = res;
    this.canvas.height = res;
    this.canvas.id = 'minimap';
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    this.terrain = this.bakeTerrain(props);

    // Click-to-walk, like OSRS: map the click back to a tile.
    if (onClickTile) {
      this.canvas.addEventListener('pointerdown', (e) => {
        const rect = this.canvas.getBoundingClientRect();
        const cx = ((e.clientX - rect.left) / rect.width) * this.canvas.width;
        const cy = ((e.clientY - rect.top) / rect.height) * this.canvas.height;
        const x = Math.floor(cx / this.px);
        const y = this.flipY(Math.floor(cy / this.px));
        if (this.map.inBounds(x, y)) onClickTile(tile(x, y));
      });
    }
  }

  /** Redraw the live layer (terrain blit + actors). Call once per frame. */
  update(): void {
    const ctx = this.ctx;
    ctx.drawImage(this.terrain, 0, 0);

    for (const entity of this.world.entities.values()) {
      if (entity.id === this.trackedId) continue;
      this.dot(entity, '#ffd34d', 2.5);
    }

    const tracked = this.world.entities.get(this.trackedId);
    if (tracked) {
      this.viewWedge(tracked);
      this.dot(tracked, '#ffffff', 3.5, '#39c5ff');
    }
  }

  /** Bake the static terrain to an offscreen canvas once, north pointing up. */
  private bakeTerrain(props: ReadonlyArray<Prop>): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    const ctx = c.getContext('2d')!;
    const px = this.px;

    ctx.fillStyle = MiniMap.COLORS.ground;
    ctx.fillRect(0, 0, c.width, c.height);

    // Generic blocked tiles first (covers the keep footprint), props on top.
    ctx.fillStyle = MiniMap.COLORS.blocked;
    for (let y = 0; y < this.map.height; y++) {
      for (let x = 0; x < this.map.width; x++) {
        if (this.map.isBlocked(x, y)) ctx.fillRect(x * px, this.flipY(y) * px, px, px);
      }
    }
    for (const prop of props) {
      ctx.fillStyle = MiniMap.COLORS[prop.kind] ?? MiniMap.COLORS.blocked;
      ctx.fillRect(prop.tile.x * px, this.flipY(prop.tile.y) * px, px, px);
    }
    return c;
  }

  /** Tile y is north-positive; canvas y is down, so flip for a north-up view. */
  private flipY(y: number): number {
    return this.map.height - 1 - y;
  }

  /** Centre-of-tile pixel coordinates on the minimap canvas. */
  private toCanvas(x: number, y: number): [number, number] {
    return [(x + 0.5) * this.px, (this.flipY(y) + 0.5) * this.px];
  }

  private dot(entity: Entity, fill: string, r: number, ring?: string): void {
    const [cx, cy] = this.toCanvas(entity.position.x, entity.position.y);
    const ctx = this.ctx;
    if (ring) {
      ctx.beginPath();
      ctx.arc(cx, cy, r + 1.5, 0, Math.PI * 2);
      ctx.fillStyle = ring;
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  /** A translucent cone from the player showing the camera's facing direction. */
  private viewWedge(player: Entity): void {
    const [cx, cy] = this.toCanvas(player.position.x, player.position.y);
    const h = this.camera.heading;
    const spread = 0.5; // ~28° half-angle
    const len = this.px * 6;
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    for (const a of [h - spread, h + spread]) {
      ctx.lineTo(cx + Math.sin(a) * len, cy - Math.cos(a) * len);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.fill();
  }
}
