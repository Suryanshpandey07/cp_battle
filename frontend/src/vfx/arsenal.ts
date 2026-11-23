/**
 * Drawing for weapon effects: projectile shapes, beams, held weapons ("props"),
 * ground spikes, slash marks and target reticles. Pure Canvas2D, no gradients
 * per particle: glows reuse the cached radial sprites. All sizes are in arena
 * pixels; the engine owns the lists and their timing.
 */
import { glowSprite } from "./particles";

export type ProjectileShape =
  | "orb"
  | "comet"
  | "bolt"
  | "shard"
  | "vortex"
  | "glyphs"
  | "fireball"
  | "spear"
  | "bullet"
  | "rocket"
  | "arrow"
  | "shuriken"
  | "meteor";

export interface Beam {
  from: () => [number, number];
  to: () => [number, number];
  t0: number;
  dur: number;
  width: number;
  ramp: number;
  style: "laser" | "lightning" | "orbital";
  grow: number; // ms to reach full width
  branches: number;
  seed: number;
}

export type PropKind = "pistol" | "rifle" | "minigun" | "launcher" | "bow" | "spear" | "cannon";

export interface Prop {
  side: 1 | 2;
  kind: PropKind;
  t0: number;
  dur: number;
  scale: number;
  kicks: number[]; // game times of each shot: recoil + muzzle flash
  accent: string;
  metal: string;
  aim?: number; // radians toward the target, already accounting for facing
}

export interface Spikes {
  x: number;
  y: number;
  width: number;
  n: number;
  height: number;
  t0: number;
  dur: number;
  color: string;
  edge: string;
}

export interface Slash {
  x: number;
  y: number;
  angle: number;
  len: number;
  t0: number;
  dur: number;
  color: string;
  width: number;
}

export interface Reticle {
  x: number;
  y: number;
  r: number;
  t0: number;
  dur: number;
  color: string;
  /** Slide with a moving point (a misfired strike drifting back onto its owner). */
  follow?: () => [number, number];
}

const TAU = Math.PI * 2;

