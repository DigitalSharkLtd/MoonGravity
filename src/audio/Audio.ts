/**
 * MOON GRAVITY — hybrid audio engine.
 *
 * Recorded CC0 / public-domain samples (public/audio/*.mp3, see CREDITS.md) are layered with
 * procedural WebAudio synthesis (sub-bass thumps, mechanical clicks, zaps, tails), and every
 * sound has a fully procedural fallback that is used while samples are still loading or if a
 * file is missing. Music is 100% procedural (Music.ts).
 *
 * Vacuum stylization: sounds from other sources arrive as "suit radio / ground conduction":
 * inverse-distance attenuation (ref ~4 m, near-silent at ~120 m) plus a distance low-pass with a
 * bassy low-shelf. The local player's own (2D) sounds get a subtle "inside the helmet" reverb.
 *
 * Signal flow:
 *   voice → strip ─┬─ 2D: sfxIn / suitIn / uiIn (+ helmet reverb send)
 *                  └─ 3D: distance LP → low-shelf → panner → sfxIn (+ world reverb send)
 *   sfxIn → muffle LP → sfxVol ┐
 *   suitIn → light LP → suitVol ├→ master → compressor → limiter → destination
 *   uiIn → uiVol ───────────────┤
 *   music → muffle LP → musicVol┘
 */
import type * as THREE from 'three';
import { applyEnv, makeImpulse, makeNoiseBank, MusicPlayer, type Env, type FEnv, type NoiseBank, type NoiseKind, type Pt } from './Music';

export type Sfx =
  | 'pulse' | 'rail_charge' | 'rail' | 'plasma' | 'glauncher' | 'arc' | 'nuke_launch' | 'singularity_fire' | 'helios_mark'
  | 'dryfire' | 'reload' | 'switch' | 'explosion' | 'explosion_big' | 'nuke' | 'emp' | 'singularity_collapse' | 'helios_beam'
  | 'impact_metal' | 'impact_dirt' | 'impact_flesh' | 'hit_marker' | 'kill_confirm' | 'headshot' | 'hurt' | 'death'
  | 'footstep' | 'footstep_metal' | 'land' | 'jump' | 'jet_start' | 'mag_on' | 'mag_off' | 'mag_clamp'
  | 'pickup' | 'o2_refill' | 'breach' | 'shield_up' | 'shield_hit' | 'shield_down' | 'pod_incoming' | 'pod_land'
  | 'capture' | 'point_lost' | 'ui_click' | 'ui_hover' | 'respawn' | 'grenade_bounce' | 'grenade_throw' | 'sealant'
  | 'countdown' | 'match_start' | 'victory' | 'defeat' | 'streak'
  | 'melee' | 'grapple_fire' | 'grapple_hit' | 'airbrake' | 'roll' | 'slide' | 'mantle' | 'deploy' | 'drone_fire';
export type Loop = 'jet' | 'breathing' | 'hiss' | 'heartbeat' | 'alarm' | 'ambient' | 'beam' | 'capture_tick';

// ============================================================================
// Tuning
// ============================================================================

const MAX_VOICES = 48;
const THROTTLE_MS = 15;
const DEFAULT_REF = 4; // m — full volume inside this radius
const ROLLOFF = 1.6; // inverse model: ~-34 dB at 120 m for ref 4
const POOL_MAX = 64;
const MUSIC_TRIM = 0.8; // music sits in the background even at volume 1
const UI_TRIM = 0.85;
const TICK_MS = 40;
const LOAD_CONCURRENCY = 6;

/** Recorded samples in public/audio: [key, variant files, load priority (0 first)]. */
const SAMPLE_SETS: ReadonlyArray<readonly [string, readonly string[], number]> = [
  ['pulse', ['pulse_1', 'pulse_2', 'pulse_3'], 0],
  ['step', ['step_1', 'step_2', 'step_3', 'step_4'], 0],
  ['step_metal', ['step_metal_1', 'step_metal_2', 'step_metal_3', 'step_metal_4'], 0],
  ['impact_dirt', ['impact_dirt_1', 'impact_dirt_2', 'impact_dirt_3'], 0],
  ['impact_metal', ['impact_metal_1', 'impact_metal_2', 'impact_metal_3'], 0],
  ['thump', ['thump_1'], 0],
  ['rail', ['rail_1'], 0],
  ['plasma', ['plasma_1'], 0],
  ['arc', ['arc_1', 'arc_2'], 0],
  ['glauncher', ['glauncher_1'], 0],
  ['weapon_change', ['weapon_change'], 0],
  ['dryfire', ['dryfire_1'], 0],
  ['explosion', ['explosion_1', 'explosion_2', 'explosion_3'], 0],
  ['land', ['land_1', 'land_2'], 1],
  ['jump', ['jump_1', 'jump_2'], 1],
  ['explosion_big', ['explosion_big_1', 'explosion_big_2'], 1],
  ['nuke', ['nuke_1'], 1],
  ['nuke_launch', ['nuke_launch_1'], 1],
  ['sing_fire', ['sing_fire_1'], 1],
  ['sing_collapse', ['sing_collapse_1'], 1],
  ['emp', ['emp_1'], 1],
  ['laser_beam', ['laser_beam'], 1],
  ['beam_loop', ['beam_loop'], 1],
  ['jet_loop', ['jet_loop'], 1],
  ['jet_start', ['jet_start_1'], 1],
  ['clank', ['clank_1', 'clank_2'], 1],
  ['crack', ['crack_1'], 1],
  ['coin', ['coin_1'], 1],
  ['teleport', ['teleport_1'], 1],
  ['shield_up', ['shield_up_1'], 1],
  ['shield_down', ['shield_down_1'], 1],
  ['shield_hit', ['shield_hit_1'], 1],
  ['target_beep', ['target_beep'], 1],
  ['ui_click', ['ui_click_1'], 1],
  ['pod_alarm', ['pod_alarm'], 2],
  ['ambient_loop', ['ambient_loop'], 2],
];

// ============================================================================
// Small helpers
// ============================================================================

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const clamp01 = (v: number): number => clamp(Number.isFinite(v) ? v : 0, 0, 1);
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
const finite3 = (v: THREE.Vector3 | undefined): v is THREE.Vector3 =>
  !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

/** Percussive envelope: linear attack, exponential decay. */
const perc = (peak: number, decay: number, attack = 0.002, at = 0): Env => [
  [at, 0],
  [at + attack, peak, 'l'],
  [at + attack + decay, 0],
];
/** Several percussive hits on one envelope: [at, peak, decay]. */
const hits = (list: ReadonlyArray<readonly [number, number, number]>, attack = 0.002): Env => {
  const e: Pt[] = [];
  for (let i = 0; i < list.length; i++) {
    const [at, pk, dec] = list[i];
    const next = i + 1 < list.length ? list[i + 1][0] : Infinity;
    e.push([at, 0], [at + attack, pk, 'l'], [Math.min(at + attack + dec, next - 0.0005), 0]);
  }
  return e;
};
/** Sustained gates: [at, dur, amp]. */
const gates = (list: ReadonlyArray<readonly [number, number, number]>, atk = 0.004, rel = 0.012): Env => {
  const e: Pt[] = [];
  for (const [at, dur, amp] of list) e.push([at, 0], [at + atk, amp, 'l'], [at + dur, amp], [at + dur + rel, 0]);
  return e;
};
/** Stepped value sequence: [at, value]. */
const steps = (list: ReadonlyArray<readonly [number, number]>): Env =>
  list.map(([t, v], i): Pt => (i === 0 ? [t, v] : [t, v, 's']));
const scaleEnv = (e: Env, k: number): Env => e.map(([t, v, m]): Pt => (m ? [t, v * k, m] : [t, v * k]));

function setPannerPos(p: PannerNode, x: number, y: number, z: number): void {
  if (p.positionX) {
    p.positionX.value = x;
    p.positionY.value = y;
    p.positionZ.value = z;
  } else {
    (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(x, y, z);
  }
}

function decode(ctx: BaseAudioContext, ab: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise<AudioBuffer>((resolve, reject) => {
    try {
      // callback form for old Safari; promise form for everything else (double-settle is harmless)
      const p = ctx.decodeAudioData(ab, resolve, reject) as Promise<AudioBuffer> | undefined;
      if (p && typeof p.then === 'function') p.then(resolve, reject);
    } catch (e) {
      reject(e);
    }
  });
}

// ============================================================================
// Sample bank
// ============================================================================

/** A decoded sample; start/end (s) skip codec padding and leading/trailing silence. */
interface Sample {
  buf: AudioBuffer;
  start: number;
  end: number;
}

class SampleBank {
  private readonly sets = new Map<string, Sample[]>();
  private readonly lastPick = new Map<string, number>();
  total = 0;
  done = 0;
  finished = false;

  constructor(private readonly ctx: AudioContext, private readonly base: string) {}

  get progress(): number {
    if (this.finished) return 1;
    return this.total > 0 ? this.done / this.total : 0;
  }

  has(key: string): boolean {
    const s = this.sets.get(key);
    return !!s && s.length > 0;
  }

  hasAll(keys: readonly string[]): boolean {
    for (const k of keys) if (!this.has(k)) return false;
    return true;
  }

  /** Random variant, never the same one twice in a row. */
  pick(key: string): Sample | null {
    const s = this.sets.get(key);
    if (!s || s.length === 0) return null;
    if (s.length === 1) return s[0];
    const last = this.lastPick.get(key) ?? -1;
    let i = Math.floor(Math.random() * s.length);
    if (i === last) i = (i + 1 + Math.floor(Math.random() * (s.length - 1))) % s.length;
    this.lastPick.set(key, i);
    return s[i];
  }

  async loadAll(): Promise<void> {
    // manifest.json lists the files that actually ship; no manifest → procedural only (one request, no 404 spam)
    let avail: Set<string> | null = null;
    try {
      const r = await fetch(`${this.base}manifest.json`, { cache: 'no-cache' });
      if (r.ok) {
        const j = (await r.json()) as { files?: unknown };
        if (Array.isArray(j.files)) avail = new Set(j.files.filter((f): f is string => typeof f === 'string'));
      }
    } catch {
      /* offline / missing */
    }
    if (!avail) {
      this.finished = true;
      return;
    }
    const have = avail;
    const jobs: { key: string; file: string; prio: number; order: number }[] = [];
    for (const [key, files, prio] of SAMPLE_SETS) {
      files.forEach((file, i) => {
        if (have.has(file)) jobs.push({ key, file, prio, order: i });
      });
    }
    // weapons / footsteps / impacts first; first variant of every set before the rest
    jobs.sort((a, b) => a.prio - b.prio || a.order - b.order);
    this.total = jobs.length;
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < jobs.length) {
        const j = jobs[next++];
        try {
          await this.loadOne(j.key, j.file);
        } catch {
          // missing / undecodable file → procedural fallback stays in use
        } finally {
          this.done++;
        }
      }
    };
    await Promise.all(Array.from({ length: LOAD_CONCURRENCY }, worker));
    this.finished = true;
  }

  private async loadOne(key: string, file: string): Promise<void> {
    const res = await fetch(`${this.base}${file}.mp3`);
    if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
    const buf = await decode(this.ctx, await res.arrayBuffer());
    // trim decoder padding / silence
    const d = buf.getChannelData(0);
    const n = d.length;
    let a = 0;
    while (a < n && Math.abs(d[a]) < 0.0025) a++;
    let b = n - 1;
    while (b > a && Math.abs(d[b]) < 0.0008) b--;
    if (b - a < 32) throw new Error(`${file}: silent`);
    const sr = buf.sampleRate;
    const s: Sample = { buf, start: Math.max(0, a - 8) / sr, end: (b + 1) / sr };
    let set = this.sets.get(key);
    if (!set) this.sets.set(key, (set = []));
    set.push(s);
  }
}

// ============================================================================
// Synthesis toolkit (one Builder per one-shot voice / rhythmic loop event)
// ============================================================================

interface SynthLib {
  noise: NoiseBank;
  bank: SampleBank;
  curve(drive: number): Float32Array<ArrayBuffer>;
}

interface Tone {
  o: OscillatorNode;
  g: GainNode;
}
interface OscOpts {
  to?: AudioNode;
  detune?: FEnv;
}
interface NoiseOpts {
  to?: AudioNode;
  type?: BiquadFilterType;
  f?: FEnv;
  q?: number;
  rate?: number;
}
interface SmpOpts {
  gain?: number;
  rate?: number;
  at?: number;
  to?: AudioNode;
  lp?: FEnv;
  hp?: number;
  /** max play length (relative s); fades out at the end */
  dur?: number;
  offset?: number;
}

/**
 * Builds one sound. Times are relative to t0 and scaled by 1/pitch (playback-rate-like),
 * frequencies are scaled by pitch. Tracks every node for later disconnection.
 */
