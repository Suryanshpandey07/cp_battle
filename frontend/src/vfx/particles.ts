/**
 * Struct-of-arrays particle pool in typed arrays with a free list. Nothing is
 * allocated inside the frame loop. When the pool is full, smoke is dropped first.
 * Sprites are pre-rendered once to offscreen canvases and drawn with drawImage;
 * fire, sparks and glow use additive blending, smoke and debris normal blending.
 */

export const enum Kind {
  Glow = 0,
  Flame = 1,
  Smoke = 2,
  Spark = 3,
  Square = 4,
  Shard = 5,
  Ring = 6,
  Glyph = 7,
  Streak = 8, // a spark drawn as a line along its velocity: sells speed
  Ember = 9, // a small flickering glow that drifts up
  Debris = 10, // a tumbling rock chip that bounces off the floor
}

export const ADDITIVE = new Set<number>([Kind.Glow, Kind.Flame, Kind.Spark, Kind.Ring, Kind.Streak, Kind.Ember]);

export class Particles {
  readonly cap: number;
  limit: number;
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  ay: Float32Array;
  drag: Float32Array;
  life: Float32Array;
  max: Float32Array;
  s0: Float32Array;
  s1: Float32Array;
  rot: Float32Array;
  vr: Float32Array;
  ramp: Uint8Array; // index into the colour-ramp table
  kind: Uint8Array;
  bounce: Uint8Array;
  floorY: Float32Array;
  alive: Uint8Array;
  private free: Int32Array;
  private freeTop: number;
  count = 0;

  constructor(cap = 2000) {
    this.cap = cap;
    this.limit = cap;
    const f = () => new Float32Array(cap);
    this.x = f();
    this.y = f();
    this.vx = f();
    this.vy = f();
    this.ay = f();
    this.drag = f();
    this.life = f();
    this.max = f();
    this.s0 = f();
    this.s1 = f();
    this.rot = f();
    this.vr = f();
    this.floorY = f();
    this.ramp = new Uint8Array(cap);
    this.kind = new Uint8Array(cap);
    this.bounce = new Uint8Array(cap);
    this.alive = new Uint8Array(cap);
    this.free = new Int32Array(cap);
    for (let i = 0; i < cap; i++) this.free[i] = cap - 1 - i;
    this.freeTop = cap;
  }

  private evictSmoke(): number {
    for (let i = 0; i < this.cap; i++) {
      if (this.alive[i] && this.kind[i] === Kind.Smoke) {
        this.alive[i] = 0;
        this.count--;
        return i;
      }
    }
    return -1;
  }

  spawn(kind: Kind, x: number, y: number, vx: number, vy: number, lifeMs: number, s0: number, s1: number, ramp: number, ay = 0, drag = 0): number {
    let i: number;
    if (this.count >= this.limit || this.freeTop === 0) {
      if (kind === Kind.Smoke) return -1;
      i = this.evictSmoke();
      if (i < 0) return -1;
    } else {
      i = this.free[--this.freeTop];
    }
    this.alive[i] = 1;
    this.count++;
    this.kind[i] = kind;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.ay[i] = ay;
    this.drag[i] = drag;
    this.life[i] = 0;
    this.max[i] = lifeMs;
    this.s0[i] = s0;
    this.s1[i] = s1;
    this.rot[i] = Math.random() * 6.283;
    this.vr[i] = (Math.random() - 0.5) * 8;
    this.ramp[i] = ramp;
    this.bounce[i] = 0;
    this.floorY[i] = 1e9;
    return i;
  }

  setBounce(i: number, floorY: number): void {
    if (i < 0) return;
    this.bounce[i] = 1;
    this.floorY[i] = floorY;
  }

  update(dtMs: number): void {
    const dt = dtMs / 1000;
    for (let i = 0; i < this.cap; i++) {
      if (!this.alive[i]) continue;
      this.life[i] += dtMs;
      if (this.life[i] >= this.max[i]) {
        this.alive[i] = 0;
        this.count--;
        this.free[this.freeTop++] = i;
        continue;
      }
      const d = 1 - this.drag[i] * dt;
      this.vx[i] *= d;
      this.vy[i] = this.vy[i] * d + this.ay[i] * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.rot[i] += this.vr[i] * dt;
      if (this.bounce[i] && this.y[i] > this.floorY[i]) {
        this.y[i] = this.floorY[i];
        this.vy[i] *= -0.45;
        this.vx[i] *= 0.7;
        this.bounce[i] = 0;
      }
    }
  }

  clear(): void {
    this.alive.fill(0);
    this.count = 0;
    for (let i = 0; i < this.cap; i++) this.free[i] = this.cap - 1 - i;
    this.freeTop = this.cap;
  }
}

/* Pre-rendered sprites -------------------------------------------------------- */

const spriteCache = new Map<string, HTMLCanvasElement>();

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return [c, c.getContext("2d")!];
}

/** A soft radial glow in one colour, rendered once per colour. */
export function glowSprite(color: string): HTMLCanvasElement {
  const key = `g:${color}`;
  let c = spriteCache.get(key);
  if (!c) {
    const [cv, g] = makeCanvas(64);
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, color);
    grad.addColorStop(0.35, color + "aa");
    grad.addColorStop(1, color + "00");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    spriteCache.set(key, cv);
    c = cv;
  }
  return c;
}

/** A lumpy flame puff (three overlapping blobs). */
export function puffSprite(color: string): HTMLCanvasElement {
  const key = `p:${color}`;
  let c = spriteCache.get(key);
  if (!c) {
    const [cv, g] = makeCanvas(64);
    for (const [x, y, r] of [
      [28, 34, 20],
      [38, 30, 16],
      [32, 24, 14],
    ]) {
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, color + "ee");
      grad.addColorStop(1, color + "00");
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    spriteCache.set(key, cv);
    c = cv;
  }
  return c;
}

export function squareSprite(color: string): HTMLCanvasElement {
  const key = `s:${color}`;
  let c = spriteCache.get(key);
  if (!c) {
    const [cv, g] = makeCanvas(8);
    g.fillStyle = color;
    g.fillRect(0, 0, 8, 8);
    spriteCache.set(key, cv);
    c = cv;
  }
  return c;
}

/** An irregular rock chip with a lit edge, rendered once per colour. */
export function debrisSprite(color: string): HTMLCanvasElement {
  const key = `d:${color}`;
  let c = spriteCache.get(key);
  if (!c) {
    const [cv, g] = makeCanvas(16);
    g.fillStyle = color;
    g.beginPath();
    const pts = [
      [2, 6],
      [6, 1],
      [12, 2],
      [15, 8],
      [11, 14],
      [4, 13],
    ];
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fill();
    g.fillStyle = "rgba(255,255,255,0.25)";
    g.beginPath();
    g.moveTo(6, 1);
    g.lineTo(12, 2);
    g.lineTo(9, 6);
    g.closePath();
    g.fill();
    spriteCache.set(key, cv);
    c = cv;
  }
  return c;
}

/** Small noise table for flicker and turbulence. */
export const NOISE = (() => {
  const n = new Float32Array(256);
  let s = 1337;
  for (let i = 0; i < 256; i++) {
    s = (s * 16807) % 2147483647;
    n[i] = (s / 2147483647) * 2 - 1;
  }
  return n;
})();

export function noise(t: number): number {
  const i = Math.floor(t) & 255;
  const f = t - Math.floor(t);
  return NOISE[i] * (1 - f) + NOISE[(i + 1) & 255] * f;
}
