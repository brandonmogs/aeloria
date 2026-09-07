import { MAX_RUN_ENERGY, Player } from '../sim/Player';

/**
 * The status orbs beside the minimap, OSRS-style: a hitpoints orb that drains
 * vertically and glows red when low, a prayer orb that empties as points are
 * spent, and a run orb showing remaining run energy as a percentage. The run
 * orb is a click toggle; the sim owns the actual state (it un-toggles itself
 * at zero energy), so the orb just reports clicks upward and repaints from the
 * player each frame.
 */
export class Orbs {
  private readonly root = document.createElement('div');
  private readonly hpCanvas = document.createElement('canvas');
  private readonly hpText = document.createElement('div');
  private readonly prayerCanvas = document.createElement('canvas');
  private readonly prayerText = document.createElement('div');
  private readonly runBtn = document.createElement('div');
  private readonly runIcon = document.createElement('span');
  private readonly runText = document.createElement('div');
  private lastHp = -1;
  private lastPrayer = -1;
  private lastEnergy = -1;
  private lastRunning: boolean | null = null;

  constructor(onToggleRun: (on: boolean) => void) {
    this.root.id = 'orbs';

    const hpWrap = document.createElement('div');
    hpWrap.className = 'orb';
    hpWrap.title = 'Hitpoints';
    this.hpCanvas.width = 52;
    this.hpCanvas.height = 52;
    this.hpText.className = 'orb-num';
    hpWrap.append(this.hpCanvas, this.hpText);

    const prayerWrap = document.createElement('div');
    prayerWrap.className = 'orb';
    prayerWrap.title = 'Prayer points';
    this.prayerCanvas.width = 52;
    this.prayerCanvas.height = 52;
    this.prayerText.className = 'orb-num';
    prayerWrap.append(this.prayerCanvas, this.prayerText);

    this.runBtn.className = 'orb orb-run';
    this.runBtn.title = 'Toggle run';
    this.runIcon.textContent = '🚶';
    this.runText.className = 'orb-run-num';
    this.runBtn.append(this.runIcon, this.runText);
    this.runBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      onToggleRun(this.lastRunning !== true);
    });

    this.root.append(hpWrap, prayerWrap, this.runBtn);
    document.body.appendChild(this.root);
  }

  /** Repaint any orb whose value changed. Call once per frame. */
  update(player: Player): void {
    if (player.hitpoints !== this.lastHp) {
      this.lastHp = player.hitpoints;
      const frac = player.maxHitpoints > 0 ? player.hitpoints / player.maxHitpoints : 0;
      drawOrb(this.hpCanvas, frac, '#2a1214', frac > 0.25 ? '#a03434' : '#c02a2a');
      this.hpText.textContent = String(player.hitpoints);
      this.hpText.style.color = frac > 0.5 ? '#8df08b' : frac > 0.25 ? '#f2d06b' : '#ff6b5e';
    }

    if (player.prayerPoints !== this.lastPrayer) {
      this.lastPrayer = player.prayerPoints;
      const max = Math.max(1, player.maxPrayerPoints);
      const frac = player.prayerPoints / max;
      drawOrb(this.prayerCanvas, frac, '#101c22', '#3f8fa8');
      this.prayerText.textContent = String(player.prayerPoints);
      this.prayerText.style.color = frac > 0.25 ? '#9fd8e8' : '#ff6b5e';
    }

    const pct = Math.floor((player.energy / MAX_RUN_ENERGY) * 100);
    if (pct !== this.lastEnergy) {
      this.lastEnergy = pct;
      this.runText.textContent = `${pct}%`;
    }
    if (player.running !== this.lastRunning) {
      this.lastRunning = player.running;
      this.runIcon.textContent = player.running ? '🏃' : '🚶';
      this.runBtn.classList.toggle('orb-on', player.running);
    }
  }
}

/** A rimmed orb with a vertical fill clipped to the circle. */
function drawOrb(canvas: HTMLCanvasElement, frac: number, back: string, fill: string): void {
  const ctx = canvas.getContext('2d')!;
  const w = 52;
  const r = 24;
  ctx.clearRect(0, 0, w, w);

  ctx.beginPath();
  ctx.arc(26, 26, r, 0, Math.PI * 2);
  ctx.fillStyle = back;
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(26, 26, r - 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = fill;
  const h = (r * 2 - 4) * Math.max(0, Math.min(1, frac));
  ctx.fillRect(0, 26 + (r - 2) - h, w, h);
  ctx.restore();

  ctx.beginPath();
  ctx.arc(26, 26, r, 0, Math.PI * 2);
  ctx.strokeStyle = '#0e0c08';
  ctx.lineWidth = 2.5;
  ctx.stroke();
}