class Builder {
  /** relative end time of the longest layer */
  end = 0;
  readonly nodes: AudioNode[] = [];
  readonly srcs: AudioScheduledSourceNode[] = [];
  private readonly ts: number;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly lib: SynthLib,
    readonly t0: number,
    readonly out: AudioNode,
    readonly p = 1,
  ) {
    this.ts = 1 / p;
  }

  /** absolute end time */
  get endTime(): number {
    return this.t0 + this.end * this.ts;
  }

  private at(x: number): number {
    return this.t0 + x * this.ts;
  }

  private env(param: AudioParam, e: FEnv, scale = 1): number {
    return applyEnv(param, e, this.t0, this.ts, scale);
  }

  private span(a: Env): [number, number] {
    let last = 0;
    for (const pt of a) last = Math.max(last, pt[0]);
    this.end = Math.max(this.end, last);
    return [this.at(a.length ? a[0][0] : 0), this.at(last) + 0.02];
  }

  gain(v: FEnv, to?: AudioNode): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = 0;
    this.env(g.gain, v);
    g.connect(to ?? this.out);
    this.nodes.push(g);
    return g;
  }

  filt(type: BiquadFilterType, f: FEnv, q = 0.7, to?: AudioNode): BiquadFilterNode {
    const fl = this.ctx.createBiquadFilter();
    fl.type = type;
    fl.Q.value = q;
    this.env(fl.frequency, f, this.p);
    fl.connect(to ?? this.out);
    this.nodes.push(fl);
    return fl;
  }

  /** tanh waveshaper → level gain → to. Returns the shaper input. */
  shape(drive: number, level = 0.6, to?: AudioNode): WaveShaperNode {
    const ws = this.ctx.createWaveShaper();
    ws.curve = this.lib.curve(drive);
    ws.oversample = drive > 3 ? '2x' : 'none';
    const g = this.ctx.createGain();
    g.gain.value = level;
    ws.connect(g);
    g.connect(to ?? this.out);
    this.nodes.push(ws, g);
    return ws;
  }

  osc(type: OscillatorType, f: FEnv, a: Env, o: OscOpts = {}): Tone {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    this.env(osc.frequency, f, this.p);
    if (o.detune !== undefined) this.env(osc.detune, o.detune);
    const g = this.ctx.createGain();
    g.gain.value = 0;
    this.env(g.gain, a);
    osc.connect(g);
    g.connect(o.to ?? this.out);
    const [s, e] = this.span(a);
    osc.start(s);
    osc.stop(e);
    this.nodes.push(osc, g);
    this.srcs.push(osc);
    return { o: osc, g };
  }

  /** Looping noise buffer → optional filter → envelope. */
  noise(kind: NoiseKind, a: Env, o: NoiseOpts = {}): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    const buf = this.lib.noise[kind];
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = (o.rate ?? 1) * this.p;
    let head: AudioNode = src;
    this.nodes.push(src);
    if (o.f !== undefined) {
      const fl = this.ctx.createBiquadFilter();
      fl.type = o.type ?? 'bandpass';
      fl.Q.value = o.q ?? 0.8;
      this.env(fl.frequency, o.f, this.p);
      src.connect(fl);
      head = fl;
      this.nodes.push(fl);
    }
    const g = this.ctx.createGain();
    g.gain.value = 0;
    this.env(g.gain, a);
    head.connect(g);
    g.connect(o.to ?? this.out);
    const [s, e] = this.span(a);
    src.start(s, Math.random() * (buf.duration - 0.05));
    src.stop(e);
    this.nodes.push(g);
    this.srcs.push(src);
    return src;
  }

  /** LFO added onto a parameter (depth in the param's units). */
  lfo(param: AudioParam, type: OscillatorType, rate: FEnv, depth: FEnv, from: number, to: number): void {
    const o = this.ctx.createOscillator();
    o.type = type;
    this.env(o.frequency, rate, this.p);
    const g = this.ctx.createGain();
    g.gain.value = 0;
    this.env(g.gain, depth);
    o.connect(g);
    g.connect(param);
    o.start(this.at(from));
    o.stop(this.at(to) + 0.02);
    this.end = Math.max(this.end, to);
    this.nodes.push(o, g);
    this.srcs.push(o);
  }

  /** Tremolo gain stage (1 ± depth) feeding `to`; returns its input. */
  trem(rate: FEnv, depth: number, dur: number, to?: AudioNode): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = 1;
    g.connect(to ?? this.out);
    this.nodes.push(g);
    this.lfo(g.gain, 'sine', rate, depth, 0, dur);
    return g;
  }

  /** 2-operator FM tone; dev = frequency deviation in Hz. */
  fm(fc: FEnv, ratio: number, dev: FEnv, a: Env, o: { to?: AudioNode; type?: OscillatorType } = {}): Tone {
    const car = this.osc(o.type ?? 'sine', fc, a, { to: o.to });
    const m = this.ctx.createOscillator();
    this.env(m.frequency, fc, this.p * ratio);
    const mg = this.ctx.createGain();
    mg.gain.value = 0;
    this.env(mg.gain, dev, this.p);
    m.connect(mg);
    mg.connect(car.o.frequency);
    const [s, e] = this.span(a);
    m.start(s);
    m.stop(e);
    this.nodes.push(m, mg);
    this.srcs.push(m);
    return car;
  }

  /** Recorded sample layer (random variant). Returns null when the sample isn't loaded. */
  smp(key: string, o: SmpOpts = {}): AudioBufferSourceNode | null {
    const s = this.lib.bank.pick(key);
    if (!s) return null;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = s.buf;
    const rate = Math.max(0.05, (o.rate ?? 1) * this.p);
    src.playbackRate.value = rate;
    const offset = Math.min(s.start + (o.offset ?? 0), s.end - 0.01);
    let len = (s.end - offset) / rate; // real seconds
    const at = o.at ?? 0;
    const t = this.at(at);
    const vol = o.gain ?? 1;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    if (o.dur !== undefined && o.dur * this.ts < len) {
      len = o.dur * this.ts;
      const f = Math.min(0.06, len * 0.35);
      g.gain.setValueAtTime(vol, t + len - f);
      g.gain.linearRampToValueAtTime(0, t + len);
    }
    let head: AudioNode = src;
    this.nodes.push(src, g);
    if (o.hp !== undefined) {
      const hp = c.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = o.hp;
      head.connect(hp);
      head = hp;
      this.nodes.push(hp);
    }
    if (o.lp !== undefined) {
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 0;
      this.env(lp.frequency, o.lp);
      head.connect(lp);
      head = lp;
      this.nodes.push(lp);
    }
    head.connect(g);
    g.connect(o.to ?? this.out);
    src.start(t, offset);
    src.stop(t + len + 0.02);
    this.srcs.push(src);
    this.end = Math.max(this.end, at + len / this.ts);
    return src;
  }
}

// ============================================================================
// Sound definitions
// ============================================================================

type BusId = 'sfx' | 'ui' | 'suit';

interface SfxDef {
  /** fully procedural version (fallback while samples load / if missing) */
  build: (b: Builder) => void;
  /** hybrid version: recorded samples + procedural sweeteners (used when `needs` are loaded) */
  hybrid?: (b: Builder) => void;
  needs?: readonly string[];
  gain?: number;
  bus?: BusId;
  /** 3D reference distance (how far the sound carries) */
  ref?: number;
  /** world reverb send (3D) */
  verb?: number;
  /** helmet reverb send (2D) */
  helm?: number;
  /** random pitch variation (fraction) */
  vary?: number;
  /** voice-stealing priority weight */
  prio?: number;
  /** throttle window for identical sounds (ms) */
  throttle?: number;
}

// ---- shared layers ---------------------------------------------------------

const subThump = (b: Builder, f0: number, f1: number, amp: number, dec: number, at = 0): void => {
  b.osc('sine', [[at, f0], [at + dec * 0.45, f1]], perc(amp, dec, 0.003, at));
};
const servo = (b: Builder, at: number, dur: number, f0: number, f1: number, amp: number): void => {
  const bp = b.filt('bandpass', [[at, f0 * 3], [at + dur, f1 * 3.5]], 2.5);
  b.osc('sawtooth', [[at, f0], [at + dur, f1]], [[at, 0], [at + 0.03, amp, 'l'], [at + dur - 0.03, amp], [at + dur, 0]], { to: bp });
};
const zapTail = (b: Builder, at: number, dur: number, amp: number): void => {
  const bp = b.filt('bandpass', [[at, 3000], [at + dur, 700]], 2);
  const z = b.osc('sawtooth', [[at, 1800], [at + dur * 0.9, 240]], [[at, 0], [at + 0.02, amp, 'l'], [at + dur, 0]], { to: bp });
  b.lfo(z.o.frequency, 'square', 55, 350, at, at + dur);
  b.noise('crackle', [[at, 0], [at + 0.02, amp * 1.6, 'l'], [at + dur * 1.05, 0]], { type: 'bandpass', f: [[at, 4000], [at + dur, 1500]], q: 0.9 });
};
const chime = (b: Builder, notes: readonly number[], gap: number, amp: number, dec: number, dev = 2): void => {
  notes.forEach((m, i) => {
    const f = mtof(m);
    b.fm(f, 3.5, [[i * gap, f * dev], [i * gap + dec * 0.6, f * 0.05]], perc(amp, dec, 0.002, i * gap));
  });
};
const brassNote = (b: Builder, to: AudioNode, m: number, at: number, dur: number, amp: number, detune = 0): void => {
  b.osc('sawtooth', mtof(m), [[at, 0], [at + 0.03, amp, 'l'], [at + dur, amp * 0.8], [at + dur + 0.25, 0]], { to, detune });
};
const whoosh = (b: Builder, at: number, dur: number, amp: number, f0: number, f1: number): void => {
  b.noise('white', [[at, 0], [at + dur * 0.45, amp, 'l'], [at + dur, 0]], { type: 'bandpass', f: [[at, f0], [at + dur * 0.45, f1], [at + dur, f0 * 1.4]], q: 1.6 });
};

// ---- per-sound design --------------------------------------------------------

