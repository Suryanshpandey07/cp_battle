/**
 * The music player: a look-ahead sequencer on the WebAudio clock. Every 25 ms
 * it schedules the 16th notes due in the next 150 ms, bar by bar, from
 * tracks.ts. Instruments are synthesised here (oscillators, filters, a noise
 * buffer, an FM pair). A new track crossfades over a second; a hit ducks the
 * music for a moment so the impact cuts through. It waits silently until the
 * browser lets audio start (the first click or key press).
 */
import { useSyncExternalStore } from "react";
import { useSettings } from "../state/settings";
import { synth } from "./synth";
import { barEvents, TRACKS, type Ev, type Intensity, type Patch, type Track } from "./tracks";

const LOOKAHEAD = 0.15;
const TICK_MS = 25;

const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);

/** A soft-clipping curve for the heavy tracks. */
function clipCurve() {
  const c = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) c[i] = Math.tanh(((i / 1023) * 2 - 1) * 3.5);
  return c;
}

interface Playing {
  track: Track;
  out: GainNode;
  drive: WaveShaperNode; // a soft clipper for the heavy tracks, inside the crossfade
  bar: number;
  step: number;
  next: number; // context time of the next 16th
}

class Music {
  private ctx: AudioContext | null = null;
  private duckNode: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private pulse25: PeriodicWave | null = null;
  private curve: ReturnType<typeof clipCurve> | null = null;
  private playing: Playing | null = null;
  private wanted: string | null = null;
  private intensity: Intensity = 0;
  private timer = 0;
  private listeners = new Set<() => void>();
  enabled = true;

  /** Ask for a track (by id); it starts as soon as audio is allowed. */
  play(id: string | null): void {
    if (id && !TRACKS[id]) id = "menu";
    if (this.wanted === id) return;
    this.wanted = id;
    this.emit();
    this.ensureTimer();
    this.sync();
  }

  setIntensity(i: Intensity): void {
    this.intensity = i;
  }

  getIntensity(): Intensity {
    return this.intensity;
  }

  /** The track you hear (or will hear once audio unlocks). */
  current(): Track | null {
    return this.wanted ? TRACKS[this.wanted] : null;
  }

