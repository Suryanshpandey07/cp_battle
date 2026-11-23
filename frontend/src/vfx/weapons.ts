/**
 * Weapons: how an attack looks. The weapon is a cosmetic the player equips;
 * the card's difficulty in their hand (easy, normal, medium, tough) picks one
 * of four choreographies, from a small shot to a screen-filling finisher.
 * Nothing here changes a number: the server already decided the damage, and
 * the director applies HP at the impact step whatever the weapon draws.
 *
 * Contract with the director: launch() must make the main hit arrive exactly
 * `travel` ms after it is called, so the impact step lines up.
 */
import { sfx } from "../audio/sfx";
import type { Engine } from "./engine";
import type { Fighter } from "./fighters";
import { Kind } from "./particles";
import type { DamageClass } from "./timings";

export type WeaponStyle = "fireball" | "spear" | "gun" | "lightning" | "arrows" | "shuriken" | "laser" | "meteor";
export const WEAPON_STYLES: WeaponStyle[] = ["fireball", "spear", "gun", "lightning", "arrows", "shuriken", "laser", "meteor"];
export type Level = 0 | 1 | 2 | 3;
export const LEVEL_KEYS = ["easy", "normal", "medium", "tough"] as const;

/** Extra windup and travel per difficulty, on top of the damage-class timeline. */
export const LEVEL_EXTRA: Record<Level, { windup: number; travel: number }> = {
  0: { windup: 0, travel: 0 },
  1: { windup: 0, travel: 60 },
  2: { windup: 150, travel: 150 },
  3: { windup: 450, travel: 300 },
};

/** Particle budget multiplier per difficulty: the tough form is the heavy one. */
const PART: Record<Level, number> = { 0: 0.6, 1: 1, 2: 1.6, 3: 2.6 };

export function levelOf(raw: unknown, cls: DamageClass): Level {
  if (typeof raw === "number" && raw >= 0 && raw <= 3) return Math.round(raw) as Level;
  return (["light", "heavy", "massive", "nuke"].indexOf(cls) as Level) ?? 0;
}

export interface WeaponLook {
  style: WeaponStyle;
  colors: string[]; // 5-colour ramp, hot to dark
  metal: string;
  accent: string;
  status: string | null;
}

export const DEFAULT_LOOK: WeaponLook = {
  style: "fireball",
  colors: ["#fff7d6", "#ffd23f", "#ff7a1a", "#d62718", "#2a1a1a"],
  metal: "#78350f",
  accent: "#fb923c",
  status: "burning",
};

export interface Strike {
  fx: Engine;
  A: Fighter;
  D: Fighter;
  att: 1 | 2;
  def: 1 | 2;
  level: Level;
  cls: DamageClass;
  look: WeaponLook;
  ramp: number;
  windup: number;
  travel: number;
  blocked: boolean;
  warn: boolean;
  /** Where the main hit lands: the defender's chest, or the shield's edge when blocked. */
  hit: () => [number, number];
}

interface WeaponFx {
  windup(s: Strike): void;
  launch(s: Strike): void;
  impact(s: Strike): void;
  explode(s: Strike): void;
}

// ------------------------------------------------------------------ shared kit

const RAMPS = {
  rock: ["#d6d3d1", "#a8a29e", "#78716c", "#57534e", "#292524"],
  dust: ["#e7e5e4", "#d6d3d1", "#a8a29e", "#78716c", "#44403c"],
  brass: ["#fff7c2", "#fde68a", "#d4a017", "#a16207", "#422006"],
  metal: ["#ffffff", "#e2e8f0", "#94a3b8", "#475569", "#1e293b"],
  electric: ["#ffffff", "#e0f2fe", "#7dd3fc", "#3b82f6", "#1e1b4b"],
  gold: ["#ffffff", "#fef9c3", "#facc15", "#a16207", "#1c1917"],
  red: ["#ffffff", "#fecaca", "#ef4444", "#991b1b", "#1f2937"],
};

const r = (fx: Engine, k: keyof typeof RAMPS) => fx.ramp(RAMPS[k]);
const n = (s: Strike, base: number) => Math.round(base * PART[s.level]);
const pick = <T>(s: Strike, v: [T, T, T, T]): T => v[s.level];
const feet = (F: Fighter): [number, number] => [F.anchors.feet[0], F.anchors.feet[1]];
/** -1 or +1: which way the attacker is from the defender (things fall in from that side of the sky). */
const fromSide = (s: Strike): number => (s.A.baseX < s.D.baseX ? -1 : 1);

/** A glowing shape that sits still and swells for `ms` (charging orbs, a sun overhead). */
function hover(s: Strike, at: [number, number], size: number, ms: number, style: "fireball" | "orb" = "fireball"): void {
  s.fx.launch({ from: at, to: () => at, dur: ms, size, ramp: s.ramp, style, trail: 0, trailStyle: "none", path: "line", grow: ms });
}

/** Points around the hand where the medium fireballs gather. */
const orbSpots = (s: Strike): [number, number][] => {
  const [mx, my] = s.A.anchors.muzzle;
  return [
    [mx - s.A.facing * 6, my - 46],
    [mx + s.A.facing * 30, my - 18],
    [mx + s.A.facing * 4, my + 22],
  ];
};
const jitter = (p: [number, number], amt: number): [number, number] => [p[0] + (Math.random() - 0.5) * amt, p[1] + (Math.random() - 0.5) * amt * 0.6];

