/**
 * Misfires: a wrong answer turns the attack around. The weapon leaves the hand
 * as usual, falters, turns, and comes back to hit the one who fired it: the
 * arrow stalls and flips, the shuriken boomerangs, bullets ricochet, the rocket
 * loops round, lightning forks back, the laser hits a glitch mirror, the
 * meteor's target slides onto its owner and the spear tumbles and drops.
 *
 * Contract with the director (the same as weapons.launch): misfire(s) makes the
 * main return hit land exactly `s.travel` ms after it is called. TURN gives the
 * share of `travel` at which the weapon turns round, for the "uh-oh" beat.
 * Nothing here changes a number: the server already decided the recoil.
 */
import { sfx } from "../audio/sfx";
import type { Fighter } from "./fighters";
import { Kind } from "./particles";
import { kit, type Level, type Strike, type WeaponStyle } from "./weapons";

const { r, n, pick, feet, jitter, streaks, fireBall, dust, volley } = kit;

type Pt = [number, number];

/** A strike aimed back at its owner: A and D are both the attacker, O is the one it was meant for. */
export interface MisfireStrike extends Strike {
  O: Fighter;
}

/** How long a misfire takes from leaving the hand to hitting its owner, by difficulty. */
export const MISFIRE_TRAVEL: Record<Level, number> = { 0: 820, 1: 900, 2: 1050, 3: 1250 };

/** When the weapon turns round, as a share of the travel. */
export const TURN: Record<WeaponStyle, number> = { fireball: 0.48, spear: 0.5, gun: 0.45, lightning: 0.42, arrows: 0.5, shuriken: 0.5, laser: 0.45, meteor: 0.5 };

const lerp = (a: Pt, b: Pt, u: number): Pt => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
const smooth = (u: number) => u * u * (3 - 2 * u);
function bez(a: Pt, c: Pt, b: Pt, u: number): Pt {
  const v = 1 - u;
  return [v * v * a[0] + 2 * v * u * c[0] + u * u * b[0], v * v * a[1] + 2 * v * u * c[1] + u * u * b[1]];
}

/** +1 when the intended target is to the right. */
const dirOf = (s: MisfireStrike) => (s.O.baseX >= s.A.baseX ? 1 : -1);
/** A point part of the way from the attacker's hand to the intended target, raised. */
function toward(s: MisfireStrike, share: number, raise = 0): Pt {
  const [mx, my] = s.A.anchors.muzzle;
  const [ox, oy] = s.O.anchors.chest;
  return [mx + (ox - mx) * share, my + (oy - my) * share - raise];
}
const home = (s: MisfireStrike) => (): Pt => [s.A.anchors.chest[0], s.A.anchors.chest[1]];
const near = (s: MisfireStrike, amt: number) => {
  const j = jitter([0, 0], amt);
  return (): Pt => [s.A.anchors.chest[0] + j[0], s.A.anchors.chest[1] + j[1] * 0.8];
};

/**
 * Out, stall, loop, back: leaves `from` toward the target, slows to a stop at
 * `apex`, swings up and over a loop of radius R (so it turns to face its owner)
 * and dives back into `target()`, gathering speed.
 */
export function uturn(from: Pt, apex: Pt, R: number, dir: number, target: () => Pt, split: [number, number] = [0.42, 0.62], wobble = 0): (k: number) => Pt {
  const c: Pt = [apex[0], apex[1] - R];
  const top: Pt = [apex[0], apex[1] - 2 * R];
  const ctrlOut: Pt = [(from[0] + apex[0]) / 2, Math.min(from[1], apex[1]) - Math.abs(apex[0] - from[0]) * 0.12];
  const [a, b] = split;
  return (k) => {
    if (k < a) {
      const u = 1 - (1 - k / a) ** 2; // decelerates into the stall
      const p = bez(from, ctrlOut, apex, u);
      if (wobble) p[1] += Math.sin(u * 20) * wobble * u;
      return p;
    }
    if (k < b) {
      const th = Math.PI / 2 - Math.PI * ((k - a) / (b - a));
      return [c[0] + dir * R * Math.cos(th), c[1] + R * Math.sin(th)];
    }
    const u = (k - b) / (1 - b);
    const h = target();
    const ctrl: Pt = [top[0] - dir * Math.abs(top[0] - h[0]) * 0.55, top[1] - R * 0.2];
    return bez(top, ctrl, h, u * u);
  };
}

