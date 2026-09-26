/**
 * MOON GRAVITY — procedural generative music, plus the small shared DSP helpers
 * (envelopes, noise buffers, impulse responses) that Audio.ts also uses.
 *
 * Everything is scheduled slightly ahead on the AudioContext clock by the engine's
 * lookahead tick (MusicPlayer.schedule(until)), so timing is sample-accurate and the
 * JS side only wakes up every ~40 ms.
 */

// ============================================================================
// Shared DSP helpers
// ============================================================================

export type Ramp = 'l' | 's';
/** Envelope point: [time offset (s), value, ramp into this point: 'l' linear, 's' step, default exponential]. */
export type Pt = readonly [number, number, Ramp?];
export type Env = readonly Pt[];
/** A constant or an envelope. */
export type FEnv = number | Env;
export type NoiseKind = 'white' | 'pink' | 'brown' | 'crackle';
export type NoiseBank = Record<NoiseKind, AudioBuffer>;

const EPS = 1e-4;
const safe = (v: number): number => (Math.abs(v) < EPS ? (v < 0 ? -EPS : EPS) : v);

/**
 * Write an envelope onto an AudioParam. Times are relative to t0 and multiplied by ts,
 * values are multiplied by scale. Returns the last (unscaled) time offset.
 */
export function applyEnv(param: AudioParam, e: FEnv, t0: number, ts = 1, scale = 1): number {
  if (typeof e === 'number') {
    param.setValueAtTime(e * scale, t0);
    return 0;
  }
  let last = 0;
  for (let i = 0; i < e.length; i++) {
    const [dt, v0, mode] = e[i];
    const t = t0 + dt * ts;
    const v = v0 * scale;
    if (i === 0 || mode === 's') param.setValueAtTime(safe(v), t);
    else if (mode === 'l') param.linearRampToValueAtTime(v, t);
    else param.exponentialRampToValueAtTime(safe(v), t);
    if (dt > last) last = dt;
  }
  return last;
}

/** Pre-generate looping mono noise buffers (white / pink / brown / crackle). */
export function makeNoiseBank(ctx: BaseAudioContext, seconds = 2): NoiseBank {
  const sr = ctx.sampleRate;
  const n = Math.max(2, Math.floor(sr * seconds));
  const make = (fill: (d: Float32Array) => void, deseam: boolean): AudioBuffer => {
    const b = ctx.createBuffer(1, n, sr);
    const d = b.getChannelData(0);
    fill(d);
    if (deseam) {
      // remove DC + the loop-seam jump of correlated noise
      let mean = 0;
      for (let i = 0; i < n; i++) mean += d[i];
      mean /= n;
      const jump = d[n - 1] - d[0];
      for (let i = 0; i < n; i++) d[i] -= mean + jump * (i / (n - 1) - 0.5);
    }
    let peak = 1e-9;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
    const k = 0.9 / peak;
    for (let i = 0; i < n; i++) d[i] *= k;
    return b;
  };
  const white = make((d) => {
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }, false);
  const pink = make((d) => {
    // Paul Kellet's refined pink filter
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    }
  }, true);
  const brown = make((d) => {
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last;
    }
  }, true);
  const crackle = make((d) => {
    // sparse electric crackles / static pops over a faint hiss
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.015;
    let i = 0;
    while (i < d.length) {
      i += 1 + Math.floor(-Math.log(1 - Math.random() * 0.999) * (sr / 90));
      const len = 8 + Math.floor(Math.random() * 70);
      const amp = Math.pow(Math.random(), 2) * (Math.random() < 0.5 ? -1 : 1);
      const tau = len * 0.3;
      for (let k = 0; k < len && i + k < d.length; k++) d[i + k] += amp * Math.exp(-k / tau) * (Math.random() * 2 - 1);
    }
  }, false);
  return { white, pink, brown, crackle };
}

/**
 * Synthesized stereo impulse response: optional discrete early reflections, then a
 * decaying noise tail that darkens over time. `darkness` 0..1.
 */
