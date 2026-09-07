/**
 * Aeloria's background music: a gentle, original medieval-flavoured loop in
 * the spirit of the old RuneScape MIDI tracks, synthesized live in WebAudio —
 * no audio files, and no borrowed melodies. A soft triangle lead carries a
 * dorian tune over a slow sine drone; everything runs through a lowpass so it
 * sits behind the game's chunky effects.
 *
 * Autoplay rules mean the context can only start after a user gesture, so the
 * first pointerdown boots it. `M` toggles it (the toggle is wired in main).
 */
export class Music {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private nextLoopTimer: number | null = null;
  private enabled = true;

  constructor() {
    const boot = (): void => {
      this.start();
      window.removeEventListener('pointerdown', boot);
    };
    window.addEventListener('pointerdown', boot);
  }

  /** Flip the music on/off. Returns the new state. */
  toggle(): boolean {
    this.enabled = !this.enabled;
    if (!this.enabled) {
      this.stop();
    } else {
      this.start();
    }
    return this.enabled;
  }

  private start(): void {
    if (!this.enabled) return;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return; // no audio available; stay silent
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (this.master) return; // already playing

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.11;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2200;
    this.master.connect(filter).connect(this.ctx.destination);

    this.scheduleLoop(this.ctx.currentTime + 0.1);
  }

  private stop(): void {
    if (this.nextLoopTimer !== null) window.clearTimeout(this.nextLoopTimer);
    this.nextLoopTimer = null;
    this.master?.disconnect();
    this.master = null;
  }

  /** Queue one pass of the tune, then re-arm just before it ends. */
  private scheduleLoop(t0: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;

    const BEAT = 0.42;
    // The lead, as [semitone offset from D4, beats] (null = rest). D dorian.
    const D4 = 293.66;
    const melody: ReadonlyArray<readonly [number | null, number]> = [
      [0, 2], [3, 1], [5, 1], [7, 2], [5, 1], [3, 1],
      [0, 2], [-2, 1], [0, 2.5], [null, 1.5],
      [7, 2], [10, 1], [12, 1], [10, 2], [7, 1], [5, 1],
      [7, 2], [3, 1], [5, 1], [0, 2.5], [null, 1.5],
      [3, 2], [5, 1], [7, 1], [10, 2], [7, 1], [5, 1],
      [3, 2], [0, 1], [-2, 1], [0, 3], [null, 1],
    ];
    // A drone note every 4 beats, an octave and a bit below the lead.
    const drone = [0, 0, -4, -4, 3, 3, 0, -2, 0];

    let beat = 0;
    for (const [semis, dur] of melody) {
      if (semis !== null) {
        this.voice(D4 * Math.pow(2, semis / 12), t0 + beat * BEAT, dur * BEAT, 'triangle', 0.5);
      }
      beat += dur;
    }
    const total = beat;
    drone.forEach((semis, i) => {
      this.voice(
        (D4 / 2) * Math.pow(2, semis / 12),
        t0 + i * 4 * BEAT,
        4.2 * BEAT,
        'sine',
        0.4,
      );
    });

    // Re-arm shortly before the loop ends (setTimeout is fine at this precision).
    const loopEnd = t0 + total * BEAT;
    this.nextLoopTimer = window.setTimeout(
      () => this.scheduleLoop(loopEnd),
      Math.max(0, (loopEnd - ctx.currentTime - 0.3) * 1000),
    );
  }

  /** One enveloped note into the master bus. */
  private voice(
    freq: number,
    at: number,
    dur: number,
    type: OscillatorType,
    gain: number,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.05);
    g.gain.setValueAtTime(gain, at + Math.max(0.05, dur - 0.12));
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g).connect(this.master);
    osc.start(at);
    osc.stop(at + dur + 0.05);
  }
}
