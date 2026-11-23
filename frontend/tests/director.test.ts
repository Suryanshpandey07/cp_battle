import { describe, expect, it } from "vitest";
import { Director } from "../src/vfx/director";
import { blockingLength, CLASSES, TIMING, type DamageClass } from "../src/vfx/timings";
import { DEFAULT_CARD } from "../src/skins/registry";

/** A value that absorbs any property access or call. */
const sink: any = new Proxy(function () {}, { get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : sink), apply: () => sink });

/** A stand-in engine: every effect call is a no-op, fighters have fixed anchors. */
function fakeEngine(now: () => number) {
  const fighter = () => ({ anchors: { muzzle: [0, 0], head: [0, 0], chest: [0, 0], feet: [0, 0] }, setPose() {}, baseX: 0, baseY: 0, size: 128, facing: 1, tint: null, tintUntil: 0, soot: 0, dizzyUntil: 0 });
  const target: any = { fighters: { 1: fighter(), 2: fighter() }, charge: {}, shields: {}, status: {}, width: 800, height: 400, gameTime: 0, now, ramp: () => 0, speedLines: {}, aberration: {} };
  return new Proxy(target, { get: (t, k) => (k in t ? t[k] : sink) });
}

function run(cls: DamageClass, opts: { blocked?: boolean; lethal?: boolean; crit?: boolean } = {}) {
  let clock = 0;
  const hp: number[] = [];
  const fx = fakeEngine(() => clock);
  const d = new Director({ fx, you: 1, skin: () => DEFAULT_CARD, setHp: (_s: number, h: number) => hp.push(h), maxHp: () => 28000, reduced: () => false } as any, () => clock);
  d.debug = [];
  const msg = opts.blocked
    ? { v: 1, type: "attack.blocked", t: 0, data: { attacker: 1, defender: 2, prevented_damage: 9000, damage_class: cls, crit: false, scenario: "safe", problem: "x", hits_landed: 1 } }
    : { v: 1, type: "attack.landed", t: 0, data: { attacker: 1, defender: 2, damage: 9000, damage_class: cls, crit: !!opts.crit, scenario: "safe", tier_diff: 1, problem: "x", defender_hp: opts.lethal ? 0 : 19000, attacker_damage_dealt: 9000, hits_landed: 1 } };
  d.play(msg as any);
  for (clock = 0; clock <= 6000; clock += 1) d.tick();
  return { steps: Object.fromEntries(d.debug.map((e) => [e.step, e.t])), hp };
}

describe("VFX director timing (section 7 tables)", () => {
  for (const cls of CLASSES) {
    it(`plays the ${cls} fire attack on the documented timeline`, () => {
      const { steps, hp } = run(cls);
      const T = TIMING[cls];
      expect(steps.windup).toBe(0);
      expect(steps.launch).toBe(T.windup);
      expect(steps.impact).toBe(T.windup + T.travel);
      expect(steps.explosion).toBe(T.windup + T.travel + T.hitStop);
      expect(steps.end).toBe(blockingLength(cls));
      expect(hp).toEqual([19000]); // the HP bar moves at the impact step, to the server's number
    });
  }

  it("blocking lengths equal windup + travel + hit-stop + explosion", () => {
    expect(CLASSES.map(blockingLength)).toEqual([850, 1200, 1700, 2500]);
  });

  it("a blocked hit never moves the HP bar", () => {
    const { steps, hp } = run("heavy", { blocked: true });
    expect(steps.impact).toBe(600);
    expect(hp).toEqual([]);
  });

  it("a lethal hit is raised one class and plays the KO", () => {
    const { steps } = run("heavy", { lethal: true });
    expect(steps.impact).toBe(TIMING.massive.windup + TIMING.massive.travel);
    expect(steps.ko).toBeGreaterThan(steps.impact);
    expect(steps["ko-text"]).toBe(steps.ko + 300);
  });

  it("fast-forwards when more than 3 shows are queued and skipAll applies HP", () => {
    const clock = 0;
    const hp: number[] = [];
    const d = new Director({ fx: fakeEngine(() => clock), you: 1, skin: () => DEFAULT_CARD, setHp: (_s: number, h: number) => hp.push(h), maxHp: () => 28000, reduced: () => false } as any, () => clock);
    for (let i = 0; i < 5; i++) d.play({ v: 1, type: "attack.landed", t: 0, data: { attacker: 1, defender: 2, damage: 100, damage_class: "light", crit: false, scenario: "safe", tier_diff: 1, problem: "x", defender_hp: 1000 - i, attacker_damage_dealt: 0, hits_landed: 1 } } as any);
    expect(d.queue.length).toBe(3);
    expect(hp).toEqual([1000, 999]);
    d.skipAll();
    expect(hp).toEqual([1000, 999, 998, 997, 996]);
    expect(d.busy).toBe(false);
  });
});
