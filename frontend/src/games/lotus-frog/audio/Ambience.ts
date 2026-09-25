// The pond's soundscape — no music, only ambience, all synthesised at runtime so
// there are still zero assets and zero dependencies. A continuous bed (water
// lapping, night wind, crickets, distant frogs) runs on its own, and a few event
// sounds (a splash, a croak, the soft gulp of a catch) are triggered by the
// Scene. Everything is quiet and low-passed so it sits under the visuals like
// real night air.
//
// Browsers block audio until a user gesture, so `installUnlock` starts the
// context on the first click/key/touch. Every call is wrapped so audio can never
// break the render loop; if Web Audio is missing it all no-ops.

type Ctx = AudioContext;

export class Ambience {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private started = false;
  private muted = false;
  private unlockBound = false;
  private timers: number[] = [];

  /** Listen for the first user gesture, then boot the audio graph. */
  installUnlock(): void {
    if (this.unlockBound || typeof window === "undefined") return;
    this.unlockBound = true;
    const go = (): void => {
      this.resume();
      window.removeEventListener("pointerdown", go);
      window.removeEventListener("keydown", go);
      window.removeEventListener("touchstart", go);
    };
    window.addEventListener("pointerdown", go);
    window.addEventListener("keydown", go);
    window.addEventListener("touchstart", go);
    // Press "m" any time to mute/unmute.
    window.addEventListener("keydown", (e) => {
      if (e.key === "m" || e.key === "M") this.toggleMute();
    });
  }