/** Up and over: a lob toward the target that bends back down onto its owner, slowest at the top. */
export function lobBack(from: Pt, peak: Pt, target: () => Pt): (k: number) => Pt {
  return (k) => {
    const u = k < 0.5 ? 0.5 * (1 - (1 - 2 * k) ** 2) : 0.5 + 0.5 * (2 * k - 1) ** 2;
    const h = target();
    // the control point that puts the curve's top at `peak`
    const ctrl: Pt = [2 * peak[0] - (from[0] + h[0]) / 2, 2 * peak[1] - (from[1] + h[1]) / 2];
    return bez(from, ctrl, h, u);
  };
}

/** A boomerang: forward over the top, round the far end, back along the bottom into its owner. */
export function boomerang(from: Pt, reach: number, height: number, dir: number, target: () => Pt): (k: number) => Pt {
  const a = reach / 2;
  const c: Pt = [from[0] + dir * a, from[1]];
  return (k) => {
    const phi = Math.PI * 2 * k;
    const p: Pt = [c[0] - dir * a * Math.cos(phi), c[1] - height * Math.sin(phi)];
    if (k < 0.78) return p;
    return lerp(p, target(), smooth((k - 0.78) / 0.22));
  };
}

/** Straight out to a point, then straight back: a ricochet. */
export function bounce(from: Pt, at: Pt, target: () => Pt, share = 0.5): (k: number) => Pt {
  return (k) => (k < share ? lerp(from, at, k / share) : lerp(at, target(), (k - share) / (1 - share)));
}

/** Sparks, glitch squares and smoke where the attack goes wrong. */
function sputter(s: MisfireStrike, p: Pt, big = 1): void {
  const { fx } = s;
  fx.burst(Kind.Square, p[0], p[1], Math.round(10 * big), 160, 500, [5, 2], fx.ramp(["#ffffff", "#f0abfc", "#d946ef", "#701a75", "#2e1065"]), { drag: 2 });
  fx.burst(Kind.Spark, p[0], p[1], n(s, 12), 220, 300, [3, 1], s.ramp, { drag: 3 });
  fx.burst(Kind.Smoke, p[0], p[1], 3, 40, 700, [6, 16], r(fx, "dust"), { ay: -30 });
}

/** A glitch mirror hanging in the air: what the laser bounces off. */
function mirror(s: MisfireStrike, p: Pt): void {
  const { fx } = s;
  fx.ring(p[0], p[1], 34, 520, "#e879f9", 4, 30);
  fx.ring(p[0], p[1], 60, 420, "#f0abfc", 2, 10);
  sputter(s, p, 1.6);
  fx.text({ text: "ERR", x: p[0], y: p[1] - 24, size: 12, fill: "#f5d0fe", stroke: "#4a044e", dur: 700 });
  fx.aberration = { until: fx.now() + 160, px: 3 };
  sfx.ricochet();
}

type MisfireFx = (s: MisfireStrike) => void;