/** Angle from the attacker's hand to the hit point, in the hand's local (facing) frame. */
function aim(s: Strike): number {
  const [mx, my] = s.A.anchors.muzzle;
  const [tx, ty] = s.hit();
  return Math.atan2(ty - my, (tx - mx) * s.A.facing);
}

function debris(fx: Engine, x: number, y: number, count: number, speed: number, floorY: number, size = 9): void {
  if (fx.quality === "off" || fx.reduced) return;
  const ramp = r(fx, "rock");
  const c = fx.quality === "low" ? Math.round(count * 0.35) : count;
  for (let i = 0; i < c; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6;
    const v = speed * (0.4 + Math.random() * 0.6);
    const idx = fx.particles.spawn(Kind.Debris, x, y, Math.cos(a) * v, Math.sin(a) * v, 900 + Math.random() * 700, size * (0.5 + Math.random()), size * 0.6, ramp, 1100, 0.4);
    fx.particles.setBounce(idx, floorY);
  }
}

function dust(fx: Engine, x: number, y: number, count: number, spread = 140): void {
  fx.burst(Kind.Smoke, x, y, count, spread, 1100, [12, 34], r(fx, "dust"), { ay: -30, drag: 1.4, dir: -Math.PI / 2, spread: Math.PI * 1.2 });
}

function streaks(fx: Engine, x: number, y: number, count: number, speed: number, ramp: number, dir = -Math.PI / 2, spread = Math.PI * 2, width = 3): void {
  fx.burst(Kind.Streak, x, y, count, speed, 320, [width, 0.5], ramp, { drag: 2.5, dir, spread });
}

function embers(fx: Engine, x: number, y: number, count: number, ramp: number, speed = 220): void {
  fx.burst(Kind.Ember, x, y, count, speed, 1600, [3.5, 1], ramp, { ay: -40, drag: 1.2 });
}

function fireBall(fx: Engine, x: number, y: number, size: number, count: number, ramp: number): void {
  fx.burst(Kind.Flame, x, y, count, size * 7, 650, [size, 4], ramp, { ay: -140, drag: 2 });
  fx.burst(Kind.Glow, x, y, Math.round(count / 6), size * 3, 400, [size * 1.4, size * 0.4], ramp, { drag: 3 });
}

function pillar(fx: Engine, x: number, y: number, height: number, count: number, ramp: number): void {
  fx.burst(Kind.Flame, x, y, count, height * 2.2, 900, [height * 0.16, 6], ramp, { ay: -260, drag: 0.8, dir: -Math.PI / 2, spread: 0.45 });
  embers(fx, x, y - height * 0.5, Math.round(count / 3), ramp, 160);
}

function rings(fx: Engine, x: number, y: number, count: number, r0: number, color: string, gap = 90): void {
  for (let i = 0; i < count; i++) setTimeout(() => fx.ring(x, y, r0 * (1 + i * 0.6), 520 + i * 90, color, 7 - i, 6), i * gap);
}

function smokeColumn(fx: Engine, x: number, y: number, count: number): void {
  fx.burst(Kind.Smoke, x, y, count, 90, 2200, [18, 54], r(fx, "dust"), { ay: -90, drag: 0.6, dir: -Math.PI / 2, spread: 0.9 });
}

function shells(fx: Engine, s: Strike, count: number): void {
  const [mx, my] = s.A.anchors.muzzle;
  fx.burst(Kind.Square, mx - s.A.facing * 10, my - 6, count, 180, 1100, [5, 4], r(fx, "brass"), { ay: 1100, drag: 0.3, dir: -Math.PI / 2 - s.A.facing * 0.9, spread: 0.8, bounceY: s.A.anchors.feet[1] });
}

/** Staggered volley: projectile i leaves at delays[i] and every one flies for travel - last delay. */
function volley(s: Strike, count: number, spreadMs: number, make: (i: number, delay: number, dur: number, last: boolean) => void): void {
  const gap = count > 1 ? Math.min(spreadMs / (count - 1), (s.travel - 90) / (count - 1)) : 0;
  const lastDelay = gap * (count - 1);
  const dur = Math.max(60, s.travel - lastDelay);
  for (let i = 0; i < count; i++) make(i, i * gap, dur, i === count - 1);
}

// ------------------------------------------------------------------ weapons

