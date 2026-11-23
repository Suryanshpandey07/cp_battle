/**
 * Canvas2D effects engine. Layers, back to front: theme background, fighter
 * sprites + effects canvas, screen-space canvas (flash, vignette, speed lines),
 * then the DOM HUD. Camera shake and zoom are CSS transforms on the arena root.
 * The loop runs a fixed 60 Hz simulation step with an accumulator (at most 5
 * steps a frame); timeScale drives slow motion and hitStop freezes sprites and
 * particles while the HUD keeps running. No per-particle gradients or shadowBlur.
 */
import type { ArenaSkin } from "../skins/registry";
import { Fighter } from "./fighters";
import { drawLive, drawStill } from "./backdrops";
import { drawBeam, drawProp, drawReticle, drawShape, drawSlash, drawSpikes, type Beam, type ProjectileShape, type Prop, type Reticle, type Slash, type Spikes } from "./arsenal";
import { ADDITIVE, debrisSprite, glowSprite, Kind, noise, Particles, puffSprite, squareSprite } from "./particles";
import { HPBAR, NUMBER } from "./timings";

export type Quality = "high" | "low" | "off";
export const QUALITY: Record<Quality, { maxParticles: number; dprCap: number; smoke: boolean; decals: boolean }> = {
  high: { maxParticles: 4000, dprCap: 2, smoke: true, decals: true },
  low: { maxParticles: 1200, dprCap: 1, smoke: false, decals: false },
  off: { maxParticles: 0, dprCap: 1, smoke: false, decals: false },
};

const STEP = 1000 / 60;

export interface Projectile {
  from: [number, number];
  to: () => [number, number];
  t0: number;
  dur: number;
  size: number;
  ramp: number;
  style: ProjectileShape | string;
  trail: number;
  trailStyle: string;
  done: boolean;
  onArrive?: () => void;
  onStart?: () => void;
  pos: [number, number];
  warn?: boolean; // the defender's screen edge glows when it is within 200 px
  /** arc: the classic raised curve; lob: a high arc; line: straight; drop: straight fall (meteors, rain) */
  path?: "arc" | "lob" | "line" | "drop";
  ease?: "in" | "linear" | "out";
  delay?: number; // ms of game time before it leaves the hand
  started?: boolean;
  angle?: number; // direction of travel, kept for drawing
  grow?: number; // ms to swell from nothing to full size (charging orbs)
  metal?: string;
  accent?: string;
  /** A custom flight path: k is the share of the flight done (0..1, after `ease`). Misfires use it to turn around. */
  curve?: (k: number) => [number, number];
  /** Override the drawn angle (tumbling spears): gets the share done and the direction of travel. */
  angleAt?: (k: number, motion: number) => number;
  face?: number; // the angle drawn this frame
}

interface FloatText {
  text: string;
  x: number;
  y: number;
  t0: number;
  size: number;
  fill: string;
  stroke: string;
  tag?: string;
  tagColor?: string;
  strike?: boolean;
  big?: boolean; // centre stamp (K.O., TIME!)
  dur: number;
}

interface Ring {
  x: number;
  y: number;
  t0: number;
  dur: number;
  r0: number;
  r1: number;
  color: string;
  width: number;
}

interface Decal {
  x: number;
  y: number;
  r: number;
  t0: number;
  dur: number;
  crack: boolean;
}

interface Shake {
  amp: number;
  t0: number;
  dur: number;
  rot: boolean;
  seed: number;
}

export interface ShieldFx {
  until: number;
  color: string;
  crackUntil: number;
  shattered: boolean;
}

/** HP bar: the fill snaps in 120 ms; a pale ghost waits 450 ms then drains over 700 ms; the counter tweens 500 ms. */
export class HpBarController {
  shown: number;
  ghost: number;
  target: number;
  max: number;
  private changeT = 0;
  private from = 0;
  private ghostFrom = 0;
  joltUntil = 0;
  constructor(
    public els: { fill: HTMLElement; ghost: HTMLElement; text: HTMLElement; box?: HTMLElement | null },
    hp: number,
    max: number,
  ) {
    this.shown = this.ghost = this.target = hp;
    this.max = max;
    this.render(0);
  }
  set(hp: number, max: number, now: number, animate: boolean): void {
    if (hp === this.target && max === this.max) return;
    const dropping = hp < this.target;
    this.from = this.shown;
    this.ghostFrom = Math.max(this.ghost, this.shown);
    this.target = hp;
    this.max = max;
    this.changeT = now;
    if (!animate) {
      this.shown = this.ghost = hp;
    } else if (dropping) this.joltUntil = now + 150;
    else this.ghost = hp;
    this.render(now);
  }
  tick(now: number, reduced: boolean): void {
    const dt = now - this.changeT;
    if (this.shown !== this.target) {
      const k = Math.min(1, dt / HPBAR.counterMs);
      this.shown = Math.round(this.from + (this.target - this.from) * (1 - (1 - k) ** 2));
    }
    if (this.ghost > this.target) {
      if (reduced) this.ghost = this.target;
      else if (dt > HPBAR.ghostWaitMs) {
        const k = Math.min(1, (dt - HPBAR.ghostWaitMs) / HPBAR.ghostDrainMs);
        this.ghost = this.ghostFrom + (this.target - this.ghostFrom) * k;
      }
    } else this.ghost = Math.max(this.ghost, this.target);
    this.render(now);
  }
  private render(now: number): void {
    const pct = this.max > 0 ? (this.target / this.max) * 100 : 0;
    const share = this.max > 0 ? this.target / this.max : 0;
    this.els.fill.style.width = `${pct}%`;
    this.els.fill.style.background = share > 0.5 ? "var(--hp-high)" : share >= 0.2 ? "var(--hp-mid)" : "var(--hp-low)";
    this.els.fill.classList.toggle("hp-pulse-1", share < 0.2 && share >= 0.1 && share > 0);
    this.els.fill.classList.toggle("hp-pulse-2", share < 0.1 && share > 0);
    this.els.ghost.style.width = `${this.max > 0 ? (this.ghost / this.max) * 100 : 0}%`;
    this.els.text.textContent = `${Math.round(this.shown).toLocaleString("en-US")} / ${this.max.toLocaleString("en-US")}`;
    if (this.els.box) this.els.box.style.transform = now < this.joltUntil ? `translateX(${Math.sin(now / 12) * 3}px)` : "";
  }
}

