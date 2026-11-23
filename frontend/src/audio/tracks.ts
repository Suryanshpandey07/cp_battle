/**
 * The soundtrack, written as data and composed in code: no audio files. Each
 * track names a key, a mode, a chord loop, drum patterns and instruments; the
 * melody is generated once from a seed so it is the same every time it plays.
 * `barEvents` turns one bar into notes for the sequencer (music.ts). It is pure
 * and deterministic, which is what the tests check.
 *
 * Form: intro (once), then A, B, A, B, break, round again. Intensity 0 keeps
 * every bar calm (menus, the countdown), 1 follows the form, 2 (low HP, the
 * last minute) skips the break and adds drive.
 */

export type Intensity = 0 | 1 | 2;
export type Inst =
  | "kick" | "snare" | "clap" | "hat" | "ohat" | "tom" | "taiko" | "wood" | "crash" | "crowd"
  | "bass" | "pad" | "arp" | "lead" | "keys" | "stab" | "crackle";

export type Patch =
  | "sub" | "saw" | "acid" | "square" | "tri" | "dist" | "pulse" | "fm" | "harpsi" | "koto"
  | "bell" | "glass" | "strings" | "brass" | "flute" | "pluck" | "rhodes" | "power";

export interface Track {
  id: string;
  name: string;
  mood: string;
  bpm: number;
  swing?: number; // 0..0.3: how late the off 16ths land
  key: number; // MIDI note of the tonic
  mode: number[]; // semitones of each scale degree
  chords: number[]; // scale degree of each bar's chord, looped
  seventh?: boolean;
  drums: { kick: string; snare: string; hat: string; ohat?: string; perc?: string; percInst?: Inst; snareInst?: Inst };
  bass: { patch: Patch; rhythm: string; octave?: number; fifths?: boolean };
  pad?: Patch;
  keys?: { patch: Patch; rhythm: string }; // comped chords
  arp?: { patch: Patch; rhythm: string; shape: "up" | "updown" | "broken" };
  lead: { patch: Patch; octave: number; density: number; seed: number };
  extra?: "crackle" | "crowd";
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];
const HARMONIC = [0, 2, 3, 5, 7, 8, 11];
const LYDIAN = [0, 2, 4, 6, 7, 9, 11];
const HIRAJOSHI = [0, 2, 3, 7, 8];

const FOUR = "x...x...x...x...";
const BACKBEAT = "....x.......x...";
const EIGHTHS = "x.x.x.x.x.x.x.x.";
const OFFBEATS = "..x...x...x...x.";

