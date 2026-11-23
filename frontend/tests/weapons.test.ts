import { describe, expect, it } from "vitest";
import { DEFAULT_CARD } from "../src/skins/registry";
import { Director } from "../src/vfx/director";
import { TIMING } from "../src/vfx/timings";
import { LEVEL_EXTRA, levelOf, WEAPON_STYLES, type Level, type WeaponStyle } from "../src/vfx/weapons";

/** A value that absorbs any property access or call (engine parts the test does not inspect). */
const sink: any = new Proxy(function () {}, {
  get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : sink),
  apply: () => sink,
});

/** A recording engine: launches and beams are captured, everything else is a no-op. */
function recordingEngine(now: () => number) {
  const fighter = (x: number) => ({ anchors: { muzzle: [x, 100], head: [x, 60], chest: [x, 110], feet: [x, 150] }, setPose() {}, baseX: x, baseY: 100, size: 128, facing: x < 400 ? 1 : -1, tint: null, tintUntil: 0, soot: 0, dizzyUntil: 0 });
  const launches: any[] = [];
  const beams: any[] = [];
  const target: any = {
    fighters: { 1: fighter(200), 2: fighter(700) },
    charge: {},
    shields: {},
    status: {},
    width: 900,
    height: 420,
    gameTime: 0,
    quality: "high",
    reduced: false,
    now,
    ramp: () => 0,
    speedLines: {},
    aberration: {},
    particles: sink,
    launch: (p: any) => {
      const proj = { ...p, pos: [0, 0], at: now() };
      launches.push(proj);
      return proj;
    },
    beam: (b: any) => beams.push({ ...b, at: now() }),
  };
  const fx = new Proxy(target, { get: (t, k) => (k in t ? t[k] : () => sink) });
  return { fx, launches, beams };
}

function play(style: WeaponStyle, level: Level, blocked = false) {
  let clock = 0;
  const { fx, launches, beams } = recordingEngine(() => clock);
  const warnings: unknown[] = [];
  const warn = console.warn;
  console.warn = (...a: unknown[]) => warnings.push(a);
  const look = { style, colors: DEFAULT_CARD.attack.ramp, metal: "#94a3b8", accent: "#facc15", status: null };
  const d = new Director({ fx, you: 1, skin: () => DEFAULT_CARD, setHp: () => undefined, maxHp: () => 28000, reduced: () => false, weapon: () => look } as any, () => clock);
  d.debug = [];
  const data = blocked
    ? { attacker: 1, defender: 2, prevented_damage: 9000, damage_class: "heavy", crit: false, scenario: "safe", problem: "x", hits_landed: 1, level }
    : { attacker: 1, defender: 2, damage: 9000, damage_class: "heavy", crit: false, scenario: "safe", tier_diff: 0, problem: "x", defender_hp: 19000, attacker_damage_dealt: 9000, hits_landed: 1, level };
  d.play({ v: 1, type: blocked ? "attack.blocked" : "attack.landed", t: 0, data } as any);
  for (clock = 0; clock <= 8000; clock += 1) d.tick();
  console.warn = warn;
  const steps = Object.fromEntries(d.debug.map((e) => [e.step, e.t]));
  return { steps, launches, beams, warnings };
}

describe("weapons: every style at every difficulty", () => {
  for (const style of WEAPON_STYLES) {
    for (const level of [0, 1, 2, 3] as Level[]) {
      it(`${style} at level ${level} hits on the impact step and throws nothing`, () => {
        const { steps, launches, beams, warnings } = play(style, level);
        const travel = TIMING.heavy.travel + LEVEL_EXTRA[level].travel;
        const windup = TIMING.heavy.windup + LEVEL_EXTRA[level].windup;
        expect(warnings).toEqual([]);
        expect(steps.launch).toBe(windup);
        expect(steps.impact).toBe(windup + travel);
        expect(launches.length + beams.length).toBeGreaterThan(0);
        // every projectile lands no later than the impact; the last one lands exactly on it
        // (times are absolute from the start of the show; orbs that charge during the windup count too)
        const impact = windup + travel;
        const arrivals = launches.map((p) => p.at + (p.delay ?? 0) + p.dur);
        for (const a of arrivals) expect(a <= impact + 1).toBe(true);
        // beams that end the attack must be showing at the impact moment
        const beamHits = beams.filter((b) => b.at + (b.delay ?? 0) <= impact && b.at + (b.delay ?? 0) + b.dur >= impact);
        const lastProjectile = arrivals.length ? Math.max(...arrivals) : -1;
        expect(Math.abs(lastProjectile - impact) <= 1 || beamHits.length > 0).toBe(true);
      });
    }
  }

  it("a blocked attack plays every weapon without errors", () => {
    for (const style of WEAPON_STYLES) for (const level of [0, 3] as Level[]) expect(play(style, level, true).warnings).toEqual([]);
  });

  it("tough forms take longer than easy ones and events without a level keep the class timeline", () => {
    expect(LEVEL_EXTRA[3].windup + LEVEL_EXTRA[3].travel).toBeGreaterThan(LEVEL_EXTRA[2].windup + LEVEL_EXTRA[2].travel);
    expect(LEVEL_EXTRA[0]).toEqual({ windup: 0, travel: 0 });
    expect(levelOf(undefined, "nuke")).toBe(3);
    expect(levelOf(undefined, "light")).toBe(0);
    expect(levelOf(2, "light")).toBe(2);
    expect(levelOf(9, "heavy")).toBe(1);
  });
});
