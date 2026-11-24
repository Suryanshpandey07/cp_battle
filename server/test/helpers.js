// Shared test harness: an in-memory database seeded once, FakeClock + FakeRunner
// contexts, fake sockets and a two-player "arena" (as the old engine conftest).

import { buildContext } from '../src/app.js';
import { FakeClock } from '../src/clock.js';
import { getGameConfig } from '../src/config.js';
import { Judge } from '../src/judge/index.js';
import { FakeRunner } from '../src/judge/runners.js';
import { Connection } from '../src/realtime/hub.js';
import { setLevel } from '../src/log.js';
import { hashPassword } from '../src/security.js';
import { ensureBots, loadProblemFiles, upsertProblem } from '../src/seed.js';
import { MemoryDb } from '../src/db/memory.js';
import { RAW_HANDLERS } from '../src/db/memory-sql.js';

process.env.ENV = process.env.ENV || 'test';
if (!process.env.LOG_LEVEL) process.env.LOG_LEVEL = 'ERROR';
setLevel(process.env.LOG_LEVEL);

let seeded = null;
let names = 0;
let pwHash = null;

/** A fresh in-memory database with the seed problems and bot profiles. */
export async function seededDb() {
  const db = new MemoryDb(RAW_HANDLERS);
  const cfg = getGameConfig();
  if (!seeded) seeded = loadProblemFiles();
  for (const data of seeded) await upsertProblem(db, data, cfg);
  await ensureBots(db, cfg);
  return db;
}

export async function makePlayer(db, rating = 1200, name = null) {
  name = name || `p${names++}x${rating}`;
  pwHash = pwHash || (await hashPassword('unused-pass'));
  const u = await db.user.create({ data: { username: name, username_lower: name.toLowerCase(), password_hash: pwHash } });
  return db.profile.create({ data: { user_id: u.id, display_name: name, rating, peak_rating: rating } });
}

export class FakeWS {
  constructor() {
    this.sent = [];
    this.closedWith = null;
  }

  async send(text) {
    this.sent.push(JSON.parse(text));
  }

  async close(code = 1000) {
    this.closedWith = code;
  }

  types() {
    return this.sent.map((m) => m.type);
  }

  of(type) {
    return this.sent.filter((m) => m.type === type);
  }

  last(type) {
    const all = this.of(type);
    return all[all.length - 1];
  }
}

export function testContext(db, clock = new FakeClock()) {
  const cfg = getGameConfig();
  return buildContext({ db, clock, judge: new Judge(new FakeRunner('test'), cfg), cfg });
}

/** A started two-player match with both sockets connected. */
export class Arena {
  constructor(ctx, actor, clock, ws) {
    Object.assign(this, { ctx, actor, clock, ws });
    this.n = 0;
  }

  cmd() {
    return `cmd-${this.n++}`;
  }

  settle() {
    return this.actor.settle();
  }

  async advance(seconds) {
    let left = seconds;
    while (left > 1e-9) {
      const dt = Math.min(0.5, left);
      this.clock.advance(dt);
      left -= dt;
      await this.settle();
    }
  }

  submit(side, slot, verdict = 'AC', cmdId = null, extra = '') {
    const code = `# VERDICT: ${verdict}\n# DELAY_MS: 0\nprint(1)\n${extra}`;
    return this.actor.send('submit', side, { slot, code, language: 'python' }, cmdId || this.cmd());
  }

  async submitAndJudge(side, slot, verdict = 'AC') {
    const r = await this.submit(side, slot, verdict);
    await this.settle();
    return r;
  }

  slotWithTier(side, tier) {
    return this.actor.hands[side].tiers.indexOf(tier);
  }

  hp(side) {
    return this.actor.m[`player${side}_hp`];
  }
}

const contexts = [];