const SFX: Record<Sfx, SfxDef> = {
  // ---------------------------------------------------------------- weapons
  pulse: {
    gain: 0.55, vary: 0.05, prio: 1.2, needs: ['pulse'],
    build: (b) => {
      const f = b.filt('lowpass', [[0, 5200], [0.08, 1400]], 0.9);
      b.osc('square', [[0, 1250], [0.07, 210]], perc(0.2, 0.1, 0.002), { to: f });
      b.osc('sine', [[0, 170], [0.06, 52]], perc(0.9, 0.11, 0.003));
      b.noise('white', perc(0.35, 0.025), { type: 'bandpass', f: 3200, q: 0.7 });
    },
    hybrid: (b) => {
      b.smp('pulse', { gain: 0.95, lp: rnd(6500, 11000) });
      subThump(b, 165, 50, 0.5, 0.1);
      b.noise('white', perc(0.16, 0.02, 0.0008), { type: 'highpass', f: 3500 });
    },
  },
  rail_charge: {
    gain: 0.5, vary: 0.02,
    build: (b) => {
      const d = 0.62;
      const tr = b.trem([[0, 8], [d, 42]], 0.45, d + 0.1);
      const bp = b.filt('bandpass', [[0, 500], [d, 4000]], 3, tr);
      b.osc('sawtooth', [[0, 160], [d, 1600]], [[0, 0], [0.06, 0.25, 'l'], [d, 0.6], [d + 0.07, 0]], { to: bp });
      b.osc('sine', [[0, 320], [d, 3200]], [[0, 0], [0.1, 0.05, 'l'], [d, 0.25], [d + 0.05, 0]], { to: tr });
      b.noise('pink', [[0, 0], [d, 0.3, 'l'], [d + 0.05, 0]], { type: 'highpass', f: [[0, 1000], [d, 5000]], q: 0.7 });
    },
  },
  rail: {
    gain: 0.8, ref: 7, verb: 0.3, vary: 0.03, prio: 1.5, needs: ['rail'],
    build: (b) => {
      b.noise('white', perc(1.0, 0.09, 0.001), { type: 'highpass', f: 1200, q: 0.5 });
      subThump(b, 140, 38, 1.0, 0.45);
      b.noise('brown', perc(0.8, 0.35), { type: 'lowpass', f: [[0, 2500], [0.3, 300]], q: 0.8 });
      zapTail(b, 0.02, 0.85, 0.4);
    },
    hybrid: (b) => {
      b.smp('rail', { gain: 0.95 });
      b.noise('white', perc(0.75, 0.08, 0.001), { type: 'highpass', f: 1400 });
      subThump(b, 150, 36, 1.0, 0.55);
      zapTail(b, 0.03, 0.9, 0.2);
    },
  },
  plasma: {
    gain: 0.75, ref: 5, verb: 0.15, vary: 0.05, needs: ['plasma'],
    build: (b) => {
      const sh = b.shape(3);
      const bl = b.osc('triangle', [[0, 620], [0.22, 85]], perc(0.9, 0.3, 0.004), { to: sh });
      b.lfo(bl.o.detune, 'sine', [[0, 30], [0.3, 12]], 180, 0, 0.32);
      subThump(b, 110, 38, 0.9, 0.28);
      b.noise('pink', perc(0.9, 0.3, 0.002), { type: 'lowpass', f: [[0, 3000], [0.3, 350]], q: 1.2 });
      b.noise('white', perc(0.3, 0.04), { type: 'highpass', f: 2500 });
    },
    hybrid: (b) => {
      b.smp('plasma', { gain: 0.85 });
      const sh = b.shape(3, 0.45);
      const bl = b.osc('triangle', [[0, 560], [0.2, 80]], perc(0.6, 0.25, 0.004), { to: sh });
      b.lfo(bl.o.detune, 'sine', 28, 160, 0, 0.3);
      subThump(b, 110, 38, 0.9, 0.3);
    },
  },
  glauncher: {
    gain: 0.8, ref: 5, verb: 0.15, vary: 0.05, needs: ['glauncher'],
    build: (b) => {
      b.osc('sine', [[0, 300], [0.1, 120]], perc(0.9, 0.22, 0.002));
      b.osc('triangle', [[0, 620], [0.08, 300]], perc(0.25, 0.12, 0.002));
      b.noise('pink', perc(0.8, 0.14, 0.001), { type: 'bandpass', f: [[0, 700], [0.12, 380]], q: 5 });
      b.noise('white', perc(0.4, 0.02, 0.001), { type: 'highpass', f: 1800 });
    },
    hybrid: (b) => {
      b.smp('glauncher', { gain: 0.55, rate: 0.85 });
      b.osc('sine', [[0, 300], [0.1, 120]], perc(0.85, 0.22, 0.002));
      b.noise('pink', perc(0.7, 0.14, 0.001), { type: 'bandpass', f: [[0, 700], [0.12, 380]], q: 5 });
      b.noise('white', perc(0.3, 0.02, 0.001), { type: 'highpass', f: 1800 });
    },
  },
  arc: {
    gain: 0.85, ref: 4, vary: 0.08, needs: ['arc'],
    build: (b) => {
      const bp = b.filt('bandpass', [[0, 2400], [0.18, 1200]], 1.4);
      const z = b.osc('sawtooth', [[0, 700], [0.02, 2600], [0.2, 500]], perc(0.45, 0.2, 0.002), { to: bp });
      b.lfo(z.o.frequency, 'square', 90, 500, 0, 0.22);
      b.noise('crackle', perc(0.9, 0.22, 0.001), { type: 'highpass', f: 1800, q: 0.7 });
      subThump(b, 240, 90, 0.5, 0.08);
    },
    hybrid: (b) => {
      b.smp('arc', { gain: 0.8, rate: rnd(0.95, 1.15) });
      const bp = b.filt('bandpass', [[0, 2400], [0.18, 1200]], 1.4);
      const z = b.osc('sawtooth', [[0, 700], [0.02, 2600], [0.2, 500]], perc(0.22, 0.18, 0.002), { to: bp });
      b.lfo(z.o.frequency, 'square', 90, 500, 0, 0.2);
      b.noise('crackle', perc(0.5, 0.2, 0.001), { type: 'highpass', f: 1800, q: 0.7 });
      subThump(b, 240, 90, 0.45, 0.08);
    },
  },
  nuke_launch: {
    gain: 0.85, ref: 9, verb: 0.3, vary: 0.03, prio: 2, needs: ['nuke_launch'],
    build: (b) => {
      subThump(b, 120, 35, 1.0, 0.5);
      const sh = b.shape(2.5, 0.7);
      b.noise('brown', [[0, 0], [0.03, 1, 'l'], [0.4, 0.8], [1.9, 0]], { type: 'lowpass', f: [[0, 400], [0.25, 1800], [1.8, 500]], q: 1, to: sh });
      b.noise('white', [[0, 0], [0.25, 0.5, 'l'], [1.7, 0]], { type: 'bandpass', f: [[0, 500], [0.35, 3200], [1.7, 700]], q: 1.3 });
      b.noise('crackle', perc(0.6, 0.8, 0.02), { type: 'highpass', f: 1500 });
    },
    hybrid: (b) => {
      b.smp('nuke_launch', { gain: 0.9 });
      subThump(b, 110, 32, 1.0, 0.6);
      b.noise('brown', [[0, 0], [0.03, 0.6, 'l'], [1.6, 0]], { type: 'lowpass', f: 300 });
      b.noise('crackle', perc(0.35, 0.6, 0.02), { type: 'highpass', f: 1500 });
    },
  },
  singularity_fire: {
    gain: 0.6, ref: 6, verb: 0.35, vary: 0.03, prio: 1.5, needs: ['sing_fire'],
    build: (b) => {
      const sh = b.shape(2, 0.7);
      const s = b.osc('sine', [[0, 420], [0.9, 38]], [[0, 0], [0.01, 1, 'l'], [0.5, 0.8], [1.2, 0]], { to: sh });
      b.lfo(s.o.detune, 'sine', [[0, 14], [1.1, 3]], 260, 0, 1.2);
      const lp = b.filt('lowpass', [[0, 2400], [1.0, 160]], 4);
      b.lfo(lp.frequency, 'sine', 7, [[0, 800], [1.0, 60]], 0, 1.1);
      b.osc('sawtooth', [[0, 210], [0.9, 30]], [[0, 0], [0.02, 0.35, 'l'], [1.1, 0]], { to: lp });
      subThump(b, 90, 28, 0.9, 1.0);
      b.noise('pink', [[0, 0], [0.05, 0.4, 'l'], [0.9, 0]], { type: 'bandpass', f: [[0, 3000], [0.9, 200]], q: 2 });
    },
    hybrid: (b) => {
      b.smp('sing_fire', { gain: 0.7 });
      const sh = b.shape(2, 0.6);
      const s = b.osc('sine', [[0, 420], [0.9, 38]], [[0, 0], [0.01, 0.9, 'l'], [0.5, 0.7], [1.2, 0]], { to: sh });
      b.lfo(s.o.detune, 'sine', [[0, 14], [1.1, 3]], 260, 0, 1.2);
      subThump(b, 90, 28, 0.9, 1.0);
    },
  },
  helios_mark: {
    gain: 0.5, vary: 0, needs: ['target_beep'],
    build: (b) => {
      const lp = b.filt('lowpass', 5000, 0.7);
      const beeps: [number, number, number][] = [[0, 0.25, 0.08], [0.16, 0.25, 0.08], [0.3, 0.25, 0.07], [0.41, 0.25, 0.06], [0.52, 0.3, 0.5]];
      b.osc('square', steps([[0, 1760], [0.52, 2349]]), hits(beeps), { to: lp });
      b.osc('sine', steps([[0, 880], [0.52, 1174]]), hits(beeps.map(([a, p, d]) => [a, p * 0.8, d] as [number, number, number])));
      b.osc('sawtooth', [[0, 200], [0.55, 400]], [[0, 0], [0.05, 0.05, 'l'], [0.5, 0.08], [0.6, 0]], { to: lp });
    },
    hybrid: (b) => {
      for (const at of [0, 0.16, 0.3, 0.41]) b.smp('target_beep', { at, gain: 0.7 });
      b.smp('target_beep', { at: 0.52, gain: 0.8, rate: 1.335 });
      b.osc('square', 2349, gates([[0.52, 0.34, 0.12]]), { to: b.filt('lowpass', 5000, 0.7) });
      b.osc('sawtooth', [[0, 200], [0.55, 400]], [[0, 0], [0.05, 0.04, 'l'], [0.5, 0.06], [0.6, 0]], { to: b.filt('lowpass', 2000, 0.7) });
    },
  },
  dryfire: {
    gain: 0.6, vary: 0.06, needs: ['dryfire'],
    build: (b) => {
      b.noise('white', hits([[0, 1, 0.02], [0.05, 0.6, 0.015]], 0.0005), { type: 'bandpass', f: 3200, q: 1.2 });
      b.osc('square', steps([[0, 900], [0.05, 1200]]), hits([[0, 0.25, 0.02], [0.05, 0.15, 0.02]], 0.0005), { to: b.filt('lowpass', 4000, 0.7) });
      b.osc('sine', [[0, 2200], [0.03, 1200]], perc(0.3, 0.03, 0.001));
    },
    hybrid: (b) => {
      b.smp('dryfire', { gain: 0.9 });
      b.smp('dryfire', { gain: 0.45, at: 0.055, rate: 1.25 });
      b.osc('sine', [[0, 2200], [0.03, 1200]], perc(0.12, 0.03, 0.001));
    },
  },
  reload: {
    gain: 0.8, vary: 0.04, needs: ['weapon_change'],
    build: (b) => {
      const clacks: [number, number, number][] = [[0, 0.8, 0.05], [0.38, 0.9, 0.06], [0.55, 1.0, 0.07]];
      b.noise('white', hits(clacks, 0.001), { type: 'bandpass', f: steps([[0, 1800], [0.38, 2600], [0.55, 2200]]), q: 2.2 });
      b.osc('square', steps([[0, 520], [0.38, 700], [0.55, 380]]), hits([[0, 0.12, 0.05], [0.38, 0.12, 0.05], [0.55, 0.15, 0.06]]), { to: b.filt('lowpass', 2000, 1) });
      b.osc('sine', steps([[0, 160], [0.38, 180], [0.55, 140]]), hits([[0, 0.4, 0.06], [0.38, 0.4, 0.06], [0.55, 0.5, 0.08]]));
      servo(b, 0.08, 0.26, 180, 330, 0.25);
    },
    hybrid: (b) => {
      b.smp('weapon_change', { gain: 0.85, rate: 0.9 });
      servo(b, 0.12, 0.26, 180, 330, 0.18);
      b.smp('weapon_change', { at: 0.42, gain: 0.9, rate: 1.05, dur: 0.2 });
      b.osc('sine', steps([[0.42, 170], [0.56, 140]]), hits([[0.42, 0.4, 0.06], [0.56, 0.5, 0.08]]));
      b.noise('white', perc(0.6, 0.06, 0.001, 0.56), { type: 'bandpass', f: 2200, q: 2.2 });
    },
  },
  switch: {
    gain: 0.6, vary: 0.05, needs: ['weapon_change'],
    build: (b) => {
      servo(b, 0, 0.15, 260, 520, 0.3);
      b.noise('white', perc(0.6, 0.03, 0.001, 0.15), { type: 'bandpass', f: 2500, q: 2 });
      subThump(b, 300, 150, 0.3, 0.05, 0.15);
    },
    hybrid: (b) => {
      b.smp('weapon_change', { gain: 1, rate: 1.3 });
      servo(b, 0.02, 0.15, 260, 520, 0.18);
    },
  },

  // ------------------------------------------------------------- explosions
  explosion: {
    gain: 0.8, ref: 8, verb: 0.4, helm: 0.15, vary: 0.06, prio: 2, needs: ['explosion'],
    build: (b) => {
      b.osc('sine', [[0, 120], [0.45, 36]], [[0, 0], [0.004, 1, 'l'], [0.2, 0.7], [1.1, 0]]);
      const sh = b.shape(2.2, 0.8);
      b.noise('brown', [[0, 0], [0.005, 1, 'l'], [0.12, 0.7], [1.3, 0]], { type: 'lowpass', f: [[0, 4000], [0.15, 1200], [1.2, 180]], q: 0.9, to: sh });
      b.noise('white', perc(0.7, 0.08, 0.001), { type: 'highpass', f: 1500 });
      b.noise('crackle', [[0.03, 0], [0.06, 0.45, 'l'], [0.8, 0]], { type: 'bandpass', f: 1400, q: 0.8 });
    },
    hybrid: (b) => {
      b.smp('explosion', { gain: 1, rate: rnd(0.88, 1.05) });
      b.osc('sine', [[0, 115], [0.4, 34]], [[0, 0], [0.004, 1, 'l'], [0.2, 0.7], [1.2, 0]]);
      b.noise('white', perc(0.4, 0.06, 0.001), { type: 'highpass', f: 1800 });
    },
  },
  explosion_big: {
    gain: 0.85, ref: 14, verb: 0.5, helm: 0.2, vary: 0.05, prio: 3, needs: ['explosion_big'],
    build: (b) => {
      b.osc('sine', [[0, 95], [0.7, 26]], [[0, 0], [0.005, 1, 'l'], [0.35, 0.8], [1.9, 0]]);
      const sh = b.shape(2.8, 0.8);
      b.noise('brown', [[0, 0], [0.006, 1, 'l'], [0.2, 0.85], [2.2, 0]], { type: 'lowpass', f: [[0, 3000], [0.25, 900], [2.0, 120]], q: 1.1, to: sh });
      b.noise('brown', [[0, 0], [0.1, 0.7, 'l'], [2.4, 0]], { rate: 0.5, type: 'lowpass', f: 160, q: 0.7 });
      b.noise('white', perc(0.8, 0.12, 0.001), { type: 'highpass', f: 1200 });
      b.noise('crackle', [[0.05, 0], [0.1, 0.5, 'l'], [1.4, 0]], { type: 'bandpass', f: [[0, 1800], [1.4, 600]], q: 0.7 });
    },
    hybrid: (b) => {
      b.smp('explosion_big', { gain: 1, rate: rnd(0.9, 1.02) });
      b.osc('sine', [[0, 90], [0.7, 26]], [[0, 0], [0.005, 1, 'l'], [0.35, 0.8], [2.0, 0]]);
      b.noise('brown', [[0, 0], [0.1, 0.6, 'l'], [2.4, 0]], { rate: 0.5, type: 'lowpass', f: 160, q: 0.7 });
    },
  },
  nuke: {
    gain: 0.9, ref: 45, verb: 0.55, helm: 0.25, vary: 0.02, prio: 10, needs: ['nuke'],
    build: (b) => {
      b.noise('white', perc(1, 0.25, 0.001), { type: 'highpass', f: 800 });
      b.noise('pink', [[0, 0], [0.01, 0.9, 'l'], [1.8, 0]], { type: 'bandpass', f: [[0, 4000], [1.6, 180]], q: 0.8 });
      b.osc('sine', [[0, 70], [3.0, 22]], [[0, 0], [0.01, 1, 'l'], [0.8, 0.8], [6.5, 0]]);
      const sh = b.shape(3, 0.9);
      const tr = b.trem([[0, 5], [6, 1.5]], 0.35, 7, sh);
      b.noise('brown', [[0, 0], [0.05, 1, 'l'], [1.5, 0.8], [7, 0]], { type: 'lowpass', f: [[0, 1600], [0.6, 400], [6.5, 80]], q: 1.2, to: tr });
      b.noise('brown', [[0, 0], [0.4, 0.8, 'l'], [3, 0.6], [7, 0]], { rate: 0.35, type: 'lowpass', f: 220, q: 0.7 });
      b.noise('crackle', [[0.1, 0], [0.3, 0.4, 'l'], [4, 0]], { type: 'bandpass', f: [[0, 2000], [4, 500]], q: 0.6 });
    },
    hybrid: (b) => {
      b.smp('nuke', { gain: 1 });
      b.noise('white', perc(0.7, 0.2, 0.001), { type: 'highpass', f: 900 });
      b.osc('sine', [[0, 64], [3.0, 22]], [[0, 0], [0.01, 1, 'l'], [0.8, 0.85], [6.8, 0]]);
      const sh = b.shape(3, 0.8);
      const tr = b.trem([[0, 5], [6, 1.5]], 0.35, 7, sh);
      b.noise('brown', [[0, 0], [0.3, 0.9, 'l'], [2, 0.75], [7, 0]], { type: 'lowpass', f: [[0, 900], [1.5, 300], [6.5, 80]], q: 1.2, to: tr });
      b.noise('brown', [[0, 0], [0.8, 0.7, 'l'], [3, 0.55], [7, 0]], { rate: 0.35, type: 'lowpass', f: 200, q: 0.7 });
      b.noise('crackle', [[0.2, 0], [0.5, 0.3, 'l'], [4, 0]], { type: 'bandpass', f: [[0, 2000], [4, 500]], q: 0.6 });
    },
  },
  emp: {
    gain: 1, ref: 8, verb: 0.35, vary: 0.04, prio: 2, needs: ['emp'],
    build: (b) => {
      b.noise('crackle', perc(1, 0.35, 0.001), { type: 'highpass', f: 1500 });
      b.noise('white', perc(0.6, 0.12, 0.001), { type: 'bandpass', f: 5000, q: 0.8 });
      const bz = b.osc('sawtooth', 110, perc(0.5, 0.45, 0.002), { to: b.filt('bandpass', 900, 1.2) });
      b.lfo(bz.o.frequency, 'square', 47, 80, 0, 0.5);
      const lp = b.filt('lowpass', [[0.05, 4000], [1.3, 150]], 3);
      b.osc('square', [[0.05, 1400], [1.3, 35]], [[0.05, 0], [0.07, 0.35, 'l'], [1.0, 0.25], [1.4, 0]], { to: lp });
      subThump(b, 150, 40, 0.8, 0.4);
    },
    hybrid: (b) => {
      b.smp('emp', { gain: 0.85 });
      const lp = b.filt('lowpass', [[0.05, 4000], [1.3, 150]], 3);
      b.osc('square', [[0.05, 1400], [1.3, 35]], [[0.05, 0], [0.07, 0.22, 'l'], [1.0, 0.16], [1.4, 0]], { to: lp });
      subThump(b, 150, 40, 0.8, 0.4);
    },
  },
  singularity_collapse: {
    gain: 0.95, ref: 11, verb: 0.5, vary: 0.03, prio: 3, needs: ['sing_collapse'],
    build: (b) => {
      const T = 0.95;
      b.noise('pink', [[0, 0], [T - 0.05, 0.9], [T, 0.9], [T + 0.01, 0]], { type: 'bandpass', f: [[0, 200], [T, 5000]], q: 1.2 });
      b.osc('sine', [[0, 50], [T, 420]], [[0, 0], [T - 0.02, 0.5], [T + 0.01, 0]]);
      subThump(b, 110, 28, 1, 1.5, T);
      const sh = b.shape(2.5, 0.8);
      b.noise('brown', perc(1, 1.6, 0.003, T), { type: 'lowpass', f: [[T, 2500], [T + 1.5, 150]], q: 1, to: sh });
      b.noise('white', perc(0.5, 0.08, 0.001, T), { type: 'highpass', f: 1500 });
      const w = b.osc('triangle', [[T, 180], [T + 1.6, 60]], [[T, 0], [T + 0.05, 0.25, 'l'], [T + 1.8, 0]], { to: b.filt('lowpass', 800, 1) });
      b.lfo(w.o.detune, 'sine', 6, 300, T, T + 1.8);
    },
    hybrid: (b) => {
      const T = 1.3;
      b.smp('sing_collapse', { gain: 0.95 });
      b.osc('sine', [[0, 45], [T, 380]], [[0, 0], [T - 0.02, 0.35], [T + 0.01, 0]]);
      subThump(b, 110, 28, 1, 1.5, T);
      const w = b.osc('triangle', [[T, 180], [T + 1.6, 60]], [[T, 0], [T + 0.05, 0.2, 'l'], [T + 1.8, 0]], { to: b.filt('lowpass', 800, 1) });
      b.lfo(w.o.detune, 'sine', 6, 300, T, T + 1.8);
    },
  },
  helios_beam: {
    gain: 0.9, ref: 22, verb: 0.4, helm: 0.15, vary: 0.02, prio: 5, needs: ['laser_beam'],
    build: (b) => {
      const D = 3.0;
      const env: Env = [[0, 0], [0.12, 1, 'l'], [D - 0.3, 0.85], [D + 0.3, 0]];
      const sh = b.shape(2.5, 0.5);
      const lp = b.filt('lowpass', [[0, 5000], [0.3, 2400], [D, 1600]], 2, sh);
      b.lfo(lp.frequency, 'sine', 9, 700, 0, D + 0.3);
      b.osc('sawtooth', 55, env, { to: lp });
      b.osc('sawtooth', 55.7, env, { to: lp });
      b.osc('square', 110.4, scaleEnv(env, 0.5), { to: lp });
      b.noise('white', [[0, 0], [0.1, 0.35, 'l'], [D - 0.3, 0.3], [D + 0.3, 0]], { type: 'bandpass', f: 4200, q: 0.8 });
      b.noise('crackle', [[0, 0], [0.1, 0.5, 'l'], [D, 0.4], [D + 0.3, 0]], { type: 'highpass', f: 2500 });
      subThump(b, 120, 35, 1, 0.8);
    },
    hybrid: (b) => {
      const D = 3.0;
      b.smp('laser_beam', { gain: 0.85 });
      const lp = b.filt('lowpass', 900, 3);
      b.lfo(lp.frequency, 'sine', 9, 400, 0, D + 0.3);
      b.osc('sawtooth', 55, [[0, 0], [0.12, 0.35, 'l'], [D - 0.3, 0.3], [D + 0.3, 0]], { to: lp });
      subThump(b, 120, 35, 1, 0.8);
    },
  },

  // ---------------------------------------------------------------- impacts
  impact_metal: {
    gain: 0.8, ref: 3, vary: 0.12, needs: ['impact_metal'],
    build: (b) => {
      const f = rnd(1700, 2600);
      b.fm(f, 2.76, [[0, f * 1.6], [0.25, f * 0.1]], perc(0.35, 0.35, 0.001));
      b.osc('sine', f * 1.51, perc(0.12, 0.2, 0.001));
      b.noise('white', perc(0.6, 0.05, 0.001), { type: 'highpass', f: 4500 });
    },
    hybrid: (b) => {
      b.smp('impact_metal', { gain: 0.8, rate: rnd(0.9, 1.2) });
      const f = rnd(1700, 2600);
      b.fm(f, 2.76, [[0, f * 1.4], [0.25, f * 0.1]], perc(0.16, 0.3, 0.001));
      b.noise('white', perc(0.3, 0.04, 0.001), { type: 'highpass', f: 5000 });
    },
  },
  impact_dirt: {
    gain: 0.6, ref: 3, vary: 0.12, needs: ['impact_dirt'],
    build: (b) => {
      subThump(b, 150, 55, 0.8, 0.16);
      b.noise('crackle', perc(0.8, 0.2, 0.002), { type: 'bandpass', f: 1700, q: 0.8 });
      b.noise('brown', perc(0.8, 0.22, 0.002), { type: 'lowpass', f: [[0, 900], [0.2, 250]], q: 0.8 });
    },
    hybrid: (b) => {
      b.smp('impact_dirt', { gain: 0.9, rate: rnd(0.85, 1.1), dur: 0.35 });
      subThump(b, 150, 55, 0.7, 0.15);
    },
  },
  impact_flesh: {
    gain: 0.6, ref: 3, vary: 0.1, needs: ['thump'],
    build: (b) => {
      subThump(b, 190, 70, 0.9, 0.14);
      b.noise('pink', perc(0.7, 0.1, 0.002), { type: 'lowpass', f: 800, q: 1 });
      b.noise('white', perc(0.25, 0.03, 0.001), { type: 'bandpass', f: 1300, q: 1.5 });
    },
    hybrid: (b) => {
      b.smp('thump', { gain: 0.9, rate: rnd(0.9, 1.15) });
      subThump(b, 190, 70, 0.6, 0.12);
      b.noise('pink', perc(0.5, 0.09, 0.002), { type: 'lowpass', f: 800, q: 1 });
    },
  },
  hit_marker: {
    bus: 'ui', gain: 0.9, vary: 0.02,
    build: (b) => {
      b.osc('square', 2900, perc(0.3, 0.045, 0.0008), { to: b.filt('highpass', 1800, 0.7) });
      b.osc('sine', 5200, perc(0.2, 0.03, 0.0008));
      b.osc('triangle', 1450, perc(0.25, 0.04, 0.0008));
      b.noise('white', perc(0.3, 0.012, 0.0005), { type: 'highpass', f: 6000 });
    },
  },
  kill_confirm: {
    bus: 'ui', gain: 0.5, vary: 0,
    build: (b) => {
      b.fm(mtof(88), 3.5, [[0, 400], [0.3, 50]], perc(0.4, 0.45, 0.002));
      b.fm(mtof(95), 3.5, [[0.09, 500], [0.5, 50]], perc(0.45, 0.6, 0.002, 0.09));
      subThump(b, 300, 120, 0.4, 0.08);
    },
  },
  headshot: {
    bus: 'ui', gain: 0.5, vary: 0,
    build: (b) => {
      b.noise('white', perc(0.5, 0.02, 0.0005), { type: 'highpass', f: 5000 });
      b.fm(mtof(95), 2, [[0, 900], [0.3, 80]], perc(0.4, 0.35, 0.001));
      b.fm(mtof(100), 2, [[0.07, 1100], [0.6, 80]], perc(0.45, 0.6, 0.001, 0.07));
      b.osc('triangle', mtof(107), perc(0.12, 0.5, 0.002, 0.07));
    },
  },
  hurt: {
    bus: 'suit', gain: 0.7, vary: 0.06, needs: ['thump'],
    build: (b) => {
      subThump(b, 130, 48, 1, 0.2);
      b.noise('pink', perc(0.7, 0.12, 0.002), { type: 'lowpass', f: 600, q: 0.9 });
      b.osc('square', steps([[0.03, 1450], [0.1, 1050], [0.17, 1450]]), [[0.03, 0], [0.035, 0.12, 'l'], [0.2, 0.12], [0.24, 0]], { to: b.filt('lowpass', 3500, 0.7) });
    },
    hybrid: (b) => {
      b.smp('thump', { gain: 1, rate: rnd(0.8, 0.95) });
      subThump(b, 130, 48, 0.8, 0.2);
      b.osc('square', steps([[0.03, 1450], [0.1, 1050], [0.17, 1450]]), [[0.03, 0], [0.035, 0.12, 'l'], [0.2, 0.12], [0.24, 0]], { to: b.filt('lowpass', 3500, 0.7) });
    },
  },
  death: {
    bus: 'suit', gain: 0.6, vary: 0,
    build: (b) => {
      subThump(b, 110, 40, 1, 0.35);
      const lp = b.filt('lowpass', 3000, 0.7);
      const flat = gates([[0.15, 0.11, 0.3], [0.5, 0.12, 0.3], [0.86, 1.6, 0.28]]).concat([[3.2, 0]] as Pt[]);
      b.osc('triangle', 988, flat, { to: lp });
      b.osc('sine', 1976, scaleEnv(flat, 0.25), { to: lp });
      b.noise('white', [[0.05, 0], [0.15, 0.35, 'l'], [1.2, 0.2], [3, 0]], { type: 'highpass', f: [[0, 4000], [3, 2000]], q: 0.5 });
    },
  },

  // --------------------------------------------------------------- movement
  footstep: {
    gain: 0.42, ref: 3, vary: 0.1, throttle: 40, needs: ['step'],
    build: (b) => {
      b.noise('crackle', hits([[0, 0.55, 0.07], [0.045, 0.35, 0.14]], 0.004), { type: 'bandpass', f: rnd(1000, 1500), q: 0.9 });
      b.noise('brown', perc(0.6, 0.16, 0.006), { type: 'lowpass', f: 500, q: 0.8 });
      subThump(b, 95, 48, 0.45, 0.14);
    },
    hybrid: (b) => {
      b.smp('step', { gain: 1, rate: rnd(0.9, 1.06), lp: rnd(3500, 7000) });
      subThump(b, 95, 48, 0.35, 0.12);
    },
  },
  footstep_metal: {
    gain: 0.45, ref: 3, vary: 0.08, throttle: 40, needs: ['step_metal'],
    build: (b) => {
      const f = rnd(380, 520);
      b.fm(f, 1.41, [[0, f * 3], [0.2, f * 0.2]], perc(0.25, 0.25, 0.001));
      b.noise('white', perc(0.4, 0.04, 0.001), { type: 'bandpass', f: 2600, q: 1.5 });
      subThump(b, 120, 60, 0.6, 0.12);
    },
    hybrid: (b) => {
      b.smp('step_metal', { gain: 0.95, rate: rnd(0.92, 1.08) });
      const f = rnd(380, 520);
      b.fm(f, 1.41, [[0, f * 2.5], [0.2, f * 0.2]], perc(0.1, 0.22, 0.001));
    },
  },
  land: {
    gain: 0.65, ref: 4, vary: 0.08, needs: ['land'],
    build: (b) => {
      subThump(b, 110, 38, 1, 0.32);
      b.noise('brown', perc(0.9, 0.35, 0.004), { type: 'lowpass', f: [[0, 900], [0.3, 200]], q: 0.9 });
      b.noise('crackle', perc(0.45, 0.28, 0.004), { type: 'bandpass', f: 1300, q: 0.7 });
    },
    hybrid: (b) => {
      b.smp('land', { gain: 1, rate: rnd(0.9, 1.05) });
      subThump(b, 110, 38, 0.8, 0.3);
    },
  },
  jump: {
    gain: 0.5, ref: 4, vary: 0.06, needs: ['jump'],
    build: (b) => {
      servo(b, 0, 0.14, 240, 520, 0.15);
      b.noise('white', [[0.02, 0], [0.05, 0.55, 'l'], [0.32, 0]], { type: 'bandpass', f: [[0.02, 1800], [0.3, 500]], q: 1 });
      subThump(b, 90, 50, 0.4, 0.15, 0.02);
    },
    hybrid: (b) => {
      b.smp('jump', { gain: 0.55, rate: rnd(0.95, 1.1) });
      servo(b, 0, 0.14, 240, 520, 0.1);
      b.noise('white', [[0.02, 0], [0.05, 0.35, 'l'], [0.3, 0]], { type: 'bandpass', f: [[0.02, 1800], [0.3, 500]], q: 1 });
    },
  },
  jet_start: {
    gain: 0.6, ref: 5, vary: 0.05, needs: ['jet_start'],
    build: (b) => {
      b.noise('crackle', hits([[0, 0.8, 0.02], [0.04, 0.8, 0.02], [0.07, 0.9, 0.03]], 0.001), { type: 'highpass', f: 2500 });
      subThump(b, 180, 55, 0.8, 0.3, 0.08);
      b.noise('white', [[0.08, 0], [0.1, 0.8, 'l'], [0.3, 0.4], [0.7, 0]], { type: 'lowpass', f: [[0.08, 5000], [0.6, 1200]], q: 0.8 });
      b.noise('brown', [[0.08, 0], [0.1, 0.8, 'l'], [0.7, 0]], { type: 'lowpass', f: 600 });
    },
    hybrid: (b) => {
      b.noise('crackle', hits([[0, 0.6, 0.02], [0.04, 0.6, 0.02]], 0.001), { type: 'highpass', f: 2500 });
      b.smp('jet_start', { gain: 0.9, at: 0.05 });
      subThump(b, 180, 55, 0.7, 0.3, 0.06);
    },
  },
  mag_on: {
    gain: 0.5, ref: 3, vary: 0.03,
    build: (b) => {
      const tr = b.trem(28, 0.35, 0.5);
      const lp = b.filt('lowpass', [[0, 300], [0.3, 1400]], 3, tr);
      b.osc('sawtooth', [[0, 45], [0.3, 100]], [[0, 0], [0.25, 0.5, 'l'], [0.32, 0.5], [0.5, 0]], { to: lp });
      b.osc('sine', [[0, 90], [0.3, 200]], [[0, 0], [0.25, 0.3, 'l'], [0.5, 0]], { to: tr });
      b.noise('crackle', perc(0.25, 0.06, 0.001, 0.27), { type: 'highpass', f: 3000 });
    },
  },
  mag_off: {
    gain: 0.45, ref: 3, vary: 0.03,
    build: (b) => {
      const tr = b.trem([[0, 30], [0.45, 8]], 0.4, 0.5);
      const lp = b.filt('lowpass', [[0, 1500], [0.45, 150]], 3, tr);
      b.osc('sawtooth', [[0, 100], [0.45, 35]], [[0, 0], [0.02, 0.5, 'l'], [0.48, 0]], { to: lp });
      b.osc('sine', [[0, 200], [0.45, 70]], [[0, 0], [0.02, 0.3, 'l'], [0.45, 0]], { to: tr });
    },
  },
  mag_clamp: {
    gain: 0.7, ref: 4, vary: 0.05, needs: ['clank'],
    build: (b) => {
      subThump(b, 100, 42, 1, 0.28);
      b.fm(170, 2.3, [[0, 500], [0.3, 40]], perc(0.35, 0.35, 0.001));
      b.noise('white', perc(0.5, 0.05, 0.001), { type: 'bandpass', f: 1100, q: 1.2 });
      const tr = b.trem(50, 0.5, 0.3);
      b.osc('sawtooth', 100, perc(0.12, 0.25, 0.01), { to: b.filt('lowpass', 600, 1, tr) });
    },
    hybrid: (b) => {
      b.smp('clank', { gain: 0.9, rate: rnd(0.7, 0.85) });
      subThump(b, 100, 42, 1, 0.28);
      const tr = b.trem(50, 0.5, 0.3);
      b.osc('sawtooth', 100, perc(0.12, 0.25, 0.01), { to: b.filt('lowpass', 600, 1, tr) });
    },
  },

  // ------------------------------------------------------ suit / life support
  pickup: {
    gain: 0.5, vary: 0, needs: ['coin'],
    build: (b) => {
      [84, 88, 91, 96].forEach((m, i) => b.osc('triangle', mtof(m), perc(0.3, 0.3 + i * 0.08, 0.002, i * 0.055)));
      b.osc('sine', mtof(108), perc(0.08, 0.4, 0.002, 0.165));
    },
    hybrid: (b) => {
      b.smp('coin', { gain: 0.8 });
      b.osc('sine', mtof(108), perc(0.06, 0.4, 0.002, 0.08));
    },
  },
  o2_refill: {
    bus: 'suit', gain: 0.55, vary: 0.02,
    build: (b) => {
      b.noise('white', [[0, 0], [0.08, 0.5, 'l'], [0.55, 0.4], [0.75, 0]], { type: 'bandpass', f: [[0, 1200], [0.7, 4200]], q: 1.3 });
      b.noise('pink', [[0, 0], [0.05, 0.4, 'l'], [0.7, 0]], { type: 'lowpass', f: 600 });
      b.fm(mtof(81), 2, [[0.62, 300], [1.1, 20]], perc(0.3, 0.5, 0.002, 0.62));
      b.fm(mtof(88), 2, [[0.74, 300], [1.3, 20]], perc(0.3, 0.7, 0.002, 0.74));
    },
  },
  breach: {
    bus: 'suit', gain: 0.7, vary: 0.03, needs: ['crack'],
    build: (b) => {
      subThump(b, 160, 50, 0.8, 0.18);
      b.noise('white', [[0, 0], [0.01, 0.9, 'l'], [0.15, 0.45], [1.3, 0]], { type: 'highpass', f: [[0, 1800], [1.2, 3500]], q: 0.6 });
      b.osc('square', steps([[0.1, 960], [0.25, 720], [0.4, 960], [0.55, 720]]), [[0.1, 0], [0.105, 0.13, 'l'], [0.68, 0.13], [0.72, 0]], { to: b.filt('lowpass', 3000, 0.7) });
    },
    hybrid: (b) => {
      b.smp('crack', { gain: 0.9 });
      subThump(b, 160, 50, 0.6, 0.18);
      b.noise('white', [[0.02, 0], [0.04, 0.8, 'l'], [0.2, 0.45], [1.3, 0]], { type: 'highpass', f: [[0, 1800], [1.2, 3500]], q: 0.6 });
      b.osc('square', steps([[0.12, 960], [0.27, 720], [0.42, 960], [0.57, 720]]), [[0.12, 0], [0.125, 0.12, 'l'], [0.7, 0.12], [0.74, 0]], { to: b.filt('lowpass', 3000, 0.7) });
    },
  },
  sealant: {
    bus: 'suit', gain: 0.5, vary: 0.05,
    build: (b) => {
      const tr = b.trem(17, 0.6, 0.75);
      b.noise('pink', [[0, 0], [0.04, 0.6, 'l'], [0.55, 0.5], [0.75, 0]], { type: 'bandpass', f: 2200, q: 0.7, to: tr });
      const gl = b.osc('sine', [[0, 420], [0.7, 650]], [[0, 0], [0.05, 0.1, 'l'], [0.6, 0.08], [0.75, 0]]);
      b.lfo(gl.o.frequency, 'sawtooth', 23, 220, 0, 0.75);
    },
  },

  // ---------------------------------------------------------------- gadgets
  shield_up: {
    gain: 0.55, ref: 5, verb: 0.3, vary: 0.02, needs: ['shield_up'],
    build: (b) => {
      const lp = b.filt('lowpass', [[0, 300], [0.45, 4500], [0.9, 1500]], 2);
      const e: Env = [[0, 0], [0.4, 0.35, 'l'], [0.55, 0.3], [1.0, 0]];
      b.osc('sawtooth', [[0, 110], [0.45, 220]], e, { to: lp });
      b.osc('sawtooth', [[0, 165], [0.45, 330]], e, { to: lp });
      const tr = b.trem([[0, 6], [0.6, 22]], 0.5, 1.0);
      b.osc('sine', [[0, 880], [0.5, 1760]], [[0, 0], [0.4, 0.15, 'l'], [1.0, 0]], { to: tr });
      b.noise('white', [[0.2, 0], [0.45, 0.2, 'l'], [0.9, 0]], { type: 'highpass', f: 6000 });
    },
    hybrid: (b) => {
      b.smp('shield_up', { gain: 0.8 });
      const tr = b.trem([[0, 6], [0.6, 22]], 0.5, 1.0);
      b.osc('sine', [[0, 880], [0.5, 1760]], [[0, 0], [0.4, 0.1, 'l'], [1.0, 0]], { to: tr });
      b.noise('white', [[0.2, 0], [0.45, 0.12, 'l'], [0.9, 0]], { type: 'highpass', f: 6000 });
    },
  },
  shield_hit: {
    gain: 0.55, ref: 4, vary: 0.08, needs: ['shield_hit'],
    build: (b) => {
      const s = b.osc('sine', [[0, 900], [0.25, 420]], perc(0.5, 0.3, 0.002));
      b.lfo(s.o.frequency, 'sine', 38, 140, 0, 0.3);
      b.osc('triangle', [[0, 1800], [0.2, 840]], perc(0.15, 0.2, 0.002));
      b.noise('white', perc(0.4, 0.06, 0.001), { type: 'bandpass', f: 3500, q: 1 });
    },
    hybrid: (b) => {
      b.smp('shield_hit', { gain: 0.7, rate: rnd(0.9, 1.2) });
      const s = b.osc('sine', [[0, 900], [0.25, 420]], perc(0.35, 0.3, 0.002));
      b.lfo(s.o.frequency, 'sine', 38, 140, 0, 0.3);
    },
  },
  shield_down: {
    gain: 0.55, ref: 5, verb: 0.3, vary: 0.03, needs: ['shield_down'],
    build: (b) => {
      const tr = b.trem([[0, 20], [0.8, 4]], 0.5, 0.95);
      const lp = b.filt('lowpass', [[0, 3000], [0.8, 200]], 3, tr);
      b.osc('sawtooth', [[0, 220], [0.8, 55]], [[0, 0], [0.02, 0.35, 'l'], [0.85, 0]], { to: lp });
      b.osc('sawtooth', [[0, 331], [0.8, 80]], [[0, 0], [0.02, 0.2, 'l'], [0.85, 0]], { to: lp });
      b.noise('crackle', perc(0.4, 0.5, 0.01), { type: 'highpass', f: 2500 });
    },
    hybrid: (b) => {
      b.smp('shield_down', { gain: 0.8 });
      const tr = b.trem([[0, 20], [0.8, 4]], 0.5, 0.95);
      const lp = b.filt('lowpass', [[0, 3000], [0.8, 200]], 3, tr);
      b.osc('sawtooth', [[0, 220], [0.8, 55]], [[0, 0], [0.02, 0.2, 'l'], [0.85, 0]], { to: lp });
    },
  },
  melee: {
    gain: 0.85, ref: 4, vary: 0.1,
    build: (b) => {
      whoosh(b, 0, 0.22, 0.8, 600, 3200);
      b.noise('white', perc(0.25, 0.02, 0.001), { type: 'highpass', f: 4000 });
    },
  },
  grapple_fire: {
    gain: 0.8, ref: 5, vary: 0.05,
    build: (b) => {
      b.noise('crackle', hits([[0, 0.9, 0.015]], 0.001), { type: 'highpass', f: 2000 });
      servo(b, 0.01, 0.35, 1400, 380, 0.25);
      whoosh(b, 0, 0.3, 0.6, 900, 2600);
      b.fm(820, 3.1, [[0, 900], [0.25, 60]], perc(0.25, 0.3, 0.001));
    },
  },
  grapple_hit: {
    gain: 0.8, ref: 5, vary: 0.06, needs: ['clank'],
    build: (b) => {
      subThump(b, 140, 60, 0.7, 0.2);
      b.fm(420, 2.7, [[0, 700], [0.2, 50]], perc(0.4, 0.25, 0.001));
      b.noise('white', perc(0.4, 0.04, 0.001), { type: 'bandpass', f: 2400, q: 1.5 });
    },
    hybrid: (b) => {
      b.smp('clank', { gain: 0.7, rate: rnd(1.1, 1.3) });
      servo(b, 0.05, 0.4, 300, 900, 0.18);
    },
  },
  airbrake: {
    gain: 0.75, ref: 5, vary: 0.05,
    build: (b) => {
      b.noise('white', [[0, 0], [0.04, 0.8, 'l'], [0.35, 0.5], [0.6, 0]], { type: 'bandpass', f: [[0, 5200], [0.6, 1400]], q: 0.9 });
      b.noise('brown', [[0, 0], [0.05, 0.6, 'l'], [0.6, 0]], { type: 'lowpass', f: 500 });
    },
  },
  roll: {
    gain: 0.6, ref: 4, vary: 0.08,
    build: (b) => {
      whoosh(b, 0, 0.4, 0.5, 300, 1200);
      subThump(b, 80, 40, 0.5, 0.12, 0.3);
      b.noise('brown', [[0.28, 0], [0.3, 0.6, 'l'], [0.5, 0]], { type: 'lowpass', f: 900 });
    },
  },
  slide: {
    gain: 0.6, ref: 4, vary: 0.08,
    build: (b) => {
      b.noise('pink', [[0, 0], [0.05, 0.7, 'l'], [0.7, 0.4], [0.95, 0]], { type: 'bandpass', f: [[0, 1400], [0.9, 600]], q: 0.8 });
      b.noise('brown', [[0, 0], [0.05, 0.5, 'l'], [0.9, 0]], { type: 'lowpass', f: 400 });
    },
  },
  mantle: {
    gain: 0.55, ref: 4, vary: 0.08,
    build: (b) => {
      subThump(b, 110, 50, 0.6, 0.14);
      b.noise('white', perc(0.35, 0.06, 0.001), { type: 'bandpass', f: 1600, q: 1.2 });
      servo(b, 0.05, 0.25, 300, 520, 0.12);
    },
  },
  deploy: {
    gain: 0.8, ref: 6, vary: 0.04,
    build: (b) => {
      subThump(b, 120, 45, 0.9, 0.25);
      servo(b, 0.08, 0.6, 180, 620, 0.3);
      b.fm(660, 2, [[0.5, 300], [0.8, 20]], [[0.55, 0], [0.56, 0.4, 'l'], [0.9, 0]]);
      b.noise('white', perc(0.4, 0.05, 0.001), { type: 'bandpass', f: 1200, q: 1.3 });
    },
  },
  drone_fire: {
    gain: 0.45, ref: 6, vary: 0.08, throttle: 40,
    build: (b) => {
      b.fm(1300, 1.5, [[0, 900], [0.08, 50]], perc(0.6, 0.08, 0.001));
      b.noise('white', perc(0.4, 0.04, 0.0005), { type: 'highpass', f: 3000 });
    },
  },
  grenade_throw: {
    gain: 0.9, ref: 4, vary: 0.08,
    build: (b) => {
      whoosh(b, 0, 0.36, 0.5, 400, 1700);
      b.noise('white', perc(0.3, 0.015, 0.0005), { type: 'bandpass', f: 3000, q: 2 });
    },
  },
  grenade_bounce: {
    gain: 0.55, ref: 3, vary: 0.12, needs: ['clank'],
    build: (b) => {
      b.fm(rnd(280, 360), 2.1, [[0, 500], [0.12, 30]], perc(0.35, 0.14, 0.001));
      subThump(b, 160, 80, 0.6, 0.09);
      b.noise('brown', perc(0.5, 0.07, 0.001), { type: 'lowpass', f: 1400 });
    },
    hybrid: (b) => {
      b.smp('clank', { gain: 0.6, rate: rnd(1.1, 1.5) });
      subThump(b, 160, 80, 0.5, 0.09);
    },
  },

  // ------------------------------------------------------------ game events
  pod_incoming: {
    bus: 'ui', gain: 0.7, vary: 0, needs: ['pod_alarm'],
    build: (b) => {
      chime(b, [79, 84, 88], 0.12, 0.3, 0.45);
      const lp = b.filt('lowpass', 2600, 1);
      const f: Env = [[0.4, 480], [0.8, 880, 'l'], [1.2, 480, 'l'], [1.6, 880, 'l'], [2.1, 420, 'l']];
      const e: Env = [[0.4, 0], [0.5, 0.2, 'l'], [1.9, 0.2], [2.2, 0]];
      b.osc('sawtooth', f, e, { to: lp });
      b.osc('square', f, scaleEnv(e, 0.4), { to: lp, detune: -1200 });
    },
    hybrid: (b) => {
      chime(b, [79, 84, 88], 0.12, 0.28, 0.45);
      b.smp('pod_alarm', { at: 0.38, gain: 0.55 });
    },
  },
  pod_land: {
    gain: 0.8, ref: 14, verb: 0.45, vary: 0.04, prio: 3, needs: ['explosion_big'],
    build: (b) => {
      b.osc('sine', [[0, 90], [0.4, 28]], [[0, 0], [0.005, 1, 'l'], [0.2, 0.8], [1.0, 0]]);
      const sh = b.shape(2.2, 0.8);
      b.noise('brown', [[0, 0], [0.005, 1, 'l'], [0.1, 0.7], [1.1, 0]], { type: 'lowpass', f: [[0, 2500], [1, 180]], q: 1, to: sh });
      b.fm(130, 1.73, [[0, 700], [1.2, 40]], perc(0.35, 1.3, 0.002));
      b.noise('crackle', perc(0.4, 0.6, 0.004, 0.02), { type: 'bandpass', f: 1500, q: 0.7 });
      b.noise('white', [[0.7, 0], [0.75, 0.45, 'l'], [1.5, 0.3], [2.3, 0]], { type: 'highpass', f: [[0.7, 2500], [2.2, 4500]], q: 0.5 });
      subThump(b, 140, 60, 0.5, 0.15, 1.9);
      b.noise('white', perc(0.4, 0.04, 0.001, 1.9), { type: 'bandpass', f: 900, q: 1.5 });
    },
    hybrid: (b) => {
      b.smp('explosion_big', { gain: 0.75, rate: 0.78, dur: 2.2 });
      b.osc('sine', [[0, 90], [0.4, 28]], [[0, 0], [0.005, 1, 'l'], [0.2, 0.8], [1.0, 0]]);
      b.fm(130, 1.73, [[0, 700], [1.2, 40]], perc(0.3, 1.3, 0.002));
      b.noise('white', [[0.7, 0], [0.75, 0.4, 'l'], [1.5, 0.28], [2.3, 0]], { type: 'highpass', f: [[0.7, 2500], [2.2, 4500]], q: 0.5 });
      subThump(b, 140, 60, 0.5, 0.15, 1.9);
      b.noise('white', perc(0.4, 0.04, 0.001, 1.9), { type: 'bandpass', f: 900, q: 1.5 });
    },
  },
  capture: {
    bus: 'ui', gain: 0.6, vary: 0,
    build: (b) => {
      const lp = b.filt('lowpass', [[0, 1500], [0.5, 5000]], 1.5);
      const ns = [72, 76, 79, 84, 88];
      ns.forEach((m, i) => {
        const last = i === ns.length - 1;
        b.osc('sawtooth', mtof(m), perc(0.45, last ? 0.8 : 0.25, 0.004, i * 0.075), { to: lp });
      });
      b.osc('triangle', mtof(100), perc(0.1, 0.9, 0.004, 0.3));
    },
  },
  point_lost: {
    bus: 'ui', gain: 0.6, vary: 0,
    build: (b) => {
      const lp = b.filt('lowpass', [[0, 3000], [0.8, 900]], 2);
      [76, 72, 69, 65].forEach((m, i) => b.osc('square', mtof(m), perc(0.3, i === 3 ? 0.7 : 0.2, 0.004, i * 0.13), { to: lp }));
      b.osc('sawtooth', [[0, mtof(41)], [0.9, mtof(38)]], [[0, 0], [0.05, 0.2, 'l'], [0.8, 0.15], [1.1, 0]], { to: lp });
    },
  },
  countdown: {
    bus: 'ui', gain: 0.45, vary: 0,
    build: (b) => {
      b.osc('sine', 880, [[0, 0], [0.004, 0.5, 'l'], [0.12, 0.45], [0.2, 0]]);
      b.osc('square', 880, [[0, 0], [0.004, 0.08, 'l'], [0.12, 0.07], [0.18, 0]], { to: b.filt('lowpass', 3000, 0.7) });
    },
  },
  match_start: {
    bus: 'ui', gain: 0.5, vary: 0,
    build: (b) => {
      b.osc('sine', 1760, [[0, 0], [0.004, 0.35, 'l'], [0.25, 0.3], [0.4, 0]]);
      const lp = b.filt('lowpass', [[0, 400], [0.08, 3500], [0.6, 1800], [1.4, 600]], 2);
      const sh = b.shape(1.5, 0.6, lp);
      const e: Env = [[0, 0], [0.05, 0.35, 'l'], [0.9, 0.3], [1.4, 0]];
      for (const m of [45, 52, 57, 61]) b.osc('sawtooth', mtof(m), e, { to: sh, detune: rnd(-8, 8) });
      subThump(b, 120, 45, 0.6, 0.3);
    },
  },
  victory: {
    bus: 'ui', gain: 0.65, vary: 0,
    build: (b) => {
      const lp = b.filt('lowpass', [[0, 2200], [0.44, 2200], [0.6, 4000], [1.8, 1500]], 1.2);
      const sh = b.shape(1.4, 0.6, lp);
      brassNote(b, sh, 67, 0, 0.1, 0.25);
      brassNote(b, sh, 67, 0.14, 0.1, 0.25);
      brassNote(b, sh, 67, 0.28, 0.1, 0.25);
      for (const m of [60, 64, 67, 72]) brassNote(b, sh, m, 0.44, 1.0, 0.18, rnd(-7, 7));
      b.noise('white', [[0.44, 0], [0.46, 0.15, 'l'], [1.8, 0]], { type: 'highpass', f: 7000 });
      subThump(b, 110, 45, 0.5, 0.3, 0.44);
    },
  },
  defeat: {
    // cartoon "sad trombone": wah-wah-wah-waaah
    bus: 'ui', gain: 0.7, vary: 0,
    build: (b) => {
      const notes: [number, number, number][] = [[55, 0, 0.38], [54, 0.42, 0.38], [53, 0.84, 0.38], [52, 1.26, 1.2]];
      notes.forEach(([m, at, dur], i) => {
        const lp = b.filt('lowpass', [[at, 350], [at + 0.12, 1500], [at + dur, 500]], 6);
        const o = b.osc('sawtooth', mtof(m), [[at, 0], [at + 0.04, 0.3, 'l'], [at + dur, 0.25], [at + dur + 0.12, 0]], { to: lp });
        if (i === 3) b.lfo(o.o.detune, 'sine', 5.5, 45, at + 0.25, at + dur + 0.12);
      });
    },
  },
  streak: {
    bus: 'ui', gain: 0.5, vary: 0,
    build: (b) => {
      const lp = b.filt('lowpass', [[0, 4500], [1.2, 1200]], 1);
      const sh = b.shape(6, 0.35, lp);
      const e: Env = [[0, 0], [0.005, 0.5, 'l'], [0.3, 0.4], [1.3, 0]];
      for (const m of [40, 47, 52]) b.osc('sawtooth', mtof(m), e, { to: sh, detune: rnd(-10, 10) });
      subThump(b, 150, 45, 0.8, 0.3);
      b.noise('white', perc(0.3, 1.2, 0.002), { type: 'highpass', f: 5000 });
    },
  },
  respawn: {
    gain: 0.55, verb: 0.3, vary: 0.02, needs: ['teleport'],
    build: (b) => {
      b.noise('pink', [[0, 0], [0.7, 0.6], [0.8, 0.6], [1.2, 0]], { type: 'bandpass', f: [[0, 300], [0.8, 5000]], q: 1.5 });
      const s = b.osc('sine', [[0, 200], [0.8, 1600]], [[0, 0], [0.6, 0.2, 'l'], [0.85, 0]]);
      b.lfo(s.o.detune, 'sine', 12, 80, 0, 0.9);
      subThump(b, 160, 55, 0.8, 0.25, 0.8);
      b.noise('white', [[0.8, 0], [0.82, 0.4, 'l'], [1.3, 0]], { type: 'highpass', f: 3000 });
      b.fm(mtof(84), 3, [[0.82, 600], [1.5, 40]], perc(0.2, 0.7, 0.003, 0.82));
    },
    hybrid: (b) => {
      b.smp('teleport', { gain: 0.8 });
      subThump(b, 160, 55, 0.7, 0.25, 0.8);
      b.noise('white', [[0.8, 0], [0.82, 0.3, 'l'], [1.3, 0]], { type: 'highpass', f: 3000 });
      b.fm(mtof(84), 3, [[0.82, 600], [1.5, 40]], perc(0.15, 0.7, 0.003, 0.82));
    },
  },
  ui_click: {
    bus: 'ui', gain: 0.4, vary: 0.02, needs: ['ui_click'],
    build: (b) => {
      b.osc('sine', [[0, 1900], [0.03, 1100]], perc(0.4, 0.05, 0.001));
      b.noise('white', perc(0.2, 0.01, 0.0005), { type: 'highpass', f: 4000 });
    },
    hybrid: (b) => {
      b.smp('ui_click', { gain: 0.9 });
      b.osc('sine', [[0, 1900], [0.03, 1100]], perc(0.15, 0.04, 0.001));
    },
  },
  ui_hover: {
    bus: 'ui', gain: 0.3, vary: 0.02, throttle: 40,
    build: (b) => {
      b.osc('sine', 2600, perc(0.25, 0.035, 0.002));
    },
  },
};