/** Deterministic jitter so a lightning bolt keeps its shape for a few frames. */
function rand(seed: number): () => number {
  let s = (seed * 9301 + 49297) % 233280 || 1;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

// ---------------------------------------------------------------- projectiles

export function drawShape(g: CanvasRenderingContext2D, shape: ProjectileShape, x: number, y: number, s: number, angle: number, ramp: string[], t: number, metal = "#cbd5e1", accent = "#facc15"): boolean {
  switch (shape) {
    case "fireball":
      fireball(g, x, y, s, angle, ramp, t);
      return true;
    case "spear":
      spear(g, x, y, s, angle, ramp, metal, accent);
      return true;
    case "bullet":
      bullet(g, x, y, s, angle, ramp);
      return true;
    case "rocket":
      rocket(g, x, y, s, angle, ramp, t);
      return true;
    case "arrow":
      arrow(g, x, y, s, angle, ramp, metal);
      return true;
    case "shuriken":
      shuriken(g, x, y, s, t, ramp, metal);
      return true;
    case "meteor":
      meteor(g, x, y, s, angle, ramp, t, metal);
      return true;
    default:
      return false;
  }
}

function fireball(g: CanvasRenderingContext2D, x: number, y: number, s: number, angle: number, ramp: string[], t: number): void {
  const bx = -Math.cos(angle);
  const by = -Math.sin(angle);
  g.globalCompositeOperation = "lighter";
  // flame tongues streaming behind, flickering
  for (let i = 5; i >= 1; i--) {
    const k = i / 5;
    const wob = Math.sin(t / 40 + i * 1.7) * s * 0.18;
    const px = x + bx * s * 1.1 * k + -by * wob;
    const py = y + by * s * 1.1 * k + bx * wob;
    const r = s * (1.15 - k * 0.55);
    g.globalAlpha = 0.55 * (1 - k * 0.6);
    g.drawImage(glowSprite(ramp[Math.min(4, 1 + Math.round(k * 2))]), px - r, py - r, r * 2, r * 2);
  }
  g.globalAlpha = 1;
  // heat halo, body, white-hot core
  g.drawImage(glowSprite(ramp[3]), x - s * 2.2, y - s * 2.2, s * 4.4, s * 4.4);
  g.drawImage(glowSprite(ramp[2]), x - s * 1.5, y - s * 1.5, s * 3, s * 3);
  g.drawImage(glowSprite(ramp[1]), x - s, y - s, s * 2, s * 2);
  const pulse = 0.55 + 0.08 * Math.sin(t / 30);
  g.drawImage(glowSprite(ramp[0]), x - s * pulse, y - s * pulse, s * 2 * pulse, s * 2 * pulse);
  g.globalCompositeOperation = "source-over";
}

function spear(g: CanvasRenderingContext2D, x: number, y: number, s: number, angle: number, ramp: string[], metal: string, accent: string): void {
  const len = s * 5;
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  // energy along the shaft
  g.globalCompositeOperation = "lighter";
  g.globalAlpha = 0.6;
  for (let i = 0; i < 4; i++) g.drawImage(glowSprite(ramp[2]), -len * (i / 4) - s * 0.8, -s * 0.8, s * 1.6, s * 1.6);
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
  // shaft
  g.fillStyle = "#78350f";
  g.fillRect(-len, -s * 0.09, len * 0.85, s * 0.18);
  g.fillStyle = accent;
  g.fillRect(-len * 0.2, -s * 0.13, s * 0.35, s * 0.26);
  // head
  g.fillStyle = metal;
  g.beginPath();
  g.moveTo(s * 0.9, 0);
  g.lineTo(-s * 0.25, -s * 0.32);
  g.lineTo(-s * 0.1, 0);
  g.lineTo(-s * 0.25, s * 0.32);
  g.closePath();
  g.fill();
  g.strokeStyle = "rgba(255,255,255,0.8)";
  g.lineWidth = Math.max(1, s * 0.05);
  g.beginPath();
  g.moveTo(s * 0.85, 0);
  g.lineTo(-s * 0.1, 0);
  g.stroke();
  g.restore();
}

function bullet(g: CanvasRenderingContext2D, x: number, y: number, s: number, angle: number, ramp: string[]): void {
  const len = s * 9;
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.globalCompositeOperation = "lighter";
  g.strokeStyle = ramp[2];
  g.globalAlpha = 0.5;
  g.lineWidth = s * 1.4;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(-len, 0);
  g.lineTo(0, 0);
  g.stroke();
  g.globalAlpha = 1;
  g.strokeStyle = ramp[0];
  g.lineWidth = s * 0.55;
  g.beginPath();
  g.moveTo(-len * 0.6, 0);
  g.lineTo(s * 0.5, 0);
  g.stroke();
  g.drawImage(glowSprite(ramp[1]), -s * 1.5, -s * 1.5, s * 3, s * 3);
  g.restore();
  g.globalCompositeOperation = "source-over";
}

function rocket(g: CanvasRenderingContext2D, x: number, y: number, s: number, angle: number, ramp: string[], t: number): void {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  // exhaust
  g.globalCompositeOperation = "lighter";
  const f = 1 + 0.25 * Math.sin(t / 25);
  g.drawImage(glowSprite(ramp[2]), -s * 3.2 * f, -s * 0.9, s * 2.4 * f, s * 1.8);
  g.drawImage(glowSprite(ramp[0]), -s * 2.2, -s * 0.5, s * 1.2, s);
  g.globalCompositeOperation = "source-over";
  // body
  g.fillStyle = "#64748b";
  g.fillRect(-s * 1.6, -s * 0.36, s * 2.4, s * 0.72);
  g.fillStyle = "#94a3b8";
  g.fillRect(-s * 1.6, -s * 0.36, s * 2.4, s * 0.18);
  g.fillStyle = "#dc2626";
  g.beginPath();
  g.moveTo(s * 0.8, -s * 0.36);
  g.lineTo(s * 1.5, 0);
  g.lineTo(s * 0.8, s * 0.36);
  g.closePath();
  g.fill();
  g.fillStyle = "#334155";
  for (const sgn of [-1, 1]) {
    g.beginPath();
    g.moveTo(-s * 1.6, sgn * s * 0.36);
    g.lineTo(-s * 1.9, sgn * s * 0.8);
    g.lineTo(-s * 1.1, sgn * s * 0.36);
    g.closePath();
    g.fill();
  }
  g.restore();
}

function arrow(g: CanvasRenderingContext2D, x: number, y: number, s: number, angle: number, ramp: string[], metal: string): void {
  const len = s * 4;
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.strokeStyle = "#a16207";
  g.lineWidth = Math.max(1.5, s * 0.14);
  g.beginPath();
  g.moveTo(-len, 0);
  g.lineTo(0, 0);
  g.stroke();
  // fletching
  g.fillStyle = "#f8fafc";
  for (const sgn of [-1, 1]) {
    g.beginPath();
    g.moveTo(-len, 0);
    g.lineTo(-len - s * 0.5, sgn * s * 0.4);
    g.lineTo(-len + s * 0.6, 0);
    g.closePath();
    g.fill();
  }
  g.fillStyle = metal;
  g.beginPath();
  g.moveTo(s * 0.7, 0);
  g.lineTo(-s * 0.15, -s * 0.3);
  g.lineTo(-s * 0.15, s * 0.3);
  g.closePath();
  g.fill();
  g.globalCompositeOperation = "lighter";
  g.globalAlpha = 0.7;
  g.drawImage(glowSprite(ramp[2]), -s * 0.6, -s * 0.6, s * 1.2, s * 1.2);
  g.restore();
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
}

function shuriken(g: CanvasRenderingContext2D, x: number, y: number, s: number, t: number, ramp: string[], metal: string): void {
  const spin = t / 35;
  // motion ghosts
  g.globalCompositeOperation = "lighter";
  g.globalAlpha = 0.5;
  g.drawImage(glowSprite(ramp[2]), x - s * 1.6, y - s * 1.6, s * 3.2, s * 3.2);
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
  for (let ghost = 2; ghost >= 0; ghost--) {
    g.save();
    g.translate(x, y);
    g.rotate(spin - ghost * 0.35);
    g.globalAlpha = ghost ? 0.25 : 1;
    g.fillStyle = metal;
    g.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU;
      g.lineTo(Math.cos(a) * s, Math.sin(a) * s);
      g.lineTo(Math.cos(a + TAU / 8) * s * 0.3, Math.sin(a + TAU / 8) * s * 0.3);
    }
    g.closePath();
    g.fill();
    if (!ghost) {
      g.fillStyle = "#1e293b";
      g.beginPath();
      g.arc(0, 0, s * 0.14, 0, TAU);
      g.fill();
      g.strokeStyle = ramp[1];
      g.lineWidth = Math.max(1, s * 0.06);
      g.stroke();
    }
    g.restore();
  }
  g.globalAlpha = 1;
}

