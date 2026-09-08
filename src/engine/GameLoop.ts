import { TICK_MS } from './constants';

export interface GameLoopCallbacks {
  /** Advance the simulation by exactly one 600ms tick. */
  onTick: () => void;
  /**
   * Draw a frame. `alpha` is the interpolation factor in [0, 1) between the
   * previous and current tick — use it to smooth motion. `dt` is the frame
   * delta in seconds, for framerate-independent visual effects.
   */
  onRender: (alpha: number, dt: number) => void;
}

/**
 * OSRS draws at 50 frames per second, and so do we. Besides being authentic,
 * the cap is what keeps the GPU from being pinned at 100% on a high-refresh
 * monitor: an uncapped requestAnimationFrame loop would happily re-render the
 * whole world 144+ times a second for no visible benefit.
 */
export const MAX_FPS = 50;
const MIN_FRAME_MS = 1000 / MAX_FPS - 0.5; // a hair under, so 60Hz→50 doesn't alias to 30

/**
 * Fixed-timestep game loop. The simulation advances in discrete, deterministic
 * 600ms ticks regardless of framerate; rendering happens on animation frames
 * (capped at {@link MAX_FPS}) with an interpolation factor so motion stays
 * smooth between ticks. This is the only place wall-clock time touches the
 * game — the simulation itself never sees real time, which is what keeps it
 * deterministic and server-portable.
 */
export class GameLoop {
  private accumulator = 0;
  private lastTime = 0;
  private lastRender = 0;
  private running = false;
  private frame = 0;

  constructor(private readonly callbacks: GameLoopCallbacks) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.lastRender = this.lastTime - MIN_FRAME_MS;
    this.frame = requestAnimationFrame(this.loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frame);
  }

  private loop = (now: number): void => {
    if (!this.running) return;
    this.frame = requestAnimationFrame(this.loop);

    // Frame cap: skip this animation frame entirely; the time it covered is
    // folded into the next frame's delta, so tick timing is unaffected.
    if (now - this.lastRender < MIN_FRAME_MS) return;
    this.lastRender = now;

    let delta = now - this.lastTime;
    this.lastTime = now;
    // Clamp huge gaps (e.g. a backgrounded tab) to avoid a tick spiral.
    if (delta > 1000) delta = 1000;
    this.accumulator += delta;

    while (this.accumulator >= TICK_MS) {
      this.callbacks.onTick();
      this.accumulator -= TICK_MS;
    }

    const alpha = this.accumulator / TICK_MS;
    this.callbacks.onRender(alpha, delta / 1000);
  };
}