// ============================================================================
// Loops
// ============================================================================

/** Persistent-graph toolkit for continuous loops (sources run until the loop is torn down). */
class LoopKit {
  readonly nodes: AudioNode[] = [];
  readonly srcs: AudioScheduledSourceNode[] = [];
  /** sample keys the graph wanted but that weren't loaded yet (triggers a rebuild later) */
  readonly missing: string[] = [];

  constructor(
    private readonly ctx: AudioContext,
    private readonly lib: SynthLib,
    private readonly t0: number,
  ) {}

  gain(v: number, to: AudioNode | AudioParam): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = v;
    if (to instanceof AudioParam) g.connect(to);
    else g.connect(to);
    this.nodes.push(g);
    return g;
  }

  filt(type: BiquadFilterType, f: number, q: number, to: AudioNode): BiquadFilterNode {
    const b = this.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    b.connect(to);
    this.nodes.push(b);
    return b;
  }

  noise(kind: NoiseKind, to: AudioNode, rate = 1): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = this.lib.noise[kind];
    s.loop = true;
    s.playbackRate.value = rate;
    s.connect(to);
    s.start(this.t0, Math.random() * 1.9);
    this.nodes.push(s);
    this.srcs.push(s);
    return s;
  }

  osc(type: OscillatorType, f: number, to: AudioNode, level = 1): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.connect(level === 1 ? to : this.gain(level, to));
    o.start(this.t0);
    this.nodes.push(o);
    this.srcs.push(o);
    return o;
  }

  lfo(param: AudioParam, type: OscillatorType, rate: number, depth: number): OscillatorNode {
    return this.osc(type, rate, this.gain(depth, param));
  }

  trem(rate: number, depth: number, to: AudioNode): GainNode {
    const g = this.gain(1, to);
    this.lfo(g.gain, 'sine', rate, depth);
    return g;
  }

  shaper(drive: number, level: number, to: AudioNode): WaveShaperNode {
    const ws = this.ctx.createWaveShaper();
    ws.curve = this.lib.curve(drive);
    ws.connect(this.gain(level, to));
    this.nodes.push(ws);
    return ws;
  }

  /** Looping recorded sample (null + marked missing if not loaded yet). */
  loopSample(key: string, to: AudioNode, rate = 1): AudioBufferSourceNode | null {
    const s = this.lib.bank.pick(key);
    if (!s) {
      this.missing.push(key);
      return null;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = s.buf;
    src.loop = true;
    src.loopStart = s.start;
    src.loopEnd = s.end;
    src.playbackRate.value = rate;
    src.connect(to);
    src.start(this.t0, s.start + Math.random() * (s.end - s.start) * 0.9);
    this.nodes.push(src);
    this.srcs.push(src);
    return src;
  }
}