export class Engine {
  now: () => number = () => performance.now();
  gameTime = 0;
  timeScale = 1;
  private slowUntil = 0;
  private slowScale = 1;
  hitStopUntil = 0;
  quality: Quality = "high";
  autoQuality = true;
  reduced = false;
  shakeScale = 1;
  flashScale = 1;
  paused = false;
  frames = 0;
  fps = 60;
  private frameEma = 16.7;
  private slowFrames = 0;
  particles = new Particles(4000);
  fighters: Record<1 | 2, Fighter> = { 1: new Fighter(), 2: new Fighter() };
  you: 1 | 2 = 1;
  projectiles: Projectile[] = [];
  beams: Beam[] = [];
  props: Prop[] = [];
  spikes: Spikes[] = [];
  slashes: Slash[] = [];
  reticles: Reticle[] = [];
  darken = { a: 0, t0: 0, dur: 0 };
  texts: FloatText[] = [];
  rings: Ring[] = [];
  decals: Decal[] = [];
  shakes: Shake[] = [];
  shields: Partial<Record<1 | 2, ShieldFx>> = {};
  charge: Partial<Record<1 | 2, { size: number; target: number; mine: boolean; ramp: number; unstable: number }>> = {};
  status: Partial<Record<1 | 2, { kind: string; until: number }>> = {};
  hp: Partial<Record<1 | 2, HpBarController>> = {};
  flash = { a: 0, t0: 0, dur: 200, color: "#ffffff" };
  vignette = { a: 0, t0: 0, dur: 500, color: "239,68,68", side: 0 };
  edgeGlow = 0;
  speedLines = { until: 0, t0: 0 };
  aberration = { until: 0, px: 0 };
  tear = { until: 0 };
  zoom = { from: 1, to: 1, t0: 0, dur: 1, cx: 0.5, cy: 0.5 };
  lowHpPulse = false;
  ramps: string[][] = [];
  private rampIndex = new Map<string, number>();
  private raf = 0;
  private last = 0;
  private acc = 0;
  private W = 800;
  private H = 400;
  private dpr = 1;
  theme: ArenaSkin | null = null;
  /** Move both fighters right by this share of the width (banners with text on the left). */
  stageShift = 0;
  private bgDirty = true;
  private still: HTMLCanvasElement | null = null;
  private stillShown = false;
  private pulseT = -1e9;
  private pulseLevel = 0;
  private ambientT = 0;
  onFrame: ((e: Engine) => void) | null = null;

  constructor(
    public root: HTMLElement,
    public bg: HTMLCanvasElement,
    public fx: HTMLCanvasElement,
    public screen: HTMLCanvasElement,
  ) {
    this.fighters[1].facing = 1;
    this.fighters[2].facing = -1;
    this.ramp(["#fff7d6", "#ffd23f", "#ff7a1a", "#d62718", "#2a1a1a"]);
  }

  // ------------------------------------------------------------------ setup
  ramp(colors: string[]): number {
    const key = colors.join(",");
    let i = this.rampIndex.get(key);
    if (i === undefined) {
      i = this.ramps.length;
      this.ramps.push(colors);
      this.rampIndex.set(key, i);
    }
    return i;
  }

  setQuality(q: Quality, auto = this.autoQuality): void {
    this.quality = q;
    this.autoQuality = auto;
    this.particles.limit = QUALITY[q].maxParticles;
    if (q === "off") this.particles.clear();
    this.resize();
  }

  setTheme(theme: ArenaSkin): void {
    if (this.theme?.id !== theme.id) this.particles.clear();
    this.theme = theme;
    this.bgDirty = true;
  }

  get width(): number {
    return this.W;
  }
  get height(): number {
    return this.H;
  }

  /** Fighter placement: the opponent top-right, you bottom-left and larger (nearer the camera). */
  layout(): void {
    const k = Math.min(1.25, Math.max(0.35, this.H / 420));
    const me = this.fighters[this.you];
    const opp = this.fighters[this.you === 1 ? 2 : 1];
    me.scale = 5 * k * (this.W < 700 ? 0.8 : 1);
    opp.scale = 4 * k * (this.W < 700 ? 0.8 : 1);
    me.baseX = this.W * (0.22 + this.stageShift);
    me.baseY = this.H * 0.66;
    opp.baseX = this.W * (0.76 + this.stageShift * 0.25);
    opp.baseY = this.H * 0.36;
    me.facing = 1;
    opp.facing = -1;
  }

  resize(): void {
    const r = this.root.getBoundingClientRect();
    this.W = Math.max(200, r.width);
    this.H = Math.max(120, r.height);
    this.dpr = Math.min(window.devicePixelRatio || 1, QUALITY[this.quality].dprCap);
    for (const c of [this.bg, this.fx, this.screen]) {
      c.width = Math.round(this.W * this.dpr);
      c.height = Math.round(this.H * this.dpr);
      c.style.width = `${this.W}px`;
      c.style.height = `${this.H}px`;
    }
    this.layout();
    this.bgDirty = true;
  }

  start(): void {
    this.resize();
    this.last = this.now();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.frame(this.now());
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }

  /** Frame stepping for the VFX Lab: advance exactly one simulation step while paused. */
  stepOnce(): void {
    const was = this.paused;
    this.paused = false;
    this.frame(this.last + STEP);
    this.paused = was;
  }

  // ------------------------------------------------------------------ effects API
  slowmo(scale: number, ms: number): void {
    if (this.reduced) return;
    this.slowScale = Math.min(this.slowScale < 1 && this.now() < this.slowUntil ? this.slowScale : 1, scale);
    this.slowUntil = Math.max(this.slowUntil, this.now() + ms);
  }