export async function makeArena({ r1 = 1200, r2 = 1200, mode = 'ranked', map = 'bit', seed = 7, connect = true, botPersonality = null, db = null } = {}) {
  db = db || (await seededDb());
  const clock = new FakeClock();
  const ctx = testContext(db, clock);
  contexts.push(ctx);
  await ctx.problems.reload(db);
  const p1 = await makePlayer(db, r1);
  let actor;
  if (mode === 'bot' || mode === 'practice') {
    const p2 = await ctx.matches.botProfile(mode === 'bot' ? botPersonality : 'dummy');
    actor = await ctx.matches.createMatch(mode, map, p1, p2, { opponentKind: mode === 'bot' ? 'bot' : 'dummy', seed });
  } else {
    const p2 = await makePlayer(db, r2);
    actor = await ctx.matches.createMatch(mode, map, p1, p2, { seed });
  }
  const ws = {};
  const arena = new Arena(ctx, actor, clock, ws);
  if (connect) {
    for (const side of [1, 2]) {
      if (!actor.m[`player${side}_is_bot`]) {
        ws[side] = new FakeWS();
        await actor.send('join', side, { conn: new Connection(ws[side], 0), last_seq: 0 });
      }
    }
    await arena.settle();
    await arena.advance(3.1);
    if (actor.m.status !== 'live') throw new Error(`match is ${actor.m.status}, not live`);
  }
  return arena;
}

export async function closeAll() {
  for (const ctx of contexts.splice(0)) {
    ctx.matchmaker.stop();
    await ctx.matches.shutdown();
    ctx.judge.stop();
  }
}

// ---------------------------------------------------------------------------- HTTP
/** A real HTTP + WebSocket server on a free port over an in-memory database. */
export async function startServer({ db = null } = {}) {
  const { start } = await import('../src/app.js');
  const { RealClock } = await import('../src/clock.js');
  db = db || (await seededDb());
  const ctx = testContext(db, new RealClock());
  const running = await start({ ctx, port: 0, host: '127.0.0.1' });
  const { port } = running.server.address();
  return { base: `http://127.0.0.1:${port}`, ws: `ws://127.0.0.1:${port}`, ctx, db, stop: running.stop };
}

/** fetch with a tiny cookie jar, like a browser on one site. */
export class Client {
  constructor(base) {
    this.base = base;
    this.cookies = new Map();
  }

  async request(method, path, { json, headers = {} } = {}) {
    const h = { ...headers };
    if (json !== undefined) h['content-type'] = 'application/json';
    if (this.cookies.size) h.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const r = await fetch(this.base + path, { method, headers: h, body: json === undefined ? undefined : JSON.stringify(json) });
    for (const c of r.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      const k = kv.slice(0, i);
      const v = kv.slice(i + 1);
      if (!v || /Expires=Thu, 01 Jan 1970/.test(c)) this.cookies.delete(k);
      else this.cookies.set(k, v);
    }
    const text = await r.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return { status: r.status, headers: r.headers, body };
  }

  get(path, o) { return this.request('GET', path, o); }

  post(path, o) { return this.request('POST', path, o); }

  put(path, o) { return this.request('PUT', path, o); }

  patch(path, o) { return this.request('PATCH', path, o); }

  delete(path, o) { return this.request('DELETE', path, o); }
}

export const H = (tok) => ({ headers: { authorization: `Bearer ${tok}` } });
export const HJ = (tok, json) => ({ headers: { authorization: `Bearer ${tok}` }, json });

/** A WebSocket client that queues messages so tests can wait for a type. */
export function openSocket(url) {
  const ws = new WebSocket(url);
  const queue = [];
  const waiters = [];
  let closeCode = null;
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    const w = waiters.shift();
    if (w) w(msg); else queue.push(msg);
  });
  ws.addEventListener('close', (ev) => {
    closeCode = ev.code;
    for (const w of waiters.splice(0)) w(null);
  });
  const next = (timeoutMs) => new Promise((resolve, reject) => {
    if (queue.length) return resolve(queue.shift());
    if (closeCode !== null) return resolve(null);
    const t = setTimeout(() => reject(new Error('timed out waiting for a message')), timeoutMs);
    waiters.push((m) => { clearTimeout(t); resolve(m); });
    return undefined;
  });
  return {
    opened: new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); }),
    send: (obj) => ws.send(JSON.stringify(obj)),
    close: () => ws.close(),
    get closeCode() { return closeCode; },
    closed: new Promise((resolve) => ws.addEventListener('close', (ev) => resolve(ev.code))),
    async until(type, limit = 200, timeoutMs = 15_000) {
      for (let i = 0; i < limit; i++) {
        const m = await next(timeoutMs);
        if (m === null) throw new Error(`socket closed (${closeCode}) before ${type}`);
        if (m.type === type) return m;
      }
      throw new Error(`never saw ${type}`);
    },
  };
}