const fireball: MisfireFx = (s) => {
  const { fx, A } = s;
  const dir = dirOf(s);
  const from: Pt = [A.anchors.muzzle[0], A.anchors.muzzle[1]];
  const ball = (size: number, delay: number, dur: number, curve: (k: number) => Pt, trail = 5) =>
    fx.launch({ from, to: home(s), dur, delay, size, ramp: s.ramp, style: "fireball", trail, trailStyle: "embers", curve, warn: s.warn });
  if (s.level <= 1) {
    const size = s.level ? 16 : 12;
    ball(size, 0, s.travel, uturn(from, toward(s, 0.42, 30), 36 + s.level * 8, dir, home(s), [0.42, 0.62], 10));
  } else if (s.level === 2) {
    // three orbs spin out of control and come home one after another
    volley(s, 3, 220, (i, delay, dur, last) => {
      const p = ball(14, delay, dur, uturn([from[0], from[1] - 20 + i * 20], toward(s, 0.3 + i * 0.08, 40 - i * 20), 30 + i * 6, dir, last ? home(s) : near(s, 70), [0.4, 0.6], 14));
      if (!last) p.onArrive = () => fireBall(fx, p.pos[0], p.pos[1], 12, 30, s.ramp);
    });
  } else {
    // the sun overhead wobbles, tips over and falls on its maker
    const [hx, hy] = A.anchors.head;
    const sun: Pt = [hx, hy - 60];
    fx.launch({
      from: sun, to: home(s), dur: s.travel, size: 44, ramp: s.ramp, style: "fireball", trail: 10, trailStyle: "embers", warn: s.warn,
      curve: (k) => {
        if (k < 0.62) {
          const w = (k / 0.62) * 22;
          return [sun[0] + Math.sin(k * 60) * w, sun[1] + Math.cos(k * 47) * w * 0.4 - k * 30];
        }
        return lerp([sun[0], sun[1] - 18], home(s)(), ((k - 0.62) / 0.38) ** 2);
      },
    });
    fx.dim(0.35, s.travel + 600);
  }
  setTimeout(() => sputter(s, toward(s, 0.42, 30)), s.travel * 0.4);
  sfx.fwoosh(s.travel / 1000, s.level);
};

const spear: MisfireFx = (s) => {
  const { fx, A } = s;
  const from: Pt = [A.anchors.muzzle[0], A.anchors.muzzle[1] - 10];
  const tumble = (k: number, m: number) => (k > 0.32 && k < 0.7 ? m + Math.PI * 4 * smooth((k - 0.32) / 0.38) : m);
  const metal = s.level === 3 ? s.look.accent : s.look.metal;
  const throwOne = (delay: number, dur: number, peak: Pt, target: () => Pt, size: number) =>
    fx.launch({ from, to: target, dur, delay, size, ramp: s.ramp, style: "spear", trail: 4, trailStyle: "wind", curve: lobBack(from, peak, target), angleAt: tumble, warn: s.warn, metal, accent: s.look.accent });
  if (s.level === 2) {
    volley(s, 3, 260, (i, delay, dur, last) => {
      const p = throwOne(delay, dur, toward(s, 0.3 + i * 0.05, 180), last ? home(s) : () => [A.anchors.feet[0] + (i - 1) * 50, A.anchors.feet[1]], 15);
      if (!last)
        p.onArrive = () => {
          dust(fx, p.pos[0], p.pos[1], 6, 90);
          fx.shake(5, 140);
          sfx.thud(0);
        };
    });
  } else throwOne(0, s.travel, toward(s, 0.32, s.level === 3 ? 210 : 170), home(s), pick(s, [15, 18, 18, 28]));
  sfx.whoosh(s.travel / 1000, s.level);
};

