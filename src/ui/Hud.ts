import { World } from '../sim/World';
import { Entity } from '../sim/Entity';

/**
 * A tiny debug overlay: current tick, the tracked entity's tile, whether it's
 * moving, and a smoothed FPS readout. Handy while building out the simulation;
 * it'll be replaced by the real game UI (inventory, stats, chat) down the line.
 */
export class Hud {
  private readonly el = document.getElementById('hud') as HTMLElement;
  private frames = 0;
  private elapsed = 0;
  private fps = 0;

  constructor() {
    // Debug info hides by default now that real UI exists; F3 brings it back.
    this.el.style.display = 'none';
    window.addEventListener('keydown', (e) => {
      if (e.key === 'F3') {
        e.preventDefault();
        this.el.style.display = this.el.style.display === 'none' ? '' : 'none';
      }
    });
  }

  update(world: World, tracked: Entity, dt: number): void {
    this.frames++;
    this.elapsed += dt;
    if (this.elapsed >= 0.5) {
      this.fps = Math.round(this.frames / this.elapsed);
      this.frames = 0;
      this.elapsed = 0;
    }
    if (this.el.style.display === 'none') return;

    this.el.textContent = [
      'AELORIA · vertical slice',
      `tick     ${world.tickCount}`,
      `tile     (${tracked.position.x}, ${tracked.position.y})`,
      `hp       ${tracked.hitpoints}/${tracked.maxHitpoints}`,
      `moving   ${tracked.isMoving ? `yes (${tracked.path.length} left)` : 'no'}`,
      `fps      ${this.fps}`,
    ].join('\n');
  }
}