  toggleMute(): void {
    this.setMuted(!this.muted);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.05);
    }
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Pause all sound (the player has left the pond). resume() brings it back. */
  suspend(): void {
    try {
      if (this.ctx && this.ctx.state === "running") void this.ctx.suspend();
    } catch {
      /* never throw from audio */
    }
  }

  /** Create the context + ambient bed (idempotent). Safe to call repeatedly. */
  resume(): void {
    try {
      if (!this.ctx) {
        const AC: typeof AudioContext | undefined =
          window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.9;
        this.master.connect(this.ctx.destination);
        this.noise = this.makeNoise(this.ctx);
      }
      if (this.ctx.state === "suspended") void this.ctx.resume();
      if (!this.started) {
        this.started = true;
        this.startBed();
      }
    } catch {
      /* audio is a nicety; never let it throw into the game loop */
    }
  }

  // ── Ambient bed ──────────────────────────────────────────────────────────

  private startBed(): void {
    const ctx = this.ctx!;
    const master = this.master!;

    // Water: low-passed noise, gently breathing.
    const water = ctx.createBufferSource();
    water.buffer = this.noise;
    water.loop = true;
    const waterLp = ctx.createBiquadFilter();
    waterLp.type = "lowpass";
    waterLp.frequency.value = 480;
    const waterGain = ctx.createGain();
    waterGain.gain.value = 0.16;
    water.connect(waterLp).connect(waterGain).connect(master);
    this.lfo(0.09, 120, waterLp.frequency); // slow lapping on the cutoff
    this.lfo(0.06, 0.05, waterGain.gain);
    water.start();

    // Wind: band-passed noise with a slower swell.
    const wind = ctx.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;
    const windBp = ctx.createBiquadFilter();
    windBp.type = "bandpass";
    windBp.frequency.value = 620;
    windBp.Q.value = 0.7;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.05;
    wind.connect(windBp).connect(windGain).connect(master);
    this.lfo(0.04, 0.045, windGain.gain);
    this.lfo(0.03, 180, windBp.frequency);
    wind.start();

    // Living layers on their own gentle timers.
    this.scheduleCrickets();
    this.scheduleFrogs();
  }

  private scheduleCrickets(): void {
    const tick = (): void => {
      if (!this.ctx) return;
      if (!this.muted) this.cricketTrill();
      this.after(this.rand(1.8, 5), tick);
    };
    this.after(this.rand(0.5, 2), tick);
  }

  private scheduleFrogs(): void {
    const tick = (): void => {
      if (!this.ctx) return;
      if (!this.muted) this.frogCroak(0.06 + Math.random() * 0.04, 150 + Math.random() * 90, true);
      this.after(this.rand(5, 14), tick);
    };
    this.after(this.rand(2, 6), tick);
  }

  // ── Event sounds (called by the Scene) ─────────────────────────────────

  /** A water disturbance. `intensity` 0..1 scales the splash. */
  splash(intensity = 0.6): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted || !this.noise) return;
    try {
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 900;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.setValueAtTime(1600, t);
      bp.frequency.exponentialRampToValueAtTime(500, t + 0.18);
      const g = ctx.createGain();
      const vol = 0.12 + intensity * 0.16;
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.18 + intensity * 0.2);
      src.connect(hp).connect(bp).connect(g).connect(this.master);
      src.start(t);
      src.stop(t + 0.5);
    } catch {
      /* ignore */
    }
  }

  /** The on-screen frog's croak. `big` = the double-click croak. */
  croak(big = false): void {
    this.frogCroak(big ? 0.22 : 0.13, big ? 150 : 190, false);
  }

  /** Soft gulp when the frog eats a bug. */
  eat(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    try {
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(520, t);
      o.frequency.exponentialRampToValueAtTime(180, t + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.11, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0006, t + 0.16);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 0.2);
    } catch {
      /* ignore */
    }
  }

  // ── Primitives ─────────────────────────────────────────────────────────

  private frogCroak(vol: number, freq: number, distant: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    try {
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = freq;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = distant ? 700 : 1100;
      const g = ctx.createGain();
      // Two quick "rib-bit" pulses via a pumped amplitude.
      g.gain.setValueAtTime(0.0001, t);
      const pulses = 2;
      for (let i = 0; i < pulses; i++) {
        const s = t + i * 0.12;
        g.gain.exponentialRampToValueAtTime(vol, s + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0008, s + 0.1);
      }
      // A slight upward chirp per croak.
      o.frequency.setValueAtTime(freq, t);
      o.frequency.linearRampToValueAtTime(freq * 1.12, t + 0.24);
      o.connect(lp).connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 0.3);
    } catch {
      /* ignore */
    }
  }

  private cricketTrill(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    try {
      const base = ctx.currentTime;
      const pan = this.pan(Math.random() * 2 - 1);
      const dest: AudioNode = pan ?? this.master;
      if (pan) pan.connect(this.master);
      const freq = 4200 + Math.random() * 900;
      const pulses = 5 + ((Math.random() * 5) | 0);
      for (let i = 0; i < pulses; i++) {
        const t = base + i * 0.055;
        const o = ctx.createOscillator();
        o.type = "triangle";
        o.frequency.value = freq;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.014, t + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0004, t + 0.03);
        o.connect(g).connect(dest);
        o.start(t);
        o.stop(t + 0.05);
      }
    } catch {
      /* ignore */
    }
  }

  /** A slow oscillator added onto an AudioParam (for breathing filters/gains). */
  private lfo(freq: number, depth: number, param: AudioParam): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = depth;
    osc.connect(g).connect(param);
    osc.start();
  }

  private pan(x: number): StereoPannerNode | null {
    const ctx = this.ctx!;
    if (typeof ctx.createStereoPanner !== "function") return null;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, x));
    return p;
  }

  private makeNoise(ctx: Ctx): AudioBuffer {
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02; // brownish, softer than white
      d[i] = last * 3.5;
    }
    return buf;
  }

  private rand(a: number, b: number): number {
    return a + Math.random() * (b - a);
  }

  private after(seconds: number, fn: () => void): void {
    const id = window.setTimeout(fn, seconds * 1000);
    this.timers.push(id);
  }
}

/** Shared instance — the pond has one soundscape. */
export const ambience = new Ambience();