  hitStop(ms: number): void {
    if (this.reduced) return;
    this.hitStopUntil = Math.max(this.hitStopUntil, this.now() + ms);
  }

  shake(amp: number, ms: number, rot = false): void {
    if (this.reduced || this.shakeScale <= 0) return;
    this.shakes.push({ amp: amp * this.shakeScale, t0: this.now(), dur: ms, rot, seed: Math.random() * 100 });
  }

  flashWhite(alpha: number, ms = 220, color = "#ffffff"): void {
    if (this.reduced) return;
    // Flashes stay under three per second.
    if (this.now() - this.flash.t0 < 340) alpha = Math.min(alpha, this.flash.a * 0.5);
    this.flash = { a: alpha * this.flashScale, t0: this.now(), dur: ms, color };
  }

  damageVignette(alpha: number, ms = 500): void {
    this.vignette = { a: alpha * this.flashScale, t0: this.now(), dur: ms, color: "239,68,68", side: 0 };
  }

  zoomTo(z: number, ms: number, cx = 0.5, cy = 0.5): void {
    if (this.reduced) return;
    const cur = this.currentZoom();
    this.zoom = { from: cur, to: z, t0: this.now(), dur: ms, cx, cy };
  }

  private currentZoom(): number {
    const k = Math.min(1, (this.now() - this.zoom.t0) / this.zoom.dur);
    return this.zoom.from + (this.zoom.to - this.zoom.from) * (1 - (1 - k) ** 3);
  }

  ring(x: number, y: number, r1: number, ms: number, color = "#fff7d6", width = 6, r0 = 4): void {
    if (this.quality === "off" && !this.reduced) return;
    this.rings.push({ x, y, t0: this.gameTime, dur: ms, r0, r1, color, width });
  }

  decal(x: number, y: number, r: number, crack: boolean): void {
    if (!QUALITY[this.quality].decals || this.reduced) return;
    this.decals.push({ x, y, r, t0: this.gameTime, dur: 3000, crack });
    if (this.decals.length > 8) this.decals.shift();
  }

  text(t: Omit<FloatText, "t0" | "dur"> & { dur?: number }): void {
    const now = this.gameTime;
    let y = t.y;
    if (!t.big) {
      for (const o of this.texts) if (!o.big && now - o.t0 < NUMBER.stackGapMs && Math.abs(o.x - t.x) < 80) y = Math.min(y, o.y - NUMBER.stackPx);
    }
    this.texts.push({ ...t, y, t0: now, dur: t.dur ?? NUMBER.riseMs });
  }

  /** Emit n particles in a burst. Low quality scales counts by 0.35 and drops smoke. */
  burst(kind: Kind, x: number, y: number, n: number, speed: number, life: number, size: [number, number], ramp: number, opts: { ay?: number; drag?: number; spread?: number; dir?: number; bounceY?: number; up?: number } = {}): void {
    if (this.quality === "off" || this.reduced) return;
    if (kind === Kind.Smoke && !QUALITY[this.quality].smoke) return;
    const count = Math.round(this.quality === "low" ? n * 0.35 : n);
    const spread = opts.spread ?? Math.PI * 2;
    const dir = opts.dir ?? -Math.PI / 2;
    for (let i = 0; i < count; i++) {
      const a = dir + (Math.random() - 0.5) * spread;
      const v = speed * (0.35 + Math.random() * 0.65);
      const idx = this.particles.spawn(kind, x, y, Math.cos(a) * v, Math.sin(a) * v - (opts.up ?? 0), life * (0.6 + Math.random() * 0.4), size[0], size[1], ramp, opts.ay ?? 0, opts.drag ?? 1.5);
      if (opts.bounceY !== undefined) this.particles.setBounce(idx, opts.bounceY);
    }
  }

  launch(p: Omit<Projectile, "done" | "pos" | "t0">): Projectile {
    const proj: Projectile = { ...p, t0: this.gameTime, done: false, pos: [...p.from] as [number, number], started: !p.delay };
    this.projectiles.push(proj);
    if (!p.delay) p.onStart?.();
    return proj;
  }

  /** A beam from one point to another (lasers, lightning, orbital strikes). */
  beam(b: Omit<Beam, "t0" | "seed"> & { delay?: number }): void {
    this.beams.push({ ...b, t0: this.gameTime + (b.delay ?? 0), seed: Math.floor(Math.random() * 1e6) });
  }

  /** A held weapon shown at the fighter's hand for dur ms; kicks are ms offsets of each shot. */
  prop(p: Omit<Prop, "t0" | "kicks"> & { kicks?: number[] }): void {
    this.props = this.props.filter((x) => x.side !== p.side);
    this.props.push({ ...p, t0: this.gameTime, kicks: (p.kicks ?? []).map((k) => this.gameTime + k) });
  }

  spike(sp: Omit<Spikes, "t0"> & { delay?: number }): void {
    if (this.reduced) return;
    this.spikes.push({ ...sp, t0: this.gameTime + (sp.delay ?? 0) });
  }

  slash(sl: Omit<Slash, "t0"> & { delay?: number }): void {
    this.slashes.push({ ...sl, t0: this.gameTime + (sl.delay ?? 0) });
  }

  reticle(r: Omit<Reticle, "t0">): void {
    this.reticles.push({ ...r, t0: this.gameTime });
  }

  /** Darken the arena behind the effects (storms, orbital strikes). */
  dim(alpha: number, ms: number): void {
    if (this.reduced) return;
    this.darken = { a: alpha, t0: this.gameTime, dur: ms };
  }

  /** Drop every in-flight effect (previews switching weapons). */
  clearEffects(): void {
    this.projectiles = [];
    this.beams = [];
    this.props = [];
    this.spikes = [];
    this.slashes = [];
    this.reticles = [];
    this.rings = [];
    this.texts = [];
    this.darken = { a: 0, t0: 0, dur: 0 };
    this.particles.clear();
  }