  /** Dip the music under a big sound effect: depth 0..1 for `ms`. */
  duck(depth = 0.55, ms = 350): void {
    const c = this.ctx;
    if (!c || !this.duckNode) return;
    const g = this.duckNode.gain;
    const t = c.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(1 - depth, t + 0.03);
    g.linearRampToValueAtTime(1, t + 0.03 + ms / 1000);
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  private ensureTimer(): void {
    if (this.timer || typeof window === "undefined") return;
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  private setup(): boolean {
    const c = synth.ctx;
    const bus = synth.musicOut();
    if (!c || !bus || c.state !== "running") return false;
    if (this.ctx === c) return true;
    this.ctx = c;
    this.duckNode = c.createGain();
    this.duckNode.connect(bus);
    this.assets(c);
    return true;
  }

  /** The noise buffer, the 25% pulse wave and the clipping curve, for one audio context. */
  private assets(c: BaseAudioContext): void {
    const len = c.sampleRate;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // a 25% pulse wave, the classic handheld lead
    const N = 32;
    const re = new Float32Array(N);
    const im = new Float32Array(N);
    for (let n = 1; n < N; n++) im[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * 0.25);
    this.pulse25 = c.createPeriodicWave(re, im);
    this.curve = clipCurve();
  }

  /**
   * Render bars of a track offline (no speakers) and measure it: the check
   * that every track is audible and none clips. Used by the browser tests.
   */
  async measure(id: string, bars: number, intensity: Intensity, rate = 22050): Promise<{ peak: number; rms: number; seconds: number }> {
    const track = TRACKS[id];
    const sx = 60 / track.bpm / 4;
    const seconds = sx * 16 * bars + 1.5;
    const off = new OfflineAudioContext(1, Math.ceil(seconds * rate), rate);
    const saved = { ctx: this.ctx, noise: this.noise, pulse25: this.pulse25, curve: this.curve };
    try {
      this.ctx = off as unknown as AudioContext;
      this.assets(off);
      const out = off.createGain();
      out.gain.value = 0.9 * 0.6 * 0.7; // music bus at the default volume, times the default master
      out.connect(off.destination);
      const drive = off.createWaveShaper();
      drive.curve = this.curve;
      const dg = off.createGain();
      dg.gain.value = 0.5;
      drive.connect(dg).connect(out);
      const p: Playing = { track, out, drive, bar: 0, step: 0, next: 0 };
      for (let bar = 0; bar < bars; bar++) {
        const events = barEvents(track, bar, intensity);
        for (let st = 0; st < 16; st++) {
          const at = 0.05 + (bar * 16 + st) * sx + (st % 2 ? (track.swing ?? 0) * sx : 0);
          for (const e of events) if (e.step === st) this.voice(p, e, at, sx);
        }
      }
    } finally {
      Object.assign(this, saved);
    }
    const buf = await off.startRendering();
    const d = buf.getChannelData(0);
    let peak = 0;
    let sum = 0;
    for (let i = 0; i < d.length; i++) {
      const v = Math.abs(d[i]);
      if (v > peak) peak = v;
      sum += d[i] * d[i];
    }
    return { peak, rms: Math.sqrt(sum / d.length), seconds };
  }

  /** Start, switch or stop to match what was asked for. */
  private sync(): void {
    const enabled = this.enabled && useSettings.getState().s.music;
    const want = enabled ? this.wanted : null;
    if ((this.playing?.track.id ?? null) === want) return;
    if (!this.setup()) return;
    const c = this.ctx!;
    if (this.playing) {
      const old = this.playing.out;
      old.gain.cancelScheduledValues(c.currentTime);
      old.gain.setValueAtTime(old.gain.value, c.currentTime);
      old.gain.linearRampToValueAtTime(0, c.currentTime + 1);
      window.setTimeout(() => old.disconnect(), 1300);
      this.playing = null;
    }
    if (!want) return;
    const out = c.createGain();
    out.gain.setValueAtTime(0, c.currentTime);
    out.gain.linearRampToValueAtTime(1, c.currentTime + 1);
    out.connect(this.duckNode!);
    const drive = c.createWaveShaper();
    drive.curve = this.curve;
    const dg = c.createGain();
    dg.gain.value = 0.5;
    drive.connect(dg).connect(out);
    this.playing = { track: TRACKS[want], out, drive, bar: 0, step: 0, next: c.currentTime + 0.1 };
    this.emit();
  }

  private tick(): void {
    this.sync();
    const p = this.playing;
    const c = this.ctx;
    if (!p || !c) return;
    if (p.next < c.currentTime - 0.2) p.next = c.currentTime + 0.05; // the tab slept: skip ahead, do not burst
    const sixteenth = 60 / p.track.bpm / 4;
    let events: Ev[] | null = null;
    while (p.next < c.currentTime + LOOKAHEAD) {
      if (!events || p.step === 0) events = barEvents(p.track, p.bar, this.intensity);
      const swing = p.step % 2 ? (p.track.swing ?? 0) * sixteenth : 0;
      for (const e of events) if (e.step === p.step) this.voice(p, e, p.next + swing, sixteenth);
      p.step++;
      p.next += sixteenth;
      if (p.step === 16) {
        p.step = 0;
        p.bar++;
        events = null;
      }
    }
  }

  // ------------------------------------------------------------------ instruments

  private env(out: AudioNode, t: number, peak: number, attack: number, hold: number, release: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.setValueAtTime(Math.max(0.0002, peak), t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    g.connect(out);
    return g;
  }

  private osc(type: OscillatorType | "pulse25", f: number, t: number, end: number, detune = 0): OscillatorNode {
    const o = this.ctx!.createOscillator();
    if (type === "pulse25" && this.pulse25) o.setPeriodicWave(this.pulse25);
    else o.type = type === "pulse25" ? "square" : type;
    o.frequency.setValueAtTime(f, t);
    o.detune.value = detune;
    o.start(t);
    o.stop(end + 0.05);
    return o;
  }

  private noiseSrc(t: number, dur: number): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
    return s;
  }

  private filter(type: BiquadFilterType, f: number, q = 0.7): BiquadFilterNode {
    const b = this.ctx!.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return b;
  }

  private voice(p: Playing, e: Ev, t: number, sx: number): void {
    const out = p.out;
    const dur = e.len * sx;
    const v = e.vel;
    switch (e.inst) {
      case "kick": {
        const o = this.osc("sine", 150, t, t + 0.3);
        o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
        o.connect(this.env(out, t, 0.75 * v, 0.003, 0.02, 0.26));
        break;
      }
      case "snare":
      case "clap": {
        const n = this.noiseSrc(t, 0.25);
        const f = this.filter(e.inst === "clap" ? "bandpass" : "highpass", e.inst === "clap" ? 1300 : 1500, e.inst === "clap" ? 1.2 : 0.7);
        n.connect(f).connect(this.env(out, t, 0.32 * v, 0.002, e.inst === "clap" ? 0.03 : 0.01, 0.16));
        if (e.inst === "snare") this.osc("triangle", 190, t, t + 0.12).connect(this.env(out, t, 0.18 * v, 0.002, 0.01, 0.08));
        break;
      }
      case "hat":
      case "ohat": {
        const n = this.noiseSrc(t, 0.3);
        n.connect(this.filter("highpass", 7500)).connect(this.env(out, t, 0.09 * v, 0.001, 0.005, e.inst === "ohat" ? 0.2 : 0.04));
        break;
      }
      case "crash": {
        const n = this.noiseSrc(t, 1.6);
        n.connect(this.filter("highpass", 5000)).connect(this.env(out, t, 0.08 * v, 0.002, 0.02, 1.4));
        break;
      }
      case "tom":
      case "taiko": {
        const f0 = e.inst === "taiko" ? 85 : Math.max(90, mtof(e.notes?.[0] ?? 45));
        const o = this.osc("sine", f0 * 1.6, t, t + 0.5);
        o.frequency.exponentialRampToValueAtTime(f0, t + 0.08);
        o.connect(this.env(out, t, (e.inst === "taiko" ? 0.6 : 0.35) * v, 0.003, 0.03, e.inst === "taiko" ? 0.45 : 0.25));
        if (e.inst === "taiko") this.noiseSrc(t, 0.1).connect(this.filter("lowpass", 900)).connect(this.env(out, t, 0.2 * v, 0.002, 0.01, 0.08));
        break;
      }
      case "wood": {
        const o = this.osc("sine", 1200, t, t + 0.08);
        o.connect(this.env(out, t, 0.12 * v, 0.001, 0.005, 0.05));
        break;
      }
      case "crowd": {
        // a stadium "hey!": a burst of voices
        const n = this.noiseSrc(t, 0.35);
        n.connect(this.filter("bandpass", 900, 2.2)).connect(this.env(out, t, 0.28 * v, 0.01, 0.06, 0.2));
        this.noiseSrc(t, 0.35).connect(this.filter("bandpass", 1700, 3)).connect(this.env(out, t, 0.14 * v, 0.01, 0.06, 0.18));
        break;
      }
      case "crackle": {
        // vinyl dust under the lo-fi track
        for (let i = 0; i < 6; i++) {
          const at = t + Math.random() * dur;
          this.noiseSrc(at, 0.01).connect(this.filter("highpass", 3000)).connect(this.env(out, at, 0.02 * v, 0.001, 0.001, 0.006));
        }
        break;
      }
      case "bass":
        for (const m of e.notes ?? []) this.bass(e.patch === "dist" ? p.drive : out, e.patch ?? "saw", mtof(m), t, dur, v);
        break;
      case "pad":
        for (const m of e.notes ?? []) this.pad(out, e.patch ?? "saw", mtof(m), t, dur, v);
        break;
      case "keys":
      case "stab":
        for (const m of e.notes ?? []) this.pluck(e.patch === "power" ? p.drive : out, e.patch ?? "rhodes", mtof(m), t, dur, v * 0.7);
        break;
      case "arp":
        for (const m of e.notes ?? []) this.pluck(out, e.patch ?? "pluck", mtof(m), t, dur, v);
        break;
      case "lead":
        for (const m of e.notes ?? []) this.lead(out, e.patch ?? "square", mtof(m), t, dur, v);
        break;
    }
  }

  private bass(out: AudioNode, patch: Patch, f: number, t: number, dur: number, v: number): void {
    const end = t + dur;
    if (patch === "sub" || patch === "koto") {
      const o = this.osc(patch === "koto" ? "triangle" : "sine", f, t, end + 0.3);
      if (patch === "koto") o.frequency.exponentialRampToValueAtTime(f, t + 0.04);
      o.connect(this.env(out, t, 0.32 * v, 0.01, dur * 0.6, 0.25));
      return;
    }
    if (patch === "tri") {
      this.osc("triangle", f, t, end).connect(this.env(out, t, 0.3 * v, 0.004, dur * 0.7, 0.04));
      return;
    }
    const type: OscillatorType | "pulse25" = patch === "pulse" ? "pulse25" : patch === "square" ? "square" : "sawtooth";
    const o = this.osc(type, f, t, end + 0.1);
    const flt = this.filter("lowpass", patch === "acid" ? 2400 : 1100, patch === "acid" ? 9 : 1);
    flt.frequency.setValueAtTime(patch === "acid" ? 2600 : 1400, t);
    flt.frequency.exponentialRampToValueAtTime(patch === "acid" ? 260 : 380, t + Math.max(0.08, dur));
    if (patch === "dist") {
      o.connect(flt).connect(this.env(out, t, 0.6 * v, 0.004, dur * 0.7, 0.05)); // `out` is the clipper here
      return;
    }
    o.connect(flt).connect(this.env(out, t, (patch === "acid" ? 0.2 : 0.22) * v, 0.004, dur * 0.6, 0.06));
  }

  private pad(out: AudioNode, patch: Patch, f: number, t: number, dur: number, v: number): void {
    const end = t + dur;
    const flt = this.filter("lowpass", patch === "glass" ? 3000 : 1500, 0.5);
    const g = this.env(out, t, (patch === "glass" ? 0.04 : 0.045) * v, Math.min(0.5, dur * 0.3), dur * 0.4, Math.min(0.9, dur * 0.4));
    flt.connect(g);
    if (patch === "glass") {
      this.osc("sine", f * 2, t, end + 1).connect(flt);
      this.osc("triangle", f, t, end + 1, 6).connect(flt);
    } else {
      this.osc("sawtooth", f, t, end + 1, -8).connect(flt);
      this.osc("sawtooth", f, t, end + 1, 8).connect(flt);
    }
  }

  private pluck(out: AudioNode, patch: Patch, f: number, t: number, dur: number, v: number): void {
    const c = this.ctx!;
    switch (patch) {
      case "rhodes":
      case "bell":
      case "fm": {
        // two-operator FM: a bell or an electric piano
        const ratio = patch === "rhodes" ? 1 : 3.5;
        const car = this.osc("sine", f, t, t + 1.2);
        const mod = this.osc("sine", f * ratio, t, t + 1.2);
        const mg = c.createGain();
        mg.gain.setValueAtTime(f * (patch === "rhodes" ? 1.2 : 2.5), t);
        mg.gain.exponentialRampToValueAtTime(f * 0.05, t + 0.6);
        mod.connect(mg).connect(car.frequency);
        car.connect(this.env(out, t, (patch === "rhodes" ? 0.09 : 0.06) * v, 0.004, 0.02, patch === "rhodes" ? 0.9 : 1.1));
        break;
      }
      case "harpsi": {
        const o = this.osc("sawtooth", f, t, t + 0.4);
        o.connect(this.filter("highpass", 400)).connect(this.env(out, t, 0.06 * v, 0.001, 0.005, 0.28));
        break;
      }
      case "koto": {
        const o = this.osc("triangle", f * 1.02, t, t + 0.9);
        o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
        o.connect(this.filter("lowpass", 2200)).connect(this.env(out, t, 0.14 * v, 0.002, 0.01, 0.7));
        break;
      }
      case "glass": {
        this.osc("sine", f * 2, t, t + 0.7).connect(this.env(out, t, 0.05 * v, 0.002, 0.01, 0.6));
        break;
      }
      case "power": {
        // `out` is the clipper: a distorted power chord
        const o = this.osc("sawtooth", f, t, t + dur + 0.2);
        o.connect(this.filter("lowpass", 2600)).connect(this.env(out, t, 0.35 * v, 0.004, dur * 0.8, 0.12));
        break;
      }
      case "square":
      case "pulse":
        this.osc(patch === "pulse" ? "pulse25" : "square", f, t, t + 0.2).connect(this.env(out, t, 0.045 * v, 0.002, 0.03, 0.08));
        break;
      default: {
        // a filtered saw pluck
        const o = this.osc("sawtooth", f, t, t + 0.3);
        const flt = this.filter("lowpass", 3000, 2);
        flt.frequency.setValueAtTime(3200, t);
        flt.frequency.exponentialRampToValueAtTime(400, t + 0.18);
        o.connect(flt).connect(this.env(out, t, 0.07 * v, 0.002, 0.01, 0.18));
      }
    }
  }

  private lead(out: AudioNode, patch: Patch, f: number, t: number, dur: number, v: number): void {
    const c = this.ctx!;
    const end = t + dur;
    const vib = (o: OscillatorNode, depth: number) => {
      if (dur < 0.2) return;
      const l = this.osc("sine", 5.5, t + 0.12, end);
      const lg = c.createGain();
      lg.gain.value = depth;
      l.connect(lg).connect(o.detune);
    };
    switch (patch) {
      case "flute": {
        const o = this.osc("sine", f, t, end + 0.2);
        vib(o, 18);
        o.connect(this.env(out, t, 0.11 * v, 0.06, dur * 0.7, 0.15));
        this.noiseSrc(t, dur).connect(this.filter("bandpass", f * 2, 3)).connect(this.env(out, t, 0.04 * v, 0.03, dur * 0.3, 0.1));
        break;
      }
      case "brass": {
        const o = this.osc("sawtooth", f, t, end + 0.2);
        const flt = this.filter("lowpass", 800, 1.5);
        flt.frequency.setValueAtTime(600, t);
        flt.frequency.linearRampToValueAtTime(2600, t + 0.08);
        flt.frequency.linearRampToValueAtTime(1500, end);
        vib(o, 10);
        o.connect(flt).connect(this.env(out, t, 0.1 * v, 0.03, dur * 0.75, 0.12));
        break;
      }
      case "tri":
      case "fm": {
        const o = this.osc(patch === "tri" ? "triangle" : "sine", f, t, end + 0.3);
        vib(o, 12);
        o.connect(this.env(out, t, 0.12 * v, 0.01, dur * 0.6, 0.25));
        if (patch === "fm") this.osc("sine", f * 2, t, end).connect(this.env(out, t, 0.03 * v, 0.005, 0.02, 0.2));
        break;
      }
      case "saw": {
        const a = this.osc("sawtooth", f, t, end + 0.15, -6);
        const b = this.osc("sawtooth", f, t, end + 0.15, 6);
        const flt = this.filter("lowpass", 2800, 1);
        vib(a, 14);
        a.connect(flt);
        b.connect(flt);
        flt.connect(this.env(out, t, 0.06 * v, 0.01, dur * 0.7, 0.1));
        break;
      }
      default: {
        const o = this.osc(patch === "pulse" ? "pulse25" : "square", f, t, end + 0.1);
        vib(o, 8);
        o.connect(this.env(out, t, 0.06 * v, 0.004, dur * 0.8, 0.05));
      }
    }
  }
}

export const music = new Music();
synth.duckHook = (depth, ms) => music.duck(depth, ms);
if (typeof window !== "undefined") (window as unknown as { __music?: Music }).__music = music;

/** React: the track playing now (re-renders when it changes). */
export function useNowPlaying(): Track | null {
  return useSyncExternalStore(music.subscribe, () => music.current(), () => null);
}