function meteor(g: CanvasRenderingContext2D, x: number, y: number, s: number, angle: number, ramp: string[], t: number, rock: string): void {
  const bx = -Math.cos(angle);
  const by = -Math.sin(angle);
  g.globalCompositeOperation = "lighter";
  for (let i = 8; i >= 1; i--) {
    const k = i / 8;
    const r = s * (1.5 - k * 0.9);
    g.globalAlpha = 0.5 * (1 - k * 0.7);
    g.drawImage(glowSprite(ramp[Math.min(4, 1 + Math.round(k * 3))]), x + bx * s * 3 * k - r, y + by * s * 3 * k - r, r * 2, r * 2);
  }
  g.globalAlpha = 1;
  g.drawImage(glowSprite(ramp[2]), x - s * 2, y - s * 2, s * 4, s * 4);
  g.globalCompositeOperation = "source-over";
  g.save();
  g.translate(x, y);
  g.rotate(t / 300);
  g.fillStyle = rock;
  g.beginPath();
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU;
    const r = s * (0.8 + 0.2 * Math.sin(i * 2.3));
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
  g.fill();
  g.strokeStyle = ramp[1];
  g.lineWidth = Math.max(1.5, s * 0.12);
  g.stroke();
  g.fillStyle = ramp[2];
  for (let i = 0; i < 3; i++) {
    g.beginPath();
    g.arc(Math.cos(i * 2.1) * s * 0.35, Math.sin(i * 2.1) * s * 0.35, s * 0.12, 0, TAU);
    g.fill();
  }
  g.restore();
}

// ---------------------------------------------------------------- beams