const fireball: WeaponFx = {
  windup(s) {
    const { fx, A } = s;
    const ch = fx.charge[s.att];
    if (ch) ch.target = pick(s, [7, 14, 18, 46]);
    const [mx, my] = A.anchors.muzzle;
    embers(fx, mx, my, n(s, 18), s.ramp, 120);
    if (s.level === 2) for (const at of orbSpots(s)) hover(s, at, 14, s.windup);
    if (s.level === 3) {
      if (ch) ch.target = 8;
      const [hx0, hy0] = A.anchors.head;
      hover(s, [hx0, hy0 - 60], 44, s.windup);
      // a sun gathers above the head and drinks the light around it
      fx.dim(0.35, s.windup + s.travel + 600);
      const [hx, hy] = A.anchors.head;
      for (let i = 0; i < 70; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = 120 + Math.random() * 120;
        fx.particles.spawn(Kind.Flame, hx + Math.cos(a) * d, hy - 60 + Math.sin(a) * d, -Math.cos(a) * d * 2.2, -Math.sin(a) * d * 2.2, 420, 10, 3, s.ramp, 0, 0);
      }
      fx.ring(hx, hy - 60, 30, s.windup, s.look.colors[1], 4, 160);
      sfx.rumble(s.windup / 1000);
    }
  },
  launch(s) {
    const { fx, A } = s;
    const from = A.anchors.muzzle;
    const shot = (size: number, delay: number, dur: number, path: "arc" | "lob" | "line", trail: number, start: [number, number] = [from[0], from[1]], spread = 0) =>
      fx.launch({ from: start, to: () => (spread ? jitter(s.hit(), spread) : s.hit()), dur, delay, size, ramp: s.ramp, style: "fireball", trail, trailStyle: "embers", path, warn: s.warn });
    if (s.level === 0) shot(12, 0, s.travel, "arc", 2);
    else if (s.level === 1) shot(16, 0, s.travel, "arc", 5);
    else if (s.level === 2) {
      const paths: ("arc" | "lob" | "line")[] = ["lob", "line", "arc"];
      const spots = orbSpots(s);
      volley(s, 3, 240, (i, delay, dur, last) => {
        const p = shot(14, delay, dur, paths[i], 4, spots[i], last ? 0 : 20);
        if (!last) p.onArrive = () => miniBlast(s, p.pos, 12);
      });
    } else {
      const [hx, hy] = A.anchors.head;
      shot(44, 0, s.travel, "line", 12, [hx, hy - 60]);
      fx.zoomTo(1.06, s.travel);
    }
    sfx.fwoosh(s.travel / 1000, s.level);
  },
  impact(s) {
    const [x, y] = s.hit();
    if (s.level >= 2) rings(s.fx, x, y, s.level === 3 ? 3 : 2, 60, s.look.colors[1]);
    if (s.level === 3) s.fx.flashWhite(0.5, 260, s.look.colors[1]);
  },
  explode(s) {
    const { fx, D } = s;
    const [x, y] = s.hit();
    const [fx0, fy0] = feet(D);
    fireBall(fx, x, y, pick(s, [10, 16, 22, 34]), n(s, 90), s.ramp);
    embers(fx, x, y, n(s, 40), s.ramp, pick(s, [180, 240, 300, 420]));
    fx.burst(Kind.Smoke, x, y - 10, n(s, 10), 90, 1600, [12, 34], s.ramp, { ay: -50, drag: 1 });
    if (s.level >= 2) pillar(fx, fx0, fy0, pick(s, [0, 0, 120, 260]), n(s, 50), s.ramp);
    if (s.level === 3) {
      debris(fx, fx0, fy0, 40, 520, fy0 + 6);
      smokeColumn(fx, fx0, fy0 - 40, 26);
      fx.decal(fx0, fy0, 70, true);
      for (let i = 0; i < 4; i++) setTimeout(() => pillar(fx, fx0 + (i - 1.5) * 50, fy0, 140, 18, s.ramp), 80 + i * 90);
    } else if (s.level >= 1) fx.decal(fx0, fy0, 22 + s.level * 12, false);
  },
};

function miniBlast(s: Strike, p: [number, number], size: number): void {
  const { fx } = s;
  fireBall(fx, p[0], p[1], size, 30, s.ramp);
  fx.ring(p[0], p[1], 50, 300, s.look.colors[1], 4);
  fx.shake(4, 120);
  sfx.pop();
}

