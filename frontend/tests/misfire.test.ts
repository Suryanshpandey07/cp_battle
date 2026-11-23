import { describe, expect, it } from "vitest";
import { DEFAULT_CARD } from "../src/skins/registry";
import { Director } from "../src/vfx/director";
import { boomerang, bounce, lobBack, MISFIRE_TRAVEL, TURN, uturn } from "../src/vfx/misfire";
import { TIMING } from "../src/vfx/timings";
import { LEVEL_EXTRA, WEAPON_STYLES, type Level, type WeaponStyle } from "../src/vfx/weapons";

const sink: any = new Proxy(function () {}, { get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : sink), apply: () => sink });

function engine(now: () => number) {
  const fighter = (x: number) => ({ anchors: { muzzle: [x + 50, 100], head: [x, 60], chest: [x, 110], feet: [x, 150] }, setPose() {}, baseX: x, baseY: 100, size: 128, facing: x < 400 ? 1 : -1, tint: null, tintUntil: 0, soot: 0, dizzyUntil: 0 });
  const launches: any[] = [];
  const beams: any[] = [];
  const reticles: any[] = [];
  const target: any = {
    fighters: { 1: fighter(200), 2: fighter(700) }, charge: {}, shields: {}, status: {}, width: 900, height: 420, gameTime: 0, quality: "high", reduced: false, now,
    ramp: () => 0, speedLines: {}, aberration: {}, particles: sink,
    launch: (p: any) => {
      const proj = { ...p, pos: [0, 0], at: now() };
      launches.push(proj);
      return proj;
    },
    beam: (b: any) => beams.push({ ...b, at: now() }),
    reticle: (r: any) => reticles.push({ ...r, at: now() }),
  };
  return { fx: new Proxy(target, { get: (t, k) => (k in t ? t[k] : () => sink) }), launches, beams, reticles };
}

function misfire(style: WeaponStyle, level: Level, lethal = false) {
  let clock = 0;
  const { fx, launches, beams, reticles } = engine(() => clock);
  const hp: number[] = [];
  const warnings: unknown[] = [];
  const warn = console.warn;
  console.warn = (...a: unknown[]) => warnings.push(a);
  const look = { style, colors: DEFAULT_CARD.attack.ramp, metal: "#94a3b8", accent: "#facc15", status: null };
  const d = new Director({ fx, you: 1, skin: () => DEFAULT_CARD, setHp: (_s: number, h: number) => hp.push(h), maxHp: () => 28000, reduced: () => false, weapon: () => look } as any, () => clock);
  d.debug = [];
  d.play({ v: 1, type: "attack.backfire", t: 0, data: { attacker: 1, recoil: 6000, recoil_class: "heavy", verdict: "WA", problem: "x", attacker_hp: lethal ? 0 : 22000, crit: false, scenario: "safe", level } } as any);
  let hpAt = -1;
  for (clock = 0; clock <= 9000; clock += 1) {
    d.tick();
    if (hpAt < 0 && hp.length) hpAt = clock;
  }
  console.warn = warn;
  return { steps: Object.fromEntries(d.debug.map((e) => [e.step, e.t])), names: d.debug.map((e) => e.show), launches, beams, reticles, hp, hpAt, warnings, fx };
}

describe("misfire paths", () => {
  const home = (): [number, number] => [200, 110];
  it("a U-turn leaves toward the target, turns over the top and lands on its owner", () => {
    const f = uturn([250, 100], [420, 80], 40, 1, home);
    expect(f(0)).toEqual([250, 100]);
    expect(f(1)[0]).toBeCloseTo(200);
    expect(f(1)[1]).toBeCloseTo(110);
    // still heading out just before the turn, heading home just after
    expect(f(0.4)[0]).toBeGreaterThan(f(0.3)[0]);
    expect(f(0.8)[0]).toBeLessThan(f(0.7)[0]);
    // the top of the loop is above the apex
    expect(f(0.52)[1]).toBeLessThan(80);
  });
  it("a boomerang returns home; a lob-back peaks where it is told; a ricochet bounces", () => {
    const b = boomerang([250, 100], 300, 80, 1, home);
    expect(b(0)).toEqual([250, 100]);
    expect(b(1)[0]).toBeCloseTo(200);
    expect(b(0.5)[0]).toBeCloseTo(550); // the far end
    const l = lobBack([250, 100], [400, 10], home);
    expect(l(0.5)[0]).toBeCloseTo(400);
    expect(l(0.5)[1]).toBeCloseTo(10);
    expect(l(1)[1]).toBeCloseTo(110);
    const r = bounce([250, 100], [500, 60], home);
    expect(r(0.5)).toEqual([500, 60]);
    expect(r(1)).toEqual([200, 110]);
  });
});

describe("misfires: every weapon at every difficulty hits its owner", () => {
  for (const style of WEAPON_STYLES) {
    for (const level of [0, 1, 2, 3] as Level[]) {
      it(`${style} at level ${level}`, () => {
        const { steps, launches, beams, hp, hpAt, warnings } = misfire(style, level);
        const windup = TIMING.heavy.windup + LEVEL_EXTRA[level].windup;
        const travel = MISFIRE_TRAVEL[level];
        expect(warnings).toEqual([]);
        expect(steps.windup).toBe(0);
        expect(steps.destabilise).toBeLessThan(steps.misfire);
        expect(steps.misfire).toBe(windup);
        expect(steps.turn).toBe(Math.round(windup + travel * TURN[style]));
        expect(steps.explosion).toBe(windup + travel);
        expect(hp).toEqual([22000]);
        expect(hpAt).toBe(windup + travel); // the recoil lands with the weapon
        // something flies back: the last thing launched or beamed after the misfire ends on the attacker (x = 200)
        const after = launches.filter((p) => p.at >= windup);
        const lands = after.map((p) => p.at + (p.delay ?? 0) + p.dur);
        const returning = after.filter((p) => Math.abs(p.at + (p.delay ?? 0) + p.dur - (windup + travel)) <= 1);
        const beamHome = beams.filter((b) => b.at >= windup && Math.abs(b.to()[0] - 200) < 1 && b.at + (b.delay ?? 0) <= windup + travel + 60);
        expect(returning.length + beamHome.length).toBeGreaterThan(0);
        for (const p of returning) {
          const end = p.curve ? p.curve(1) : p.to();
          expect(Math.abs(end[0] - 200)).toBeLessThan(1);
        }
        for (const a of lands) expect(a <= windup + travel + 1).toBe(true);
      });
    }
  }
  it("a lethal misfire is a self-destruct with a K.O.", () => {
    const { names, steps } = misfire("arrows", 1, true);
    expect(names).toContain("self-destruct");
    expect(steps.ko).toBeGreaterThan(steps.explosion);
  });
});