export function drawBeam(g: CanvasRenderingContext2D, b: Beam, now: number, ramp: string[]): void {
  const age = now - b.t0;
  if (age < 0 || age > b.dur) return;
  const [x0, y0] = b.from();
  const [x1, y1] = b.to();
  const fadeIn = Math.min(1, age / Math.max(1, b.grow));
  const fadeOut = age > b.dur * 0.7 ? 1 - (age - b.dur * 0.7) / (b.dur * 0.3) : 1;
  const k = fadeIn * fadeOut;
  g.save();
  g.globalCompositeOperation = "lighter";
  g.lineCap = "round";
  if (b.style === "lightning") {
    const frame = Math.floor(now / 45);
    const paths: [number, number][][] = [];
    const main = jag(x0, y0, x1, y1, 10, Math.hypot(x1 - x0, y1 - y0) * 0.08, b.seed + frame);
    paths.push(main);
    const r = rand(b.seed * 7 + frame);
    for (let i = 0; i < b.branches; i++) {
      const at = main[1 + Math.floor(r() * (main.length - 2))];
      const a = Math.atan2(y1 - y0, x1 - x0) + (r() - 0.5) * 1.8;
      const len = Math.hypot(x1 - x0, y1 - y0) * (0.15 + r() * 0.2);
      paths.push(jag(at[0], at[1], at[0] + Math.cos(a) * len, at[1] + Math.sin(a) * len, 5, len * 0.15, b.seed + i * 13 + frame));
    }
    const flicker = 0.75 + 0.25 * Math.sin(now / 17 + b.seed);
    paths.forEach((pts, i) => {
      const w = (i ? 0.5 : 1) * b.width * k * flicker;
      stroke(g, pts, ramp[3], w * 3.2, 0.35);
      stroke(g, pts, ramp[2], w * 1.6, 0.8);
      stroke(g, pts, ramp[0], w * 0.6, 1);
    });
    g.drawImage(glowSprite(ramp[1]), x1 - b.width * 6, y1 - b.width * 6, b.width * 12, b.width * 12);
  } else {
    const flick = 1 + 0.12 * Math.sin(now / 11 + b.seed);
    const w = b.width * k * flick;
    const pts: [number, number][] = [
      [x0, y0],
      [x1, y1],
    ];
    stroke(g, pts, ramp[3], w * 3.4, 0.3);
    stroke(g, pts, ramp[2], w * 1.8, 0.7);
    stroke(g, pts, ramp[1], w, 1);
    stroke(g, pts, "#ffffff", w * 0.4, 1);
    g.drawImage(glowSprite(ramp[1]), x0 - w * 2, y0 - w * 2, w * 4, w * 4);
    g.drawImage(glowSprite(ramp[0]), x1 - w * 3, y1 - w * 3, w * 6, w * 6);
    if (b.style === "orbital") {
      g.globalAlpha = 0.5 * k;
      g.drawImage(glowSprite(ramp[2]), x1 - w * 6, y1 - w * 1.5, w * 12, w * 3);
    }
  }
  g.restore();
}

function stroke(g: CanvasRenderingContext2D, pts: [number, number][], color: string, width: number, alpha: number): void {
  if (width <= 0.2) return;
  g.globalAlpha = alpha;
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineJoin = "round";
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.stroke();
}

function jag(x0: number, y0: number, x1: number, y1: number, n: number, amp: number, seed: number): [number, number][] {
  const r = rand(seed);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const out: [number, number][] = [[x0, y0]];
  for (let i = 1; i < n; i++) {
    const k = i / n;
    const off = (r() - 0.5) * 2 * amp * Math.sin(k * Math.PI);
    out.push([x0 + dx * k + nx * off, y0 + dy * k + ny * off]);
  }
  out.push([x1, y1]);
  return out;
}

// ---------------------------------------------------------------- held weapons