  setStatus(side: 1 | 2, kind: string, ms: number): void {
    this.status[side] = { kind, until: this.gameTime + ms };
  }

  // ------------------------------------------------------------------ loop
  frame(now: number): void {
    if (this.paused) {
      this.last = now;
      return;
    }
    const raw = Math.min(250, now - this.last);
    this.last = now;
    this.frameEma = this.frameEma * 0.95 + raw * 0.05;
    this.fps = 1000 / this.frameEma;
    if (this.autoQuality && this.quality !== "off") {
      this.slowFrames = this.frameEma > 22 ? this.slowFrames + 1 : 0;
      if (this.slowFrames > 90) {
        this.setQuality(this.quality === "high" ? "low" : "off", true); // never step up automatically
        this.slowFrames = 0;
      }
    }
    if (now > this.slowUntil) this.slowScale = 1;
    const frozen = now < this.hitStopUntil;
    this.acc += raw;
    let steps = 0;
    while (this.acc >= STEP && steps < 5) {
      const dt = STEP * this.timeScale * this.slowScale;
      if (!frozen) {
        this.gameTime += dt;
        this.particles.update(dt);
        this.updateProjectiles(dt);
        this.ambient(dt);
      }
      for (const f of [this.fighters[1], this.fighters[2]]) f.update(dt, frozen);
      this.acc -= STEP;
      steps++;
    }
    if (steps === 5) this.acc = 0;
    this.frames++;
    this.onFrame?.(this);
    for (const k of [1, 2] as const) this.hp[k]?.tick(now, this.reduced);
    this.applyCamera(now);
    this.draw(now);
  }

  private updateProjectiles(dt: number): void {
    for (const p of this.projectiles) {
      if (p.done) continue;
      const age = this.gameTime - p.t0 - (p.delay ?? 0);
      if (age < 0) continue;
      if (!p.started) {
        p.started = true;
        p.onStart?.();
      }
      const k = Math.min(1, age / p.dur);
      const ease = p.ease ?? (p.curve ? "linear" : "in");
      const e = ease === "linear" ? k : ease === "out" ? 1 - (1 - k) ** 2 : k * k * k; // default: cubic ease-in
      const to = p.to();
      const dx = to[0] - p.from[0];
      const dy = to[1] - p.from[1];
      const prev = p.pos;
      if (p.curve) p.pos = p.curve(e);
      else {
        const dist = Math.hypot(dx, dy);
        // quadratic Bezier; the control point is raised by a share of the distance
        const raise = p.path === "line" || p.path === "drop" ? 0 : p.path === "lob" ? 0.5 : 0.18;
        const cx = p.from[0] + dx / 2;
        const cy = p.from[1] + dy / 2 - dist * raise;
        const u = 1 - e;
        p.pos = [u * u * p.from[0] + 2 * u * e * cx + e * e * to[0], u * u * p.from[1] + 2 * u * e * cy + e * e * to[1]];
      }
      const mx = p.pos[0] - prev[0];
      const my = p.pos[1] - prev[1];
      if (Math.abs(mx) + Math.abs(my) > 0.01) p.angle = Math.atan2(my, mx);
      else if (p.angle === undefined) p.angle = Math.atan2(dy, dx);
      p.face = p.angleAt ? p.angleAt(k, p.angle ?? 0) : p.angle;
      if (this.quality !== "off" && !this.reduced && p.trail > 0) {
        const n = Math.max(1, Math.round((p.trail * dt) / STEP));
        const back = (p.angle ?? 0) + Math.PI;
        for (let i = 0; i < n; i++) {
          const jx = (Math.random() - 0.5) * p.size * 0.6;
          const jy = (Math.random() - 0.5) * p.size * 0.6;
          const ts = p.trailStyle;
          if (ts === "streak" || ts === "wind") {
            const a = back + (Math.random() - 0.5) * 0.5;
            const v = 220 + Math.random() * 260;
            this.particles.spawn(Kind.Streak, p.pos[0] + jx, p.pos[1] + jy, Math.cos(a) * v, Math.sin(a) * v, 180 + Math.random() * 160, ts === "wind" ? 2 : Math.max(1.5, p.size * 0.12), 0.5, p.ramp, 0, 3);
          } else if (ts === "smoke") {
            this.particles.spawn(Kind.Smoke, p.pos[0] + jx, p.pos[1] + jy, (Math.random() - 0.5) * 30, -10 - Math.random() * 20, 700 + Math.random() * 500, p.size * 0.5, p.size * 1.6, p.ramp, -20, 1);
            this.particles.spawn(Kind.Flame, p.pos[0] + jx * 0.3, p.pos[1] + jy * 0.3, Math.cos(back) * 80, Math.sin(back) * 80, 160, p.size * 0.5, p.size * 0.1, p.ramp, 0, 3);
          } else if (ts === "embers") {
            this.particles.spawn(Kind.Ember, p.pos[0] + jx, p.pos[1] + jy, (Math.random() - 0.5) * 60, -30 - Math.random() * 60, 500 + Math.random() * 500, Math.max(2, p.size * 0.18), 1, p.ramp, -60, 1);
            this.particles.spawn(Kind.Flame, p.pos[0] + jx, p.pos[1] + jy, (Math.random() - 0.5) * 40, -20 - Math.random() * 40, 260 + Math.random() * 200, p.size * 0.6, p.size * 0.15, p.ramp, -30, 2);
          } else if (ts !== "none") {
            const kind = ts === "mist" ? Kind.Smoke : ts === "bits" ? Kind.Glyph : ts === "pixel" ? Kind.Square : Kind.Flame;
            this.particles.spawn(kind, p.pos[0] + jx, p.pos[1] + jy, (Math.random() - 0.5) * 40, -20 - Math.random() * 40, 260 + Math.random() * 200, p.size * 0.6, p.size * 0.15, p.ramp, -30, 2);
          }
        }
      }
      if (p.warn && Math.hypot(to[0] - p.pos[0], to[1] - p.pos[1]) < 200) this.edgeGlow = 1;
      if (k >= 1) {
        p.done = true;
        p.onArrive?.();
      }
    }
    this.projectiles = this.projectiles.filter((p) => !p.done);
  }