const spear: WeaponFx = {
  windup(s) {
    const { fx, A } = s;
    fx.prop({ side: s.att, kind: "spear", dur: s.windup + 40, scale: pick(s, [36, 40, 40, 52]), accent: s.look.accent, metal: s.level === 3 ? s.look.accent : s.look.metal });
    if (s.level === 2) {
      const [tx, ty] = feet(s.D);
      fx.reticle({ x: tx, y: ty, r: 70, dur: s.windup + s.travel, color: s.look.accent });
    }
    if (s.level === 3) {
      const [hx, hy] = A.anchors.head;
      streaks(fx, hx, hy, 40, 260, r(fx, "gold"));
      fx.flashWhite(0.18, 300, s.look.accent);
      sfx.rumble(s.windup / 1000);
    }
  },
  launch(s) {
    const { fx, A, D } = s;
    const from: [number, number] = [A.anchors.muzzle[0], A.anchors.muzzle[1] - 10];
    const metal = s.look.metal;
    if (s.level <= 1) {
      fx.launch({ from, to: s.hit, dur: s.travel, size: s.level ? 17 : 13, ramp: s.ramp, style: "spear", trail: s.level ? 6 : 2, trailStyle: "wind", path: "arc", ease: "in", warn: s.warn, metal, accent: s.look.accent });
    } else if (s.level === 2) {
      // three spears fall from the sky onto the target
      volley(s, 3, 300, (i, delay, dur, last) => {
        const [tx] = s.hit();
        const off = (i - 1) * 46;
        const p = fx.launch({ from: [tx + off + 160 * fromSide(s), -60], to: () => (last ? s.hit() : [D.anchors.feet[0] + off, D.anchors.feet[1]]), dur, delay, size: 15, ramp: s.ramp, style: "spear", trail: 4, trailStyle: "wind", path: "drop", ease: "in", warn: s.warn, metal, accent: s.look.accent });
        if (!last)
          p.onArrive = () => {
            const [fx0, fy0] = [D.anchors.feet[0] + off, D.anchors.feet[1]];
            dust(fx, fx0, fy0, 6, 90);
            debris(fx, fx0, fy0, 8, 260, fy0 + 4, 6);
            fx.shake(5, 140);
            sfx.thud(0);
          };
      });
    } else {
      fx.launch({ from, to: s.hit, dur: s.travel, size: 30, ramp: r(fx, "gold"), style: "spear", trail: 12, trailStyle: "streak", path: "line", ease: "in", warn: s.warn, metal: s.look.accent, accent: "#ffffff" });
      fx.ring(from[0], from[1], 120, 380, "#fef9c3", 6, 10); // sonic boom
      fx.shake(6, 200);
    }
    sfx.whoosh(s.travel / 1000, s.level);
  },
  impact(s) {
    const { fx } = s;
    const [x, y] = s.hit();
    const back = Math.atan2(s.A.anchors.muzzle[1] - y, s.A.anchors.muzzle[0] - x);
    streaks(fx, x, y, n(s, 30), 520, r(fx, "metal"), back, 1.2);
    sfx.clang(s.level);
  },
  explode(s) {
    const { fx, D } = s;
    const [fx0, fy0] = feet(D);
    dust(fx, fx0, fy0, n(s, 12), 120);
    debris(fx, fx0, fy0, n(s, 14), 360, fy0 + 6, 8);
    if (s.level === 3) {
      fx.spike({ x: fx0, y: fy0 + 6, width: D.size * 2.6, n: 11, height: D.size * 0.95, dur: 1400, color: "#57534e", edge: "#facc15" });
      fx.spike({ x: fx0, y: fy0 + 6, width: D.size * 3.6, n: 9, height: D.size * 0.55, dur: 1300, color: "#44403c", edge: "#d6d3d1", delay: 90 });
      debris(fx, fx0, fy0, 50, 640, fy0 + 6, 12);
      rings(fx, fx0, fy0 - 20, 3, 80, "#fde68a");
      streaks(fx, fx0, fy0, 80, 700, r(fx, "gold"), -Math.PI / 2, 2.2, 4);
      fx.decal(fx0, fy0, 80, true);
      sfx.boom(3);
    }
  },
};

const gun: WeaponFx = {
  windup(s) {
    const kind = pick(s, ["pistol", "rifle", "minigun", "launcher"] as const);
    const shotsAt = gunShots(s).map((d) => s.windup + d);
    s.fx.prop({ side: s.att, kind, dur: s.windup + s.travel + 260, scale: pick(s, [40, 46, 50, 56]), accent: s.look.accent, metal: s.look.metal, kicks: shotsAt, aim: aim(s) });
    if (s.level === 3) {
      // laser sight on the target while the launcher locks on
      s.fx.beam({ from: () => s.A.anchors.muzzle, to: s.hit, dur: s.windup, width: 2.2, ramp: r(s.fx, "red"), style: "laser", grow: 80, branches: 0 });
      sfx.lockOn(s.windup / 1000);
    }
    if (s.level === 2) sfx.spinUp(s.windup / 1000);
  },
  launch(s) {
    const { fx } = s;
    const delays = gunShots(s);
    if (s.level === 3) {
      fx.launch({ from: [...s.A.anchors.muzzle] as [number, number], to: s.hit, dur: s.travel, size: 15, ramp: s.ramp, style: "rocket", trail: 7, trailStyle: "smoke", path: "arc", ease: "in", warn: s.warn, onStart: () => sfx.rocket(s.travel / 1000) });
      shells(fx, s, 0);
      return;
    }
    const last = delays[delays.length - 1];
    const dur = Math.max(60, s.travel - last);
    delays.forEach((delay, i) => {
      const final = i === delays.length - 1;
      const p = fx.launch({
        from: [...s.A.anchors.muzzle] as [number, number],
        to: () => (final ? s.hit() : jitter(s.hit(), s.level === 2 ? 70 : 30)),
        dur,
        delay,
        size: pick(s, [4.5, 4.5, 3.4, 4]),
        ramp: s.ramp,
        style: "bullet",
        trail: 0,
        trailStyle: "none",
        path: "line",
        ease: "linear",
        warn: s.warn && final,
        onStart: () => {
          shells(fx, s, 1);
          sfx.gunshot(s.level);
        },
      });
      if (!final)
        p.onArrive = () => {
          streaks(fx, p.pos[0], p.pos[1], 8, 380, r(fx, "brass"));
          fx.burst(Kind.Smoke, p.pos[0], p.pos[1], 2, 40, 500, [6, 14], r(fx, "dust"), { ay: -20 });
          fx.shake(s.level === 2 ? 2.5 : 3, 60);
        };
    });
  },
  impact(s) {
    const { fx } = s;
    const [x, y] = s.hit();
    streaks(fx, x, y, n(s, 24), 460, r(fx, "brass"));
    if (s.level === 3) {
      fx.flashWhite(0.55, 280, "#fed7aa");
      rings(fx, x, y, 3, 70, "#fed7aa");
    }
  },
  explode(s) {
    const { fx, D } = s;
    const [x, y] = s.hit();
    const [fx0, fy0] = feet(D);
    if (s.level <= 1) {
      fx.burst(Kind.Smoke, x, y, n(s, 6), 60, 800, [8, 20], r(fx, "dust"), { ay: -40 });
      fx.burst(Kind.Spark, x, y, n(s, 16), 260, 300, [3, 1], s.ramp, { drag: 3 });
      return;
    }
    if (s.level === 2) {
      dust(fx, fx0, fy0 - 20, 18, 160);
      streaks(fx, x, y, 40, 520, s.ramp);
      return;
    }
    fireBall(fx, x, y, 30, 220, s.ramp);
    debris(fx, fx0, fy0, 45, 560, fy0 + 6, 10);
    smokeColumn(fx, fx0, fy0 - 30, 22);
    embers(fx, x, y, 60, s.ramp, 380);
    fx.decal(fx0, fy0, 64, true);
    sfx.boom(3);
  },
};