export function makeImpulse(ctx: BaseAudioContext, seconds: number, darkness: number, pre = 0.01, early = 0): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.max(2, Math.floor(sr * seconds));
  const b = ctx.createBuffer(2, n, sr);
  const tau = seconds / 6.9; // -60 dB at the end
  const p0 = Math.floor(pre * sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let lp = 0;
    for (let i = p0; i < n; i++) {
      const t = (i - p0) / sr;
      const a = Math.min(0.96, darkness * Math.min(1, t / (seconds * 0.45)));
      lp = lp * a + (Math.random() * 2 - 1) * (1 - a);
      d[i] = lp * Math.exp(-t / tau) * (early > 0 ? 0.6 : 1);
    }
    // early reflections (small enclosed space, e.g. a helmet)
    for (let k = 0; k < early; k++) {
      const t = pre + 0.002 + Math.random() * 0.028;
      const idx = Math.floor(t * sr);
      if (idx < n) d[idx] += (Math.random() < 0.5 ? -1 : 1) * (0.9 - k / (early * 1.4));
    }
  }
  return b;
}

// ============================================================================
// Generative music
// ============================================================================

export type MusicKind = 'menu' | 'match' | 'none';

const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

interface Live {
  end: number;
  nodes: AudioNode[];
}

/** Owns the shared music FX (reverb, stereo chorus) and crossfades between tracks. */
export class MusicPlayer {
  readonly ctx: AudioContext;
  readonly noise: NoiseBank;
  /** stereo output → engine music bus */
  readonly out: GainNode;
  /** reverb send */
  readonly verbIn: GainNode;
  /** stereo chorus input (pads) */
  readonly chorusIn: GainNode;
  /** soft "glass" harmonic wave used by plucks/blips */
  readonly glass: PeriodicWave;
  private readonly fx: AudioNode[] = [];
  private readonly fxSrc: AudioScheduledSourceNode[] = [];
  private tracks: Track[] = [];
  private cur: Track | null = null;
  private kind: MusicKind = 'none';

  constructor(ctx: AudioContext, dest: AudioNode, noise: NoiseBank) {
    this.ctx = ctx;
    this.noise = noise;
    this.out = ctx.createGain();
    this.out.connect(dest);

    // long, soft hall
    this.verbIn = ctx.createGain();
    const verb = ctx.createConvolver();
    verb.buffer = makeImpulse(ctx, 3.6, 0.55, 0.025);
    const verbOut = ctx.createGain();
    verbOut.gain.value = 0.75;
    this.verbIn.connect(verb);
    verb.connect(verbOut);
    verbOut.connect(this.out);

    // stereo chorus: dry + two slowly modulated delays panned L/R
    this.chorusIn = ctx.createGain();
    const dry = ctx.createGain();
    dry.gain.value = 0.7;
    this.chorusIn.connect(dry);
    dry.connect(this.out);
    const send = ctx.createGain();
    send.gain.value = 0.55;
    this.chorusIn.connect(send);
    send.connect(this.verbIn);
    this.fx.push(this.verbIn, verb, verbOut, this.chorusIn, dry, send);
    for (const [base, depth, rate, pan] of [[0.013, 0.0035, 0.21, -0.85], [0.019, 0.004, 0.29, 0.85]] as const) {
      const dl = ctx.createDelay(0.1);
      dl.delayTime.value = base;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rate;
      const lg = ctx.createGain();
      lg.gain.value = depth;
      lfo.connect(lg);
      lg.connect(dl.delayTime);
      lfo.start();
      const wet = ctx.createGain();
      wet.gain.value = 0.6;
      this.chorusIn.connect(dl);
      dl.connect(wet);
      let tail: AudioNode = wet;
      if (typeof ctx.createStereoPanner === 'function') {
        const p = ctx.createStereoPanner();
        p.pan.value = pan;
        wet.connect(p);
        tail = p;
        this.fx.push(p);
      }
      tail.connect(this.out);
      this.fx.push(dl, lfo, lg, wet);
      this.fxSrc.push(lfo);
    }

    const imag = new Float32Array([0, 1, 0.42, 0.22, 0.1, 0.14, 0.04, 0.06, 0.02]);
    const real = new Float32Array(imag.length);
    this.glass = ctx.createPeriodicWave(real, imag);
  }

  get current(): MusicKind {
    return this.kind;
  }