const gun: MisfireFx = (s) => {
  const { fx, A } = s;
  const from = (): Pt => [A.anchors.muzzle[0], A.anchors.muzzle[1]];
  // the jam: click, click, smoke from the barrel
  sfx.jam();
  fx.burst(Kind.Smoke, from()[0], from()[1], 6, 50, 900, [6, 18], r(fx, "dust"), { ay: -40 });
  if (s.level === 3) {
    // the rocket loses its lock, loops round and finds its owner
    const R = 70;
    fx.launch({ from: from(), to: home(s), dur: s.travel, size: 15, ramp: s.ramp, style: "rocket", trail: 7, trailStyle: "smoke", curve: uturn(from(), toward(s, 0.48, 60), R, dirOf(s), home(s), [0.38, 0.64], 18), warn: s.warn, onStart: () => sfx.rocket(s.travel / 1000) });
    fx.beam({ from: () => A.anchors.muzzle, to: home(s), dur: s.travel * 0.5, width: 2, ramp: r(fx, "red"), style: "laser", grow: 80, branches: 0, delay: s.travel * 0.45 });
    return;
  }
  const count = pick(s, [1, 3, 12, 1]);
  const jamMs = 260; // the shots leave after the clicks
  volley({ ...s, travel: s.travel - jamMs }, count, s.level === 2 ? 320 : 150, (i, delay, dur, last) => {
    const wall = toward(s, 0.5 + (i % 3) * 0.06, 30 + ((i * 37) % 90));
    const p = fx.launch({
      from: from(), to: home(s), dur, delay: delay + jamMs, size: pick(s, [4.5, 4.5, 3.4, 4]), ramp: s.ramp, style: "bullet", trail: 0, trailStyle: "none",
      curve: bounce(from(), wall, last ? home(s) : near(s, 60)), warn: s.warn && last,
      onStart: () => {
        kit.shells(fx, s, 1);
        sfx.gunshot(s.level);
      },
    });
    setTimeout(() => {
      streaks(fx, wall[0], wall[1], 10, 360, r(fx, "brass"));
      if (i === 0 || last) sfx.ricochet();
    }, delay + jamMs + dur * 0.5);
    if (!last) p.onArrive = () => streaks(fx, p.pos[0], p.pos[1], 6, 300, r(fx, "brass"));
  });
};

const lightning: MisfireFx = (s) => {
  const { fx, A } = s;
  const er = r(fx, "electric");
  const head = (): Pt => [A.anchors.head[0], A.anchors.head[1]];
  if (s.level <= 1) {
    // the bolt leaves the hand, forks up into the sky and comes down on the caster
    const sky = toward(s, 0.4, 170);
    fx.beam({ from: () => A.anchors.muzzle, to: () => sky, dur: s.travel * 0.6, width: s.level ? 4 : 2.5, ramp: er, style: "lightning", grow: s.travel * 0.3, branches: 2 });
    fx.beam({ from: () => sky, to: head, dur: 260, width: s.level ? 6 : 4, ramp: er, style: "lightning", grow: 30, branches: 3, delay: s.travel - 40 });
    setTimeout(() => {
      fx.ring(sky[0], sky[1], 50, 300, "#bae6fd", 3);
      streaks(fx, sky[0], sky[1], 14, 260, er);
    }, s.travel * 0.3);
  } else {
    // the storm gathers over the wrong head
    fx.dim(pick(s, [0, 0, 0.3, 0.55]), s.travel + 700);
    const cx = A.baseX;
    for (let i = 0; i < pick(s, [0, 0, 8, 14]); i++) fx.particles.spawn(Kind.Smoke, cx + (i - 6) * 34, 10 + Math.random() * 30, (Math.random() - 0.5) * 20, 0, s.travel + 900, 40, 70, r(fx, "dust"), 0, 0.5);
    const bolts = pick(s, [0, 0, 2, 5]);
    for (let i = 0; i < bolts; i++) {
      const dx = (i - (bolts - 1) / 2) * 60;
      const at = s.travel * 0.35 + i * ((s.travel * 0.5) / bolts);
      fx.beam({ from: () => [cx + dx, -20], to: () => [A.anchors.feet[0] + dx, A.anchors.feet[1]], dur: 200, width: 4, ramp: er, style: "lightning", grow: 20, branches: 3, delay: at });
      setTimeout(() => fx.flashWhite(0.2, 100, "#bfdbfe"), at);
    }
    fx.beam({ from: () => [cx, -20], to: head, dur: 480, width: s.level === 3 ? 12 : 7, ramp: er, style: "lightning", grow: 30, branches: 5, delay: s.travel - 40 });
  }
  sfx.zap(s.travel / 1000, s.level);
};