/** Draw a held weapon at the fighter's hand. x, y is the muzzle anchor; facing flips it. */
export function drawProp(g: CanvasRenderingContext2D, p: Prop, x: number, y: number, facing: 1 | -1, now: number): void {
  const age = now - p.t0;
  if (age < 0 || age > p.dur) return;
  const alpha = Math.min(1, age / 90) * (age > p.dur - 150 ? Math.max(0, (p.dur - age) / 150) : 1);
  let recoil = 0;
  let flash = 0;
  for (const k of p.kicks) {
    const d = now - k;
    if (d >= 0 && d < 90) {
      recoil = Math.max(recoil, 1 - d / 90);
      if (d < 45) flash = Math.max(flash, 1 - d / 45);
    }
  }
  const s = p.scale;
  g.save();
  g.globalAlpha = alpha;
  g.translate(x - facing * recoil * s * 0.35, y);
  g.scale(facing, 1);
  if (p.aim !== undefined) g.rotate(p.aim);
  const metal = p.metal;
  const dark = "#0f172a";
  let tip = s * 1.2;
  switch (p.kind) {
    case "pistol":
      g.fillStyle = metal;
      g.fillRect(-s * 0.1, -s * 0.2, s * 0.9, s * 0.22);
      g.fillStyle = dark;
      g.fillRect(-s * 0.1, 0, s * 0.25, s * 0.45);
      tip = s * 0.85;
      break;
    case "rifle":
      g.fillStyle = dark;
      g.fillRect(-s * 0.6, -s * 0.12, s * 0.5, s * 0.3);
      g.fillStyle = metal;
      g.fillRect(-s * 0.2, -s * 0.18, s * 1.4, s * 0.22);
      g.fillStyle = p.accent;
      g.fillRect(s * 0.2, -s * 0.28, s * 0.35, s * 0.1);
      g.fillStyle = dark;
      g.fillRect(s * 0.1, 0.02 * s, s * 0.18, s * 0.4);
      tip = s * 1.2;
      break;
    case "minigun": {
      g.fillStyle = dark;
      g.fillRect(-s * 0.5, -s * 0.35, s * 0.7, s * 0.7);
      const spin = now / 18;
      for (let i = 0; i < 6; i++) {
        const off = Math.sin(spin + (i * TAU) / 6) * s * 0.2;
        g.fillStyle = i % 2 ? metal : "#64748b";
        g.fillRect(s * 0.2, off - s * 0.04, s * 1.3, s * 0.08);
      }
      g.fillStyle = p.accent;
      g.fillRect(-s * 0.45, -s * 0.42, s * 0.5, s * 0.08);
      tip = s * 1.5;
      break;
    }
    case "launcher":
      g.fillStyle = "#3f6212";
      g.fillRect(-s * 0.9, -s * 0.3, s * 2.2, s * 0.6);
      g.fillStyle = dark;
      g.fillRect(s * 1.2, -s * 0.36, s * 0.18, s * 0.72);
      g.fillRect(-s * 0.1, s * 0.3, s * 0.2, s * 0.35);
      g.fillStyle = p.accent;
      g.fillRect(-s * 0.4, -s * 0.42, s * 0.3, s * 0.12);
      tip = s * 1.35;
      break;
    case "cannon":
      g.fillStyle = metal;
      g.fillRect(-s * 0.5, -s * 0.32, s * 1.6, s * 0.64);
      g.fillStyle = p.accent;
      for (let i = 0; i < 3; i++) g.fillRect(-s * 0.3 + i * s * 0.4, -s * 0.36, s * 0.12, s * 0.72);
      g.globalCompositeOperation = "lighter";
      g.drawImage(glowSprite(p.accent), s * 0.8, -s * 0.5, s, s);
      g.globalCompositeOperation = "source-over";
      tip = s * 1.15;
      break;
    case "bow": {
      const pull = Math.max(0, Math.min(1, age / Math.max(1, p.dur - 200)));
      g.strokeStyle = "#78350f";
      g.lineWidth = Math.max(2, s * 0.1);
      g.beginPath();
      g.arc(-s * 0.2, 0, s * 0.8, -1.1, 1.1);
      g.stroke();
      g.strokeStyle = "#f8fafc";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(-s * 0.2 + Math.cos(-1.1) * s * 0.8, Math.sin(-1.1) * s * 0.8);
      g.lineTo(-s * 0.2 - pull * s * 0.45 * (recoil ? 0 : 1), 0);
      g.lineTo(-s * 0.2 + Math.cos(1.1) * s * 0.8, Math.sin(1.1) * s * 0.8);
      g.stroke();
      tip = s * 0.6;
      break;
    }
    case "spear":
      g.rotate(-0.5);
      g.fillStyle = "#78350f";
      g.fillRect(-s * 1.4, -s * 0.06, s * 2.2, s * 0.12);
      g.fillStyle = metal;
      g.beginPath();
      g.moveTo(s * 1.25, 0);
      g.lineTo(s * 0.7, -s * 0.2);
      g.lineTo(s * 0.7, s * 0.2);
      g.closePath();
      g.fill();
      tip = s * 1.25;
      break;
  }
  if (flash > 0) {
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = flash;
    const f = s * (0.6 + flash * 0.5);
    g.drawImage(glowSprite("#fff7d6"), tip - f * 0.5, -f * 0.5, f, f);
    g.drawImage(glowSprite(p.accent), tip - f * 0.2, -f * 0.8, f * 1.6, f * 1.6);
    g.fillStyle = "#fffbeb";
    g.beginPath();
    g.moveTo(tip, -s * 0.12);
    g.lineTo(tip + f * 1.1, 0);
    g.lineTo(tip, s * 0.12);
    g.closePath();
    g.fill();
  }
  g.restore();
}