  /** Crossfade to a track ('none' fades out). */
  play(kind: MusicKind): void {
    if (kind === this.kind) return;
    const now = this.ctx.currentTime;
    if (this.cur) this.cur.fadeOut(now, kind === 'none' ? 2.8 : 2.0);
    this.cur = null;
    this.kind = kind;
    if (kind === 'none') return;
    const t = kind === 'menu' ? new MenuTrack(this, now + 0.12) : new MatchTrack(this, now + 0.12);
    this.tracks.push(t);
    this.cur = t;
  }

  /** Lookahead scheduling; called by the engine tick. */
  schedule(until: number): void {
    const now = this.ctx.currentTime;
    for (let i = this.tracks.length - 1; i >= 0; i--) {
      const t = this.tracks[i];
      if (t.finished(now)) {
        t.dispose();
        this.tracks.splice(i, 1);
        continue;
      }
      try {
        t.schedule(until, now);
      } catch (e) {
        // never let a bad note kill the scheduler
        console.warn('[music]', e);
      }
    }
  }

  dispose(): void {
    for (const t of this.tracks) t.dispose();
    this.tracks = [];
    this.cur = null;
    for (const s of this.fxSrc) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    for (const n of this.fx) n.disconnect();
    this.out.disconnect();
  }
}

// ----------------------------------------------------------------------------
// Track base: step sequencer + per-note node bookkeeping + crossfade
// ----------------------------------------------------------------------------

abstract class Track {
  protected readonly ctx: AudioContext;
  protected readonly p: MusicPlayer;
  /** dry/main voice bus (also feeds the reverb) */
  protected readonly main: GainNode;
  /** pads → shared stereo chorus */
  protected readonly pads: GainNode;
  /** echo send → this track's filtered feedback delay */
  protected readonly echo: GainNode;
  private readonly faders: GainNode[];
  private readonly own: AudioNode[] = [];
  protected readonly perm: AudioNode[] = [];
  protected readonly permSrc: AudioScheduledSourceNode[] = [];
  private readonly live: Live[] = [];
  protected readonly stepDur: number;
  protected next: number;
  protected step = 0;
  private stopAt = Infinity;

  constructor(p: MusicPlayer, start: number, stepDur: number, echoTime: number, echoFb: number, verbAmt: number, level: number) {
    const ctx = p.ctx;
    this.ctx = ctx;
    this.p = p;
    this.stepDur = stepDur;
    this.next = start;

    this.main = ctx.createGain();
    this.main.connect(p.out);
    const vs = ctx.createGain();
    vs.gain.value = verbAmt;
    this.main.connect(vs);
    vs.connect(p.verbIn);

    this.pads = ctx.createGain();
    this.pads.connect(p.chorusIn);

    this.echo = ctx.createGain();
    const dl = ctx.createDelay(2);
    dl.delayTime.value = echoTime;
    const dlp = ctx.createBiquadFilter();
    dlp.type = 'lowpass';
    dlp.frequency.value = 2600;
    const fb = ctx.createGain();
    fb.gain.value = echoFb;
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.echo.connect(dl);
    dl.connect(dlp);
    dlp.connect(fb);
    fb.connect(dl);
    dlp.connect(wet);
    wet.connect(this.main);

    this.own.push(this.main, vs, this.pads, this.echo, dl, dlp, fb, wet);
    this.faders = [this.main, this.pads, this.echo];
    for (const f of this.faders) {
      f.gain.setValueAtTime(0.0001, start);
      f.gain.setTargetAtTime(level, start, 0.9);
    }
  }

  protected abstract playStep(step: number, t: number): void;

  schedule(until: number, now: number): void {
    // free finished notes
    let w = 0;
    for (let r = 0; r < this.live.length; r++) {
      const l = this.live[r];
      if (l.end < now) {
        for (const n of l.nodes) n.disconnect();
      } else this.live[w++] = l;
    }
    this.live.length = w;
    // fell behind (tab throttled / suspended): skip ahead instead of bursting
    if (this.next < now - 0.3) {
      const skip = Math.ceil((now - this.next) / this.stepDur);
      this.next += skip * this.stepDur;
      this.step += skip;
    }
    let guard = 0;
    while (this.next < until && this.next < this.stopAt && guard++ < 64) {
      this.playStep(this.step, this.next);
      this.step++;
      this.next += this.stepDur;
    }
  }