interface LoopState {
  id: Loop;
  def: LoopDef;
  active: boolean;
  intensity: number;
  applied: number;
  appliedAt: number;
  /** on/off fader (rhythmic events connect here) */
  out: GainNode;
  /** continuous graph output → out (swapped on rebuild) */
  inner: GainNode | null;
  strip: Strip;
  nodes: AudioNode[];
  srcs: AudioScheduledSourceNode[];
  missing: string[];
  update: ((i: number, now: number) => void) | null;
  next: number;
  phase: number;
  offAt: number;
  lpF: number;
}

interface LoopDef {
  bus: BusId;
  ref?: number;
  verb?: number;
  helm?: number;
  /** continuous graph; returns an updater applied when intensity changes */
  graph?: (k: LoopKit, out: GainNode) => (i: number, now: number) => void;
  /** rhythmic loops: schedule one event at time t, return seconds until the next one */
  event?: (mk: (t: number) => Builder, st: LoopState, t: number) => number;
  firstDelay?: number;
}

const LOOPS: Record<Loop, LoopDef> = {
  // thruster: recorded afterburner + procedural roar; intensity = throttle
  jet: {
    bus: 'sfx', ref: 5,
    graph: (k, out) => {
      const lp = k.filt('lowpass', 2000, 0, out);
      const sg = k.gain(0, lp);
      const s = k.loopSample('jet_loop', sg);
      const roarG = k.gain(0, out);
      const rlp = k.filt('lowpass', 300, 1, roarG);
      k.noise('brown', k.trem(13, 0.15, rlp));
      const hissG = s ? null : k.gain(0, out);
      const bp = hissG ? k.filt('bandpass', 1500, 0.8, hissG) : null;
      if (bp) k.noise('white', bp);
      return (i, now) => {
        const T = (p: AudioParam, v: number): void => {
          p.setTargetAtTime(v, now, 0.06);
        };
        if (s) {
          T(sg.gain, 0.22 + 0.6 * i);
          T(s.playbackRate, 0.82 + 0.3 * i);
          T(lp.frequency, 1800 + 7000 * i);
        }
        T(roarG.gain, (s ? 0.06 : 0.1) + 0.45 * i);
        T(rlp.frequency, 250 + 1300 * i);
        if (hissG && bp) {
          T(hissG.gain, 0.04 + 0.25 * i);
          T(bp.frequency, 900 + 2600 * i);
        }
      };
    },
  },
  // helmet breathing: filtered noise in inhale/exhale cycles, faster + sharper with intensity
  breathing: {
    bus: 'suit', helm: 0.25,
    event: (mk, st, t) => {
      const i = st.intensity;
      const cycle = 4.4 - 3.2 * i;
      const amp = 0.25 + 0.6 * i;
      const b = mk(t);
      if (st.phase++ % 2 === 0) {
        const d = cycle * (0.36 - 0.08 * i);
        const f0 = 900 + 700 * i;
        const att = d * (0.55 - 0.35 * i);
        b.noise('pink', [[0, 0], [att, amp, 'l'], [d * 0.85, amp * 0.7], [d, 0]], { type: 'bandpass', f: [[0, f0], [d, f0 * 1.35]], q: 1.1 + i });
        b.noise('white', [[0, 0], [att, amp * 0.25, 'l'], [d, 0]], { type: 'highpass', f: 3000 + 1500 * i });
        return d + cycle * 0.06;
      }
      const d = cycle * (0.42 - 0.04 * i);
      const f0 = 650 + 400 * i;
      b.noise('pink', [[0, 0], [d * 0.2, amp * 0.8, 'l'], [d * 0.6, amp * 0.5], [d, 0]], { type: 'bandpass', f: [[0, f0], [d, f0 * 0.7]], q: 0.9 });
      b.noise('brown', [[0, 0], [d * 0.2, amp * 0.4, 'l'], [d, 0]], { type: 'lowpass', f: 400 });
      return d + cycle * 0.16 * (1 - 0.6 * i);
    },
  },
  // air leaking out of the suit
  hiss: {
    bus: 'suit',
    graph: (k, out) => {
      const g = k.gain(0, out);
      const hp = k.filt('highpass', 2500, 0.7, g);
      k.noise('white', k.trem(9, 0.25, hp));
      const wg = k.gain(0, out);
      const bp = k.filt('bandpass', 5200, 8, wg);
      k.noise('pink', bp);
      return (i, now) => {
        g.gain.setTargetAtTime(0.05 + 0.4 * i, now, 0.08);
        hp.frequency.setTargetAtTime(1800 + 2500 * i, now, 0.08);
        wg.gain.setTargetAtTime(0.9 * i * i, now, 0.08);
        bp.frequency.setTargetAtTime(4200 + 2200 * i, now, 0.08);
      };
    },
  },
  heartbeat: {
    bus: 'suit',
    event: (mk, st, t) => {
      const i = st.intensity;
      const period = 60 / (58 + 110 * i);
      const a = 0.25 + 0.6 * i;
      const gap = Math.min(0.14, period * 0.3);
      const b = mk(t);
      const lp = b.filt('lowpass', 260, 0);
      b.osc('triangle', [[0, 70], [0.09, 42]], perc(a, 0.16, 0.008), { to: lp });
      b.osc('triangle', [[gap, 62], [gap + 0.09, 38]], perc(a * 0.7, 0.2, 0.008, gap), { to: lp });
      b.noise('brown', hits([[0, a * 0.5, 0.08], [gap, a * 0.35, 0.09]], 0.006), { type: 'lowpass', f: 140 });
      return period;
    },
  },
  // low-oxygen warning beeps
  alarm: {
    bus: 'suit',
    event: (mk, st, t) => {
      const i = st.intensity;
      const a = 0.1 + 0.12 * i;
      const b = mk(t);
      const lp = b.filt('lowpass', 2500 + 2000 * i, 0.8);
      b.osc('square', steps([[0, 1320], [0.14, 990]]), gates([[0, 0.11, a], [0.14, 0.12, a]]), { to: lp });
      return 1.3 - 0.6 * i;
    },
  },
  // suit life-support hum + base machinery bed + faint radio static
  ambient: {
    bus: 'suit', firstDelay: 5,
    graph: (k, out) => {
      const g = k.gain(0, out);
      const s = k.loopSample('ambient_loop', k.gain(0.55, g));
      const hum = k.gain(s ? 0.25 : 0.5, g);
      const lp = k.filt('lowpass', 300, 0, hum);
      k.osc('sine', 58, lp);
      k.osc('triangle', 116.7, lp, 0.3);
      k.lfo(hum.gain, 'sine', 0.13, 0.1);
      k.noise('brown', k.filt('lowpass', 220, 0, k.gain(s ? 0.3 : 0.6, g)));
      k.noise('crackle', k.filt('bandpass', 2600, 0.8, k.gain(0.05, g)));
      return (i, now) => g.gain.setTargetAtTime(0.1 * (0.3 + 0.7 * i), now, 0.3);
    },
    event: (mk, st, t) => {
      // occasional faint radio squelch
      const a = 0.025 * (0.4 + 0.6 * st.intensity);
      mk(t).noise('white', [[0, 0], [0.01, a, 'l'], [0.16, a * 0.7], [0.2, 0]], { type: 'bandpass', f: 2200, q: 1.5 });
      return rnd(7, 18);
    },
  },
  // orbital laser: recorded beam loop + procedural buzz/sizzle (3D at pos)
  beam: {
    bus: 'sfx', ref: 20, verb: 0.2,
    graph: (k, out) => {
      const g = k.gain(0, out);
      const lp = k.filt('lowpass', 2000, 2, g);
      k.lfo(lp.frequency, 'sine', 8.5, 500);
      const s = k.loopSample('beam_loop', lp);
      const sh = k.shaper(2.5, s ? 0.16 : 0.4, lp);
      k.osc('sawtooth', 70, sh);
      k.osc('sawtooth', 70.9, sh);
      k.osc('square', 140.3, sh, 0.5);
      k.noise('white', k.filt('bandpass', 4200, 0.9, k.gain(s ? 0.1 : 0.3, g)));
      k.osc('sine', 35, g, 0.5);
      return (i, now) => {
        g.gain.setTargetAtTime(0.35 + 0.65 * i, now, 0.05);
        lp.frequency.setTargetAtTime(1500 + 5000 * i, now, 0.05);
      };
    },
  },
  // soft tick-tock while capturing; pitch rises with progress (intensity)
  capture_tick: {
    bus: 'ui',
    event: (mk, st, t) => {
      const i = st.intensity;
      const f = (st.phase++ % 2 === 1 ? 1500 : 2000) * (1 + 0.5 * i);
      const b = mk(t);
      b.osc('sine', f, perc(0.12 + 0.15 * i, 0.04, 0.001));
      b.osc('triangle', f * 0.5, perc(0.05 + 0.05 * i, 0.03, 0.001));
      return 0.25;
    },
  },
};