export const TRACKS: Record<string, Track> = {
  menu: {
    id: "menu", name: "Lobby Lounge", mood: "Lo-fi, laid back", bpm: 82, swing: 0.18, key: 53, mode: MAJOR, chords: [0, 5, 1, 4], seventh: true,
    drums: { kick: "x.....x...x.....", snare: BACKBEAT, hat: EIGHTHS, snareInst: "snare" },
    bass: { patch: "sub", rhythm: "x.....x.x.......", octave: 2 },
    keys: { patch: "rhodes", rhythm: "x.....x.....x..." },
    lead: { patch: "fm", octave: 5, density: 0.32, seed: 11 },
    extra: "crackle",
  },
  title: {
    id: "title", name: "Arena Overture", mood: "Heroic", bpm: 120, key: 48, mode: MINOR, chords: [0, 5, 2, 6],
    drums: { kick: FOUR, snare: BACKBEAT, hat: OFFBEATS },
    bass: { patch: "saw", rhythm: "x.x.x.x.x.x.x.x.", octave: 2, fifths: true },
    pad: "strings",
    arp: { patch: "square", rhythm: "xxxxxxxxxxxxxxxx", shape: "up" },
    lead: { patch: "brass", octave: 4, density: 0.55, seed: 3 },
  },
  bit: {
    id: "bit", name: "Binary Rain", mood: "Chiptune synthwave", bpm: 128, key: 45, mode: MINOR, chords: [0, 5, 2, 6],
    drums: { kick: FOUR, snare: BACKBEAT, hat: EIGHTHS },
    bass: { patch: "pulse", rhythm: "x.x.x.x.x.x.x.x.", octave: 2, fifths: true },
    pad: "saw",
    arp: { patch: "square", rhythm: "xxxxxxxxxxxxxxxx", shape: "updown" },
    lead: { patch: "pulse", octave: 5, density: 0.6, seed: 21 },
  },
  circuit: {
    id: "circuit", name: "Clock Cycle", mood: "Techno", bpm: 132, key: 40, mode: DORIAN, chords: [0, 0, 3, 6],
    drums: { kick: FOUR, snare: BACKBEAT, hat: ".x.x.x.x.x.x.x.x", ohat: OFFBEATS, snareInst: "clap" },
    bass: { patch: "acid", rhythm: "x.xxx.x.xx.x.xx.", octave: 2 },
    arp: { patch: "pluck", rhythm: "x..x..x..x..x.x.", shape: "broken" },
    lead: { patch: "saw", octave: 5, density: 0.38, seed: 8 },
  },
  handheld: {
    id: "handheld", name: "Green Plains Gallop", mood: "Handheld adventure", bpm: 150, key: 48, mode: MAJOR, chords: [0, 4, 5, 3],
    drums: { kick: "x.......x.......", snare: BACKBEAT, hat: EIGHTHS },
    bass: { patch: "tri", rhythm: "x.x.x.x.x.x.x.x.", octave: 2, fifths: true },
    arp: { patch: "pulse", rhythm: "x...x...x...x...", shape: "broken" },
    lead: { patch: "square", octave: 5, density: 0.75, seed: 5 },
  },
  prestige: {
    id: "prestige", name: "Marble Hall Fugue", mood: "Baroque, grand", bpm: 100, key: 50, mode: HARMONIC, chords: [0, 5, 3, 4],
    drums: { kick: "x.......x...x...", snare: "................", hat: "................", perc: "x.......x.x.x...", percInst: "tom" },
    bass: { patch: "harpsi", rhythm: "x.x.x.x.x.x.x.x.", octave: 2 },
    pad: "strings",
    arp: { patch: "harpsi", rhythm: "xxxxxxxxxxxxxxxx", shape: "broken" },
    lead: { patch: "brass", octave: 4, density: 0.55, seed: 13 },
  },
  space: {
    id: "space", name: "Orbit Drift", mood: "Ambient, wide", bpm: 92, key: 54, mode: LYDIAN, chords: [0, 1, 4, 0],
    drums: { kick: "x.........x.....", snare: "........x.......", hat: OFFBEATS },
    bass: { patch: "sub", rhythm: "x.......x.......", octave: 2 },
    pad: "glass",
    arp: { patch: "bell", rhythm: "x.x.x.x.x.x.x.x.", shape: "up" },
    lead: { patch: "fm", octave: 5, density: 0.3, seed: 34 },
  },
  volcano: {
    id: "volcano", name: "Magma Core", mood: "Heavy", bpm: 150, key: 40, mode: PHRYGIAN, chords: [0, 1, 0, 6],
    drums: { kick: "x..x..x.x..x..x.", snare: BACKBEAT, hat: EIGHTHS, perc: "............xxxx", percInst: "tom" },
    bass: { patch: "dist", rhythm: "xxx.xxx.xx.xxx.x", octave: 1 },
    keys: { patch: "power", rhythm: "x.....x.....x..." },
    lead: { patch: "saw", octave: 4, density: 0.6, seed: 66 },
  },
  neon: {
    id: "neon", name: "Neon Overdrive", mood: "Outrun", bpm: 110, key: 48, mode: MINOR, chords: [0, 5, 6, 4],
    drums: { kick: FOUR, snare: BACKBEAT, hat: ".x.x.x.x.x.x.x.x" },
    bass: { patch: "saw", rhythm: "x.x.x.x.x.x.x.x.", octave: 2, fifths: true },
    pad: "strings",
    arp: { patch: "pluck", rhythm: "xxxxxxxxxxxxxxxx", shape: "up" },
    lead: { patch: "saw", octave: 5, density: 0.55, seed: 77 },
  },
  frost: {
    id: "frost", name: "Aurora Glass", mood: "Crystalline", bpm: 116, key: 47, mode: MINOR, chords: [0, 3, 5, 4],
    drums: { kick: "x.......x.......", snare: BACKBEAT, hat: OFFBEATS },
    bass: { patch: "sub", rhythm: "x...x...x...x...", octave: 2 },
    pad: "glass",
    arp: { patch: "glass", rhythm: "xxxxxxxxxxxxxxxx", shape: "updown" },
    lead: { patch: "tri", octave: 5, density: 0.5, seed: 90 },
  },
  sakura: {
    id: "sakura", name: "Petals and Steel", mood: "Taiko and koto", bpm: 108, key: 50, mode: HIRAJOSHI, chords: [0, 0, 3, 2],
    drums: { kick: "x.....x...x.....", snare: "................", hat: "................", perc: "..x.......x.x...", percInst: "wood", snareInst: "taiko" },
    bass: { patch: "koto", rhythm: "x.......x...x...", octave: 2 },
    pad: "glass",
    arp: { patch: "koto", rhythm: "x.x.x.x.x.x.x.x.", shape: "broken" },
    lead: { patch: "flute", octave: 5, density: 0.45, seed: 42 },
  },
  colosseum: {
    id: "colosseum", name: "Champion's Roar", mood: "Stadium anthem", bpm: 140, key: 43, mode: MINOR, chords: [0, 5, 6, 0],
    drums: { kick: FOUR, snare: BACKBEAT, hat: EIGHTHS, perc: "x.x.............", percInst: "taiko" },
    bass: { patch: "dist", rhythm: "x.x.x.x.x.x.x.x.", octave: 1, fifths: true },
    keys: { patch: "power", rhythm: "x.......x......." },
    lead: { patch: "brass", octave: 4, density: 0.6, seed: 9 },
    extra: "crowd",
  },
};

