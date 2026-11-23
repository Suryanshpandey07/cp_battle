/**
 * Arena backdrops. Each layer has a still part, drawn once into an offscreen
 * canvas (sky, far scenery, the floor), and a live part drawn every frame on
 * top of it (rain, pulses, clouds, crowds, aurora, lanterns). The live part is
 * cheap: cached sprites and a few hundred primitives at most, and it is skipped
 * with reduced motion or effects off. `pulse` (0..1, decaying) is how hard the
 * last hit landed: the scenery reacts to it (the crowd jumps, the volcano flares).
 * Original art drawn in code; no image files.
 */
import type { ArenaSkin } from "../skins/registry";
import { glowSprite } from "./particles";

export type Pad = { x: number; y: number; size: number };
type G = CanvasRenderingContext2D;
type Pal = ArenaSkin["palette"];

interface Layer {
  still(g: G, W: number, H: number, p: Pal): void;
  live?(g: G, W: number, H: number, p: Pal, t: number, pulse: number, low: boolean): void;
}

const TAU = Math.PI * 2;
/** The floor starts here. Fighters stand below it, scenery sits above. */
export const horizon = (H: number) => Math.round(H * 0.45);

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (i: number, j = 0) => {
  const x = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

function mix(a: string, b: string, k: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - k) + ((pb >> s) & 255) * k);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`;
}

function sky(g: G, W: number, H: number, stops: [number, string][]): void {
  const grad = g.createLinearGradient(0, 0, 0, H);
  for (const [k, c] of stops) grad.addColorStop(k, c);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
}

function glow(g: G, x: number, y: number, r: number, color: string, alpha: number): void {
  g.globalCompositeOperation = "lighter";
  g.globalAlpha = Math.max(0, Math.min(1, alpha));
  g.drawImage(glowSprite(color), x - r, y - r, r * 2, r * 2);
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
}

/** A floor in perspective: a gradient plane with lines running to the vanishing point. */
function floor(g: G, W: number, H: number, near: string, far: string, line: string, opts: { rows?: number; cols?: number; alpha?: number; offset?: number } = {}): void {
  const hz = horizon(H);
  const grad = g.createLinearGradient(0, hz, 0, H);
  grad.addColorStop(0, far);
  grad.addColorStop(1, near);
  g.fillStyle = grad;
  g.fillRect(0, hz, W, H - hz);
  g.strokeStyle = line;
  g.globalAlpha = opts.alpha ?? 0.22;
  g.lineWidth = 1.5;
  const vx = W / 2;
  const vy = hz - H * 0.35;
  const cols = opts.cols ?? 14;
  for (let i = -cols; i <= cols; i++) {
    const bx = vx + (i / cols) * W * 1.6;
    const k = (hz - vy) / (H - vy);
    g.beginPath();
    g.moveTo(vx + (bx - vx) * k, hz);
    g.lineTo(bx, H);
    g.stroke();
  }
  const rows = opts.rows ?? 9;
  const off = opts.offset ?? 0;
  for (let i = 0; i < rows; i++) {
    const k = ((i + off) / rows) ** 2;
    const y = hz + (H - hz) * k;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
  }
  g.globalAlpha = 1;
}

function mountains(g: G, W: number, H: number, base: number, height: number, color: string, seed: number, cap?: string): void {
  const R = rng(seed);
  const pts: [number, number][] = [[0, base]];
  let x = 0;
  while (x < W + 60) {
    x += 50 + R() * 90;
    pts.push([x, base - height * (0.35 + R() * 0.65)]);
    x += 40 + R() * 70;
    pts.push([x, base - height * (0.05 + R() * 0.3)]);
  }
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(0, H);
  for (const [px, py] of pts) g.lineTo(px, py);
  g.lineTo(W, H);
  g.closePath();
  g.fill();
  if (cap) {
    g.fillStyle = cap;
    for (let i = 1; i < pts.length; i += 2) {
      const [px, py] = pts[i];
      const depth = (base - py) * 0.28;
      if (base - py < height * 0.5) continue;
      g.beginPath();
      g.moveTo(px, py);
      g.lineTo(px - depth * 0.9, py + depth);
      g.lineTo(px - depth * 0.3, py + depth * 0.8);
      g.lineTo(px, py + depth * 1.1);
      g.lineTo(px + depth * 0.4, py + depth * 0.75);
      g.lineTo(px + depth * 0.9, py + depth);
      g.closePath();
      g.fill();
    }
  }
}

function vignette(g: G, W: number, H: number, alpha = 0.55): void {
  const v = g.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.3, W / 2, H * 0.55, Math.max(W, H) * 0.75);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, `rgba(0,0,0,${alpha})`);
  g.fillStyle = v;
  g.fillRect(0, 0, W, H);
}

// ------------------------------------------------------------------ glyph sprites (binary rain)

const glyphCache = new Map<string, HTMLCanvasElement>();
function glyph(ch: string, color: string): HTMLCanvasElement {
  const key = ch + color;
  let c = glyphCache.get(key);
  if (!c) {
    c = document.createElement("canvas");
    c.width = 12;
    c.height = 16;
    const g = c.getContext("2d")!;
    g.fillStyle = color;
    g.font = "bold 14px monospace";
    g.textBaseline = "top";
    g.fillText(ch, 1, 1);
    glyphCache.set(key, c);
  }
  return c;
}

// ------------------------------------------------------------------ layers

const digits: Layer = {
  still(g, W, H, p) {
    const hz = horizon(H);
    sky(g, W, H, [[0, p.sky[0]], [0.45, p.sky[1]], [1, "#020617"]]);
    // server towers on the horizon
    const R = rng(7);
    for (let x = -10; x < W; ) {
      const w = 26 + R() * 50;
      const h = H * (0.1 + R() * 0.22);
      g.fillStyle = mix(p.sky[0], "#000000", 0.35);
      g.fillRect(x, hz - h, w, h);
      g.fillStyle = p.accent;
      for (let yy = hz - h + 6; yy < hz - 4; yy += 7) for (let xx = x + 4; xx < x + w - 4; xx += 7) if (R() < 0.18) g.fillRect(xx, yy, 2, 2);
      x += w + 4 + R() * 14;
    }
    floor(g, W, H, "#020617", mix(p.floor, "#000000", 0.3), p.accent, { alpha: 0.3 });
    glow(g, W / 2, hz, W * 0.5, p.accent, 0.08);
  },
  live(g, W, H, p, t, pulse, low) {
    const hz = horizon(H);
    const cols = Math.floor(W / (low ? 40 : 26));
    g.save();
    g.beginPath();
    g.rect(0, 0, W, hz);
    g.clip();
    for (let i = 0; i < cols; i++) {
      const speed = 50 + hash(i) * 90 + pulse * 220;
      const len = 5 + Math.floor(hash(i, 2) * 9);
      const span = H + len * 16;
      const head = ((t / 1000) * speed + hash(i, 3) * span) % span;
      const x = i * (W / cols) + 4;
      for (let j = 0; j < len; j++) {
        const y = head - j * 16;
        if (y < -16 || y > hz) continue;
        const ch = hash(i * 31 + j, Math.floor(t / 180 + j)) > 0.5 ? "1" : "0";
        g.globalAlpha = (j === 0 ? 0.95 : 0.55 * (1 - j / len)) * (0.6 + pulse * 0.4);
        g.drawImage(glyph(ch, j === 0 ? "#f0fdf4" : p.accent), x, y);
      }
    }
    g.restore();
    g.globalAlpha = 1;
    // blinking tower lights
    g.fillStyle = p.text;
    for (let i = 0; i < 14; i++) if (Math.sin(t / 300 + i * 2.1) > 0.6) g.fillRect(hash(i, 9) * W, hz - 8 - hash(i, 4) * H * 0.2, 3, 3);
  },
};

interface Trace {
  pts: [number, number][];
  len: number;
}
const traceCache = new Map<string, Trace[]>();
function traces(W: number, H: number): Trace[] {
  const key = `${Math.round(W)}x${Math.round(H)}`;
  let out = traceCache.get(key);
  if (out) return out;
  const R = rng(11);
  const hz = horizon(H);
  out = [];
  for (let i = 0; i < 22; i++) {
    let x = R() * W;
    let y = R() * hz * 0.95;
    const pts: [number, number][] = [[x, y]];
    for (let s = 0; s < 4; s++) {
      if (s % 2 === 0) x += (R() < 0.5 ? -1 : 1) * (40 + R() * 120);
      else y += (R() < 0.5 ? -1 : 1) * (20 + R() * 60);
      y = Math.max(6, Math.min(hz - 6, y));
      pts.push([x, y]);
    }
    let len = 0;
    for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
    out.push({ pts, len });
  }
  traceCache.set(key, out);
  return out;
}
function along(tr: Trace, d: number): [number, number] {
  for (let k = 1; k < tr.pts.length; k++) {
    const [ax, ay] = tr.pts[k - 1];
    const [bx, by] = tr.pts[k];
    const seg = Math.hypot(bx - ax, by - ay);
    if (d <= seg) return [ax + ((bx - ax) * d) / seg, ay + ((by - ay) * d) / seg];
    d -= seg;
  }
  return tr.pts[tr.pts.length - 1];
}

const circuit: Layer = {
  still(g, W, H, p) {
    const hz = horizon(H);
    sky(g, W, H, [[0, p.sky[0]], [0.5, p.sky[1]], [1, "#020617"]]);
    g.strokeStyle = p.accent;
    g.lineWidth = 2;
    g.globalAlpha = 0.28;
    for (const tr of traces(W, H)) {
      g.beginPath();
      tr.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
      const [ex, ey] = tr.pts[tr.pts.length - 1];
      g.strokeRect(ex - 4, ey - 4, 8, 8);
    }
    g.globalAlpha = 1;
    // chips
    const R = rng(5);
    for (let i = 0; i < 4; i++) {
      const w = 50 + R() * 50;
      const h = 30 + R() * 26;
      const x = (0.12 + i * 0.24) * W + R() * 40;
      const y = hz * (0.2 + R() * 0.5);
      g.fillStyle = "#0b1220";
      g.fillRect(x, y, w, h);
      g.strokeStyle = mix(p.accent, "#000000", 0.4);
      g.strokeRect(x + 0.5, y + 0.5, w, h);
      g.fillStyle = mix(p.accent, "#000000", 0.5);
      for (let k = 6; k < w - 4; k += 8) {
        g.fillRect(x + k, y - 5, 3, 5);
        g.fillRect(x + k, y + h, 3, 5);
      }
    }
    floor(g, W, H, "#020617", mix(p.floor, "#000000", 0.2), p.accent, { alpha: 0.35, rows: 10 });
  },
  live(g, W, H, p, t, pulse) {
    const trs = traces(W, H);
    trs.forEach((tr, i) => {
      const speed = 90 + hash(i) * 120 + pulse * 400;
      const d = ((t / 1000) * speed + hash(i, 1) * tr.len) % tr.len;
      const [x, y] = along(tr, d);
      glow(g, x, y, 9 + pulse * 8, p.accent, 0.9);
      glow(g, x, y, 3, "#ffffff", 0.9);
    });
    const R = rng(5);
    for (let i = 0; i < 4; i++) {
      const w = 50 + R() * 50;
      R();
      const x = (0.12 + i * 0.24) * W + R() * 40;
      const y = horizon(H) * (0.2 + R() * 0.5);
      if (Math.sin(t / 240 + i * 1.7) > 0) glow(g, x + w - 8, y + 8, 6, "#22c55e", 0.9);
    }
  },
};

const hills: Layer = {
  still(g, W, H) {
    const hz = horizon(H);
    g.fillStyle = "#9bbc0f";
    g.fillRect(0, 0, W, H);
    // a blocky sun
    g.fillStyle = "#e0f8d0";
    const sx = Math.round(W * 0.12);
    const sy = Math.round(H * 0.16);
    for (let y = -5; y <= 5; y++) for (let x = -5; x <= 5; x++) if (x * x + y * y <= 26) g.fillRect(sx + x * 5, sy + y * 5, 5, 5);
    const shades = ["#8bac0f", "#306230", "#0f380f"];
    shades.forEach((c, i) => {
      g.fillStyle = c;
      g.beginPath();
      g.moveTo(0, H);
      for (let x = 0; x <= W; x += 8) g.lineTo(x, hz * (0.6 + i * 0.17) + (Math.round((Math.sin(x / (90 - i * 20) + i) * 14) / 4) * 4));
      g.lineTo(W, H);
      g.fill();
    });
    // pixel trees on the middle hill
    for (let i = 0; i < 9; i++) {
      const x = Math.round((hash(i, 1) * W) / 4) * 4;
      const y = Math.round((hz * 0.8 + hash(i, 2) * 10) / 4) * 4;
      g.fillStyle = "#0f380f";
      g.fillRect(x - 2, y - 4, 4, 10);
      for (let r = 0; r < 4; r++) g.fillRect(x - 4 * (4 - r), y - 8 - r * 8, 8 * (4 - r), 8);
    }
    g.fillStyle = "#8bac0f";
    g.fillRect(0, hz, W, H - hz);
    g.fillStyle = "#95b60f";
    for (let y = hz; y < H; y += 16) for (let x = ((y - hz) / 16) % 2 ? 16 : 0; x < W; x += 32) g.fillRect(x, y, 16, 16);
    g.fillStyle = "#306230";
    g.fillRect(0, hz, W, 4);
  },
  live(g, W, H, _p, t, pulse) {
    g.fillStyle = "#e0f8d0";
    for (let i = 0; i < 4; i++) {
      const w = 60 + hash(i) * 70;
      const x = (((t / 1000) * (10 + i * 5) + hash(i, 1) * (W + 200)) % (W + 200)) - 100;
      const y = Math.round((H * (0.08 + hash(i, 2) * 0.18)) / 4) * 4;
      g.fillRect(Math.round(x / 4) * 4, y, w, 12);
      g.fillRect(Math.round(x / 4) * 4 + 12, y - 8, w - 28, 8);
    }
    g.fillStyle = "#0f380f";
    for (let i = 0; i < 3; i++) {
      const x = (((t / 1000) * (30 + i * 8) + i * 300) % (W + 80)) - 40;
      const y = H * (0.12 + i * 0.06) + Math.sin(t / 400 + i) * 6;
      const up = Math.floor(t / 180 + i) % 2;
      g.fillRect(x, y, 4, 4);
      g.fillRect(x - 8, y + (up ? -4 : 4), 8, 4);
      g.fillRect(x + 4, y + (up ? -4 : 4), 8, 4);
    }
    if (pulse > 0.3) {
      g.globalAlpha = (pulse - 0.3) * 0.25;
      g.fillStyle = "#0f380f";
      g.fillRect(0, 0, W, H);
      g.globalAlpha = 1;
    }
  },
};

const marble: Layer = {
  still(g, W, H, p) {
    const hz = horizon(H);
    sky(g, W, H, [[0, mix(p.sky[0], "#000000", 0.2)], [1, p.sky[1]]]);
    const n = 6;
    const colW = W / n;
    for (let i = 0; i <= n; i++) {
      const x = i * colW;
      // arch recess between columns
      if (i < n) {
        g.fillStyle = mix(p.sky[0], "#000000", 0.45);
        g.beginPath();
        g.moveTo(x + colW * 0.18, hz);
        g.lineTo(x + colW * 0.18, H * 0.2);
        g.arc(x + colW * 0.5, H * 0.2, colW * 0.32, Math.PI, 0);
        g.lineTo(x + colW * 0.82, hz);
        g.fill();
      }
      const cw = colW * 0.2;
      const grad = g.createLinearGradient(x - cw / 2, 0, x + cw / 2, 0);
      grad.addColorStop(0, "#a8a29e");
      grad.addColorStop(0.5, "#f5f5f4");
      grad.addColorStop(1, "#78716c");
      g.fillStyle = grad;
      g.fillRect(x - cw / 2, H * 0.06, cw, hz - H * 0.06);
      g.fillStyle = "rgba(0,0,0,0.12)";
      for (let f = 1; f < 4; f++) g.fillRect(x - cw / 2 + (cw * f) / 4, H * 0.08, 1.5, hz - H * 0.1);
      g.fillStyle = "#e7e5e4";
      g.fillRect(x - cw * 0.75, H * 0.04, cw * 1.5, H * 0.03);
      g.fillRect(x - cw * 0.7, hz - H * 0.025, cw * 1.4, H * 0.025);
    }
    g.fillStyle = p.accent;
    g.fillRect(0, H * 0.035, W, 3);
    // a marble floor in chequered perspective
    const vx = W / 2;
    const vy = hz - H * 0.35;
    const rows = 8;
    const cols = 10;
    for (let r = 0; r < rows; r++) {
      const y0 = hz + (H - hz) * (r / rows) ** 2;
      const y1 = hz + (H - hz) * ((r + 1) / rows) ** 2;
      for (let c = -cols; c < cols; c++) {
        const at = (y: number, cc: number) => vx + ((cc / cols) * W * 1.6) * ((y - vy) / (H - vy));
        g.fillStyle = (r + c) % 2 ? "#e7e5e4" : "#a8a29e";
        g.beginPath();
        g.moveTo(at(y0, c), y0);
        g.lineTo(at(y0, c + 1), y0);
        g.lineTo(at(y1, c + 1), y1);
        g.lineTo(at(y1, c), y1);
        g.fill();
      }
    }
    const shine = g.createLinearGradient(0, hz, 0, H);
    shine.addColorStop(0, "rgba(253,230,138,0.25)");
    shine.addColorStop(1, "rgba(28,25,23,0.35)");
    g.fillStyle = shine;
    g.fillRect(0, hz, W, H - hz);
    vignette(g, W, H, 0.45);
  },
  live(g, W, H, p, t, pulse) {
    const hz = horizon(H);
    // light shafts from high windows
    g.globalCompositeOperation = "lighter";
    for (let i = 0; i < 3; i++) {
      const x = W * (0.2 + i * 0.3);
      const a = 0.05 + 0.03 * Math.sin(t / 1400 + i * 2) + pulse * 0.12;
      g.globalAlpha = a;
      g.fillStyle = "#fde68a";
      g.beginPath();
      g.moveTo(x - 20, 0);
      g.lineTo(x + 20, 0);
      g.lineTo(x + 120, H);
      g.lineTo(x - 40, H);
      g.fill();
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    // banners sway between the columns
    const colW = W / 6;
    for (const i of [1, 4]) {
      const x = i * colW + colW * 0.5;
      const w = colW * 0.36;
      const h = hz * 0.55;
      const sway = Math.sin(t / 900 + i) * 6 + pulse * 10 * Math.sin(t / 60);
      g.fillStyle = mix(p.accent, "#7f1d1d", 0.35);
      g.beginPath();
      g.moveTo(x - w / 2, H * 0.08);
      g.lineTo(x + w / 2, H * 0.08);
      g.lineTo(x + w / 2 + sway, H * 0.08 + h);
      g.lineTo(x + sway, H * 0.08 + h - 14);
      g.lineTo(x - w / 2 + sway, H * 0.08 + h);
      g.closePath();
      g.fill();
      g.fillStyle = p.accent;
      g.beginPath();
      g.arc(x + sway * 0.4, H * 0.08 + h * 0.38, w * 0.2, 0, TAU);
      g.fill();
    }
    glow(g, W / 2, H * 0.06, 80 + 8 * Math.sin(t / 130), "#fde68a", 0.25 + pulse * 0.3);
  },
};

const lava: Layer = {
  still(g, W, H) {
    const hz = horizon(H);
    sky(g, W, H, [[0, "#1c0a0a"], [0.55, "#7f1d1d"], [1, "#1c1917"]]);
    mountains(g, W, H, hz, H * 0.18, "#2a0f0f", 3);
    // the volcano
    const vx = W * 0.5;
    const top = H * 0.12;
    g.fillStyle = "#1c1917";
    g.beginPath();
    g.moveTo(vx - W * 0.32, hz);
    g.lineTo(vx - W * 0.05, top);
    g.lineTo(vx + W * 0.05, top);
    g.lineTo(vx + W * 0.34, hz);
    g.fill();
    g.strokeStyle = "#f97316";
    g.lineWidth = 3;
    for (const dx of [-0.02, 0.015, 0.04]) {
      g.beginPath();
      g.moveTo(vx + W * dx, top + 4);
      for (let k = 1; k <= 6; k++) g.lineTo(vx + W * dx + Math.sin(k * 1.7 + dx * 40) * 14 + dx * W * k * 0.6, top + ((hz - top) * k) / 6);
      g.stroke();
    }
    // basalt floor with glowing cracks
    floor(g, W, H, "#0c0a09", "#292524", "#f97316", { alpha: 0.12 });
    g.strokeStyle = "#ea580c";
    g.lineWidth = 2;
    const R = rng(9);
    for (let i = 0; i < 14; i++) {
      let x = R() * W;
      let y = hz + 10 + R() * (H - hz - 20);
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        x += (R() - 0.5) * 60;
        y += (R() - 0.3) * 18;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    vignette(g, W, H, 0.5);
  },
  live(g, W, H, _p, t, pulse) {
    const hz = horizon(H);
    const vx = W * 0.5;
    const top = H * 0.12;
    glow(g, vx, top, 70 + 14 * Math.sin(t / 300) + pulse * 80, "#f97316", 0.6 + pulse * 0.4);
    // smoke rising from the crater
    for (let i = 0; i < 8; i++) {
      const k = ((t / 4000 + i / 8) % 1);
      const x = vx + Math.sin(k * 5 + i) * 30 * k + k * 60;
      const y = top - k * H * 0.25;
      g.globalAlpha = 0.28 * (1 - k);
      g.fillStyle = "#44403c";
      g.beginPath();
      g.arc(x, y, 14 + k * 40, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
    // lava cracks breathe
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.15 + 0.1 * Math.sin(t / 500) + pulse * 0.3;
    const lg = g.createLinearGradient(0, hz, 0, H);
    lg.addColorStop(0, "rgba(249,115,22,0)");
    lg.addColorStop(1, "#f97316");
    g.fillStyle = lg;
    g.fillRect(0, hz, W, H - hz);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  },
};

const stars: Layer = {
  still(g, W, H) {
    const hz = horizon(H);
    sky(g, W, H, [[0, "#020617"], [0.6, "#1e1b4b"], [1, "#020617"]]);
    for (const [x, y, r, c] of [
      [0.3, 0.2, 0.35, "#7c3aed"],
      [0.7, 0.3, 0.3, "#0e7490"],
      [0.5, 0.05, 0.25, "#be185d"],
    ] as [number, number, number, string][]) glow(g, W * x, H * y, Math.max(W, H) * r, c, 0.28);
    const R = rng(13);
    g.fillStyle = "#ffffff";
    for (let i = 0; i < 220; i++) {
      g.globalAlpha = 0.3 + R() * 0.7;
      const s = R() < 0.1 ? 2 : 1;
      g.fillRect(R() * W, R() * hz, s, s);
    }
    g.globalAlpha = 1;
    // a ringed planet
    const px = W * 0.12;
    const py = H * 0.2;
    const pr = Math.min(W, H) * 0.08;
    g.strokeStyle = "#c4b5fd";
    g.lineWidth = 3;
    g.beginPath();
    g.ellipse(px, py, pr * 1.9, pr * 0.42, -0.3, Math.PI, TAU);
    g.stroke();
    const pg = g.createRadialGradient(px - pr * 0.4, py - pr * 0.4, pr * 0.1, px, py, pr);
    pg.addColorStop(0, "#c4b5fd");
    pg.addColorStop(1, "#4c1d95");
    g.fillStyle = pg;
    g.beginPath();
    g.arc(px, py, pr, 0, TAU);
    g.fill();
    g.beginPath();
    g.ellipse(px, py, pr * 1.9, pr * 0.42, -0.3, 0, Math.PI);
    g.stroke();
    // a metal deck
    floor(g, W, H, "#0f172a", "#1e293b", "#94a3b8", { alpha: 0.3, rows: 7, cols: 10 });
    g.fillStyle = "#38bdf8";
    g.fillRect(0, hz - 2, W, 2);
  },
  live(g, W, H, _p, t, pulse) {
    const hz = horizon(H);
    for (let i = 0; i < 40; i++) {
      const a = 0.5 + 0.5 * Math.sin(t / (400 + hash(i) * 900) + i * 3);
      glow(g, hash(i, 1) * W, hash(i, 2) * hz * 0.95, 3 + a * 3 + pulse * 6, "#e0e7ff", a);
    }
    const cyc = (t / 7000) % 1;
    if (cyc < 0.12) {
      const k = cyc / 0.12;
      const x = W * (0.9 - k * 0.6);
      const y = H * (0.05 + k * 0.2);
      g.strokeStyle = "#e0f2fe";
      g.globalAlpha = 1 - k;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + 70, y - 24);
      g.stroke();
      g.globalAlpha = 1;
    }
    for (let i = 0; i < 12; i++) if (Math.floor(t / 400 + i) % 3 === 0) glow(g, (i + 0.5) * (W / 12), hz, 5, "#38bdf8", 0.9);
  },
};

const neon: Layer = {
  still(g, W, H, p) {
    const hz = horizon(H);
    sky(g, W, H, [[0, "#12002b"], [0.3, p.sky[0]], [0.42, p.sky[1]], [0.45, "#fb7185"], [1, "#0a0014"]]);
    const R = rng(21);
    g.fillStyle = "#ffffff";
    for (let i = 0; i < 80; i++) {
      g.globalAlpha = R() * 0.7;
      g.fillRect(R() * W, R() * hz * 0.5, 1, 1);
    }
    g.globalAlpha = 1;
    // the striped sun
    const sx = W * 0.47;
    const sr = Math.min(W * 0.17, H * 0.27);
    const sy = hz - sr * 0.75;
    const sg = g.createLinearGradient(0, sy - sr, 0, sy + sr);
    sg.addColorStop(0, "#fde047");
    sg.addColorStop(0.6, "#fb7185");
    sg.addColorStop(1, "#c026d3");
    g.save();
    g.beginPath();
    g.rect(0, 0, W, hz);
    g.clip();
    g.fillStyle = sg;
    g.beginPath();
    g.arc(sx, sy, sr, 0, TAU);
    g.fill();
    for (let i = 0; i < 6; i++) {
      const y = sy + sr * 0.1 + i * sr * 0.16;
      g.fillStyle = mix(p.sky[1], "#000000", 0.1);
      g.fillRect(sx - sr, y, sr * 2, 2 + i * 1.6);
    }
    g.restore();
    // two rows of towers
    for (const [shade, hMax, seed] of [
      ["#2e1065", 0.24, 1],
      ["#0b0016", 0.16, 2],
    ] as [string, number, number][]) {
      const RR = rng(seed * 99);
      for (let x = -10; x < W; ) {
        const w = 24 + RR() * 46;
        const mid = Math.abs(x / W - 0.47) < 0.14 ? 0.45 : 1; // keep the sun clear
        const h = H * (0.04 + RR() * hMax * mid);
        g.fillStyle = shade;
        g.fillRect(x, hz - h, w, h);
        g.fillStyle = seed === 2 ? "#f0abfc" : "#7dd3fc";
        for (let yy = hz - h + 5; yy < hz - 3; yy += 6) for (let xx = x + 3; xx < x + w - 3; xx += 6) if (RR() < 0.22) g.fillRect(xx, yy, 2, 3);
        x += w + RR() * 10;
      }
    }
    g.fillStyle = "#0a0014";
    g.fillRect(0, hz, W, H - hz);
  },
  live(g, W, H, _p, t, pulse) {
    const hz = horizon(H);
    // the grid rolls toward you
    g.save();
    g.beginPath();
    g.rect(0, hz, W, H - hz);
    g.clip();
    g.strokeStyle = "#e879f9";
    g.lineWidth = 2;
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.55 + pulse * 0.4;
    const off = (t / 900) % 1;
    const rows = 10;
    for (let i = 0; i < rows; i++) {
      const y = hz + (H - hz) * ((i + off) / rows) ** 2;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(W, y);
      g.stroke();
    }
    const vx = W / 2;
    const vy = hz - H * 0.2;
    for (let i = -12; i <= 12; i++) {
      const bx = vx + (i / 12) * W * 1.8;
      const k = (hz - vy) / (H - vy);
      g.beginPath();
      g.moveTo(vx + (bx - vx) * k, hz);
      g.lineTo(bx, H);
      g.stroke();
    }
    g.restore();
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    glow(g, W / 2, hz, W * 0.45, "#fb7185", 0.18 + 0.05 * Math.sin(t / 700) + pulse * 0.2);
    // neon signs blink
    const signs: [number, number, string][] = [
      [0.08, 0.3, "#22d3ee"],
      [0.64, 0.26, "#f472b6"],
      [0.9, 0.34, "#a3e635"],
    ];
    signs.forEach(([x, y, c], i) => {
      const on = Math.sin(t / 220 + i * 5) > -0.6 || pulse > 0.4;
      if (!on) return;
      g.strokeStyle = c;
      g.lineWidth = 2;
      g.strokeRect(W * x, H * y, 34, 12);
      glow(g, W * x + 17, H * y + 6, 26, c, 0.5);
    });
  },
};

const snow: Layer = {
  still(g, W, H) {
    const hz = horizon(H);
    sky(g, W, H, [[0, "#020617"], [0.5, "#0c2d48"], [1, "#0b1026"]]);
    const R = rng(17);
    g.fillStyle = "#ffffff";
    for (let i = 0; i < 90; i++) {
      g.globalAlpha = R() * 0.8;
      g.fillRect(R() * W, R() * hz * 0.6, 1, 1);
    }
    g.globalAlpha = 1;
    mountains(g, W, H, hz, H * 0.32, "#334155", 4, "#e2e8f0");
    mountains(g, W, H, hz, H * 0.18, "#1e3a5f", 8, "#f8fafc");
    // pines on the shore
    for (let i = 0; i < 16; i++) {
      const x = hash(i, 5) * W;
      const h = 30 + hash(i, 6) * 40;
      g.fillStyle = "#0f2a2a";
      for (let k = 0; k < 3; k++) {
        g.beginPath();
        g.moveTo(x, hz - h + k * h * 0.25);
        g.lineTo(x - h * (0.25 + k * 0.08), hz - h * 0.35 + k * h * 0.18);
        g.lineTo(x + h * (0.25 + k * 0.08), hz - h * 0.35 + k * h * 0.18);
        g.fill();
      }
      g.fillStyle = "#e2e8f0";
      g.fillRect(x - 3, hz - h + 2, 6, 3);
    }
    // a frozen lake
    floor(g, W, H, "#0c4a6e", "#0e7490", "#e0f2fe", { alpha: 0.14, rows: 6, cols: 8 });
    const sheen = g.createLinearGradient(0, hz, 0, H);
    sheen.addColorStop(0, "rgba(224,242,254,0.35)");
    sheen.addColorStop(0.4, "rgba(224,242,254,0.06)");
    sheen.addColorStop(1, "rgba(2,6,23,0.3)");
    g.fillStyle = sheen;
    g.fillRect(0, hz, W, H - hz);
    g.globalAlpha = 0.25;
    g.fillStyle = "#ffffff";
    for (let i = 0; i < 12; i++) g.fillRect(hash(i, 7) * W, hz + 8 + hash(i, 8) * (H - hz - 16), 40 + hash(i, 9) * 80, 2);
    g.globalAlpha = 1;
  },
  live(g, W, H, _p, t, pulse) {
    const hz = horizon(H);
    g.globalCompositeOperation = "lighter";
    const bands: [string, number, number][] = [
      ["#22c55e", 0.16, 0],
      ["#14b8a6", 0.24, 2],
      ["#a855f7", 0.1, 4],
    ];
    for (const [c, y0, ph] of bands) {
      for (const [w, a] of [
        [28, 0.08],
        [8, 0.25],
      ]) {
        g.strokeStyle = c;
        g.lineWidth = w;
        g.globalAlpha = a * (1 + pulse * 1.5);
        g.beginPath();
        for (let x = -20; x <= W + 20; x += 24) {
          const y = H * y0 + Math.sin(x * 0.008 + t / 1800 + ph) * 18 + Math.sin(x * 0.02 + t / 900) * 6;
          if (x < 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    // the lake reflects the aurora
    glow(g, W * 0.5, hz + 20, W * 0.35, "#22c55e", 0.08 + pulse * 0.1);
  },
};

const sakura: Layer = {
  still(g, W, H) {
    const hz = horizon(H);
    sky(g, W, H, [[0, "#1e1b4b"], [0.55, "#831843"], [0.9, "#fb7185"], [1, "#fb7185"]]);
    // the moon
    const mx = W * 0.47;
    const my = H * 0.15;
    glow(g, mx, my, 90, "#fde68a", 0.35);
    g.fillStyle = "#fef3c7";
    g.beginPath();
    g.arc(mx, my, Math.min(W, H) * 0.07, 0, TAU);
    g.fill();
    mountains(g, W, H, hz, H * 0.2, "#4c1d95", 6);
    mountains(g, W, H, hz, H * 0.12, "#6b21a8", 12);
    // a pagoda
    const px = W * 0.6;
    g.fillStyle = "#1e1b4b";
    for (let k = 0; k < 4; k++) {
      const w = 70 - k * 13;
      const y = hz - 18 - k * 26;
      g.fillRect(px - w * 0.32, y - 16, w * 0.64, 18);
      g.beginPath();
      g.moveTo(px - w / 2 - 8, y - 14);
      g.quadraticCurveTo(px, y - 34, px + w / 2 + 8, y - 14);
      g.lineTo(px + w / 2 - 6, y - 20);
      g.lineTo(px - w / 2 + 6, y - 20);
      g.fill();
    }
    g.fillRect(px - 1.5, hz - 18 - 4 * 26 - 16, 3, 22);
    // a torii gate
    const tx = W * 0.4;
    const tw = 70;
    g.fillStyle = "#b91c1c";
    g.fillRect(tx - tw / 2, hz - 60, 7, 60);
    g.fillRect(tx + tw / 2 - 7, hz - 60, 7, 60);
    g.fillRect(tx - tw / 2 - 10, hz - 62, tw + 20, 6);
    g.fillRect(tx - tw / 2 - 2, hz - 50, tw + 4, 4);
    // a cherry tree on the left edge
    g.strokeStyle = "#3b0d1e";
    g.lineWidth = 12;
    g.beginPath();
    g.moveTo(W * 0.03, hz + 4);
    g.quadraticCurveTo(W * 0.06, hz - H * 0.2, W * 0.2, H * 0.12);
    g.stroke();
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(W * 0.08, hz - H * 0.18);
    g.lineTo(W * 0.3, H * 0.06);
    g.stroke();
    const R = rng(31);
    for (let i = 0; i < 46; i++) {
      const x = W * (0.06 + R() * 0.3);
      const y = H * (0.02 + R() * 0.22);
      g.fillStyle = R() < 0.5 ? "#f9a8d4" : "#fbcfe8";
      g.globalAlpha = 0.85;
      g.beginPath();
      g.arc(x, y, 8 + R() * 14, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
    // a wooden floor
    const hzF = hz;
    const fg = g.createLinearGradient(0, hzF, 0, H);
    fg.addColorStop(0, "#78350f");
    fg.addColorStop(1, "#431407");
    g.fillStyle = fg;
    g.fillRect(0, hzF, W, H - hzF);
    g.strokeStyle = "#2a0f06";
    g.globalAlpha = 0.5;
    floorLines(g, W, H, 16);
    g.globalAlpha = 1;
    vignette(g, W, H, 0.4);
  },
  live(g, W, H, _p, t, pulse) {
    // lanterns sway on the branch
    for (const [x0, len, ph] of [
      [0.24, 0.12, 0],
      [0.34, 0.08, 2],
    ] as [number, number, number][]) {
      const ax = W * x0;
      const ay = H * (0.09 - x0 * 0.1);
      const ang = Math.sin(t / 800 + ph) * 0.12 + pulse * 0.4 * Math.sin(t / 90);
      const lx = ax + Math.sin(ang) * H * len;
      const ly = ay + Math.cos(ang) * H * len;
      g.strokeStyle = "#1c1917";
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(lx, ly);
      g.stroke();
      glow(g, lx, ly + 10, 40, "#fb923c", 0.5 + 0.1 * Math.sin(t / 150 + ph));
      g.fillStyle = "#dc2626";
      g.beginPath();
      g.ellipse(lx, ly + 10, 9, 12, ang, 0, TAU);
      g.fill();
      g.fillStyle = "#1c1917";
      g.fillRect(lx - 5, ly - 3, 10, 3);
      g.fillRect(lx - 5, ly + 21, 10, 3);
    }
  },
};

function floorLines(g: G, W: number, H: number, n: number): void {
  const hz = horizon(H);
  const vx = W / 2;
  const vy = hz - H * 0.35;
  g.lineWidth = 2;
  for (let i = -n; i <= n; i++) {
    const bx = vx + (i / n) * W * 1.6;
    const k = (hz - vy) / (H - vy);
    g.beginPath();
    g.moveTo(vx + (bx - vx) * k, hz);
    g.lineTo(bx, H);
    g.stroke();
  }
}

const colosseum: Layer = {
  still(g, W, H, p) {
    const hz = horizon(H);
    sky(g, W, H, [[0, "#020617"], [0.5, "#111827"], [1, "#020617"]]);
    // tiers of arches
    const tiers = 3;
    for (let tIdx = 0; tIdx < tiers; tIdx++) {
      const y0 = H * 0.08 + tIdx * (hz - H * 0.08) * 0.33;
      const h = (hz - H * 0.08) * 0.33;
      g.fillStyle = mix("#57534e", "#000000", 0.25 + tIdx * 0.1);
      g.fillRect(0, y0, W, h);
      const archW = 40 + tIdx * 8;
      for (let x = (tIdx % 2) * archW * 0.5; x < W; x += archW * 1.4) {
        g.fillStyle = "#0c0a09";
        g.beginPath();
        g.moveTo(x, y0 + h - 2);
        g.lineTo(x, y0 + h * 0.45);
        g.arc(x + archW / 2, y0 + h * 0.45, archW / 2, Math.PI, 0);
        g.lineTo(x + archW, y0 + h - 2);
        g.fill();
      }
      g.fillStyle = p.accent;
      g.globalAlpha = 0.8;
      g.fillRect(0, y0, W, 2);
      g.globalAlpha = 1;
    }
    // the jumbotron
    const jx = W * 0.42;
    const jw = Math.min(160, W * 0.2);
    g.fillStyle = "#0f172a";
    g.fillRect(jx - jw / 2, H * 0.02, jw, H * 0.1);
    g.strokeStyle = p.accent;
    g.lineWidth = 2;
    g.strokeRect(jx - jw / 2, H * 0.02, jw, H * 0.1);
    // a sand ring
    const fg = g.createLinearGradient(0, hz, 0, H);
    fg.addColorStop(0, "#78716c");
    fg.addColorStop(1, "#44403c");
    g.fillStyle = fg;
    g.fillRect(0, hz, W, H - hz);
    g.strokeStyle = p.accent;
    g.globalAlpha = 0.5;
    g.lineWidth = 3;
    g.beginPath();
    g.ellipse(W / 2, hz + (H - hz) * 0.55, W * 0.46, (H - hz) * 0.4, 0, 0, TAU);
    g.stroke();
    g.globalAlpha = 1;
    vignette(g, W, H, 0.5);
  },
  live(g, W, H, p, t, pulse, low) {
    const hz = horizon(H);
    // the crowd bobs, and jumps when a hit lands
    const rows = 2;
    for (let r = 0; r < rows; r++) {
      const y = H * 0.08 + (r + 1) * (hz - H * 0.08) * 0.33 - 1;
      const step = low ? 22 : 14;
      for (let i = 0; i < W / step; i++) {
        const x = i * step + (r ? 7 : 0) + hash(i, r) * 4;
        const jump = Math.max(0, Math.sin(t / (160 + hash(i, r + 5) * 120) + i)) * (1.5 + pulse * 12 * hash(i, 3));
        const c = ["#64748b", "#94a3b8", p.accent, "#f472b6", "#facc15", "#475569"][Math.floor(hash(i, r + 1) * 6)];
        g.fillStyle = c;
        g.fillRect(x - 4, y - 10 - jump, 8, 10);
        g.fillStyle = "#e7c9a9";
        g.beginPath();
        g.arc(x, y - 14 - jump, 3.6, 0, TAU);
        g.fill();
        g.fillStyle = c;
        if (pulse > 0.2 && hash(i, 8) < 0.4) g.fillRect(x + 3, y - 22 - jump, 2, 9); // an arm up
      }
    }
    // torches flicker
    for (const x of [0.05, 0.3, 0.7, 0.95]) {
      const f = 0.8 + 0.2 * Math.sin(t / 60 + x * 40) + Math.random() * 0.1;
      glow(g, W * x, hz - 30, 30 * f + pulse * 20, "#fb923c", 0.7);
      glow(g, W * x, hz - 34, 10 * f, "#fef3c7", 0.9);
      g.fillStyle = "#292524";
      g.fillRect(W * x - 3, hz - 26, 6, 26);
    }
    // spotlights sweep the sand
    g.globalCompositeOperation = "lighter";
    for (const side of [-1, 1]) {
      const ox = side < 0 ? 0 : W;
      const ang = Math.PI / 2 + side * (0.6 + 0.35 * Math.sin(t / 2200 + side));
      const len = H * 1.2;
      g.globalAlpha = 0.07 + pulse * 0.12;
      g.fillStyle = "#e0f2fe";
      g.beginPath();
      g.moveTo(ox, 0);
      g.lineTo(ox + Math.cos(ang - 0.12) * len, Math.sin(ang - 0.12) * len);
      g.lineTo(ox + Math.cos(ang + 0.12) * len, Math.sin(ang + 0.12) * len);
      g.fill();
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    // jumbotron
    const jx = W * 0.42;
    g.fillStyle = Math.floor(t / 500) % 2 || pulse > 0.3 ? p.accent : "#f472b6";
    g.font = "bold 14px monospace";
    g.textAlign = "center";
    g.fillText(pulse > 0.3 ? "HIT!" : "VS", jx, H * 0.085);
    g.textAlign = "start";
  },
};

export const LAYERS: Record<string, Layer> = { digits, circuit, hills, marble, lava, stars, neon, snow, sakura, colosseum };

function pads(g: G, list: Pad[], floorColor: string, accent: string): void {
  for (const f of list) {
    g.fillStyle = "#000000";
    g.globalAlpha = 0.35;
    g.beginPath();
    g.ellipse(f.x, f.y + f.size * 0.44, f.size * 0.62, f.size * 0.12, 0, 0, TAU);
    g.fill();
    g.globalAlpha = 0.8;
    g.fillStyle = floorColor;
    g.beginPath();
    g.ellipse(f.x, f.y + f.size * 0.42, f.size * 0.75, f.size * 0.16, 0, 0, TAU);
    g.fill();
    g.globalAlpha = 0.7;
    g.strokeStyle = accent;
    g.lineWidth = 2;
    g.stroke();
  }
  g.globalAlpha = 1;
}

/** The still part of an arena, with the stage pads under the fighters. */
export function drawStill(g: G, W: number, H: number, th: ArenaSkin | null, list: Pad[] = []): void {
  const layer = LAYERS[th?.layers[0] ?? "digits"] ?? digits;
  const pal = th?.palette ?? { sky: ["#0f172a", "#052e16"], floor: "#14532d", accent: "#22c55e", text: "#dcfce7" };
  g.save();
  layer.still(g, W, H, pal);
  g.restore();
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
  pads(g, list, pal.floor, pal.accent);
}

/** The moving part of an arena; t is game time in ms. */
export function drawLive(g: G, W: number, H: number, th: ArenaSkin | null, t: number, pulse: number, low: boolean): void {
  const layer = LAYERS[th?.layers[0] ?? "digits"] ?? digits;
  if (!layer.live) return;
  g.save();
  layer.live(g, W, H, th?.palette ?? { sky: ["#0f172a", "#052e16"], floor: "#14532d", accent: "#22c55e", text: "#dcfce7" }, t, pulse, low);
  g.restore();
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
}

/** A still picture of an arena for cards and pickers. */
export function drawThumb(canvas: HTMLCanvasElement, th: ArenaSkin, t = 4200): void {
  const g = canvas.getContext("2d");
  if (!g) return;
  const W = canvas.width;
  const H = canvas.height;
  drawStill(g, W, H, th);
  drawLive(g, W, H, th, t, 0, true);
}