// ============================================================================
// Engine
// ============================================================================

type StripKind = BusId | 'd3';

/** Pooled per-voice channel strip (gain [+ distance LP + low-shelf + panner] + reverb send). */
interface Strip {
  kind: StripKind;
  input: GainNode;
  lp: BiquadFilterNode | null;
  shelf: BiquadFilterNode | null;
  panner: PannerNode | null;
  send: GainNode | null;
}

interface Voice {
  name: string;
  strip: Strip | null;
  nodes: AudioNode[];
  srcs: AudioScheduledSourceNode[];
  start: number;
  end: number;
  loud: number;
  prio: number;
  dying: boolean;
}

interface Buses {
  master: GainNode;
  sfxIn: GainNode;
  sfxLp: BiquadFilterNode;
  sfxVol: GainNode;
  suitIn: GainNode;
  suitLp: BiquadFilterNode;
  suitVol: GainNode;
  uiIn: GainNode;
  uiVol: GainNode;
  musicIn: GainNode;
  musicLp: BiquadFilterNode;
  musicVol: GainNode;
  worldVerbIn: GainNode;
  helmVerbIn: GainNode;
}

export class AudioEngine {
  /** URL prefix of the sample files (set before init() to override). */
  assetBase: string = `${import.meta.env?.BASE_URL ?? './'}audio/`;