/** The track for an arena manifest's `music` field, or the map's default. */
export function trackFor(music: string | undefined): Track {
  return TRACKS[music ?? ""] ?? TRACKS.bit;
}

// ------------------------------------------------------------------ form

export const FORM: { name: "intro" | "A" | "B" | "break"; bars: number }[] = [
  { name: "intro", bars: 4 },
  { name: "A", bars: 8 },
  { name: "B", bars: 8 },
  { name: "A", bars: 8 },
  { name: "B", bars: 8 },
  { name: "break", bars: 4 },
];
const LOOP_FROM = 1; // after the intro, the form repeats from the first A

export function sectionAt(bar: number): { name: "intro" | "A" | "B" | "break"; barIn: number; first: boolean } {
  let b = bar;
  for (let i = 0; i < FORM.length; i++) {
    if (b < FORM[i].bars) return { name: FORM[i].name, barIn: b, first: b === 0 };
    b -= FORM[i].bars;
  }
  const loopLen = FORM.slice(LOOP_FROM).reduce((a, s) => a + s.bars, 0);
  return sectionAt(FORM[0].bars + (b % loopLen));
}

// ------------------------------------------------------------------ pitch

/** MIDI note of a scale degree (degrees past the scale wrap into the next octave). */
export function noteOf(t: Track, degree: number, octave: number): number {
  const L = t.mode.length;
  const d = ((degree % L) + L) % L;
  return 12 * (octave + 1) + (t.key % 12) + t.mode[d] + 12 * Math.floor(degree / L);
}