/** Shot timings (ms after launch) for the gun at each difficulty. */
function gunShots(s: Strike): number[] {
  if (s.level === 0) return [0];
  if (s.level === 1) return [0, 70, 140];
  if (s.level === 3) return [0];
  const count = 14;
  const gap = Math.min(28, (s.travel - 80) / (count - 1));
  return Array.from({ length: count }, (_, i) => Math.round(i * gap));
}

const lightning: WeaponFx = {
  windup(s) {
    const { fx, A } = s;
    const [mx, my] = A.anchors.muzzle;
    const er = r(fx, "electric");
    streaks(fx, mx, my, n(s, 16), 160, er, -Math.PI / 2, Math.PI * 2, 2);
    if (s.level >= 2) {
      fx.dim(pick(s, [0, 0, 0.3, 0.6]), s.windup + s.travel + 700);
      // storm clouds roll in along the top of the arena
      for (let i = 0; i < pick(s, [0, 0, 8, 16]); i++) {
        const x = (i / 15) * fx.width * 1.1;
        fx.particles.spawn(Kind.Smoke, x, 10 + Math.random() * 30, (Math.random() - 0.5) * 20, 0, s.windup + s.travel + 900, 40, 70, r(fx, "dust"), 0, 0.5);
      }
      // sheet lightning flickers in the clouds while the storm builds
      for (let i = 0; i < pick(s, [0, 0, 2, 5]); i++) {
        const x = Math.random() * fx.width;
        fx.beam({ from: () => [x, 8], to: () => [x + (Math.random() - 0.5) * 220, 50 + Math.random() * 40], dur: 140, width: 2.5, ramp: r(fx, "electric"), style: "lightning", grow: 20, branches: 2, delay: Math.random() * s.windup });
      }
      sfx.rumble((s.windup + s.travel) / 1000);
    }
  },
  launch(s) {
    const { fx, A, D } = s;
    const er = r(fx, "electric");
    const sky = (dx: number): (() => [number, number]) => () => [s.hit()[0] + dx, -20];
    if (s.level <= 1) {
      fx.beam({ from: () => A.anchors.muzzle, to: s.hit, dur: s.travel + 160, width: s.level ? 4 : 2.5, ramp: er, style: "lightning", grow: s.travel, branches: s.level ? 3 : 1 });
      if (s.level === 1) fx.beam({ from: () => A.anchors.muzzle, to: () => jitter(D.anchors.head, 30), dur: s.travel + 120, width: 2.5, ramp: er, style: "lightning", grow: s.travel * 0.6, branches: 2, delay: 80 });
    } else if (s.level === 2) {
      [-90, 70, 0].forEach((dx, i) => {
        const at = s.travel - 220 + i * 105;
        fx.beam({ from: sky(dx * 0.5), to: () => (i === 2 ? s.hit() : [D.anchors.feet[0] + dx, D.anchors.feet[1]]), dur: 260, width: 5, ramp: er, style: "lightning", grow: 30, branches: 3, delay: Math.max(0, at - 30) });
        if (i < 2) setTimeout(() => strikeFlash(s, [D.anchors.feet[0] + dx, D.anchors.feet[1]]), at);
      });
    } else {
      for (let i = 0; i < 5; i++) {
        const dx = (Math.random() - 0.5) * fx.width * 0.8;
        const at = 60 + i * ((s.travel - 160) / 5);
        fx.beam({ from: () => [s.hit()[0] + dx, -20], to: () => [s.hit()[0] + dx * 0.6, D.anchors.feet[1] + (Math.random() - 0.5) * 30], dur: 200, width: 4, ramp: er, style: "lightning", grow: 20, branches: 3, delay: at });
        setTimeout(() => fx.flashWhite(0.25, 120, "#bfdbfe"), at);
      }
      fx.beam({ from: sky(0), to: s.hit, dur: 520, width: 12, ramp: er, style: "lightning", grow: 30, branches: 6, delay: s.travel - 40 });
    }
    sfx.zap(s.travel / 1000, s.level);
  },
  impact(s) {
    const { fx } = s;
    const [x, y] = s.hit();
    streaks(fx, x, y, n(s, 40), 560, r(fx, "electric"), -Math.PI / 2, Math.PI * 2, 2.5);
    fx.flashWhite(pick(s, [0.12, 0.2, 0.35, 0.7]), 200, "#dbeafe");
    if (s.level === 3) rings(fx, x, y, 3, 90, "#bae6fd", 70);
  },
  explode(s) {
    const { fx, D } = s;
    const [x, y] = s.hit();
    const [fx0, fy0] = feet(D);
    const er = r(fx, "electric");
    fx.burst(Kind.Spark, x, y, n(s, 50), 300, 500, [4, 1], er, { drag: 3 });
    embers(fx, x, y, n(s, 20), er, 260);
    if (s.level >= 2) {
      fx.decal(fx0, fy0, 30 + s.level * 14, s.level === 3);
      dust(fx, fx0, fy0, n(s, 8));
    }
    if (s.level === 3) {
      debris(fx, fx0, fy0, 30, 480, fy0 + 6, 8);
      streaks(fx, fx0, fy0, 90, 760, er, -Math.PI / 2, 2.4, 3);
    }
  },
};