  fadeOut(now: number, dur: number): void {
    for (const f of this.faders) {
      f.gain.cancelScheduledValues(now);
      f.gain.setValueAtTime(Math.max(0.0001, f.gain.value), now);
      f.gain.setTargetAtTime(0, now, dur / 4);
    }
    this.stopAt = now + dur;
  }

  finished(now: number): boolean {
    return now > this.stopAt + 0.5;
  }

  dispose(): void {
    for (const s of this.permSrc) {
      try {
        s.stop();
      } catch {
        /* ignore */
      }
    }
    for (const l of this.live) for (const n of l.nodes) n.disconnect();
    this.live.length = 0;
    for (const n of this.perm) n.disconnect();
    for (const n of this.own) n.disconnect();
  }

  // ---- note helpers -------------------------------------------------------

  protected keep(end: number, nodes: AudioNode[]): void {
    this.live.push({ end, nodes });
  }

  protected osc(type: OscillatorType | PeriodicWave, freq: number, t: number, stop: number, dest: AudioNode, detune = 0): OscillatorNode {
    const o = this.ctx.createOscillator();
    if (type instanceof PeriodicWave) o.setPeriodicWave(type);
    else o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.detune.setValueAtTime(detune, t);
    o.connect(dest);
    o.start(t);
    o.stop(stop);
    return o;
  }

  protected gain(dest: AudioNode | AudioParam, v = 0): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = v;
    if (dest instanceof AudioParam) g.connect(dest);
    else g.connect(dest);
    return g;
  }

  protected filter(type: BiquadFilterType, f: number, q: number, dest: AudioNode): BiquadFilterNode {
    const b = this.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    b.connect(dest);
    return b;
  }

  /** Slow-attack detuned saw pad (through the chorus). */
  protected pad(notes: readonly number[], t: number, dur: number, level: number, atk: number, rel: number, bright: number): void {
    const g = this.gain(this.pads);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + atk);
    g.gain.setValueAtTime(level, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + rel);
    const lp = this.filter('lowpass', 400, 3, g);
    lp.frequency.setValueAtTime(bright * 0.3, t);
    lp.frequency.linearRampToValueAtTime(bright * rnd(0.9, 1.25), t + dur * 0.55);
    lp.frequency.linearRampToValueAtTime(bright * 0.4, t + dur + rel);
    const nodes: AudioNode[] = [g, lp];
    const stop = t + dur + rel + 0.05;
    for (const m of notes) {
      for (const side of [-1, 1]) {
        const o = this.osc('sawtooth', mtof(m), t, stop, lp, side * rnd(6, 11));
        o.detune.linearRampToValueAtTime(side * rnd(3, 7), t + dur + rel);
        nodes.push(o);
      }
    }
    this.keep(stop + 0.05, nodes);
  }

  /** Filtered pluck (saw → resonant lowpass with envelope). */
  protected pluck(m: number, t: number, vel: number, cut: number, decay: number, echo: number, wave: OscillatorType | PeriodicWave = 'sawtooth'): void {
    const g = this.gain(this.main);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    const nodes: AudioNode[] = [g];
    if (echo > 0) {
      const e = this.gain(this.echo, echo);
      g.connect(e);
      nodes.push(e);
    }
    const lp = this.filter('lowpass', cut, 7, g);
    lp.frequency.setValueAtTime(cut * 3.5, t);
    lp.frequency.exponentialRampToValueAtTime(cut, t + Math.min(0.35, decay * 0.5));
    nodes.push(lp, this.osc(wave, mtof(m), t, t + decay + 0.05, lp));
    this.keep(t + decay + 0.1, nodes);
  }

  /** FM bell sparkle. */
  protected bell(m: number, t: number, vel: number, decay: number, echo: number): void {
    const f = mtof(m);
    const g = this.gain(this.main);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    const e = this.gain(this.echo, echo);
    g.connect(e);
    const car = this.osc('sine', f, t, t + decay + 0.05, g);
    const mg = this.gain(car.frequency);
    mg.gain.setValueAtTime(f * 2.2, t);
    mg.gain.exponentialRampToValueAtTime(f * 0.05, t + decay * 0.7);
    const mod = this.osc('sine', f * 3.5, t, t + decay + 0.05, mg);
    this.keep(t + decay + 0.1, [g, e, car, mg, mod]);
  }
}

