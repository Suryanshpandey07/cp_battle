/** Named sound effects built from the synth. Every sound has a visual twin. */
import type { DamageClass } from "../vfx/timings";
import { synth } from "./synth";

const CLASS_IDX: Record<DamageClass, number> = { light: 0, heavy: 1, massive: 2, nuke: 3 };
const ELEMENT_PITCH: Record<string, number> = { fire: 1, bluefire: 1.35, ice: 1.8, lightning: 1.6, void: 0.6, bits: 2, gold: 1.5, glitch: 1.2, magma: 0.7, handheld: 1.4 };

export const sfx = {
  windup(ms: number, element = "fire") {
    if (!synth.begin("windup")) return;
    const p = ELEMENT_PITCH[element] ?? 1;
    synth.noise({ dur: ms / 1000, type: "bandpass", f0: 300 * p, f1: 1200 * p, q: 2, gain: 0.18 });
    synth.tone({ f0: 120 * p, f1: 240 * p, dur: ms / 1000, gain: 0.15 });
  },
  launch(ms: number) {
    if (!synth.begin("launch")) return;
    synth.noise({ dur: ms / 1000, type: "lowpass", f0: 4000, f1: 600, gain: 0.22 });
    synth.tone({ type: "triangle", f0: 520, f1: 260, dur: ms / 1000, gain: 0.08 });
  },
  impact(cls: DamageClass) {
    if (!synth.begin(`impact`)) return;
    const k = CLASS_IDX[cls];
    synth.duckHook?.(0.35 + k * 0.15, 250 + k * 150);
    synth.tone({ f0: 60, f1: 30, dur: 0.15 + k * 0.15, gain: 0.5 });
    synth.noise({ dur: 0.12 + k * 0.26, type: "lowpass", f0: 1800, f1: 200, gain: 0.35 });
    for (let i = 0; i < 3 + k * 3; i++) synth.noise({ dur: 0.02, type: "highpass", f0: 3000, gain: 0.12, delay: Math.random() * 0.3 });
    if (cls === "nuke") {
      synth.tone({ f0: 45, f1: 20, dur: 1.2, gain: 0.5, delay: 0.05 });
      synth.noise({ dur: 1.4, type: "lowpass", f0: 900, f1: 80, gain: 0.15, delay: 0.1 });
    }
  },
  // ---- weapons: level 0..3 is easy..tough; louder and lower as it grows
  gunshot(level = 0) {
    if (!synth.begin("gunshot")) return;
    synth.noise({ dur: 0.07 + level * 0.02, type: "bandpass", f0: 2400 - level * 300, q: 0.7, gain: 0.32 });
    synth.tone({ type: "square", f0: 180, f1: 60, dur: 0.06, gain: 0.12 });
  },
  rocket(sec: number) {
    if (!synth.begin("rocket")) return;
    synth.noise({ dur: sec + 0.2, type: "lowpass", f0: 600, f1: 2400, gain: 0.25 });
    synth.tone({ type: "sawtooth", f0: 80, f1: 160, dur: sec, gain: 0.06 });
  },
  spinUp(sec: number) {
    if (!synth.begin("spinup")) return;
    synth.tone({ type: "sawtooth", f0: 60, f1: 420, dur: sec, gain: 0.06 });
  },
  lockOn(sec: number) {
    if (!synth.begin("lockon")) return;
    const beeps = Math.max(2, Math.round(sec / 0.12));
    for (let i = 0; i < beeps; i++) synth.tone({ type: "square", f0: 1400 + i * 60, dur: 0.04, gain: 0.07, delay: i * (sec / beeps) });
  },
  whoosh(sec: number, level = 0) {
    if (!synth.begin("whoosh")) return;
    synth.noise({ dur: sec + 0.05, type: "bandpass", f0: 400, f1: 2600 + level * 400, q: 1.4, gain: 0.18 + level * 0.04 });
  },
  fwoosh(sec: number, level = 0) {
    if (!synth.begin("fwoosh")) return;
    synth.noise({ dur: sec + 0.1, type: "lowpass", f0: 900 + level * 300, f1: 300, gain: 0.2 + level * 0.06 });
    synth.tone({ f0: 160 - level * 25, f1: 70, dur: sec, gain: 0.1 + level * 0.04 });
  },
  twang(level = 0) {
    if (!synth.begin("twang")) return;
    synth.tone({ type: "triangle", f0: 330, f1: 220, dur: 0.18, gain: 0.16 });
    if (level >= 2) for (let i = 0; i < 4 + level * 2; i++) synth.noise({ dur: 0.05, type: "highpass", f0: 2500, gain: 0.08, delay: 0.04 + i * 0.03 });
  },
  zap(sec: number, level = 0) {
    if (!synth.begin("zap")) return;
    synth.noise({ dur: Math.max(0.08, sec), type: "highpass", f0: 1800, gain: 0.16 + level * 0.05 });
    synth.tone({ type: "sawtooth", f0: 900 - level * 150, f1: 120, dur: Math.max(0.1, sec * 0.7), gain: 0.1 });
    if (level >= 2) synth.tone({ f0: 55, f1: 30, dur: 0.9, gain: 0.35, delay: sec });
  },
  laser(sec: number, level = 0) {
    if (!synth.begin("laser")) return;
    synth.tone({ type: "sawtooth", f0: 1600 - level * 300, f1: 300, dur: sec, gain: 0.08 + level * 0.03 });
    synth.tone({ type: "sine", f0: 120, f1: 90, dur: sec, gain: 0.12 });
  },
  charge(sec: number) {
    if (!synth.begin("charge")) return;
    synth.tone({ type: "triangle", f0: 200, f1: 1200, dur: Math.max(0.1, sec), gain: 0.07 });
  },
  rumble(sec: number) {
    if (!synth.begin("rumble")) return;
    synth.noise({ dur: Math.max(0.2, sec), type: "lowpass", f0: 140, f1: 60, gain: 0.3 });
  },
  thud(level = 0) {
    if (!synth.begin("thud")) return;
    synth.tone({ f0: 90 - level * 10, f1: 40, dur: 0.14 + level * 0.05, gain: 0.3 });
  },
  clang(level = 0) {
    if (!synth.begin("clang")) return;
    synth.tone({ type: "triangle", f0: 1800 - level * 200, f1: 900, dur: 0.25, gain: 0.12 });
    synth.tone({ type: "square", f0: 2600, f1: 1400, dur: 0.08, gain: 0.05 });
  },
  pop() {
    if (!synth.begin("pop")) return;
    synth.noise({ dur: 0.18, type: "lowpass", f0: 1400, f1: 200, gain: 0.25 });
  },
  boom(level = 3) {
    if (!synth.begin("boom")) return;
    synth.duckHook?.(0.7, 700);
    synth.tone({ f0: 70, f1: 22, dur: 0.8 + level * 0.15, gain: 0.5 });
    synth.noise({ dur: 1 + level * 0.2, type: "lowpass", f0: 1200, f1: 60, gain: 0.3 });
  },
  crit() {
    if (!synth.begin("crit")) return;
    synth.arpeggio([880, 1760], 0.07, "square", 0.12);
  },
  shieldUp() {
    if (!synth.begin("shield")) return;
    synth.tone({ type: "sawtooth", f0: 200, f1: 900, dur: 0.4, gain: 0.1 });
  },
  block() {
    if (!synth.begin("block")) return;
    for (const f of [523, 538, 1046]) synth.tone({ type: "triangle", f0: f, dur: 0.5, gain: 0.12 });
    synth.noise({ dur: 0.4, type: "highpass", f0: 2500, gain: 0.2, delay: 0.05 });
  },
  backfire() {
    if (!synth.begin("backfire")) return;
    synth.duckHook?.(0.6, 500);
    synth.tone({ type: "sawtooth", f0: 400, f1: 60, dur: 0.45, gain: 0.2 });
    synth.noise({ dur: 0.15, type: "lowpass", f0: 1200, gain: 0.3, delay: 0.35 });
  },
  crackle() {
    if (!synth.begin("crackle")) return;
    for (let i = 0; i < 6; i++) synth.noise({ dur: 0.02, type: "highpass", f0: 4000, gain: 0.1, delay: i * 0.05 });
  },
  bell() {
    if (!synth.begin("bell")) return;
    for (const f of [880, 1320, 1760]) synth.tone({ f0: f, dur: 1.6, gain: 0.12 });
  },
  victory() {
    if (!synth.begin("victory")) return;
    synth.duckHook?.(0.9, 2000);
    synth.arpeggio([523, 659, 784, 1046, 784, 1046], 0.11);
  },
  defeat() {
    if (!synth.begin("defeat")) return;
    synth.duckHook?.(0.9, 2000);
    synth.arpeggio([392, 330, 262, 196], 0.16, "square", 0.1);
  },
  rankUp() {
    if (!synth.begin("rankup")) return;
    synth.arpeggio([523, 659, 784, 1046, 1318, 1568], 0.08);
  },
  click() {
    if (synth.begin("click")) synth.tone({ type: "square", f0: 1200, dur: 0.03, gain: 0.05 });
  },
  hover() {
    if (synth.begin("hover")) synth.tone({ type: "sine", f0: 1800, dur: 0.02, gain: 0.02 });
  },
  deal() {
    if (synth.begin("deal")) synth.noise({ dur: 0.06, type: "bandpass", f0: 2500, q: 3, gain: 0.08 });
  },
  testTick() {
    if (synth.begin("tick")) synth.tone({ type: "square", f0: 1500, dur: 0.025, gain: 0.04 });
  },
  testPass() {
    if (synth.begin("pass")) synth.arpeggio([988, 1318], 0.05, "square", 0.06);
  },
  testFail() {
    if (synth.begin("fail")) synth.tone({ type: "square", f0: 220, f1: 140, dur: 0.18, gain: 0.08 });
  },
  countdown() {
    if (synth.begin("countdown")) synth.tone({ type: "square", f0: 660, dur: 0.06, gain: 0.06 });
  },
  // ---- voices: every fighter has a pitch (0.8..1.25) so the two sound different
  /** The battle cry for an attack style, louder for the bigger forms. */
  cry(style: string, pitch = 1, level = 0) {
    if (!synth.begin("cry")) return;
    const p = 190 * pitch;
    const g = 0.18 + level * 0.03;
    if (style === "shoot") synth.voice({ f0: p * 1.1, f1: p * 0.8, dur: 0.16, vowels: ["a", "uh"], h: 0.03, gain: g });
    else if (style === "draw") synth.voice({ f0: p, f1: p * 1.25, dur: 0.22, vowels: ["uh", "u"], h: 0.02, gain: g * 0.8 });
    else if (style === "summon") {
      synth.voice({ f0: p * 0.85, f1: p * 0.95, dur: 0.24, vowels: ["o", "u"], gain: g * 0.8 });
      synth.voice({ f0: p * 1.3, f1: p * 0.9, dur: 0.26, vowels: ["a", "a"], h: 0.03, gain: g, delay: 0.2 });
    } else synth.voice({ f0: p * 1.15, f1: p * 0.75, dur: 0.28, vowels: ["i", "a", "a"], h: 0.05, gain: g }); // "hyah!"
  },
  /** Hurt: a short "oof", a longer "ow!" for big hits. */
  ouch(pitch = 1, big = false) {
    if (!synth.begin("ouch")) return;
    const p = 210 * pitch;
    if (big) synth.voice({ f0: p * 1.5, f1: p * 0.7, dur: 0.42, vowels: ["a", "o", "u"], h: 0.02, gain: 0.24, vibrato: 6 });
    else synth.voice({ f0: p * 1.05, f1: p * 0.7, dur: 0.18, vowels: ["o", "u"], gain: 0.2 });
  },
  /** "Uh-oh!": the misfired weapon has turned around. */
  uhOh(pitch = 1) {
    if (!synth.begin("uhoh")) return;
    const p = 220 * pitch;
    synth.voice({ f0: p * 1.2, f1: p * 1.15, dur: 0.15, vowels: ["uh", "uh"], gain: 0.2 });
    synth.voice({ f0: p * 0.95, f1: p * 0.75, dur: 0.24, vowels: ["o", "o"], gain: 0.2, delay: 0.17 });
  },
  /** The long fall of a knocked-out fighter. */
  koCry(pitch = 1) {
    if (!synth.begin("kocry")) return;
    synth.voice({ f0: 330 * pitch, f1: 120 * pitch, dur: 0.9, vowels: ["a", "a", "o", "u"], h: 0.03, gain: 0.22, vibrato: 9 });
  },
  cheer(pitch = 1) {
    if (!synth.begin("cheer")) return;
    synth.voice({ f0: 230 * pitch, f1: 330 * pitch, dur: 0.36, vowels: ["i", "e", "a"], h: 0.03, gain: 0.22 }); // "yeah!"
  },
  /** An arm swing. */
  swish(level = 0) {
    if (!synth.begin("swish")) return;
    synth.noise({ dur: 0.12 + level * 0.02, type: "bandpass", f0: 700, f1: 2400, q: 1.8, gain: 0.1 + level * 0.02 });
  },
  /** A foot planting on a lunge or landing. */
  step() {
    if (!synth.begin("step")) return;
    synth.tone({ f0: 110, f1: 55, dur: 0.07, gain: 0.18 });
    synth.noise({ dur: 0.05, type: "lowpass", f0: 900, gain: 0.12 });
  },
  // ---- misfires
  /** The error buzz and stutter when the attack goes wrong. */
  misfire() {
    if (!synth.begin("misfire")) return;
    synth.tone({ type: "square", f0: 140, f1: 70, dur: 0.32, gain: 0.08 });
    for (let i = 0; i < 6; i++) synth.noise({ dur: 0.035, type: "bandpass", f0: 1400 - i * 150, q: 2, gain: 0.14, delay: i * 0.05 });
  },
  /** A gun that will not fire: click, click. */
  jam() {
    if (!synth.begin("jam")) return;
    for (let i = 0; i < 2; i++) {
      synth.tone({ type: "square", f0: 2400, f1: 1600, dur: 0.02, gain: 0.08, delay: i * 0.16 });
      synth.noise({ dur: 0.03, type: "highpass", f0: 3500, gain: 0.1, delay: i * 0.16 });
    }
  },
  /** A bullet or beam bouncing off something it should not have hit. */
  ricochet() {
    if (!synth.begin("ricochet")) return;
    synth.tone({ type: "sine", f0: 2600, f1: 900, dur: 0.28, gain: 0.1 });
    synth.noise({ dur: 0.05, type: "highpass", f0: 4000, gain: 0.14 });
  },
  /** A projectile coming back: a rising whistle. */
  whistle(sec: number) {
    if (!synth.begin("whistle")) return;
    synth.tone({ type: "sine", f0: 600, f1: 2200, dur: Math.max(0.15, sec), gain: 0.06 });
  },
  heartbeat() {
    if (!synth.begin("heartbeat")) return;
    synth.tone({ f0: 70, f1: 50, dur: 0.12, gain: 0.35 });
    synth.tone({ f0: 70, f1: 50, dur: 0.12, gain: 0.28, delay: 0.22 });
  },
};