function strikeFlash(s: Strike, p: [number, number]): void {
  const { fx } = s;
  streaks(fx, p[0], p[1], 20, 380, r(fx, "electric"), -Math.PI / 2, Math.PI * 1.4, 2);
  dust(fx, p[0], p[1], 4, 80);
  fx.decal(p[0], p[1], 20, false);
  fx.flashWhite(0.18, 100, "#dbeafe");
  fx.shake(5, 120);
  sfx.zap(0.08, 1);
}

const arrows: WeaponFx = {
  windup(s) {
    s.fx.prop({ side: s.att, kind: "bow", dur: s.windup + Math.min(s.travel, 300), scale: pick(s, [40, 44, 46, 50]), accent: s.look.accent, metal: s.look.metal, kicks: [s.windup], aim: aim(s) * 0.4 });
    if (s.level === 3) {
      const [fx0, fy0] = feet(s.D);
      s.fx.reticle({ x: fx0, y: fy0, r: 110, dur: s.windup + s.travel, color: "#f97316" });
      s.fx.dim(0.2, s.windup + s.travel + 500);
    }
  },
  launch(s) {
    const { fx, A, D } = s;
    const from: [number, number] = [A.anchors.muzzle[0], A.anchors.muzzle[1]];
    const arrow = (delay: number, dur: number, to: () => [number, number], path: "arc" | "lob" | "drop", start = from, size = 11, fire = false) =>
      fx.launch({ from: start, to, dur, delay, size, ramp: s.ramp, style: "arrow", trail: fire ? 3 : 1, trailStyle: fire ? "embers" : "wind", path, ease: path === "drop" ? "in" : "linear", warn: s.warn, metal: s.look.metal });
    if (s.level === 0) arrow(0, s.travel, s.hit, "arc");
    else if (s.level === 1) volley(s, 2, 140, (_i, delay, dur) => arrow(delay, dur, s.hit, "arc", from, 12));
    else if (s.level === 2) {
      volley(s, 10, 220, (_i, delay, dur, last) => {
        const p = arrow(delay, dur, last ? s.hit : () => jitter(D.anchors.chest, 110), "lob", from, 10);
        if (!last) p.onArrive = () => dust(fx, p.pos[0], p.pos[1], 2, 50);
      });
    } else {
      volley(s, 24, 380, (i, delay, dur, last) => {
        const sx = D.anchors.feet[0] + fromSide(s) * (120 + (i % 6) * 40);
        const p = arrow(delay, dur, last ? s.hit : () => jitter([D.anchors.feet[0], D.anchors.feet[1] - 20], 200), "drop", [sx, -40 - (i % 4) * 30], 12, true);
        if (!last)
          p.onArrive = () => {
            fx.burst(Kind.Flame, p.pos[0], p.pos[1], 10, 120, 420, [9, 2], s.ramp, { ay: -160 });
            embers(fx, p.pos[0], p.pos[1], 4, s.ramp, 120);
          };
      });
    }
    sfx.twang(s.level);
  },
  impact(s) {
    const [x, y] = s.hit();
    streaks(s.fx, x, y, n(s, 16), 380, r(s.fx, "metal"));
    sfx.thud(s.level);
  },
  explode(s) {
    const { fx, D } = s;
    const [fx0, fy0] = feet(D);
    dust(fx, fx0, fy0, n(s, 8), 110);
    if (s.level === 3) {
      for (let i = 0; i < 6; i++) setTimeout(() => pillar(fx, fx0 + (i - 2.5) * 44, fy0, 110, 20, s.ramp), i * 60);
      embers(fx, fx0, fy0 - 30, 90, s.ramp, 360);
      fx.decal(fx0, fy0, 70, false);
      smokeColumn(fx, fx0, fy0 - 20, 16);
    }
  },
};