// ----------------------------------------------------------------------------
// Menu: dreamy, spacey, slightly melancholic/epic (D minor, ~74 BPM)
// ----------------------------------------------------------------------------

interface MenuChord {
  bass: number;
  pad: readonly number[];
  arp: readonly number[];
}

const MENU_CHORDS: Record<string, MenuChord> = {
  Dm9: { bass: 38, pad: [57, 60, 64, 65], arp: [62, 65, 69, 72, 76] },
  Bbmaj7: { bass: 34, pad: [58, 62, 65, 69], arp: [58, 62, 65, 69, 74] },
  Fmaj9: { bass: 41, pad: [57, 60, 64, 67], arp: [60, 64, 67, 69, 72] },
  Csus2: { bass: 36, pad: [55, 60, 62, 67], arp: [60, 62, 67, 72, 74] },
  Gm9: { bass: 43, pad: [58, 62, 65, 69], arp: [62, 65, 67, 70, 74] },
  Asus4: { bass: 45, pad: [57, 62, 64, 69], arp: [57, 62, 64, 69, 76] },
};
const MENU_PROGS: readonly (readonly string[])[] = [
  ['Dm9', 'Bbmaj7', 'Fmaj9', 'Csus2'],
  ['Dm9', 'Gm9', 'Bbmaj7', 'Asus4'],
  ['Bbmaj7', 'Csus2', 'Dm9', 'Dm9'],
  ['Dm9', 'Fmaj9', 'Gm9', 'Asus4'],
];
const ARP_PATTERNS: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 3, 2, 1],
  [0, 2, 1, 3, 2, 4, 3, 1],
  [4, 3, 2, 1, 0, 1, 2, 3],
  [0, 2, 4, 2, 1, 3, 4, 3],
];

class MenuTrack extends Track {
  private prog: readonly string[] = MENU_PROGS[0];
  private chord: MenuChord = MENU_CHORDS.Dm9;
  private progCount = 0;
  private arpOn = false;
  private percOn = false;
  private arpPat: readonly number[] = ARP_PATTERNS[0];

  constructor(p: MusicPlayer, start: number) {
    const beat = 60 / 74;
    super(p, start, beat / 2, beat * 0.75, 0.42, 0.5, 1.6);
    this.texture(start);
  }

