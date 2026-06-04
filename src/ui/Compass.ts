import { OrbitCamera } from '../render/OrbitCamera';

/**
 * A classic compass dial in the top-right corner. The cardinal letters stay
 * fixed (north up) and a needle swings to point the way the camera is looking,
 * so a glance tells you which way you're facing. Clicking it snaps the view back
 * to due north — the same affordance RuneScape's compass offers.
 */
export class Compass {
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly r: number;

  constructor(private readonly camera: OrbitCamera) {
    const size = 132; // backing resolution; CSS scales it down for crispness
    this.canvas.width = size;
    this.canvas.height = size;
    this.canvas.id = 'compass';
    this.canvas.title = 'Click to face north';
    this.canvas.addEventListener('click', () => this.camera.faceNorth());
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.r = size / 2;
  }

  /** Redraw with the camera's current heading. Call once per frame. */
  update(): void {
    const ctx = this.ctx;
    const r = this.r;
    ctx.clearRect(0, 0, r * 2, r * 2);

    // Dial face.
    ctx.beginPath();
    ctx.arc(r, r, r - 4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10, 14, 20, 0.72)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(150, 180, 230, 0.4)';
    ctx.stroke();

    // Fixed cardinal letters (north up).
    ctx.font = '600 16px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const letters: ReadonlyArray<[string, number]> = [
      ['N', 0],
      ['E', Math.PI / 2],
      ['S', Math.PI],
      ['W', -Math.PI / 2],
    ];
    for (const [label, a] of letters) {
      const x = r + Math.sin(a) * (r - 18);
      const y = r - Math.cos(a) * (r - 18);
      ctx.fillStyle = label === 'N' ? '#ff6b6b' : '#9fb4d8';
      ctx.fillText(label, x, y);
    }

    this.drawNeedle(this.camera.heading);
  }

  /** A two-tone arrow: red half points where the camera looks, grey is the tail. */
  private drawNeedle(heading: number): void {
    const ctx = this.ctx;
    const r = this.r;
    const len = r - 30;
    const wide = 6;
    // Unit vectors: forward along the heading, perpendicular for the barbs.
    const fx = Math.sin(heading);
    const fy = -Math.cos(heading);
    const px = -fy;
    const py = fx;

    const tip: [number, number] = [r + fx * len, r + fy * len];
    const tail: [number, number] = [r - fx * len, r - fy * len];
    const left: [number, number] = [r + px * wide, r + py * wide];
    const right: [number, number] = [r - px * wide, r - py * wide];

    ctx.beginPath();
    ctx.moveTo(...tip);
    ctx.lineTo(...left);
    ctx.lineTo(...right);
    ctx.closePath();
    ctx.fillStyle = '#ff5a5a';
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(...tail);
    ctx.lineTo(...left);
    ctx.lineTo(...right);
    ctx.closePath();
    ctx.fillStyle = '#c8d2e4';
    ctx.fill();
  }
}