const shuriken: WeaponFx = {
  windup(s) {
    const [mx, my] = s.A.anchors.muzzle;
    streaks(s.fx, mx, my, n(s, 12), 140, r(s.fx, "metal"), -Math.PI / 2, Math.PI * 2, 2);
  },
  launch(s) {
    const { fx, A } = s;
    const star = (delay: number, dur: number, from: [number, number], to: () => [number, number], path: "arc" | "lob" | "line", size: number, trail = 2) =>
      fx.launch({ from, to, dur, delay, size, ramp: s.ramp, style: "shuriken", trail, trailStyle: "streak", path, ease: "linear", warn: s.warn, metal: s.look.metal });
    const m: [number, number] = [A.anchors.muzzle[0], A.anchors.muzzle[1]];
    if (s.level === 0) star(0, s.travel, m, s.hit, "line", 13);
    else if (s.level === 1) {
      const paths: ("lob" | "arc" | "line")[] = ["lob", "arc", "line"];
      volley(s, 3, 120, (i, delay, dur) => star(delay, dur, m, () => jitter(s.hit(), i === 2 ? 0 : 50), paths[i], 14));
    } else if (s.level === 2) {
      // six blades orbit the thrower, then peel off one after another
      volley(s, 6, 300, (i, delay, dur) => {
        const a = (i / 6) * Math.PI * 2;
        const from: [number, number] = [A.baseX + Math.cos(a) * A.size * 0.75, A.baseY + Math.sin(a) * A.size * 0.45];
        const p = star(delay, dur, from, () => jitter(s.hit(), i === 5 ? 0 : 40), "arc", 12);
        p.onArrive = () => streaks(fx, p.pos[0], p.pos[1], 10, 340, r(fx, "metal"));
      });
    } else star(0, s.travel, m, s.hit, "line", 42, 9);
    sfx.whoosh(s.travel / 1000, s.level);
  },
  impact(s) {
    const { fx } = s;
    const [x, y] = s.hit();
    streaks(fx, x, y, n(s, 24), 520, r(fx, "metal"));
    if (s.level >= 1) {
      const cuts = pick(s, [0, 2, 4, 7]);
      for (let i = 0; i < cuts; i++) {
        const a = (i % 2 ? 0.7 : -0.7) + (Math.random() - 0.5) * 0.5;
        fx.slash({ x: x + (Math.random() - 0.5) * 40, y: y + (Math.random() - 0.5) * 40, angle: a, len: 70 + s.level * 30, dur: 420, color: s.look.colors[2], width: 3 + s.level, delay: i * 55 });
      }
    }
    sfx.clang(s.level);
  },
  explode(s) {
    const { fx, D } = s;
    const [x, y] = s.hit();
    fx.burst(Kind.Spark, x, y, n(s, 30), 300, 400, [3, 1], s.ramp, { drag: 3 });
    if (s.level === 3) {
      const [fx0, fy0] = feet(D);
      for (let i = 0; i < 6; i++) fx.slash({ x: x + (Math.random() - 0.5) * 120, y: y + (Math.random() - 0.5) * 90, angle: Math.random() * Math.PI, len: 160, dur: 520, color: s.look.colors[2], width: 6, delay: i * 70 });
      streaks(fx, x, y, 90, 720, s.ramp, -Math.PI / 2, Math.PI * 2, 3);
      dust(fx, fx0, fy0, 10);
    }
  },
};

const laser: WeaponFx = {
  windup(s) {
    const { fx } = s;
    if (s.level < 3) fx.prop({ side: s.att, kind: "cannon", dur: s.windup + s.travel + 300, scale: pick(s, [36, 42, 48, 48]), accent: s.look.accent, metal: s.look.metal, aim: aim(s) });
    const ch = fx.charge[s.att];
    if (ch) ch.target = pick(s, [6, 10, 16, 8]);
    if (s.level === 3) {
      const [fx0, fy0] = feet(s.D);
      fx.reticle({ x: fx0, y: fy0, r: 90, dur: s.windup + s.travel + 200, color: s.look.colors[2] });
      // a satellite paints the target with a thin beam before it fires
      fx.beam({ from: () => [s.hit()[0], -30], to: () => [s.hit()[0], s.D.anchors.feet[1]], dur: s.windup + s.travel, width: 2.5, ramp: s.ramp, style: "laser", grow: s.windup, branches: 0 });
      fx.dim(0.45, s.windup + s.travel + 900);
      sfx.lockOn(s.windup / 1000);
    }
    sfx.charge(s.windup / 1000);
  },
  launch(s) {
    const { fx, A, D } = s;
    const m = () => A.anchors.muzzle;
    if (s.level === 0) {
      fx.launch({ from: [...m()] as [number, number], to: s.hit, dur: s.travel, size: 7, ramp: s.ramp, style: "bullet", trail: 1, trailStyle: "streak", path: "line", ease: "linear", warn: s.warn });
    } else if (s.level === 1) {
      // the beam sweeps up the floor into the target
      const t0 = fx.gameTime;
      const sweep = (): [number, number] => {
        const k = Math.min(1, (fx.gameTime - t0) / s.travel);
        const [hx, hy] = s.hit();
        return [hx + (1 - k) * -A.facing * 160, hy + (1 - k) * (D.anchors.feet[1] - hy + 20)];
      };
      fx.beam({ from: m, to: sweep, dur: s.travel + 220, width: 6, ramp: s.ramp, style: "laser", grow: 60, branches: 0 });
    } else if (s.level === 2) {
      fx.beam({ from: m, to: s.hit, dur: s.travel + 260, width: 7, ramp: s.ramp, style: "laser", grow: s.travel, branches: 0 });
      fx.beam({ from: () => [s.hit()[0] - A.facing * 260, -20], to: s.hit, dur: s.travel + 260, width: 7, ramp: s.ramp, style: "laser", grow: s.travel, branches: 0, delay: 40 });
    } else {
      fx.beam({ from: () => [s.hit()[0], -30], to: () => [s.hit()[0], D.anchors.feet[1]], dur: 1000, width: 30, ramp: s.ramp, style: "orbital", grow: 140, branches: 0, delay: s.travel - 60 });
    }
    sfx.laser((s.travel + 200) / 1000, s.level);
  },
  impact(s) {
    const { fx } = s;
    const [x, y] = s.hit();
    streaks(fx, x, y, n(s, 26), 480, s.ramp, -Math.PI / 2, Math.PI * 2, 2.5);
    if (s.level === 3) {
      fx.flashWhite(0.8, 380, s.look.colors[1]);
      rings(fx, x, s.D.anchors.feet[1], 4, 80, s.look.colors[1], 70);
    }
  },
  explode(s) {
    const { fx, D } = s;
    const [x, y] = s.hit();
    const [fx0, fy0] = feet(D);
    fx.burst(Kind.Glow, x, y, n(s, 30), 200, 500, [10, 2], s.ramp, { drag: 3 });
    embers(fx, x, y, n(s, 26), s.ramp, 240);
    fx.decal(fx0, fy0, 18 + s.level * 16, s.level === 3);
    if (s.level === 3) {
      fx.burst(Kind.Flame, fx0, fy0, 160, 520, 900, [22, 5], s.ramp, { ay: -320, drag: 0.8, dir: -Math.PI / 2, spread: 0.5 });
      debris(fx, fx0, fy0, 36, 560, fy0 + 6, 9);
      smokeColumn(fx, fx0, fy0 - 20, 20);
      sfx.boom(3);
    }
  },
};

