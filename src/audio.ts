// Procedural sound via the Web Audio API — no asset files. Everything is
// synthesised from oscillators and noise. Lazily created on first user gesture
// (browsers block audio until then).

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private muted = false;

  // continuous voices
  private thrustGain!: GainNode;
  private noiseBuf!: AudioBuffer;
  private laserGain!: GainNode;
  private laserOsc!: OscillatorNode;

  // Call from a user-gesture handler so the context can start.
  resume() {
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume();
  }

  private init() {
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
    } catch {
      this.ctx = null;
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(ctx.destination);

    // shared white-noise buffer
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // continuous engine rumble: looping noise through a lowpass
    const thrustSrc = ctx.createBufferSource();
    thrustSrc.buffer = this.noiseBuf;
    thrustSrc.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 420;
    this.thrustGain = ctx.createGain();
    this.thrustGain.gain.value = 0;
    thrustSrc.connect(lp).connect(this.thrustGain).connect(this.master);
    thrustSrc.start();

    // continuous laser tone (gated by gain)
    this.laserOsc = ctx.createOscillator();
    this.laserOsc.type = "sawtooth";
    this.laserOsc.frequency.value = 170;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 28;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 35;
    lfo.connect(lfoGain).connect(this.laserOsc.frequency);
    this.laserGain = ctx.createGain();
    this.laserGain.gain.value = 0;
    this.laserOsc.connect(this.laserGain).connect(this.master);
    this.laserOsc.start();
    lfo.start();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.35;
    return this.muted;
  }

  // 0..1 engine thrust level (smoothed toward target)
  setThrust(level: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.thrustGain.gain.setTargetAtTime(Math.min(0.25, level * 0.25), t, 0.08);
  }

  setLaser(on: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.laserGain.gain.setTargetAtTime(on ? 0.12 : 0, t, 0.02);
  }

  cannon() {
    this.burst(0.18, 220, "lowpass", 900, 0.5);
    this.tone(110, 0.12, "square", 0.18);
  }

  missile() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(300, ctx.currentTime);
    bp.frequency.exponentialRampToValueAtTime(1800, ctx.currentTime + 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    src.connect(bp).connect(g).connect(this.master);
    src.start();
    src.stop(ctx.currentTime + 0.5);
  }

  explosion(size: number) {
    if (!this.ctx) return;
    const dur = Math.min(1.2, 0.3 + size * 0.25);
    this.burst(dur, 80 + size * 40, "lowpass", 1200, Math.min(0.6, 0.25 + size * 0.12));
  }

  stage() {
    this.tone(70, 0.16, "square", 0.22);
    this.burst(0.12, 200, "highpass", 600, 0.2);
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(freq * 0.5, ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g).connect(this.master);
    o.start();
    o.stop(ctx.currentTime + dur);
  }

  private burst(dur: number, filterFreq: number, filterType: BiquadFilterType, q: number, vol: number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = filterFreq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start();
    src.stop(ctx.currentTime + dur);
  }
}
