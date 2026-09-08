import { TileMap } from '../sim/TileMap';
import { World } from '../sim/World';
import { Npc } from '../sim/Npc';
import { Prop } from '../sim/Scenery';
import { Tile, tile } from '../sim/coords';
import { OrbitCamera } from '../render/OrbitCamera';
import { bakeTerrain } from './WorldMap';

/**
 * The OSRS minimap: a round window on the world, centred on the player and
 * rotated so that the way the camera faces is up. Terrain is baked once
 * (north up) and a rotated, scrolled slice of it is blitted each frame, with
 * yellow dots for NPCs, red for items on the ground, and the player as a
 * white dot at the centre. Clicking walks there: the click is unrotated back
 * into tile space, so "up" on the minimap is always where you're looking.
 */
export class MiniMap {
  /** Pixels per tile in the baked terrain and on screen. */
  private readonly px = 4;
  private readonly size = 184;
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly terrain: HTMLCanvasElement;
  /** The tile the last minimap click resolved to (for diagnostics/tests). */
  lastTarget: Tile | null = null;

  constructor(
    private readonly map: TileMap,
    private readonly world: World,
    private readonly trackedId: number,
    private readonly camera: OrbitCamera,
    props: ReadonlyArray<Prop>,
    onClickTile?: (target: Tile) => void,
    extras: { roads?: ReadonlyArray<ReadonlyArray<Tile>>; stone?: (x: number, y: number) => boolean } = {},
  ) {
    this.canvas.width = this.size;
    this.canvas.height = this.size;
    this.canvas.id = 'minimap';
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.terrain = bakeTerrain(map, props, this.px, extras);

    if (onClickTile) {
      this.canvas.addEventListener('pointerdown', (e) => {
        const target = this.tileAtClick(e.clientX, e.clientY);
        if (target) {
          this.lastTarget = target;
          onClickTile(target);
        }
      });
    }
  }

  /** Redraw. Call once per frame. */
  update(): void {
    const ctx = this.ctx;
    const tracked = this.world.entities.get(this.trackedId);
    const half = this.size / 2;
    ctx.clearRect(0, 0, this.size, this.size);
    if (!tracked) return;

    ctx.save();
    ctx.beginPath();
    ctx.arc(half, half, half - 1, 0, Math.PI * 2);
    ctx.clip();

    // Rotate the world so the camera's heading points up, then scroll it so
    // the player's tile sits at the centre.
    ctx.translate(half, half);
    ctx.rotate(-this.camera.heading);
    const px = this.px;
    const p = tracked.position;
    ctx.drawImage(this.terrain, -(p.x + 0.5) * px, -(this.map.height - 1 - p.y + 0.5) * px);

    for (const ground of this.world.groundItems.values()) {
      this.dot(ground.tile.x - p.x, ground.tile.y - p.y, '#ff3b2f', 2);
    }
    for (const entity of this.world.entities.values()) {
      if (!(entity instanceof Npc) || entity.isDead) continue;
      this.dot(entity.position.x - p.x, entity.position.y - p.y, '#ffd34d', 2.2);
    }
    ctx.restore();

    // The player, always dead centre, always facing "up".
    ctx.beginPath();
    ctx.arc(half, half, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /** A dot at a tile offset from the player, inside the rotated context. */
  private dot(dx: number, dy: number, fill: string, r: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(dx * this.px, -dy * this.px, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  /** Undo the rotation and scroll to find which tile a click landed on. */
  private tileAtClick(clientX: number, clientY: number): Tile | null {
    const tracked = this.world.entities.get(this.trackedId);
    if (!tracked) return null;
    const rect = this.canvas.getBoundingClientRect();
    const ox = ((clientX - rect.left) / rect.width) * this.size - this.size / 2;
    const oy = ((clientY - rect.top) / rect.height) * this.size - this.size / 2;
    const h = this.camera.heading;
    const dx = ox * Math.cos(h) - oy * Math.sin(h);
    const dy = ox * Math.sin(h) + oy * Math.cos(h);
    const x = Math.round(tracked.position.x + dx / this.px);
    const y = Math.round(tracked.position.y - dy / this.px);
    return this.map.inBounds(x, y) ? tile(x, y) : null;
  }
}