  private ctx: AudioContext | null = null;
  private lib: SynthLib | null = null;
  private bus: Buses | null = null;
  private player: MusicPlayer | null = null;
  private readonly vol = { master: 0.85, sfx: 1, music: 0.7 };
  private muffleAmt = 0;
  private readonly lis = { x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: -1, ux: 0, uy: 1, uz: 0 };
  private voices: Voice[] = [];
  private ephemeral: Voice[] = [];
  private readonly loops = new Map<Loop, LoopState>();
  private readonly pool = new Map<StripKind, Strip[]>();
  private readonly recent = new Map<string, { t: number; x: number; y: number; z: number; has: boolean }>();
  private musicKind: 'menu' | 'match' | 'none' = 'none';
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTick = 0;
  private resumeAt = 0;
  private resumeFromGesture = false;
  private unlockBound = false;
  private warned = 0;
  private hrtf = false;

  /** True once the AudioContext exists and is running. */
  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Sample loading progress 0..1 (procedural fallbacks are used until a sample is ready). */
  get loaded(): number {
    return this.lib ? this.lib.bank.progress : 0;
  }

  // ---------------------------------------------------------------- lifecycle

  /** Create/resume the AudioContext. Call from a user gesture. Safe to call many times. */
  init(): void {
    try {
      if (this.ctx) {
        this.resume();
        return;
      }
      if (typeof window === 'undefined') return;
      const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
      const AC = w.AudioContext ?? w.webkitAudioContext;
      if (!AC) return;
      let ctx: AudioContext;
      try {
        ctx = new AC({ latencyHint: 'interactive' });
      } catch {
        ctx = new AC();
      }
      this.ctx = ctx;
      const cache = new Map<number, Float32Array<ArrayBuffer>>();
      const bank = new SampleBank(ctx, this.assetBase);
      this.lib = {
        noise: makeNoiseBank(ctx, 2),
        bank,
        curve: (drive: number) => {
          const k = Math.round(drive * 10) / 10;
          let c = cache.get(k);
          if (!c) {
            c = new Float32Array(1024);
            const n = Math.tanh(k);
            for (let i = 0; i < 1024; i++) c[i] = Math.tanh(k * (i / 511.5 - 1)) / n;
            cache.set(k, c);
          }
          return c;
        },
      };
      this.bus = this.buildBuses(ctx);
      this.applyMix(true);
      this.applyListener();
      this.player = new MusicPlayer(ctx, this.bus.musicIn, this.lib.noise);
      if (this.musicKind !== 'none') this.player.play(this.musicKind);
      ctx.addEventListener('statechange', () => {
        if (ctx.state === 'running') this.removeUnlock();
      });
      this.resume();
      this.timer = setInterval(this.tick, TICK_MS);
      void bank.loadAll().catch(() => undefined);
    } catch (e) {
      this.warn('init', e);
    }
  }

  private buildBuses(ctx: AudioContext): Buses {
    const g = (v = 1): GainNode => {
      const n = ctx.createGain();
      n.gain.value = v;
      return n;
    };
    const lpf = (): BiquadFilterNode => {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 20000;
      f.Q.value = 0;
      return f;
    };
    // master → glue compressor → brickwall-ish limiter → out
    const master = g(this.vol.master);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 10;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.004;
    comp.release.value = 0.22;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -2;
    lim.knee.value = 0;
    lim.ratio.value = 20;
    lim.attack.value = 0.001;
    lim.release.value = 0.08;
    master.connect(comp);
    comp.connect(lim);
    lim.connect(ctx.destination);

    const sfxIn = g(), sfxLp = lpf(), sfxVol = g();
    sfxIn.connect(sfxLp);
    sfxLp.connect(sfxVol);
    sfxVol.connect(master);
    const suitIn = g(), suitLp = lpf(), suitVol = g();
    suitIn.connect(suitLp);
    suitLp.connect(suitVol);
    suitVol.connect(master);
    const uiIn = g(), uiVol = g();
    uiIn.connect(uiVol);
    uiVol.connect(master);
    const musicIn = g(), musicLp = lpf(), musicVol = g();
    musicIn.connect(musicLp);
    musicLp.connect(musicVol);
    musicVol.connect(master);

    // world reverb (big events, other players) — dark 1.6 s tail, muffled with the sfx bus
    const worldVerbIn = g();
    const wv = ctx.createConvolver();
    wv.buffer = makeImpulse(ctx, 1.6, 0.75, 0.02);
    const wvOut = g(0.55);
    worldVerbIn.connect(wv);
    wv.connect(wvOut);
    wvOut.connect(sfxLp);
    // helmet reverb (local player's own sounds) — tiny enclosed space
    const helmVerbIn = g();
    const hv = ctx.createConvolver();
    hv.buffer = makeImpulse(ctx, 0.32, 0.35, 0.003, 10);
    const hvOut = g(0.5);
    helmVerbIn.connect(hv);
    hv.connect(hvOut);
    hvOut.connect(suitLp);

    return { master, sfxIn, sfxLp, sfxVol, suitIn, suitLp, suitVol, uiIn, uiVol, musicIn, musicLp, musicVol, worldVerbIn, helmVerbIn };
  }

  private resume(): void {
    const c = this.ctx;
    if (!c || c.state === 'closed') return;
    if (c.state !== 'running') {
      this.markResume();
      void c.resume().catch(() => undefined);
      this.addUnlock();
    }
  }

  private markResume(): void {
    this.resumeAt = performance.now();
    const ua = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
    this.resumeFromGesture = ua ? ua.isActive : true;
  }

  // autoplay policy: resume on the next user gesture if the context started suspended
  private readonly unlock = (): void => {
    const c = this.ctx;
    if (!c) return;
    if (c.state !== 'running') {
      this.markResume();
      void c.resume().catch(() => undefined);
    } else this.removeUnlock();
  };

  private addUnlock(): void {
    if (this.unlockBound || typeof window === 'undefined') return;
    this.unlockBound = true;
    for (const ev of ['pointerdown', 'keydown', 'touchend', 'mousedown']) window.addEventListener(ev, this.unlock, true);
  }

  private removeUnlock(): void {
    if (!this.unlockBound || typeof window === 'undefined') return;
    this.unlockBound = false;
    for (const ev of ['pointerdown', 'keydown', 'touchend', 'mousedown']) window.removeEventListener(ev, this.unlock, true);
  }

  /**
   * Scheduling is allowed while running, or right after a resume requested from a user gesture
   * (the clock starts a few ms later). Never while autoplay-blocked: that would queue up a burst.
   */
  private canPlay(): boolean {
    const c = this.ctx;
    if (!c) return false;
    return c.state === 'running' || (this.resumeFromGesture && performance.now() - this.resumeAt < 400);
  }

  private warn(where: string, e: unknown): void {
    if (this.warned++ < 8) console.warn(`[audio] ${where}:`, e);
  }

  // ----------------------------------------------------------------- listener

  /** listener = camera */
  setListener(pos: THREE.Vector3, forward: THREE.Vector3, up: THREE.Vector3): void {
    try {
      if (!finite3(pos)) return;
      const L = this.lis;
      L.x = pos.x;
      L.y = pos.y;
      L.z = pos.z;
      if (finite3(forward) && finite3(up) && forward.x * forward.x + forward.y * forward.y + forward.z * forward.z > 1e-8) {
        L.fx = forward.x;
        L.fy = forward.y;
        L.fz = forward.z;
        L.ux = up.x;
        L.uy = up.y;
        L.uz = up.z;
      }
      this.applyListener();
    } catch (e) {
      this.warn('setListener', e);
    }
  }

  private applyListener(): void {
    const c = this.ctx;
    if (!c) return;
    const l = c.listener;
    const L = this.lis;
    if (l.positionX) {
      l.positionX.value = L.x;
      l.positionY.value = L.y;
      l.positionZ.value = L.z;
      l.forwardX.value = L.fx;
      l.forwardY.value = L.fy;
      l.forwardZ.value = L.fz;
      l.upX.value = L.ux;
      l.upY.value = L.uy;
      l.upZ.value = L.uz;
    } else {
      const legacy = l as unknown as {
        setPosition(x: number, y: number, z: number): void;
        setOrientation(x: number, y: number, z: number, ux: number, uy: number, uz: number): void;
      };
      legacy.setPosition(L.x, L.y, L.z);
      legacy.setOrientation(L.fx, L.fy, L.fz, L.ux, L.uy, L.uz);
    }
  }

  /** Optional: HRTF panning (better front/back cues on headphones, more CPU). Default equal-power. */
  setHrtf(on: boolean): void {
    this.hrtf = on;
    const list = this.pool.get('d3');
    if (list) for (const s of list) if (s.panner) s.panner.panningModel = on ? 'HRTF' : 'equalpower';
  }

  // ------------------------------------------------------------------ one-shots

  /** One-shot. pos = world position for 3D sounds (omit for 2D/UI/local-player sounds). */
  play(name: Sfx, opts?: { pos?: THREE.Vector3; volume?: number; pitch?: number }): void {
    const ctx = this.ctx, lib = this.lib;
    if (!ctx || !lib || !this.bus || !this.canPlay()) return;
    try {
      const def = SFX[name];
      if (!def) return;
      const now = ctx.currentTime;
      const busId: BusId = def.bus ?? 'sfx';
      const pos = busId !== 'ui' && finite3(opts?.pos) ? opts?.pos : undefined;
      if (this.throttled(name, pos, def.throttle ?? THROTTLE_MS)) return;
      const vol = clamp(Number.isFinite(opts?.volume) ? (opts?.volume as number) : 1, 0, 4) * (def.gain ?? 1);
      if (vol <= 0.0005) return;
      const ref = def.ref ?? DEFAULT_REF;
      let dGain = 1;
      if (pos) {
        const L = this.lis;
        const d = Math.hypot(pos.x - L.x, pos.y - L.y, pos.z - L.z);
        dGain = ref / (ref + ROLLOFF * (Math.max(d, ref) - ref));
        if (vol * dGain < 0.002) return; // inaudible: don't spend a voice
      }
      const prio = def.prio ?? 1;
      const loud = vol * dGain;
      if (!this.admit(loud, prio, now)) return;

      const strip = this.acquire(pos ? 'd3' : busId);
      const gIn = strip.input.gain;
      gIn.cancelScheduledValues(0);
      gIn.setValueAtTime(vol, now);
      if (strip.send) strip.send.gain.setValueAtTime(pos ? (def.verb ?? 0.06) : (def.helm ?? (busId === 'suit' ? 0.15 : 0.1)), now);
      if (pos) this.place(strip, pos, ref, now, false);

      const vary = def.vary ?? 0.04;
      const pitch = clamp((Number.isFinite(opts?.pitch) ? (opts?.pitch as number) : 1) * (1 + (Math.random() * 2 - 1) * vary), 0.25, 4);
      const b = new Builder(ctx, lib, now + 0.005, strip.input, pitch);
      if (def.hybrid && def.needs && lib.bank.hasAll(def.needs)) def.hybrid(b);
      else def.build(b);
      this.voices.push({ name, strip, nodes: b.nodes, srcs: b.srcs, start: now, end: b.endTime + 0.08, loud, prio, dying: false });
    } catch (e) {
      this.warn(`play(${name})`, e);
    }
  }

