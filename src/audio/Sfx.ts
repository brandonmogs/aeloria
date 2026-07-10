/**
 * All of Aeloria's sound, synthesized in WebAudio — no audio files. Each effect
 * is a tiny recipe of oscillators and filtered noise with sharp envelopes, in
 * the spirit of OSRS's chunky little sound bites.
 *
 * The AudioContext can only start after a user gesture, so construction wires a
 * one-time pointerdown bootstrap; every play call is a no-op until then.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  constructor() {
    const boot = (): void => {
      this.ensure();
      window.removeEventListener('pointerdown', boot);
    };
    window.addEventListener('pointerdown', boot);
  }

  /** Diagnostic: 'uninitialized' until the first gesture, then the ctx state. */
  get state(): string {
    return this.ctx?.state ?? 'uninitialized';
  }

  private ensure(): AudioContext | null {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.35;
        this.master.connect(this.ctx.destination);
      } catch {
        return null; // no audio available; stay silent
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** A meaty low thud — landing a hit. */
  hit(): void {
    this.tone({ freq: 150, to: 55, dur: 0.14, type: 'sine', gain: 0.9 });
    this.noise({ dur: 0.08, freq: 420, q: 0.8, gain: 0.35 });
  }

  /** A dull clack — a blocked (zero) hit. */
  block(): void {
    this.tone({ freq: 290, to: 240, dur: 0.06, type: 'triangle', gain: 0.4 });
    this.noise({ dur: 0.05, freq: 1600, q: 1.4, gain: 0.18 });
  }

  /** Axe biting wood. */
  chop(): void {
    this.noise({ dur: 0.07, freq: 750, q: 1.1, gain: 0.5 });
    this.tone({ freq: 170, to: 120, dur: 0.07, type: 'square', gain: 0.16 });
  }

  /** Pick ringing off stone. */
  mine(): void {
    this.tone({ freq: 1250, to: 1100, dur: 0.05, type: 'triangle', gain: 0.32 });
    this.noise({ dur: 0.05, freq: 3400, q: 1.6, gain: 0.2 });
  }

  /** A soft pop — scooping an item off the ground. */
  pickup(): void {
    this.tone({ freq: 660, to: 1020, dur: 0.09, type: 'sine', gain: 0.4 });
  }

  /** Two quick gulps — eating. */
  eat(): void {
    this.tone({ freq: 340, to: 210, dur: 0.09, type: 'sine', gain: 0.4 });
    this.tone({ freq: 300, to: 180, dur: 0.1, type: 'sine', gain: 0.35, delay: 0.12 });
  }

  /** A little rising fanfare for a level-up. */
  levelUp(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      this.tone({ freq, dur: 0.22, type: 'triangle', gain: 0.35, delay: i * 0.09 });
      this.tone({ freq: freq / 2, dur: 0.22, type: 'sine', gain: 0.2, delay: i * 0.09 });
    });
  }

  /** A sagging groan for a death. */
  death(): void {
    this.tone({ freq: 200, to: 70, dur: 0.4, type: 'sawtooth', gain: 0.3 });
  }

  private tone(o: {
    freq: number;
    to?: number;
    dur: number;
    type: OscillatorType;
    gain: number;
    delay?: number;
  }): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type;
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t0 + o.dur);

    const g = ctx.createGain();
    g.gain.setValueAtTime(o.gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + o.dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.02);
  }

  private noise(o: { dur: number; freq: number; q: number; gain: number; delay?: number }): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + (o.delay ?? 0);

    const len = Math.max(1, Math.floor(ctx.sampleRate * o.dur));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = o.freq;
    filter.Q.value = o.q;

    const g = ctx.createGain();
    g.gain.setValueAtTime(o.gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + o.dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t0);
  }
}