  private ambient(dt: number): void {
    const th = this.theme;
    if (!th || !th.ambient.particles || this.quality === "off" || this.reduced) return;
    this.ambientT += dt;
    const every = 1000 / Math.max(0.5, th.ambient.rate);
    while (this.ambientT > every) {
      this.ambientT -= every;
      const kindName = th.ambient.particles;
      const r = this.ramp([th.palette.accent, th.palette.accent, th.palette.text, th.palette.floor, th.palette.sky[0]]);
      const x = Math.random() * this.W;
      if (kindName === "snow") {
        this.particles.spawn(Kind.Glow, x, -10, (Math.random() - 0.5) * 30, 25 + Math.random() * 35, 9000, 2.5 + Math.random() * 2.5, 2, this.ramp(["#ffffff", "#ffffff", "#e0f2fe", "#bae6fd", "#7dd3fc"]), 0, 0);
      } else if (kindName === "petals") {
        this.particles.spawn(Kind.Square, x + this.W * 0.2, -10, -30 - Math.random() * 40, 30 + Math.random() * 30, 9000, 6, 5, this.ramp(["#fbcfe8", "#f9a8d4", "#f472b6", "#ec4899", "#be185d"]), 0, 0);
      } else if (kindName === "embers") {
        this.particles.spawn(Kind.Ember, x, this.H + 10, (Math.random() - 0.5) * 20, -40 - Math.random() * 50, 5000, 2.5, 1, this.ramp(["#fff7d6", "#fde047", "#fb923c", "#ea580c", "#7c2d12"]), -5, 0);
      } else {
        const kind = kindName === "bits" ? Kind.Glyph : kindName === "ash" ? Kind.Square : kindName === "coins" ? Kind.Square : Kind.Glow;
        const fall = kindName === "comets" ? 0 : 1;
        this.particles.spawn(kind, x, fall ? -10 : Math.random() * this.H * 0.4, kindName === "comets" ? -120 : (Math.random() - 0.5) * 10, fall ? 30 + Math.random() * 40 : 20, 6000, kind === Kind.Glyph ? 10 : 3, kind === Kind.Glyph ? 10 : 2, r, 0, 0);
      }
    }
  }