  /** Persistent spacey wind texture (filtered pink noise, slow sweep). */
  private texture(t: number): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.p.noise.pink;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700;
    bp.Q.value = 2.5;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.045;
    const lg = ctx.createGain();
    lg.gain.value = 450;
    lfo.connect(lg);
    lg.connect(bp.frequency);
    const g = ctx.createGain();
    g.gain.value = 0.05;
    src.connect(bp);
    bp.connect(g);
    g.connect(this.pads);
    src.start(t, Math.random());
    lfo.start(t);
    this.perm.push(src, bp, lfo, lg, g);
    this.permSrc.push(src, lfo);
  }

  protected playStep(s: number, t: number): void {
    const d = this.stepDur;
    const pos = s % 16;
    const ci = Math.floor(s / 16);
    if (pos === 0) {
      if (ci % 4 === 0) {
        // new progression + arrangement decision
        let next = pick(MENU_PROGS);
        if (next === this.prog && this.progCount > 0) next = pick(MENU_PROGS);
        this.prog = next;
        this.arpOn = this.progCount > 0 && Math.random() < 0.8;
        this.percOn = this.progCount > 1 && Math.random() < 0.6;
        this.arpPat = pick(ARP_PATTERNS);
        this.progCount++;
      }
      this.chord = MENU_CHORDS[this.prog[ci % 4]] ?? MENU_CHORDS.Dm9;
      const dur = 16 * d;
      this.pad(this.chord.pad, t, dur, 0.05, 2.4, 3.4, rnd(1300, 2000));
      if (this.progCount > 1 || ci % 4 >= 2) this.bass(this.chord.bass, t, dur);
    }
    if (this.arpOn) {
      if (Math.random() > 0.12) {
        const idx = this.arpPat[s % this.arpPat.length];
        let m = this.chord.arp[idx % this.chord.arp.length] + 12;
        if (Math.random() < 0.08) m += 12;
        const vel = (s % 4 === 0 ? 0.075 : 0.05) * rnd(0.8, 1.1);
        const cut = 700 + 500 * Math.sin((s / 64) * Math.PI * 2) ** 2;
        this.pluck(m, t, vel, cut, 1.3, 0.55, this.p.glass);
      }
    }
    if (pos % 4 === 2 && Math.random() < 0.1) this.bell(pick(this.chord.arp) + 24, t, 0.025, 2.6, 0.8);
    // sparse, soft percussion in some progressions: muffled kick on the bar, brushed shaker on off-beats
    if (this.percOn) {
      if (pos % 8 === 0) this.softKick(t, pos === 0 ? 1 : 0.7);
      if (s % 2 === 1 && Math.random() < 0.85) this.shaker(t, s % 4 === 3 ? 1 : 0.6);
    }
  }

  private softKick(t: number, vel: number): void {
    const g = this.gain(this.main);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.22 * vel, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    const o = this.osc('sine', 110, t, t + 0.5, g);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.16);
    this.keep(t + 0.55, [g, o]);
  }

  private shaker(t: number, vel: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.p.noise.white;
    const g = this.gain(this.pads);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.018 * vel, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    const bp = this.filter('bandpass', 6500, 1.2, g);
    src.connect(bp);
    src.start(t, Math.random() * 1.5);
    src.stop(t + 0.15);
    this.keep(t + 0.2, [src, bp, g]);
  }

  private bass(m: number, t: number, dur: number): void {
    const g = this.gain(this.main);
    const stop = t + dur + 2.2;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.2, t + 1.0);
    g.gain.setValueAtTime(0.2, t + dur - 0.2);
    g.gain.linearRampToValueAtTime(0, t + dur + 2.0);
    const lp = this.filter('lowpass', 320, 0, g);
    const o1 = this.osc('sine', mtof(m), t, stop, lp);
    const g2 = this.gain(lp, 0.28);
    const o2 = this.osc('triangle', mtof(m + 12), t, stop, g2);
    this.keep(stop + 0.05, [g, lp, o1, g2, o2]);
  }
}

// ----------------------------------------------------------------------------
// Match: low-key driving pulse (E minor, 112 BPM) that stays in the background
// ----------------------------------------------------------------------------

interface MatchChord {
  root: number;
  tones: readonly number[];
}

const MATCH_CHORDS: Record<string, MatchChord> = {
  Em: { root: 40, tones: [64, 67, 71] },
  C: { root: 36, tones: [64, 67, 72] },
  D: { root: 38, tones: [62, 66, 69] },
  Bm: { root: 35, tones: [62, 66, 71] },
  G: { root: 43, tones: [62, 67, 71] },
  F: { root: 41, tones: [65, 69, 72] },
  Am: { root: 33, tones: [64, 69, 72] },
};
const MATCH_PROGS: readonly (readonly string[])[] = [
  ['Em', 'C', 'D', 'Bm'],
  ['Em', 'Em', 'C', 'D'],
  ['Em', 'G', 'D', 'C'],
  ['Em', 'F', 'Em', 'D'],
  ['Am', 'Em', 'C', 'D'],
];
const BASS_PATTERNS: readonly (readonly (number | null)[])[] = [
  [0, 0, 12, 0, 0, 0, 12, 0, 0, 0, 12, 0, 0, 7, 12, 0],
  [0, null, 0, 0, 12, null, 0, 0, 0, null, 0, 0, 12, null, 7, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 12, 10],
  [0, null, 12, 0, null, 0, 12, null, 0, 0, 12, 0, 7, null, 10, 12],
];