const arrows: MisfireFx = (s) => {
  const { fx, A } = s;
  const dir = dirOf(s);
  const from: Pt = [A.anchors.muzzle[0], A.anchors.muzzle[1]];
  const arrow = (delay: number, dur: number, curve: (k: number) => Pt, size = 11, fire = false) =>
    fx.launch({ from, to: home(s), dur, delay, size, ramp: s.ramp, style: "arrow", trail: fire ? 3 : 1, trailStyle: fire ? "embers" : "wind", curve, warn: s.warn, metal: s.look.metal });
  if (s.level === 0) arrow(0, s.travel, uturn(from, toward(s, 0.45, 20), 38, dir, home(s)), 15);
  else if (s.level === 1) volley(s, 2, 140, (i, delay, dur) => arrow(delay, dur, uturn(from, toward(s, 0.4 + i * 0.08, 20 + i * 18), 34 + i * 8, dir, home(s)), 15));
  else {
    // the volley climbs, turns in the sky and rains down on the archer
    const count = s.level === 2 ? 10 : 22;
    if (s.level === 3) fx.reticle({ x: A.anchors.feet[0], y: A.anchors.feet[1], r: 100, dur: s.travel, color: "#ef4444" });
    volley(s, count, s.level === 2 ? 220 : 360, (i, delay, dur, last) => {
      const spot = last ? home(s) : near(s, s.level === 2 ? 110 : 190);
      const peak = toward(s, 0.25 + (i % 5) * 0.04, 200 + (i % 4) * 22);
      const p = arrow(delay, dur, lobBack(from, peak, spot), 13, s.level === 3);
      if (!last)
        p.onArrive = () => {
          dust(fx, p.pos[0], p.pos[1], 2, 50);
          if (s.level === 3) fx.burst(Kind.Flame, p.pos[0], p.pos[1], 8, 110, 380, [8, 2], s.ramp, { ay: -150 });
        };
    });
  }
  sfx.twang(s.level);
};

const shuriken: MisfireFx = (s) => {
  const { fx, A } = s;
  const dir = dirOf(s);
  const m: Pt = [A.anchors.muzzle[0], A.anchors.muzzle[1]];
  const reach = Math.abs(s.O.baseX - A.baseX) * 0.75;
  const star = (delay: number, dur: number, from: Pt, curve: (k: number) => Pt, size: number, trail = 2) =>
    fx.launch({ from, to: home(s), dur, delay, size, ramp: s.ramp, style: "shuriken", trail, trailStyle: "streak", curve, warn: s.warn, metal: s.look.metal });
  if (s.level === 0) star(0, s.travel, m, boomerang(m, reach, 90, dir, home(s)), 13);
  else if (s.level === 1) volley(s, 3, 140, (i, delay, dur, last) => star(delay, dur, m, boomerang(m, reach * (0.8 + i * 0.1), 60 + i * 30, dir, last ? home(s) : near(s, 50)), 14));
  else if (s.level === 2) {
    // six blades orbit the thrower and tighten into a spiral
    volley(s, 6, 300, (i, delay, dur, last) => {
      const a0 = (i / 6) * Math.PI * 2;
      const target = last ? home(s) : near(s, 40);
      star(delay, dur, m, (k) => {
        const rad = A.size * (1.3 - k * 1.1);
        const a = a0 + k * Math.PI * 5;
        const p: Pt = [A.baseX + Math.cos(a) * rad, A.baseY + Math.sin(a) * rad * 0.6];
        return k < 0.85 ? p : lerp(p, target(), (k - 0.85) / 0.15);
      }, 12);
    });
  } else star(0, s.travel, m, boomerang(m, reach * 1.1, 130, dir, home(s)), 40, 9);
  sfx.whoosh(s.travel / 1000, s.level);
};