  private applyCamera(now: number): void {
    let x = 0;
    let y = 0;
    let rot = 0;
    this.shakes = this.shakes.filter((s) => now - s.t0 < s.dur);
    for (const s of this.shakes) {
      const k = 1 - (now - s.t0) / s.dur;
      const t = (now - s.t0) / 1000;
      x += s.amp * k * (Math.sin(t * 61 + s.seed) * 0.6 + Math.sin(t * 37) * 0.4 + noise(t * 30 + s.seed) * 0.3);
      y += s.amp * k * (Math.cos(t * 53 + s.seed) * 0.6 + noise(t * 25) * 0.4);
      if (s.rot) rot += 1.5 * k * Math.sin(t * 29 + s.seed);
    }
    const z = this.currentZoom();
    this.root.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${rot.toFixed(2)}deg) scale(${z.toFixed(3)})`;
    this.root.style.transformOrigin = `${this.zoom.cx * 100}% ${this.zoom.cy * 100}%`;
  }

  // ------------------------------------------------------------------ drawing
  /**
   * The arena: the still part is drawn once into an offscreen canvas (when the
   * theme or size changes); the live part (rain, crowds, aurora) is drawn over
   * it every frame unless motion is reduced or effects are off.
   */
  private drawBackground(): void {
    const g = this.bg.getContext("2d")!;
    const live = this.quality !== "off" && !this.reduced;
    if (this.bgDirty) {
      if (!this.still) this.still = document.createElement("canvas");
      this.still.width = this.bg.width;
      this.still.height = this.bg.height;
      const sg = this.still.getContext("2d")!;
      sg.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      const list = [this.fighters[1], this.fighters[2]].map((f) => ({ x: f.baseX, y: f.baseY, size: f.size }));
      drawStill(sg, this.W, this.H, this.theme, list);
      this.bgDirty = false;
      this.stillShown = false;
    }
    if (!live && this.stillShown) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.still!, 0, 0);
    this.stillShown = true;
    if (!live) return;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const pk = Math.max(0, 1 - (this.gameTime - this.pulseT) / 900) * this.pulseLevel;
    drawLive(g, this.W, this.H, this.theme, this.gameTime, pk, this.quality === "low");
  }

  /** The scenery reacts to a hit: 1 light .. 4 nuke. */
  pulse(level: number): void {
    this.pulseT = this.gameTime;
    this.pulseLevel = Math.min(1, level / 4 + 0.15);
  }

  private drawParticles(g: CanvasRenderingContext2D): void {
    const P = this.particles;
    for (let pass = 0; pass < 2; pass++) {
      const additive = pass === 1;
      g.globalCompositeOperation = additive ? "lighter" : "source-over";
      for (let i = 0; i < P.cap; i++) {
        if (!P.alive[i]) continue;
        const k = P.kind[i];
        if (ADDITIVE.has(k) !== additive) continue;
        const f = P.life[i] / P.max[i];
        const ramp = this.ramps[P.ramp[i]] ?? this.ramps[0];
        const color = ramp[Math.min(ramp.length - 1, Math.floor(f * (ramp.length - 1) + (k === Kind.Smoke ? 3 : 0)))];
        const size = P.s0[i] + (P.s1[i] - P.s0[i]) * f;
        g.globalAlpha = k === Kind.Smoke ? 0.35 * (1 - f) : 1 - f * f;
        g.lineCap = "round";
        const x = P.x[i];
        const y = P.y[i];
        if (k === Kind.Streak) {
          const vx = P.vx[i];
          const vy = P.vy[i];
          g.strokeStyle = color;
          g.lineWidth = size;
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x - vx * 0.045, y - vy * 0.045);
          g.stroke();
          continue;
        }
        if (k === Kind.Ember) {
          g.globalAlpha *= 0.6 + 0.4 * Math.sin(P.life[i] / 30 + i);
          g.drawImage(glowSprite(color), x - size, y - size, size * 2, size * 2);
          continue;
        }
        if (k === Kind.Debris) {
          g.save();
          g.translate(x, y);
          g.rotate(P.rot[i]);
          g.globalAlpha = f > 0.8 ? (1 - f) * 5 : 1;
          g.drawImage(debrisSprite(color), -size / 2, -size / 2, size, size);
          g.restore();
          continue;
        }
        if (k === Kind.Glyph) {
          g.fillStyle = color;
          g.font = `${Math.max(6, size)}px monospace`;
          g.fillText(i % 2 ? "1" : "0", x, y);
        } else if (k === Kind.Square || k === Kind.Shard) {
          g.save();
          g.translate(x, y);
          g.rotate(P.rot[i]);
          g.drawImage(squareSprite(color), -size / 2, -size / 2, size, k === Kind.Shard ? size * 0.6 : size);
          g.restore();
        } else if (k === Kind.Spark) {
          g.drawImage(glowSprite(color), x - size, y - size, size * 2, size * 2);
        } else {
          const spr = k === Kind.Flame || k === Kind.Smoke ? puffSprite(k === Kind.Smoke ? "#3f3f46" : color) : glowSprite(color);
          g.drawImage(spr, x - size, y - size, size * 2, size * 2);
        }
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }

  private drawProjectile(g: CanvasRenderingContext2D, p: Projectile): void {
    if (!p.started) return;
    const [x, y] = p.pos;
    const ramp = this.ramps[p.ramp] ?? this.ramps[0];
    const age = this.gameTime - p.t0 - (p.delay ?? 0);
    const s = p.grow ? p.size * Math.min(1, Math.max(0.05, age / p.grow)) : p.size;
    if (this.reduced) {
      g.drawImage(glowSprite(ramp[1]), x - 8, y - 8, 16, 16);
      return;
    }
    if (drawShape(g, p.style as ProjectileShape, x, y, s, p.face ?? p.angle ?? 0, ramp, this.gameTime, p.metal, p.accent)) {
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
      return;
    }
    g.globalCompositeOperation = "lighter";
    if (p.style === "bolt") {
      g.strokeStyle = ramp[1];
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(p.from[0], p.from[1]);
      const segs = 7;
      for (let i = 1; i <= segs; i++) {
        const k = i / segs;
        g.lineTo(p.from[0] + (x - p.from[0]) * k + (i < segs ? (Math.random() - 0.5) * 26 : 0), p.from[1] + (y - p.from[1]) * k + (i < segs ? (Math.random() - 0.5) * 26 : 0));
      }
      g.stroke();
      g.drawImage(glowSprite(ramp[0]), x - s, y - s, s * 2, s * 2);
    } else if (p.style === "shard") {
      g.save();
      g.translate(x, y);
      g.rotate(this.gameTime / 60);
      g.fillStyle = ramp[1];
      g.beginPath();
      g.moveTo(0, -s);
      g.lineTo(s * 0.5, 0);
      g.lineTo(0, s);
      g.lineTo(-s * 0.5, 0);
      g.fill();
      g.restore();
      g.drawImage(glowSprite(ramp[2]), x - s, y - s, s * 2, s * 2);
    } else if (p.style === "vortex") {
      g.globalCompositeOperation = "source-over";
      g.fillStyle = "#0b0618";
      g.beginPath();
      g.arc(x, y, s * 0.6, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = ramp[2];
      g.lineWidth = 3;
      g.beginPath();
      g.ellipse(x, y, s, s * 0.35, this.gameTime / 200, 0, Math.PI * 2);
      g.stroke();
    } else if (p.style === "glyphs") {
      g.fillStyle = ramp[1];
      g.font = `${Math.max(8, s * 0.4)}px monospace`;
      for (let i = 0; i < 10; i++) {
        const a = i * 0.63 + this.gameTime / 120;
        g.fillText(i % 2 ? "1" : "0", x + Math.cos(a) * s * 0.5, y + Math.sin(a) * s * 0.5);
      }
    } else {
      if (p.style === "comet") {
        g.drawImage(glowSprite(ramp[2]), x - s * 2.2, y - s * 0.6, s * 2.2, s * 1.2);
      }
      g.drawImage(glowSprite(ramp[2]), x - s * 1.6, y - s * 1.6, s * 3.2, s * 3.2);
      g.drawImage(glowSprite(ramp[1]), x - s, y - s, s * 2, s * 2);
      g.drawImage(glowSprite(ramp[0]), x - s * 0.55, y - s * 0.55, s * 1.1, s * 1.1);
    }
    g.globalCompositeOperation = "source-over";
  }

  private drawShield(g: CanvasRenderingContext2D, side: 1 | 2, sh: ShieldFx, now: number): void {
    const f = this.fighters[side];
    const left = sh.until - now;
    if (left <= 0 && !sh.shattered) return;
    const flicker = left < 2000 && Math.floor(left / 160) % 2 === 0 ? 0.35 : 1;
    const w = f.size * 1.1;
    const h = f.size * 0.86;
    const cx = f.baseX;
    const cy = f.baseY + f.size * 0.08;
    g.save();
    g.globalAlpha = 0.22 * flicker;
    g.fillStyle = sh.color;
    g.beginPath();
    g.ellipse(cx, cy, w / 2, h / 2, 0, Math.PI, 0);
    g.lineTo(cx + w / 2, cy + h * 0.32);
    g.ellipse(cx, cy + h * 0.32, w / 2, h * 0.08, 0, 0, Math.PI);
    g.fill();
    g.globalAlpha = 0.85 * flicker;
    g.strokeStyle = sh.color;
    g.lineWidth = 3;
    g.beginPath();
    g.ellipse(cx, cy, w / 2, h / 2, 0, Math.PI, 0);
    g.stroke();
    // hex pattern, drifting in opacity
    g.globalAlpha = (0.15 + 0.1 * Math.sin(now / 400)) * flicker;
    g.lineWidth = 1;
    for (let hx = -3; hx <= 3; hx++) {
      for (let hy = -2; hy <= 0; hy++) {
        const px = cx + hx * 18 + (hy % 2 ? 9 : 0);
        const py = cy + hy * 15;
        if (((px - cx) / (w / 2)) ** 2 + ((py - cy) / (h / 2)) ** 2 > 0.9) continue;
        g.beginPath();
        for (let i = 0; i < 6; i++) g.lineTo(px + 8 * Math.cos((i * Math.PI) / 3), py + 8 * Math.sin((i * Math.PI) / 3));
        g.closePath();
        g.stroke();
      }
    }
    if (now < sh.crackUntil) {
      g.globalAlpha = 1;
      g.strokeStyle = "#ffffff";
      g.lineWidth = 2;
      for (let i = 0; i < 7; i++) {
        const a = Math.PI + (i / 6) * Math.PI;
        g.beginPath();
        g.moveTo(cx, cy - h * 0.15);
        g.lineTo(cx + Math.cos(a) * w * 0.48, cy + Math.sin(a) * h * 0.48);
        g.stroke();
      }
    }
    g.restore();
  }

  private draw(now: number): void {
    this.drawBackground();
    const g = this.fx.getContext("2d")!;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.W, this.H);
    const dk = this.darken.dur ? (this.gameTime - this.darken.t0) / this.darken.dur : 1;
    if (dk < 1 && this.darken.a > 0) {
      const env = Math.min(1, dk / 0.12) * (dk > 0.7 ? (1 - dk) / 0.3 : 1);
      g.globalAlpha = this.darken.a * env;
      g.fillStyle = "#020617";
      g.fillRect(0, 0, this.W, this.H);
      g.globalAlpha = 1;
    }
    for (const r of this.reticles) {
      if (r.follow) [r.x, r.y] = r.follow();
      drawReticle(g, r, this.gameTime);
    }
    this.reticles = this.reticles.filter((r) => this.gameTime - r.t0 < r.dur);
    // decals on the floor
    for (const d of this.decals) {
      const k = (this.gameTime - d.t0) / d.dur;
      if (k > 1) continue;
      g.globalAlpha = 0.55 * (1 - k);
      g.fillStyle = "#1c1917";
      g.beginPath();
      g.ellipse(d.x, d.y, d.r, d.r * 0.3, 0, 0, Math.PI * 2);
      g.fill();
      if (d.crack) {
        g.strokeStyle = "#f97316";
        g.lineWidth = 2;
        for (let i = 0; i < 5; i++) {
          g.beginPath();
          g.moveTo(d.x, d.y);
          g.lineTo(d.x + Math.cos(i * 1.3) * d.r * 1.3, d.y + Math.sin(i * 1.3) * d.r * 0.4);
          g.stroke();
        }
      }
    }
    this.decals = this.decals.filter((d) => this.gameTime - d.t0 < d.dur);
    g.globalAlpha = 1;
    // fighters, status overlays and shields
    for (const side of [1, 2] as const) {
      const f = this.fighters[side];
      f.draw(g, now);
      const st = this.status[side];
      if (st && this.gameTime < st.until && !this.reduced && this.quality !== "off") {
        if (st.kind === "burning" && Math.random() < 0.6) {
          this.particles.spawn(Kind.Flame, f.baseX + (Math.random() - 0.5) * f.size * 0.6, f.baseY + f.size * 0.2, 0, -60, 420, 9, 2, 0, -40, 1);
        }
        if (st.kind === "frozen") {
          g.globalAlpha = 0.35;
          g.drawImage(glowSprite("#67e8f9"), f.baseX - f.size * 0.5, f.baseY - f.size * 0.5, f.size, f.size);
          g.globalAlpha = 1;
        }
        if (st.kind === "shocked" && Math.floor(this.gameTime / 60) % 2) {
          g.globalAlpha = 0.4;
          g.drawImage(glowSprite("#fde047"), f.baseX - f.size * 0.5, f.baseY - f.size * 0.5, f.size, f.size);
          g.globalAlpha = 1;
        }
      }
      if (f.dizzyUntil > this.gameTime && !this.reduced) {
        g.fillStyle = "#fde047";
        g.font = "12px monospace";
        for (let i = 0; i < 3; i++) {
          const a = this.gameTime / 200 + (i * Math.PI * 2) / 3;
          g.fillText("★", f.anchors.head[0] + Math.cos(a) * 22, f.anchors.head[1] - 8 + Math.sin(a) * 6);
        }
      }
      const sh = this.shields[side];
      if (sh) this.drawShield(g, side, sh, now);
      const ch = this.charge[side];
      if (ch && !this.reduced) {
        ch.size += (ch.target - ch.size) * 0.15;
        const [mx, my] = f.anchors.muzzle;
        const ramp = this.ramps[ch.ramp] ?? this.ramps[0];
        const jitter = ch.unstable ? 1 + (Math.random() - 0.5) * 0.4 : 1 + (ch.mine ? 0 : 0.15 * Math.sin(now / 120));
        const s = ch.size * jitter;
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = ch.mine ? 1 : 0.55;
        const col = ch.unstable && Math.floor(now / 33) % 2 ? "#ff00ff" : ramp[1];
        g.drawImage(glowSprite(col), mx - s, my - s, s * 2, s * 2);
        g.drawImage(glowSprite(ramp[0]), mx - s * 0.5, my - s * 0.5, s, s);
        g.globalAlpha = 1;
        g.globalCompositeOperation = "source-over";
      }
    }
    for (const p of this.props) {
      const f = this.fighters[p.side];
      drawProp(g, p, f.anchors.muzzle[0], f.anchors.muzzle[1], f.facing, this.gameTime);
    }
    this.props = this.props.filter((p) => this.gameTime - p.t0 < p.dur);
    for (const sp of this.spikes) drawSpikes(g, sp, this.gameTime);
    this.spikes = this.spikes.filter((sp) => this.gameTime - sp.t0 < sp.dur);
    this.drawParticles(g);
    for (const p of this.projectiles) this.drawProjectile(g, p);
    for (const b of this.beams) drawBeam(g, b, this.gameTime, this.ramps[b.ramp] ?? this.ramps[0]);
    this.beams = this.beams.filter((b) => this.gameTime - b.t0 < b.dur);
    for (const sl of this.slashes) drawSlash(g, sl, this.gameTime);
    this.slashes = this.slashes.filter((sl) => this.gameTime - sl.t0 < sl.dur);
    // shockwave rings
    for (const r of this.rings) {
      const k = (this.gameTime - r.t0) / r.dur;
      if (k > 1) continue;
      g.globalAlpha = 1 - k;
      g.strokeStyle = r.color;
      g.lineWidth = r.width * (1 - k) + 1;
      g.beginPath();
      g.arc(r.x, r.y, r.r0 + (r.r1 - r.r0) * (1 - (1 - k) ** 2), 0, Math.PI * 2);
      g.stroke();
    }
    this.rings = this.rings.filter((r) => this.gameTime - r.t0 < r.dur);
    g.globalAlpha = 1;
    // floating numbers and stamps
    for (const t of this.texts) this.drawText(g, t);
    this.texts = this.texts.filter((t) => this.gameTime - t.t0 < t.dur);
    this.drawScreen(now);
  }

  private drawText(g: CanvasRenderingContext2D, t: FloatText): void {
    const age = this.gameTime - t.t0;
    let scale = 1;
    let dy = 0;
    let alpha = 1;
    if (t.big) {
      scale = age < 350 ? 4 - 3 * (1 - (1 - age / 350) ** 3) : 1;
      if (age < 350 && age > 300) scale = 0.92;
      alpha = age > t.dur - 300 ? (t.dur - age) / 300 : 1;
    } else if (this.reduced) {
      alpha = age < 200 ? age / 200 : age > t.dur - 300 ? (t.dur - age) / 300 : 1;
    } else {
      scale = age < NUMBER.popMs ? 1.5 * (age / NUMBER.popMs) : age < NUMBER.popMs + NUMBER.settleMs ? 1.5 - 0.5 * ((age - NUMBER.popMs) / NUMBER.settleMs) : 1;
      dy = -NUMBER.rise * (1 - (1 - Math.min(1, age / NUMBER.riseMs)) ** 2);
      alpha = age > t.dur - NUMBER.fadeMs ? Math.max(0, (t.dur - age) / NUMBER.fadeMs) : 1;
    }
    g.save();
    g.globalAlpha = Math.max(0, alpha);
    g.translate(t.big ? this.W / 2 : t.x, t.big ? this.H * 0.42 : t.y + dy);
    g.scale(scale, scale);
    g.font = `${t.size}px "Press Start 2P", monospace`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineJoin = "round";
    g.lineWidth = Math.max(3, t.size / 9);
    g.strokeStyle = t.stroke;
    g.strokeText(t.text, 0, 0);
    g.fillStyle = t.fill;
    g.fillText(t.text, 0, 0);
    if (t.strike) {
      const w = g.measureText(t.text).width;
      g.fillRect(-w / 2, -2, w, 4);
    }
    if (t.tag) {
      g.font = `${Math.max(8, t.size * 0.4)}px "Press Start 2P", monospace`;
      g.strokeText(t.tag, 0, t.size * 0.85);
      g.fillStyle = t.tagColor ?? t.fill;
      g.fillText(t.tag, 0, t.size * 0.85);
    }
    g.restore();
  }

  private drawScreen(now: number): void {
    const g = this.screen.getContext("2d")!;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.W, this.H);
    const W = this.W;
    const H = this.H;
    const fk = (now - this.flash.t0) / this.flash.dur;
    if (fk < 1 && this.flash.a > 0) {
      g.globalAlpha = this.flash.a * (1 - fk);
      g.fillStyle = this.flash.color;
      g.fillRect(0, 0, W, H);
    }
    const vk = (now - this.vignette.t0) / this.vignette.dur;
    const lowPulse = this.lowHpPulse ? 0.12 + 0.08 * Math.sin(now / 400) : 0;
    const va = Math.max(vk < 1 ? this.vignette.a * (1 - vk) : 0, lowPulse * this.flashScale);
    if (va > 0) {
      g.globalAlpha = 1;
      const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
      vg.addColorStop(0, "rgba(239,68,68,0)");
      vg.addColorStop(1, `rgba(239,68,68,${va.toFixed(3)})`);
      g.fillStyle = vg;
      g.fillRect(0, 0, W, H);
    }
    if (this.edgeGlow > 0.01) {
      g.globalAlpha = this.edgeGlow * 0.5;
      g.strokeStyle = "#fb923c";
      g.lineWidth = 10;
      g.strokeRect(0, 0, W, H);
      this.edgeGlow *= 0.9;
    }
    if (now < this.speedLines.until && !this.reduced) {
      g.globalAlpha = 0.5;
      g.strokeStyle = "#ffffff";
      g.lineWidth = 2;
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2 + i;
        g.beginPath();
        g.moveTo(W / 2 + Math.cos(a) * W * 0.3, H / 2 + Math.sin(a) * H * 0.3);
        g.lineTo(W / 2 + Math.cos(a) * W, H / 2 + Math.sin(a) * H);
        g.stroke();
      }
    }
    if (now < this.aberration.until && !this.reduced && this.quality === "high") {
      g.globalAlpha = 0.25;
      g.globalCompositeOperation = "lighter";
      g.drawImage(this.fx, this.aberration.px, 0, W, H);
      g.drawImage(this.fx, -this.aberration.px, 0, W, H);
      g.globalCompositeOperation = "source-over";
    }
    g.globalAlpha = 1;
  }
}