type SectionId = 'intro' | 'drive' | 'full' | 'lift' | 'break';
interface Section {
  bass: boolean;
  kick: 0 | 2 | 4;
  hats: 0 | 1 | 2;
  snare: boolean;
  pad: boolean;
  blips: boolean;
  open: number;
}
const SECTIONS: Record<SectionId, Section> = {
  intro: { bass: true, kick: 0, hats: 1, snare: false, pad: false, blips: false, open: 0.25 },
  drive: { bass: true, kick: 2, hats: 1, snare: false, pad: true, blips: false, open: 0.45 },
  full: { bass: true, kick: 4, hats: 2, snare: true, pad: true, blips: false, open: 0.7 },
  lift: { bass: true, kick: 4, hats: 2, snare: true, pad: true, blips: true, open: 0.9 },
  break: { bass: false, kick: 0, hats: 1, snare: false, pad: true, blips: true, open: 0.3 },
};
const NEXT_SECTION: Record<SectionId, readonly SectionId[]> = {
  intro: ['drive'],
  drive: ['full', 'lift', 'full'],
  full: ['lift', 'break', 'drive'],
  lift: ['break', 'full', 'drive'],
  break: ['drive', 'full'],
};

class MatchTrack extends Track {
  private readonly bassOsc: OscillatorNode;
  private readonly bassSub: OscillatorNode;
  private readonly bassLp: BiquadFilterNode;
  private readonly bassG: GainNode;
  private readonly kickOsc: OscillatorNode;
  private readonly kickG: GainNode;
  private readonly hatG: GainNode;
  private readonly snG: GainNode;
  private readonly snTone: OscillatorNode;
  private readonly snToneG: GainNode;
  private section: SectionId = 'intro';
  private nextSection: SectionId = 'drive';
  private prog: readonly string[] = MATCH_PROGS[0];
  private chord: MatchChord = MATCH_CHORDS.Em;
  private pattern: readonly (number | null)[] = BASS_PATTERNS[0];
  private hatBusy = -1;

  constructor(p: MusicPlayer, start: number) {
    const beat = 60 / 112;
    super(p, start, beat / 4, beat * 0.75, 0.33, 0.18, 1.2);
    const ctx = this.ctx;
    // monophonic bass: saw + square sub → resonant lowpass → gate
    this.bassG = this.gain(this.main);
    this.bassLp = this.filter('lowpass', 400, 6, this.bassG);
    this.bassOsc = ctx.createOscillator();
    this.bassOsc.type = 'sawtooth';
    this.bassOsc.connect(this.bassLp);
    this.bassSub = ctx.createOscillator();
    this.bassSub.type = 'square';
    const subG = this.gain(this.bassLp, 0.35);
    this.bassSub.connect(subG);
    // kick
    this.kickG = this.gain(this.main);
    this.kickOsc = ctx.createOscillator();
    this.kickOsc.type = 'sine';
    this.kickOsc.connect(this.kickG);
    // hats + snare share one looping noise source
    const noise = ctx.createBufferSource();
    noise.buffer = this.p.noise.white;
    noise.loop = true;
    this.hatG = this.gain(this.main);
    const hp = this.filter('highpass', 7200, 1, this.hatG);
    this.snG = this.gain(this.main);
    const bp = this.filter('bandpass', 1900, 0.8, this.snG);
    noise.connect(hp);
    noise.connect(bp);
    this.snToneG = this.gain(this.main);
    this.snTone = ctx.createOscillator();
    this.snTone.type = 'triangle';
    this.snTone.connect(this.snToneG);
    for (const o of [this.bassOsc, this.bassSub, this.kickOsc, this.snTone]) o.start(start);
    noise.start(start, Math.random());
    this.perm.push(this.bassOsc, this.bassSub, subG, this.bassLp, this.bassG, this.kickOsc, this.kickG, noise, hp, bp, this.hatG, this.snG, this.snTone, this.snToneG);
    this.permSrc.push(this.bassOsc, this.bassSub, this.kickOsc, noise, this.snTone);
  }