const laser: MisfireFx = (s) => {
  const { fx, A } = s;
  const m = (): Pt => [A.anchors.muzzle[0], A.anchors.muzzle[1]];
  const glass = toward(s, 0.5, 50);
  if (s.level === 3) {
    // targeting error: the orbital reticle drifts off the target and onto its owner
    const t0 = fx.gameTime;
    const slide = s.travel * 0.6;
    const at = (): Pt => lerp(kit.feet(s.O), kit.feet(A), smooth(Math.min(1, (fx.gameTime - t0) / slide)));
    fx.reticle({ x: at()[0], y: at()[1], r: 90, dur: s.travel + 200, color: "#ef4444", follow: at });
    fx.text({ text: "TARGETING ERROR", x: fx.width / 2, y: 110, size: 12, fill: "#fecaca", stroke: "#450a0a", dur: 1200 });
    fx.beam({ from: () => [A.anchors.feet[0], -30], to: () => [A.anchors.feet[0], A.anchors.feet[1]], dur: 1000, width: 30, ramp: s.ramp, style: "orbital", grow: 140, branches: 0, delay: s.travel - 60 });
  } else if (s.level === 0) {
    fx.launch({ from: m(), to: home(s), dur: s.travel, size: 7, ramp: s.ramp, style: "bullet", trail: 1, trailStyle: "streak", curve: bounce(m(), glass, home(s), 0.45), warn: s.warn });
  } else {
    fx.beam({ from: m, to: () => glass, dur: s.travel + 200, width: s.level === 2 ? 7 : 6, ramp: s.ramp, style: "laser", grow: s.travel * 0.4, branches: 0 });
    fx.beam({ from: () => glass, to: home(s), dur: s.travel * 0.55 + 260, width: s.level === 2 ? 8 : 6, ramp: s.ramp, style: "laser", grow: s.travel * 0.55, branches: 0, delay: s.travel * 0.45 });
  }
  if (s.level < 3) setTimeout(() => mirror(s, glass), s.travel * 0.42);
  sfx.laser((s.travel + 200) / 1000, s.level);
};

const meteor: MisfireFx = (s) => {
  const { fx, A } = s;
  // the strike was aimed at the opponent; the coordinates slide back onto the caster
  const t0 = fx.gameTime;
  const slide = s.travel * 0.45;
  const at = (): Pt => lerp(feet(s.O), feet(A), smooth(Math.min(1, (fx.gameTime - t0) / slide)));
  fx.reticle({ x: at()[0], y: at()[1], r: pick(s, [50, 70, 120, 150]), dur: s.travel, color: "#ef4444", follow: at });
  const away = A.baseX < s.O.baseX ? -1 : 1; // falls in from the caster's own side of the sky
  const rock = (delay: number, dur: number, to: () => Pt, size: number, dx: number, trail: number) =>
    fx.launch({ from: [to()[0] + away * dx, -size * 2], to, dur, delay, size, ramp: s.ramp, style: "meteor", trail, trailStyle: "embers", path: "drop", ease: "in", warn: s.warn, metal: s.look.metal });
  const fall = s.travel * 0.5;
  if (s.level <= 1) rock(s.travel - fall, fall, home(s), s.level ? 20 : 12, fx.width * 0.25, s.level ? 5 : 2);
  else if (s.level === 2) {
    for (let i = 0; i < 4; i++) {
      const off = (i - 1.5) * 55;
      const p = rock(s.travel - fall + i * 60 - 240, fall, () => [A.anchors.feet[0] + off, A.anchors.feet[1]], 14, fx.width * 0.2, 3);
      p.onArrive = () => {
        fireBall(fx, p.pos[0], p.pos[1], 12, 30, s.ramp);
        fx.shake(6, 140);
        sfx.thud(2);
      };
    }
    rock(s.travel - fall, fall, home(s), 16, fx.width * 0.22, 4);
  } else {
    rock(s.travel - fall, fall, home(s), 60, fx.width * 0.3, 14);
    fx.dim(0.5, s.travel + 900);
    setTimeout(() => fx.zoomTo(1.08, fall), s.travel - fall);
  }
  setTimeout(() => sfx.fwoosh(fall / 1000, s.level), s.travel - fall);
};

export const MISFIRES: Record<WeaponStyle, MisfireFx> = { fireball, spear, gun, lightning, arrows, shuriken, laser, meteor };

/** The fighter's attack motion for each weapon. */
export const STYLE_OF: Record<WeaponStyle, "throw" | "shoot" | "draw" | "summon"> = {
  fireball: "throw",
  spear: "throw",
  shuriken: "throw",
  gun: "shoot",
  laser: "shoot",
  arrows: "draw",
  lightning: "summon",
  meteor: "summon",
};