export function chordDegrees(t: Track, root: number): number[] {
  const step = t.mode.length >= 7 ? 2 : 1;
  const out = [root, root + step * 1, root + step * 2];
  if (t.seventh) out.push(root + step * 3);
  return out;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const RHYTHMS = [
  "x.x.x...x..x.x..",
  "x...x.x.x...x...",
  "x..x..x.x.x.x...",
  "x.xx..x.x..x....",
  "x...x...x.x.x.x.",
  "xx..x.x...x.x...",
];

/** A 2-bar motif, then variations: an 8-bar phrase of (degree, length in 16ths) or rests. */
type Note = { step: number; degree: number; len: number };
const melodyCache = new Map<string, Note[][]>();

export function melody(t: Track, part: "A" | "B"): Note[][] {
  const key = `${t.id}:${part}`;
  const hit = melodyCache.get(key);
  if (hit) return hit;
  const R = rng(t.lead.seed * 7 + (part === "B" ? 101 : 1));
  const L = t.mode.length;
  const motif = (bars: number, from: number): Note[][] => {
    const out: Note[][] = [];
    let prev = from;
    for (let b = 0; b < bars; b++) {
      const rhythm = RHYTHMS[Math.floor(R() * RHYTHMS.length)];
      const chord = chordDegrees(t, t.chords[b % t.chords.length]);
      const notes: Note[] = [];
      for (let s = 0; s < 16; s++) {
        if (rhythm[s] !== "x" || R() > t.lead.density + (s % 4 === 0 ? 0.3 : 0)) continue;
        let deg: number;
        if (s % 4 === 0) {
          // strong beats land on a chord tone near the last note
          const opts = chord.flatMap((c) => [c, c + L, c - L]).sort((a, b2) => Math.abs(a - prev) - Math.abs(b2 - prev));
          deg = opts[Math.floor(R() * 2)];
        } else deg = prev + [-2, -1, -1, 1, 1, 2][Math.floor(R() * 6)];
        deg = Math.max(-2, Math.min(L + 2, deg));
        let len = 1;
        while (s + len < 16 && rhythm[s + len] !== "x" && len < 4) len++;
        notes.push({ step: s, degree: deg, len });
        prev = deg;
      }
      out.push(notes);
    }
    return out;
  };
  const a = motif(2, part === "A" ? 2 : 4);
  const b = motif(2, part === "A" ? 4 : 2);
  // A A' B A'' : repeat the motif, vary its last bar, end on the tonic
  const vary = (bar: Note[]) => bar.map((n, i) => (i === bar.length - 1 ? { ...n, degree: n.degree + (R() < 0.5 ? 1 : -1) } : n));
  const cadence = (bar: Note[]) => (bar.length ? [...bar.slice(0, -1), { ...bar[bar.length - 1], degree: 0, len: Math.max(2, bar[bar.length - 1].len) }] : [{ step: 0, degree: 0, len: 8 }]);
  const phrase = [a[0], a[1], a[0], vary(a[1]), b[0], b[1], a[0], cadence(a[1])];
  melodyCache.set(key, phrase);
  return phrase;
}

// ------------------------------------------------------------------ bars

export interface Ev {
  step: number; // 16th within the bar
  inst: Inst;
  patch?: Patch;
  notes?: number[]; // MIDI
  len: number; // in 16ths
  vel: number; // 0..1
}

const hits = (pattern: string) => [...pattern].map((c, i) => (c === "x" || c === "o" ? i : -1)).filter((i) => i >= 0);

/** Everything that plays in one bar of a track. */
export function barEvents(t: Track, bar: number, intensity: Intensity): Ev[] {
  const sec = sectionAt(bar);
  let name = sec.name;
  if (intensity === 2 && name === "break") name = "B";
  const calm = intensity === 0 || name === "intro" || name === "break";
  const drive = intensity === 2;
  const root = t.chords[bar % t.chords.length];
  const chord = chordDegrees(t, root);
  const ev: Ev[] = [];
  const add = (e: Ev) => ev.push(e);

  // pad or comped chords: always there, they carry the harmony
  if (t.pad) add({ step: 0, inst: "pad", patch: t.pad, notes: chord.map((d) => noteOf(t, d, 3)), len: 16, vel: calm ? 0.8 : 0.6 });
  if (t.keys) for (const s of hits(t.keys.rhythm)) add({ step: s, inst: t.keys.patch === "power" ? "stab" : "keys", patch: t.keys.patch, notes: t.keys.patch === "power" ? [noteOf(t, root, 3), noteOf(t, root, 3) + 7, noteOf(t, root, 4)] : chord.map((d) => noteOf(t, d, 4)), len: 3, vel: calm ? 0.55 : 0.7 });

  // arpeggio over the chord
  if (t.arp && (!calm || name === "intro" || intensity === 0)) {
    const seq = t.arp.shape === "updown" ? [...chord.slice(0, 3), chord[0] + (t.mode.length >= 7 ? 7 : 5), ...chord.slice(1, 3).reverse()] : t.arp.shape === "broken" ? [chord[0], chord[2], chord[1], chord[2]] : [...chord.slice(0, 3), chord[0] + (t.mode.length >= 7 ? 7 : 5)];
    const oct = 4; // up to an octave and a fifth above: stays under C7
    hits(t.arp.rhythm).forEach((s, i) => add({ step: s, inst: "arp", patch: t.arp!.patch, notes: [noteOf(t, seq[i % seq.length], oct)], len: 1, vel: calm ? 0.5 : 0.7 }));
  }

  // bass
  if (!calm || (name === "break" && intensity > 0)) {
    const o = t.bass.octave ?? 2;
    const fifth = root + (t.mode.length >= 7 ? 4 : 3);
    const rh = drive && t.bass.rhythm.replace(/\./g, "").length < 10 ? "x.x.x.x.x.x.x.x." : t.bass.rhythm;
    hits(rh).forEach((s, i) => {
      const deg = t.bass.fifths && i % 4 === 3 ? fifth : root;
      const up = t.bass.patch === "pulse" || t.bass.patch === "saw" ? (i % 2) * 12 : 0;
      add({ step: s, inst: "bass", patch: t.bass.patch, notes: [noteOf(t, deg, o) + up], len: t.bass.patch === "sub" || t.bass.patch === "koto" ? 4 : 1, vel: s % 4 === 0 ? 0.9 : 0.7 });
    });
  } else if (intensity === 0 || name === "intro") {
    add({ step: 0, inst: "bass", patch: "sub", notes: [noteOf(t, root, 2)], len: 16, vel: 0.5 });
  }

  // drums
  const d = t.drums;
  if (!calm) {
    for (const s of hits(d.kick)) add({ step: s, inst: "kick", len: 1, vel: s % 4 === 0 ? 1 : 0.8 });
    for (const s of hits(d.snare)) add({ step: s, inst: d.snareInst ?? "snare", len: 1, vel: 0.9 });
    const hat = drive ? "xxxxxxxxxxxxxxxx" : d.hat;
    for (const s of hits(hat)) add({ step: s, inst: "hat", len: 1, vel: s % 2 ? 0.45 : 0.75 });
    if (d.ohat) for (const s of hits(d.ohat)) add({ step: s, inst: "ohat", len: 2, vel: 0.5 });
    if (d.perc && (name === "B" || drive)) for (const s of hits(d.perc)) add({ step: s, inst: d.percInst ?? "tom", notes: [noteOf(t, root, 2)], len: 2, vel: 0.8 });
    if (sec.first) add({ step: 0, inst: "crash", len: 8, vel: 0.6 });
    // a fill into the next section
    const next = sectionAt(bar + 1);
    if (next.first && next.name !== sec.name) for (const s of [12, 13, 14, 15]) add({ step: s, inst: d.snareInst === "taiko" ? "taiko" : "tom", notes: [noteOf(t, root + (15 - s), 2)], len: 1, vel: 0.7 + (s - 12) * 0.08 });
  } else if (intensity > 0 && name === "break") {
    for (const s of hits(d.kick).slice(0, 2)) add({ step: s, inst: "kick", len: 1, vel: 0.6 });
    for (const s of hits(d.hat)) add({ step: s, inst: "hat", len: 1, vel: 0.35 });
  } else if (t.drums.perc && name !== "intro") {
    for (const s of hits(t.drums.perc)) add({ step: s, inst: t.drums.percInst ?? "wood", notes: [noteOf(t, root, 3)], len: 1, vel: 0.4 });
  }

  // melody: in B (and the break), louder and an octave up when it is tense
  if (name === "B" || name === "break" || (drive && name === "A")) {
    const ph = melody(t, name === "A" ? "A" : "B");
    const notes = ph[sec.barIn % ph.length];
    const lift = drive && t.lead.octave <= 4; // high leads stay put: an octave up would shriek
    const oct = t.lead.octave + (lift ? 1 : 0);
    for (const n of notes) add({ step: n.step, inst: "lead", patch: t.lead.patch, notes: [noteOf(t, n.degree, oct)], len: n.len, vel: name === "break" ? 0.6 : drive ? 0.95 : 0.85 });
  }

  if (t.extra === "crackle") add({ step: 0, inst: "crackle", len: 16, vel: 0.5 });
  if (t.extra === "crowd" && !calm && name === "B") for (const s of [4, 12]) add({ step: s, inst: "crowd", len: 2, vel: 0.8 });
  return ev;
}
