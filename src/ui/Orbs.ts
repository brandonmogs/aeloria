/**
 * The status orbs beside the minimap, OSRS-style: a hitpoints orb that drains
 * vertically and glows red when low, and a run-toggle orb. The run orb is a
 * click toggle; movement commands read its state via {@link runEnabled}.
 */
export class Orbs {
  private readonly root = document.createElement('div');
  private readonly hpCanvas = document.createElement('canvas');
  private readonly hpText = document.createElement('div');
  private readonly runBtn = document.createElement('div');
  private lastHp = -1;
  private lastMax = -1;

  runEnabled = false;

  constructor() {
    this.root.id = 'orbs';

    const hpWrap = document.createElement('div');
    hpWrap.className = 'orb';
    hpWrap.title = 'Hitpoints';
    this.hpCanvas.width = 52;
    this.hpCanvas.height = 52;
    this.hpText.className = 'orb-num';
    hpWrap.append(this.hpCanvas, this.hpText);

    this.runBtn.className = 'orb orb-run';
    this.runBtn.title = 'Toggle run';
    this.runBtn.textContent = '🚶';
    this.runBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.runEnabled = !this.runEnabled;
      this.runBtn.textContent = this.runEnabled ? '🏃' : '🚶';
      this.runBtn.classList.toggle('orb-on', this.runEnabled);
    });

    this.root.append(hpWrap, this.runBtn);
    document.body.appendChild(this.root);
  }

  /** Repaint the HP orb if the values changed. Call once per frame. */
  update(hp: number, maxHp: number): void {
    if (hp === this.lastHp && maxHp === this.lastMax) return;
    this.lastHp = hp;
    this.lastMax = maxHp;

    const frac = maxHp > 0 ? hp / maxHp : 0;
    const ctx = this.hpCanvas.getContext('2d')!;
    const w = 52;
    const r = 24;
    ctx.clearRect(0, 0, w, w);

    // Backplate.
    ctx.beginPath();
    ctx.arc(26, 26, r, 0, Math.PI * 2);
    ctx.fillStyle = '#2a1214';
    ctx.fill();

    // Vertical fill clipped to the circle: red, going grey as it empties.
    ctx.save();
    ctx.beginPath();
    ctx.arc(26, 26, r - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = frac > 0.25 ? '#a03434' : '#c02a2a';
    const h = (r * 2 - 4) * frac;
    ctx.fillRect(0, 26 + (r - 2) - h, w, h);
    ctx.restore();

    // Rim.
    ctx.beginPath();
    ctx.arc(26, 26, r, 0, Math.PI * 2);
    ctx.strokeStyle = '#0e0c08';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    this.hpText.textContent = String(hp);
    this.hpText.style.color = frac > 0.5 ? '#8df08b' : frac > 0.25 ? '#f2d06b' : '#ff6b5e';
  }
}