  private throttled(name: string, pos: THREE.Vector3 | undefined, windowMs: number): boolean {
    const t = performance.now();
    const r = this.recent.get(name);
    if (r && t - r.t < windowMs) {
      if (!pos || !r.has) return true;
      const dx = pos.x - r.x, dy = pos.y - r.y, dz = pos.z - r.z;
      if (dx * dx + dy * dy + dz * dz < 36) return true; // same-ish place (< 6 m)
    }
    const e = r ?? { t, x: 0, y: 0, z: 0, has: false };
    e.t = t;
    e.has = !!pos;
    if (pos) {
      e.x = pos.x;
      e.y = pos.y;
      e.z = pos.z;
    }
    if (!r) this.recent.set(name, e);
    return false;
  }

  /** Voice budget: steal the quietest / most finished voice, or drop the new one. */
  private admit(loud: number, prio: number, now: number): boolean {
    let live = 0;
    let victim: Voice | null = null;
    let worst = Infinity;
    for (const v of this.voices) {
      if (v.dying) continue;
      live++;
      const life = clamp((now - v.start) / Math.max(0.05, v.end - v.start), 0, 1);
      const s = v.loud * v.prio * (1 - 0.85 * life);
      if (s < worst) {
        worst = s;
        victim = v;
      }
    }
    if (live < MAX_VOICES) return true;
    if (!victim || loud * prio < worst) return false;
    this.kill(victim, now);
    return true;
  }

  private kill(v: Voice, now: number): void {
    v.dying = true;
    const g = v.strip?.input.gain;
    if (g) {
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.setTargetAtTime(0, now, 0.015);
    }
    for (const s of v.srcs) {
      try {
        s.stop(now + 0.08);
      } catch {
        /* not started / already stopped */
      }
    }
    v.end = Math.min(v.end, now + 0.1);
  }

  // --------------------------------------------------------------- strips/pool

  private acquire(kind: StripKind): Strip {
    const s = this.pool.get(kind)?.pop();
    return s ?? this.makeStrip(kind);
  }

  private release(s: Strip): void {
    try {
      s.input.gain.cancelScheduledValues(0);
      s.input.gain.value = 0;
    } catch {
      /* ignore */
    }
    let list = this.pool.get(s.kind);
    if (!list) this.pool.set(s.kind, (list = []));
    if (list.length < POOL_MAX) list.push(s);
    else for (const n of [s.input, s.lp, s.shelf, s.panner, s.send]) n?.disconnect();
  }

  private makeStrip(kind: StripKind): Strip {
    const ctx = this.ctx as AudioContext;
    const b = this.bus as Buses;
    const input = ctx.createGain();
    input.gain.value = 0;
    if (kind === 'd3') {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 20000;
      lp.Q.value = 0;
      const shelf = ctx.createBiquadFilter();
      shelf.type = 'lowshelf';
      shelf.frequency.value = 180;
      shelf.gain.value = 0;
      const p = ctx.createPanner();
      p.panningModel = this.hrtf ? 'HRTF' : 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = DEFAULT_REF;
      p.rolloffFactor = ROLLOFF;
      p.maxDistance = 10000;
      const send = ctx.createGain();
      send.gain.value = 0;
      input.connect(lp);
      lp.connect(shelf);
      shelf.connect(p);
      p.connect(b.sfxIn);
      p.connect(send);
      send.connect(b.worldVerbIn);
      return { kind, input, lp, shelf, panner: p, send };
    }
    input.connect(kind === 'ui' ? b.uiIn : kind === 'suit' ? b.suitIn : b.sfxIn);
    let send: GainNode | null = null;
    if (kind !== 'ui') {
      send = ctx.createGain();
      send.gain.value = 0;
      input.connect(send);
      send.connect(b.helmVerbIn);
    }
    return { kind, input, lp: null, shelf: null, panner: null, send };
  }

  /** Position a 3D strip: panner + "suit radio / ground conduction" distance filtering. */
  private place(s: Strip, pos: THREE.Vector3, ref: number, now: number, smooth: boolean): void {
    const p = s.panner, lp = s.lp, shelf = s.shelf;
    if (!p || !lp || !shelf) return;
    p.refDistance = ref;
    p.rolloffFactor = ROLLOFF;
    setPannerPos(p, pos.x, pos.y, pos.z);
    const L = this.lis;
    const d = Math.hypot(pos.x - L.x, pos.y - L.y, pos.z - L.z);
    const k = Math.max(1, d / ref);
    const far = Math.min(1, (k - 1) / 25);
    const f = clamp(20000 / Math.pow(k, 1.05), 250, 20000);
    if (smooth) {
      lp.frequency.setTargetAtTime(f, now, 0.05);
      lp.Q.setTargetAtTime(far * 5, now, 0.05);
      shelf.gain.setTargetAtTime(far * 7, now, 0.05);
    } else {
      lp.frequency.setValueAtTime(f, now);
      lp.Q.setValueAtTime(far * 5, now);
      shelf.gain.setValueAtTime(far * 7, now);
    }
  }

  // --------------------------------------------------------------------- loops

  /** Continuous loops. Idempotent: call every frame with the current state. */
  setLoop(id: Loop, active: boolean, intensity = 1, pos?: THREE.Vector3): void {
    const ctx = this.ctx;
    if (!ctx || !this.lib || !this.bus) return;
    try {
      const now = ctx.currentTime;
      let L = this.loops.get(id);
      if (!active) {
        if (L && L.active) {
          L.active = false;
          L.offAt = now;
          L.out.gain.setTargetAtTime(0, now, 0.08);
        }
        return;
      }
      if (!this.canPlay()) return;
      if (!L) {
        L = this.createLoop(id, now);
        this.loops.set(id, L);
      }
      const spatial = finite3(pos);
      const want: StripKind = spatial ? 'd3' : L.def.bus;
      if (L.strip.kind !== want) this.reroute(L, want);
      if (spatial && pos) {
        const ref = L.def.ref ?? DEFAULT_REF;
        this.place(L.strip, pos, ref, now, true);
      }
      if (!L.active) {
        L.active = true;
        L.out.gain.setTargetAtTime(1, now, 0.06);
        if (L.next < now) L.next = now + (L.def.firstDelay ?? 0.02);
      }
      const i = clamp01(intensity);
      L.intensity = i;
      if (L.update && (L.applied < 0 || Math.abs(i - L.applied) > 0.015 || (i !== L.applied && now - L.appliedAt > 0.25))) {
        L.update(i, now);
        L.applied = i;
        L.appliedAt = now;
      }
    } catch (e) {
      this.warn(`setLoop(${id})`, e);
    }
  }

  private createLoop(id: Loop, now: number): LoopState {
    const ctx = this.ctx as AudioContext;
    const def = LOOPS[id];
    const out = ctx.createGain();
    out.gain.value = 0;
    const strip = this.acquire(def.bus);
    this.primeStrip(strip, def);
    out.connect(strip.input);
    const L: LoopState = {
      id, def, active: false, intensity: 0, applied: -1, appliedAt: 0, out, inner: null, strip,
      nodes: [], srcs: [], missing: [], update: null, next: 0, phase: 0, offAt: now, lpF: 0,
    };
    this.buildLoopGraph(L, now, false);
    return L;
  }

  private primeStrip(s: Strip, def: LoopDef): void {
    s.input.gain.cancelScheduledValues(0);
    s.input.gain.value = 1;
    if (s.send) s.send.gain.value = s.kind === 'd3' ? (def.verb ?? 0) : (def.helm ?? 0);
  }

  /** (Re)build a continuous loop's graph; crossfades from the old graph when rebuilding. */
  private buildLoopGraph(L: LoopState, now: number, fade: boolean): void {
    const def = L.def;
    if (!def.graph) return;
    const ctx = this.ctx as AudioContext;
    if (L.inner) {
      // retire the old graph (e.g. procedural → now that the sample has loaded)
      const old = L.inner;
      old.gain.setTargetAtTime(0, now, 0.08);
      for (const s of L.srcs) {
        try {
          s.stop(now + 0.5);
        } catch {
          /* ignore */
        }
      }
      this.ephemeral.push({ name: L.id, strip: null, nodes: [...L.nodes, old], srcs: L.srcs, start: now, end: now + 0.6, loud: 0, prio: 0, dying: true });
    }
    const inner = ctx.createGain();
    inner.gain.value = fade ? 0 : 1;
    if (fade) inner.gain.setTargetAtTime(1, now, 0.08);
    inner.connect(L.out);
    const kit = new LoopKit(ctx, this.lib as SynthLib, now);
    L.update = def.graph(kit, inner);
    L.inner = inner;
    L.nodes = kit.nodes;
    L.srcs = kit.srcs;
    L.missing = kit.missing;
    L.applied = -1;
    if (L.active) {
      L.update(L.intensity, now);
      L.applied = L.intensity;
      L.appliedAt = now;
    }
  }

  private reroute(L: LoopState, kind: StripKind): void {
    try {
      L.out.disconnect();
    } catch {
      /* ignore */
    }
    this.release(L.strip);
    const s = this.acquire(kind);
    this.primeStrip(s, L.def);
    L.out.connect(s.input);
    L.strip = s;
  }

  private destroyLoop(L: LoopState): void {
    for (const s of L.srcs) {
      try {
        s.stop();
      } catch {
        /* ignore */
      }
    }
    for (const n of L.nodes) n.disconnect();
    L.inner?.disconnect();
    L.out.disconnect();
    this.release(L.strip);
  }

  private runEvents(L: LoopState, now: number, horizon: number): void {
    const ev = L.def.event;
    const ctx = this.ctx, lib = this.lib;
    if (!ev || !ctx || !lib) return;
    if (L.next < now - 0.25) L.next = now + 0.02; // fell behind: resync instead of bursting
    let guard = 0;
    while (L.next < horizon && guard++ < 16) {
      const made: Builder[] = [];
      const t = Math.max(L.next, now + 0.005);
      const dt = ev((tt) => {
        const b = new Builder(ctx, lib, tt, L.out, 1);
        made.push(b);
        return b;
      }, L, t);
      for (const b of made) this.ephemeral.push({ name: L.id, strip: null, nodes: b.nodes, srcs: b.srcs, start: t, end: b.endTime + 0.05, loud: 0, prio: 0, dying: false });
      L.next = t + Math.max(0.03, dt);
    }
  }

  /** stop all loops (e.g. on match end / leaving to menu) */
  stopAllLoops(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      for (const L of this.loops.values()) {
        if (!L.active) continue;
        L.active = false;
        L.offAt = now;
        L.out.gain.setTargetAtTime(0, now, 0.05);
      }
    } catch (e) {
      this.warn('stopAllLoops', e);
    }
  }

  // ---------------------------------------------------------------------- mix

  setMasterVolume(v: number): void {
    this.vol.master = clamp01(v);
    this.applyMix(false);
  }

  setSfxVolume(v: number): void {
    this.vol.sfx = clamp01(v);
    this.applyMix(false);
  }

  setMusicVolume(v: number): void {
    this.vol.music = clamp01(v);
    this.applyMix(false);
  }

  /** 0..1 low-pass "muffled/deafened" effect on everything except UI (concussion, suffocation). */
  setMuffle(amount: number): void {
    const a = clamp01(amount);
    if (Math.abs(a - this.muffleAmt) < 0.003) return;
    this.muffleAmt = a;
    this.applyMix(false);
  }

  private applyMix(instant: boolean): void {
    const c = this.ctx, b = this.bus;
    if (!c || !b) return;
    try {
      const now = c.currentTime;
      const set = (p: AudioParam, v: number, tau: number): void => {
        if (instant) {
          p.cancelScheduledValues(0);
          p.setValueAtTime(v, now);
        } else p.setTargetAtTime(v, now, tau);
      };
      const m = this.muffleAmt;
      set(b.master.gain, this.vol.master, 0.03);
      set(b.sfxVol.gain, this.vol.sfx * (1 - 0.3 * m), 0.08);
      set(b.suitVol.gain, this.vol.sfx, 0.05);
      set(b.uiVol.gain, this.vol.sfx * UI_TRIM, 0.05);
      set(b.musicVol.gain, this.vol.music * MUSIC_TRIM, 0.1);
      // muffle: world sfx heavily, suit/helmet lightly (your own breathing/heartbeat stay clear), music slightly
      set(b.sfxLp.frequency, 20000 * Math.pow(320 / 20000, m), 0.08);
      set(b.sfxLp.Q, m * 4, 0.08);
      set(b.suitLp.frequency, 20000 * Math.pow(3000 / 20000, m), 0.08);
      set(b.musicLp.frequency, 20000 * Math.pow(1800 / 20000, m), 0.12);
    } catch (e) {
      this.warn('mix', e);
    }
  }

  // -------------------------------------------------------------------- music

  music(kind: 'menu' | 'match' | 'none'): void {
    this.musicKind = kind;
    try {
      this.player?.play(kind);
    } catch (e) {
      this.warn('music', e);
    }
  }

  // --------------------------------------------------------------------- tick

  /** Lookahead scheduler + housekeeping (runs every ~40 ms). */
  private readonly tick = (): void => {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      if (ctx.state === 'closed') {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        return;
      }
      const ms = performance.now();
      const gap = this.lastTick ? (ms - this.lastTick) / 1000 : TICK_MS / 1000;
      this.lastTick = ms;
      if (ctx.state !== 'running') return;
      const now = ctx.currentTime;
      // look further ahead if the timer is being throttled
      const horizon = now + clamp(gap * 2 + 0.06, 0.2, 1.5);

      this.player?.schedule(horizon);

      const bank = this.lib?.bank;
      for (const L of this.loops.values()) {
        if (L.active) {
          if (L.def.event) this.runEvents(L, now, horizon);
          if (bank && L.missing.length && bank.hasAll(L.missing)) this.buildLoopGraph(L, now, true);
        } else if (now - L.offAt > 1.5) {
          this.destroyLoop(L);
          this.loops.delete(L.id);
        }
      }

      this.sweep(this.voices, now);
      this.sweep(this.ephemeral, now);
      if (this.recent.size > 128) this.recent.clear();
    } catch (e) {
      this.warn('tick', e);
    }
  };

  /** Disconnect finished voices and return their strips to the pool. */
  private sweep(list: Voice[], now: number): void {
    let w = 0;
    for (let r = 0; r < list.length; r++) {
      const v = list[r];
      if (v.end <= now) {
        for (const n of v.nodes) {
          try {
            n.disconnect();
          } catch {
            /* ignore */
          }
        }
        if (v.strip) this.release(v.strip);
      } else list[w++] = v;
    }
    list.length = w;
  }
}

/** Singleton instance. */
export const audio: AudioEngine = new AudioEngine();