  protected playStep(s: number, t: number): void {
    const pos = s % 16;
    const bar = Math.floor(s / 16);
    if (s % 128 === 0) {
      if (s > 0) this.section = this.nextSection;
      this.nextSection = pick(NEXT_SECTION[this.section]);
      this.pattern = pick(BASS_PATTERNS);
      if (bar % 16 === 0) this.prog = pick(MATCH_PROGS);
    }
    const sec = SECTIONS[this.section];
    if (s % 32 === 0) {
      this.chord = MATCH_CHORDS[this.prog[(s / 32) % 4]] ?? MATCH_CHORDS.Em;
      if (sec.pad) this.pad(this.chord.tones.map((m) => m - 12), t, 32 * this.stepDur, 0.03, 1.2, 1.6, 1100);
    }
    // riser into a big section
    if (s % 128 === 112 && (this.nextSection === 'full' || this.nextSection === 'lift')) this.riser(t, 16 * this.stepDur);

    const macro = 0.5 + 0.5 * Math.sin((s / 512) * Math.PI * 2);
    if (sec.bass) {
      const off = this.pattern[pos];
      if (off !== null) {
        const vel = pos % 4 === 0 ? 1 : 0.72;
        this.bassNote(this.chord.root + off, t, vel, 220 + 700 * sec.open * (0.6 + 0.4 * macro));
      }
    }
    if ((sec.kick === 4 && pos % 4 === 0) || (sec.kick === 2 && pos % 8 === 0)) this.kick(t, pos === 0 ? 1 : 0.85);
    if (sec.hats >= 1 && pos % 4 === 2) {
      const open = pos === 14 && Math.random() < 0.35;
      this.hat(t, 0.9, open);
      if (open) this.hatBusy = s + 1;
    }
    if (sec.hats >= 2 && pos % 2 === 1 && s !== this.hatBusy) this.hat(t, rnd(0.3, 0.5), false);
    if (sec.snare && (pos === 4 || pos === 12)) this.snare(t, 1);
    if (sec.snare && bar % 8 === 7 && pos >= 13 && Math.random() < 0.5) this.snare(t, 0.45);
    if (sec.blips && pos % 2 === 0 && Math.random() < 0.28) {
      const m = pick(this.chord.tones) + (Math.random() < 0.3 ? 24 : 12);
      this.pluck(m, t, rnd(0.03, 0.05), 1500, 0.35, 0.6, this.p.glass);
    }
  }

  private bassNote(m: number, t: number, vel: number, cut: number): void {
    const d = this.stepDur;
    const f = mtof(m);
    this.bassOsc.frequency.setValueAtTime(f, t);
    this.bassSub.frequency.setValueAtTime(f / 2, t);
    const lf = this.bassLp.frequency;
    lf.setValueAtTime(cut * 3.2, t);
    lf.exponentialRampToValueAtTime(cut, t + d * 0.8);
    const g = this.bassG.gain;
    g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(0.2 * vel, t + 0.005);
    g.exponentialRampToValueAtTime(0.07 * vel, t + d * 0.7);
    g.linearRampToValueAtTime(0.0001, t + d - 0.004);
  }

  private kick(t: number, vel: number): void {
    const f = this.kickOsc.frequency;
    f.setValueAtTime(140, t);
    f.exponentialRampToValueAtTime(44, t + 0.11);
    const g = this.kickG.gain;
    g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(0.42 * vel, t + 0.004);
    g.exponentialRampToValueAtTime(0.0001, t + 0.3);
  }

  private hat(t: number, vel: number, open: boolean): void {
    const dec = open ? Math.min(0.2, this.stepDur * 1.9) : 0.035;
    const g = this.hatG.gain;
    g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(0.07 * vel, t + 0.002);
    g.exponentialRampToValueAtTime(0.0001, t + dec);
  }

  private snare(t: number, vel: number): void {
    const d = Math.min(0.16, this.stepDur - 0.004);
    const g = this.snG.gain;
    g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(0.13 * vel, t + 0.002);
    g.exponentialRampToValueAtTime(0.0001, t + d);
    this.snTone.frequency.setValueAtTime(220, t);
    this.snTone.frequency.exponentialRampToValueAtTime(160, t + 0.07);
    const tg = this.snToneG.gain;
    tg.setValueAtTime(0.0001, t);
    tg.linearRampToValueAtTime(0.09 * vel, t + 0.002);
    tg.exponentialRampToValueAtTime(0.0001, t + 0.08);
  }

  /** Filtered-noise swell into the next section. */
  private riser(t: number, dur: number): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.p.noise.white;
    src.loop = true;
    const g = this.gain(this.pads);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.05);
    const bp = this.filter('bandpass', 400, 2, g);
    bp.frequency.setValueAtTime(400, t);
    bp.frequency.exponentialRampToValueAtTime(6000, t + dur);
    src.connect(bp);
    src.start(t, Math.random());
    src.stop(t + dur + 0.1);
    this.keep(t + dur + 0.2, [src, bp, g]);
  }
}