const meteor: WeaponFx = {
  windup(s) {
    const { fx, D } = s;
    const [fx0, fy0] = feet(D);
    if (s.level >= 1) fx.reticle({ x: fx0, y: fy0, r: pick(s, [0, 50, 120, 150]), dur: s.windup + s.travel, color: s.look.accent });
    if (s.level === 3) {
      fx.dim(0.55, s.windup + s.travel + 1200);
      // the sky glows where it will come from
      for (let i = 0; i < 30; i++) fx.particles.spawn(Kind.Glow, fx0 + fromSide(s) * fx.width * 0.4 + (Math.random() - 0.5) * 160, -20 + Math.random() * 40, 0, 0, s.windup + s.travel, 60, 90, s.ramp, 0, 0);
      sfx.rumble((s.windup + s.travel) / 1000);
    }
  },
  launch(s) {
    const { fx, D } = s;
    const sideways = fromSide(s); // fall in from the attacker's side of the sky, clear of the HUD
    const rock = (delay: number, dur: number, to: () => [number, number], size: number, dx: number, trail: number) =>
      fx.launch({ from: [to()[0] + sideways * dx, -size * 2], to, dur, delay, size, ramp: s.ramp, style: "meteor", trail, trailStyle: "embers", path: "drop", ease: "in", warn: s.warn, metal: s.look.metal });
    if (s.level <= 1) rock(0, s.travel, s.hit, s.level ? 20 : 12, fx.width * (s.level ? 0.4 : 0.32), s.level ? 5 : 2);
    else if (s.level === 2) {
      volley(s, 5, 320, (i, delay, dur, last) => {
        const off = (i - 2) * 55;
        const to = last ? s.hit : (): [number, number] => [D.anchors.feet[0] + off, D.anchors.feet[1]];
        const p = rock(delay, dur, to, 15, fx.width * 0.3 + i * 30, 3);
        if (!last)
          p.onArrive = () => {
            const [x, y] = p.pos;
            fireBall(fx, x, y, 12, 40, s.ramp);
            debris(fx, x, y, 12, 320, D.anchors.feet[1] + 4, 7);
            fx.ring(x, y, 60, 320, s.look.colors[1], 4);
            fx.shake(6, 140);
            sfx.thud(2);
          };
      });
    } else {
      rock(0, s.travel, s.hit, 64, fx.width * 0.5, 16);
      fx.zoomTo(1.08, s.travel);
    }
    sfx.fwoosh(s.travel / 1000, s.level);
  },
  impact(s) {
    const { fx } = s;
    const [x, y] = s.hit();
    rings(fx, x, y, pick(s, [1, 2, 3, 5]), 70, s.look.colors[1], 80);
    if (s.level === 3) {
      fx.flashWhite(0.85, 450, "#fed7aa");
      fx.aberration = { until: fx.now() + 420, px: 6 };
    }
  },
  explode(s) {
    const { fx, D } = s;
    const [x, y] = s.hit();
    const [fx0, fy0] = feet(D);
    fireBall(fx, x, y, pick(s, [10, 18, 24, 44]), n(s, 100), s.ramp);
    debris(fx, fx0, fy0, n(s, 22), pick(s, [300, 400, 520, 760]), fy0 + 6, pick(s, [6, 8, 10, 14]));
    embers(fx, x, y, n(s, 30), s.ramp, 320);
    dust(fx, fx0, fy0, n(s, 10), 160);
    fx.decal(fx0, fy0, pick(s, [18, 30, 50, 110]), s.level >= 2);
    if (s.level === 3) {
      smokeColumn(fx, fx0, fy0 - 40, 40);
      for (let i = 0; i < 5; i++) setTimeout(() => pillar(fx, fx0 + (i - 2) * 70, fy0, 170, 22, s.ramp), 60 + i * 70);
      fx.spike({ x: fx0, y: fy0 + 8, width: D.size * 3.2, n: 9, height: D.size * 0.45, dur: 1500, color: "#292524", edge: "#f97316" });
      sfx.boom(3);
    }
  },
};

export const WEAPONS: Record<WeaponStyle, WeaponFx> = { fireball, spear, gun, lightning, arrows, shuriken, laser, meteor };

/** The shared effect kit, for the misfires in misfire.ts. */
export const kit = { r, n, pick, feet, fromSide, hover, jitter, debris, dust, streaks, embers, fireBall, pillar, rings, smokeColumn, shells, volley, aim, RAMPS };
