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
 * Fixed-timestep game loop. The simulation advances in discrete, deterministic
 * 600ms ticks regardless of framerate; rendering happens every animation frame
 * with an interpolation factor so motion stays smooth between ticks. This is
 * the only place wall-clock time touches the game — the simulation itself never
 * sees real time, which is what keeps it deterministic and server-portable.
 */
export class GameLoop {
  private accumulator = 0;
  private lastTime = 0;
  private running = false;
  private frame = 0;

  constructor(private readonly callbacks: GameLoopCallbacks) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.frame = requestAnimationFrame(this.loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frame);
  }

  private loop = (now: number): void => {
    if (!this.running) return;
    this.frame = requestAnimationFrame(this.loop);

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