// ---------------------------------------------------------------- ground effects

export function drawSpikes(g: CanvasRenderingContext2D, sp: Spikes, now: number): void {
  const age = now - sp.t0;
  if (age < 0 || age > sp.dur) return;
  const rise = Math.min(1, age / 120);
  const sink = age > sp.dur - 250 ? Math.max(0, (sp.dur - age) / 250) : 1;
  const k = (1 - (1 - rise) ** 3) * sink;
  for (let i = 0; i < sp.n; i++) {
    const u = sp.n === 1 ? 0 : i / (sp.n - 1) - 0.5;
    const cx = sp.x + u * sp.width;
    const h = sp.height * k * (1 - Math.abs(u) * 1.1) * (0.75 + 0.25 * Math.sin(i * 2.7));
    if (h <= 0) continue;
    const w = (sp.width / sp.n) * 0.75;
    g.fillStyle = sp.color;
    g.beginPath();
    g.moveTo(cx - w / 2, sp.y);
    g.lineTo(cx + Math.sin(i) * w * 0.15, sp.y - h);
    g.lineTo(cx + w / 2, sp.y);
    g.closePath();
    g.fill();
    g.strokeStyle = sp.edge;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(cx - w / 2, sp.y);
    g.lineTo(cx + Math.sin(i) * w * 0.15, sp.y - h);
    g.stroke();
  }
}

export function drawSlash(g: CanvasRenderingContext2D, s: Slash, now: number): void {
  const age = now - s.t0;
  if (age < 0 || age > s.dur) return;
  const grow = Math.min(1, age / 70);
  const fade = age > s.dur * 0.5 ? 1 - (age - s.dur * 0.5) / (s.dur * 0.5) : 1;
  const dx = Math.cos(s.angle) * s.len * 0.5;
  const dy = Math.sin(s.angle) * s.len * 0.5;
  g.save();
  g.globalCompositeOperation = "lighter";
  g.lineCap = "round";
  const pts: [number, number][] = [
    [s.x - dx, s.y - dy],
    [s.x - dx + dx * 2 * grow, s.y - dy + dy * 2 * grow],
  ];
  stroke(g, pts, s.color, s.width * 3 * fade, 0.35 * fade);
  stroke(g, pts, "#ffffff", s.width * fade, fade);
  g.restore();
}

export function drawReticle(g: CanvasRenderingContext2D, r: Reticle, now: number): void {
  const age = now - r.t0;
  if (age < 0 || age > r.dur) return;
  const k = Math.min(1, age / 200);
  const blink = Math.floor(age / 90) % 2 ? 1 : 0.6;
  g.save();
  g.globalAlpha = blink * (age > r.dur - 150 ? (r.dur - age) / 150 : 1);
  g.strokeStyle = r.color;
  g.lineWidth = 3;
  g.setLineDash([10, 8]);
  g.lineDashOffset = -age / 20;
  g.beginPath();
  g.ellipse(r.x, r.y, r.r * (2 - k), r.r * 0.32 * (2 - k), 0, 0, TAU);
  g.stroke();
  g.setLineDash([]);
  g.beginPath();
  g.ellipse(r.x, r.y, r.r * 0.35, r.r * 0.11, 0, 0, TAU);
  g.stroke();
  g.restore();
}
