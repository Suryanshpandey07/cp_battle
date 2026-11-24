// The match actor: one per live match, the only code allowed to change HP,
// shields, hands or match status.
//
// Every input arrives as a command on the actor's queue and is handled one at a
// time. A command is validated, applied to in-memory state (the rules come from
// src/domain), persisted together with its match_events rows in one
// transaction, and only then broadcast. A rejected command changes nothing and
// broadcasts nothing. Judging never blocks the actor: verdicts come back later
// as their own command and are re-validated.

import { randomBytes } from 'node:crypto';
import { AppError, RuleError } from '../errors.js';
import { feature } from '../domain/gameconfig.js';
import * as H from '../domain/hand.js';
import * as R from '../domain/rules.js';
import { PyRandom } from '../pyrandom.js';
import { envelope } from '../realtime/hub.js';
import { inTx } from '../db.js';
import { judgeFull, validateCode, validateLanguage } from '../services/judging.js';
import { summarize, systemError } from '../judge/index.js';
import { applyStrikes, finishTx } from './finish.js';
import { makeBrain } from './bots.js';
import { side as sideOf } from './side.js';
import { log } from '../log.js';

const LIVE_STATES = ['starting', 'live'];

class AsyncQueue {
  constructor() {
    this.items = [];
    this.waiters = [];
  }

  put(x) {
    const w = this.waiters.shift();
    if (w) w(x); else this.items.push(x);
  }

  get() {
    if (this.items.length) return Promise.resolve(this.items.shift());
    return new Promise((r) => this.waiters.push(r));
  }

  get empty() {
    return this.items.length === 0;
  }
}

function newRuntime() {
  return {
    inflight: null, inflightSlot: null, cooldownUntilMs: 0, cmdCache: new Map(), disconnectTimer: null,
    dealtAtMs: [0, 0, 0, 0], lastEmoteMs: -1e9, judging: null, everConnected: false,
  };
}

const SUB_FIELDS = ['match_id', 'profile_id', 'problem_id', 'slot', 'language', 'code', 'cmd_id', 'status', 'verdict',
  'failed_test', 'tests_passed', 'tests_total', 'time_ms', 'memory_kb', 'damage', 'recoil', 'blocked', 'crit', 'is_bot', 'created_at'];
const subData = (sub) => Object.fromEntries(SUB_FIELDS.map((k) => [k, sub[k]]));
const fingerprint = (v) => JSON.stringify(v instanceof Date ? v.toISOString() : v);

/** The match columns that changed since the last save (only those are written). */
function changedColumns(m, saved) {
  const d = {};
  for (const [k, v] of Object.entries(m)) if (k !== 'id' && saved.get(k) !== fingerprint(v)) d[k] = v;
  return d;
}
const snapshotColumns = (m) => new Map(Object.entries(m).map(([k, v]) => [k, fingerprint(v)]));

export class MatchActor {
  constructor(svc, m) {
    this.svc = svc;
    this.cfg = svc.cfg;
    this.clock = svc.clock;
    this.hub = svc.hub;
    this.db = svc.db;
    this.m = m;
    this.id = m.id;
    this.queue = new AsyncQueue();
    this.saved = snapshotColumns(m); // the row as last written
    this.decks = Object.fromEntries(Object.entries(m.decks || {}).map(([k, v]) => [Number(k), [...v]]));
    this.hands = { 1: H.handFromJson(m.player1_hand), 2: H.handFromJson(m.player2_hand) };
    this.rt = { 1: newRuntime(), 2: newRuntime() };
    this.createdMs = this.clock.nowMs();
    this.liveMs = null;
    this.timers = new Map();
    this.busy = false;
    this.stopped = false;
    this.finished = !LIVE_STATES.includes(m.status);
    this.rng = new PyRandom(m.seed);
    this.bots = {};
    this.loop = null;
    this._reset();
  }

  _reset() {
    this._events = [];
    this._transient = [];
    this._tx = [];
    this._after = [];
    this._pendingSubmissions = [];
  }

  // ------------------------------------------------------------------ plumbing
  start() {
    this.loop = this.run();
    if (!this.finished) {
      this._schedule('connect_timeout', this.cfg.match.connect_grace_s, 'connect_timeout');
      for (const s of [1, 2]) {
        if (this.side(s).is_bot) {
          this.side(s).connected = true;
          this.rt[s].everConnected = true;
        }
      }
      for (const s of [1, 2]) {
        const brain = makeBrain(this, s);
        if (brain) this.bots[s] = brain;
      }
      this._maybeCountdown();
    }
  }

  async stop() {
    this.stopped = true;
    for (const t of this.timers.values()) t.cancel();
    this.timers.clear();
    for (const rt of Object.values(this.rt)) if (rt.judging) rt.judging.cancelled = true;
    this.queue.put(null); // wake the loop so it can exit
  }

  enqueue(cmd) {
    if (!this.stopped) this.queue.put(cmd);
  }

  enqueueCmd(kind, side, data = {}) {
    this.enqueue({ kind, side, data, cmdId: null });
  }

  /** Queue a command and wait for its result (or its RuleError). */
  send(kind, side, data = {}, cmdId = null) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new AppError('server_error', 'The match did not answer in time')), 30_000);
      if (t.unref) t.unref();
      this.enqueue({
        kind, side, data, cmdId,
        reply: (v) => { clearTimeout(t); resolve(v); },
        fail: (e) => { clearTimeout(t); reject(e); },
      });
    });
  }

  /** Tests: wait until the queue is drained and no judging is in flight. */
  async settle(rounds = 400) {
    for (let i = 0; i < rounds; i++) {
      await new Promise((r) => setImmediate(r));
      const judging = Object.values(this.rt).some((rt) => rt.judging && !rt.judging.done);
      if (this.queue.empty && !this.busy && !judging && this.svc.judge.idle) {
        await new Promise((r) => setImmediate(r));
        if (this.queue.empty && !this.busy) return;
      }
      await new Promise((r) => setTimeout(r, 2));
    }
  }

  side(n) {
    return sideOf(this.m, n);
  }

  sideOf(profileId) {
    if (this.m.player1_profile_id === profileId && !this.m.player1_is_bot) return 1;
    if (this.m.player2_profile_id === profileId && !this.m.player2_is_bot) return 2;
    return null;
  }

  now() {
    return this.clock.nowMs();
  }

  elapsedMs() {
    if (this.liveMs === null) return 0;
    if (this.finished) return this.m.elapsed_ms;
    return Math.max(0, this.now() - this.liveMs);
  }

  _schedule(key, delayS, kind, data = {}) {
    const old = this.timers.get(key);
    if (old) old.cancel();
    this.timers.set(key, this.clock.callLater(delayS, () => this.enqueue({ kind: 'tick', side: 0, data: { kind, ...data } })));
  }

  _cancel(key) {
    const t = this.timers.get(key);
    if (t) {
      t.cancel();
      this.timers.delete(key);
    }
  }

  emit(type, data, vis = 'both') {
    this.m.last_seq += 1;
    const ev = { type, data, vis, seq: this.m.last_seq, t_ms: this.now() - this.createdMs };
    this._events.push(ev);
    return ev;
  }

  transient(side, type, data) {
    this._transient.push([side, envelope(type, data)]);
  }

  stat(side, key, delta = 1) {
    const s = { ...(this.side(side).stats || {}) };
    s[key] = (s[key] || 0) + delta;
    this.side(side).stats = s;
  }

  statSet(side, key, value) {
    this.side(side).stats = { ...(this.side(side).stats || {}), [key]: value };
  }

  statGet(side, key, dflt = 0) {
    const v = (this.side(side).stats || {})[key];
    return v === undefined ? dflt : v;
  }

  // ------------------------------------------------------------------ main loop
  async run() {
    while (!this.stopped) {
      const cmd = await this.queue.get();
      if (cmd === null || this.stopped) break;
      this.busy = true;
      try {
        await this._process(cmd);
      } catch (e) { // never let one command kill the match
        log.error('actor command failed', { match: this.id, error: String(e && e.stack ? e.stack : e) });
        if (cmd.fail) cmd.fail(new AppError('server_error', 'Internal error'));
      } finally {
        this.busy = false;
      }
    }
  }

  async _process(cmd) {
    const rt = this.rt[cmd.side];
    if (cmd.cmdId && rt && rt.cmdCache.has(cmd.cmdId)) {
      const cached = rt.cmdCache.get(cmd.cmdId);
      if (cached instanceof Error) cmd.fail?.(cached); else cmd.reply?.(cached);
      return;
    }
    this._reset();
    let result;
    try {
      if (cmd.kind === 'join') {
        result = await this._join(cmd);
      } else {
        const handler = this[`_cmd_${cmd.kind}`];
        if (!handler) throw new RuleError('validation', `unknown command ${cmd.kind}`);
        result = await handler.call(this, cmd);
      }
    } catch (e) {
      if (e instanceof RuleError) {
        if (cmd.cmdId && rt) this._remember(rt, cmd.cmdId, e);
        cmd.fail?.(e);
        return;
      }
      throw e;
    }
    if (this._events.length || this._tx.length || this._pendingSubmissions.length) {
      try {
        await inTx(this.db, (tx) => this._persist(tx));
        this.saved = snapshotColumns(this.m);
      } catch (e) {
        log.error('persist failed; aborting the match', { match: this.id, error: String(e && e.stack ? e.stack : e) });
        cmd.fail?.(new AppError('server_error', 'Could not save the match'));
        await this._failSafe();
        return;
      }
      for (const ev of this._events) await this.hub.broadcast(this.id, ev.vis, envelope(ev.type, ev.data, ev.seq));
    }
    for (const [side, msg] of this._transient) await this.hub.sendSide(this.id, side, msg);
    for (const fn of this._after) fn();
    if (cmd.cmdId && rt) this._remember(rt, cmd.cmdId, result);
    cmd.reply?.(result);
  }

  /** In-memory state may no longer match the database: abort the match. */
  async _failSafe() {
    if (this.finished) return;
    this._reset();
    this._abort('server_error');
    try {
      await this.db.match.updateMany({
        where: { id: this.id },
        data: { status: 'aborted', end_reason: 'aborted', outcome: 'aborted', result: this.m.result, last_seq: this.m.last_seq },
      });
    } catch (e) {
      log.error('could not record the aborted match', { match: this.id, error: String(e) });
    }
    for (const ev of this._events) await this.hub.broadcast(this.id, ev.vis, envelope(ev.type, ev.data, ev.seq));
    for (const fn of this._after) fn();
  }

  _remember(rt, cmdId, value) {
    rt.cmdCache.set(cmdId, value);
    while (rt.cmdCache.size > 256) rt.cmdCache.delete(rt.cmdCache.keys().next().value);
  }

  async _persist(tx) {
    for (const fn of this._tx) await fn(tx);
    const changed = changedColumns(this.m, this.saved);
    if (Object.keys(changed).length) await tx.match.update({ where: { id: this.id }, data: changed, select: { id: true } });
    for (const sub of new Set(this._pendingSubmissions)) {
      const data = subData(sub);
      if (sub.id === null || sub.id === undefined) {
        const row = await tx.submission.create({ data, select: { id: true } });
        sub.id = row.id;
      } else {
        const changed = Object.fromEntries(Object.entries(data).filter(([k, v]) => sub.saved.get(k) !== fingerprint(v)));
        if (Object.keys(changed).length) await tx.submission.update({ where: { id: sub.id }, data: changed, select: { id: true } });
      }
      // Not enumerable, so it never reaches a payload or the database.
      Object.defineProperty(sub, 'saved', { value: new Map(Object.entries(data).map(([k, v]) => [k, fingerprint(v)])), writable: true, configurable: true });
    }
    if (this._events.length) {
      for (const ev of this._events) {
        if (ev.data.submission_id === 'pending' && this._pendingSubmissions.length) ev.data.submission_id = this._pendingSubmissions[0].id;
      }
      await tx.matchEvent.createMany({
        data: this._events.map((ev) => ({ match_id: this.id, seq: ev.seq, t_ms: ev.t_ms, type: ev.type, payload: ev.data, visibility: ev.vis })),
      });
    }
  }

  // ------------------------------------------------------------------ views
  playerView(n) {
    const sd = this.side(n);
    const shield = sd.shield_until_ms;
    const active = R.shieldActive(shield, this.now());
    return {
      side: n, profile_id: sd.profile_id, name: sd.name, rating: sd.rating, tier: sd.tier,
      max_hp: sd.max_hp, hp: sd.hp, skins: sd.skins || {}, is_bot: sd.is_bot,
      connected: Boolean(sd.connected), hits_landed: sd.hits_landed, damage_dealt: sd.damage_dealt,
      shield_ms_left: active && shield ? Math.max(0, shield - this.now()) : 0,
      judging: this.rt[n].inflight !== null,
    };
  }

  card(n, slot) {
    const hand = this.hands[n];
    const slug = hand.slots[slot];
    const tier = hand.tiers[slot];
    if (slug === null) {
      return { slot, tier, problem: null, preview: null, pending: true, level: H.difficultyLevel(this.side(n).tier, tier, this.cfg) };
    }
    const p = this.svc.problems.get(slug);
    const pv = R.computePreview(this.side(n).tier, p.tier, p.base_damage, p.base_recoil, this.cfg);
    const revealed = (this.side(n).hints_revealed || {})[slug] ?? 0;
    return {
      slot, tier, pending: false,
      level: H.difficultyLevel(this.side(n).tier, p.tier, this.cfg),
      problem: { slug: p.slug, title: p.title, tier: p.tier, biome: p.biome, tags: revealed >= 1 ? p.tags : [] },
      preview: { damage: pv.damage, recoil: pv.recoil, tier_diff: pv.tier_diff, scenario: pv.scenario, crit: pv.crit, dmg_pct: pv.dmg_pct, recoil_pct: pv.recoil_pct },
      hints_revealed: revealed,
    };
  }

  handView(n) {
    return this.hands[n].slots.map((_, i) => this.card(n, i));
  }

  clockView() {
    return {
      status: this.m.status, elapsed_ms: this.elapsedMs(), server_time_ms: this.clock.wallMs(),
      max_ms: this.cfg.match.max_minutes * 60_000, bracket: R.speedBracket(Math.floor(this.elapsedMs() / 1000), this.cfg),
    };
  }

  snapshot(n) {
    const sd = this.side(n);
    const rt = this.rt[n];
    const hints = {};
    for (const [slug, lvl] of Object.entries(sd.hints_revealed || {})) {
      const p = this.svc.problems.get(slug);
      if (p) hints[slug] = p.hints.slice(0, lvl);
    }
    let nextRerollMs = 0;
    if (sd.last_reroll_ms !== null && sd.last_reroll_ms !== undefined) {
      nextRerollMs = Math.max(0, sd.last_reroll_ms + this.cfg.hand.reroll_gap_s * 1000 - this.now());
    }
    return {
      match: { id: this.id, mode: this.m.mode, map: this.m.map, status: this.m.status, stage: this.stageView() },
      you: n,
      players: [this.playerView(1), this.playerView(2)],
      clock: this.clockView(),
      hand: this.handView(n),
      charges: { blocks_left: sd.blocks_left, hints_left: sd.hints_left, rerolls_left: sd.rerolls_left, next_reroll_ms: nextRerollMs },
      hints,
      cooldown_ms: Math.max(0, rt.cooldownUntilMs - this.now()),
      inflight: rt.inflight ? { submission_id: rt.inflight.id, slot: rt.inflightSlot } : null,
      seq: this.m.last_seq,
      result: this.finished ? this.m.result : null,
    };
  }

  stageView() {
    const owner = this.m.stage_owner_side;
    return { theme: this.m.stage_theme, owner_side: owner, owner_name: owner ? this.side(owner).name : null };
  }

  startedPayload() {
    return { players: [this.playerView(1), this.playerView(2)], mode: this.m.mode, map: this.m.map, stage: this.stageView(), clock: this.clockView() };
  }

  // ------------------------------------------------------------------ connect / resume
  async _join(cmd) {
    const n = cmd.side;
    const conn = cmd.data.conn;
    const lastSeq = parseInt(cmd.data.last_seq || 0, 10) || 0;
    const old = this.hub.attach(this.id, n, conn);
    if (old) {
      await old.send(envelope('session.moved', { reason: 'session_moved', message: 'This match was opened in another tab.' }));
      await old.close(4001);
    }
    const sd = this.side(n);
    const rt = this.rt[n];
    const wasConnected = Boolean(sd.connected);
    sd.connected = true;
    rt.everConnected = true;
    if (rt.disconnectTimer !== null) {
      this._cancel(`disconnect:${n}`);
      rt.disconnectTimer = null;
      if (this.m.status === 'live' && !wasConnected) this.emit('player.reconnected', { side: n }, `p${3 - n}`);
    }
    // Resume: replay missed events this side may see, or a snapshot.
    const gap = this.m.last_seq - lastSeq;
    if (lastSeq <= 0 || gap > this.cfg.match.snapshot_gap) {
      await conn.send(envelope('state.snapshot', this.snapshot(n), this.m.last_seq));
    } else if (gap > 0) {
      const rows = await this.db.matchEvent.findMany({ where: { match_id: this.id, seq: { gt: lastSeq } }, orderBy: { seq: 'asc' } });
      for (const e of rows) if (e.visibility === 'both' || e.visibility === `p${n}`) await conn.send(envelope(e.type, e.payload, e.seq));
    }
    if (!this.finished) this._maybeCountdown();
    return { ok: true };
  }

  _cmd_leave(cmd) {
    const n = cmd.side;
    if (!this.hub.detach(this.id, n, cmd.data.conn)) return { ok: true }; // an old, replaced socket
    this.side(n).connected = false;
    if (this.m.status === 'live') {
      const grace = this.cfg.match.disconnect_grace_s;
      this.emit('player.disconnected', { side: n, grace_s: grace }, `p${3 - n}`);
      this.rt[n].disconnectTimer = true;
      this._schedule(`disconnect:${n}`, grace, 'disconnect_timeout', { side: n });
    }
    return { ok: true };
  }

  _maybeCountdown() {
    if (this.m.status !== 'starting' || this.timers.has('countdown')) return;
    if (!(this.side(1).connected && this.side(2).connected)) return;
    this._cancel('connect_timeout');
    const n = this.cfg.match.countdown_s;
    this.emit('match.countdown', { n });
    this._schedule('countdown', 1, 'countdown', { n: n - 1 });
  }

  // ------------------------------------------------------------------ ticks
  _cmd_tick(cmd) {
    const kind = cmd.data.kind;
    if (kind === 'countdown') {
      this.timers.delete('countdown');
      const n = cmd.data.n;
      if (this.m.status !== 'starting') return null;
      this.emit('match.countdown', { n });
      if (n > 0) this.timers.set('countdown', this.clock.callLater(1, () => this.enqueue({ kind: 'tick', side: 0, data: { kind: 'countdown', n: n - 1 } })));
      else this._goLive();
      return null;
    }
    if (this.finished) return null;
    if (kind === 'connect_timeout') {
      if (this.m.status === 'starting') {
        const absent = [1, 2].filter((s) => !this.rt[s].everConnected);
        this._abort('no_show', absent.length ? absent : [1, 2]);
      }
    } else if (kind === 'timer_end') {
      if (this.m.status === 'live') this._end('timer');
    } else if (kind === 'timer_broadcast') {
      if (this.m.status === 'live') {
        this.emit('match.timer', this.clockView());
        this._schedule('timer_broadcast', this.cfg.match.timer_broadcast_s, 'timer_broadcast');
      }
    } else if (kind === 'shield_expire') {
      const n = cmd.data.side;
      const sd = this.side(n);
      if (sd.shield_until_ms !== null && sd.shield_until_ms !== undefined && sd.shield_until_ms <= this.now()) {
        sd.shield_until_ms = null;
        this.emit('shield.expired', { side: n });
      }
    } else if (kind === 'redeal') {
      const { side: n, slot } = cmd.data;
      if (this.m.status === 'live' && this.hands[n].slots[slot] === null) {
        this.hands[n] = H.fillSlot(this.hands[n], this.decks, slot);
        this.side(n).hand = H.handToJson(this.hands[n]);
        this.rt[n].dealtAtMs[slot] = this.now();
        this.emit('card.dealt', { card: this.card(n, slot) }, `p${n}`);
      }
    } else if (kind === 'disconnect_timeout') {
      const n = cmd.data.side;
      this.timers.delete(`disconnect:${n}`);
      if (this.m.status === 'live' && !this.side(n).connected) {
        if (!this.side(3 - n).connected && !this.side(3 - n).is_bot) this._abort('both_disconnected');
        else if (this._earlyLeave()) this._abort('early_leave', [n]);
        else this._end('disconnect', n);
      }
    } else if (kind === 'bot') {
      const brain = this.bots[cmd.data.side];
      if (brain && this.m.status === 'live') brain.onTick(cmd.data);
    } else if (kind === 'bot_verdict') {
      const n = cmd.data.side;
      if (this.rt[n].inflight && this.rt[n].inflight === cmd.data.submission) this._resolve(n, cmd.data.result, cmd.data.total);
    }
    return null;
  }

  _goLive() {
    this.m.status = 'live';
    this.m.start_time = new Date();
    this.liveMs = this.now();
    for (const n of [1, 2]) this.rt[n].dealtAtMs = this.hands[n].slots.map(() => this.liveMs);
    this.emit('match.started', this.startedPayload());
    for (const n of [1, 2]) if (!this.side(n).is_bot) this.emit('hand.updated', { cards: this.handView(n) }, `p${n}`);
    this._schedule('timer_end', this.cfg.match.max_minutes * 60, 'timer_end');
    this._schedule('timer_broadcast', this.cfg.match.timer_broadcast_s, 'timer_broadcast');
    for (const brain of Object.values(this.bots)) this._after.push(() => brain.onLive());
  }

  // ------------------------------------------------------------------ validation helpers
  _requireLive() {
    if (this.m.status !== 'live' || this.finished) throw new RuleError('match_not_live', 'The match is not live');
  }

  _requireCard(n, slot) {
    if (!(slot >= 0 && slot < this.hands[n].slots.length)) throw new RuleError('not_in_hand', 'No such card slot');
    const slug = this.hands[n].slots[slot];
    if (slug === null) throw new RuleError('not_in_hand', 'That card is being re-dealt');
    return slug;
  }

  /** Read-only lookup for the Run endpoint (no state change). */
  cardSlug(n, slot) {
    return this._requireCard(n, slot);
  }

  // ------------------------------------------------------------------ submit
  async _cmd_submit(cmd) {
    const n = cmd.side;
    this._requireLive();
    const slot = parseInt(cmd.data.slot, 10);
    const slug = this._requireCard(n, slot);
    if (cmd.data.problem && cmd.data.problem !== slug) throw new RuleError('not_in_hand', 'That card is no longer in your hand');
    const rt = this.rt[n];
    if (rt.inflight) throw new RuleError('busy', 'You already have a submission being judged');
    const wait = rt.cooldownUntilMs - this.now();
    if (wait > 0) throw new RuleError('cooldown', 'Submit is cooling down', { retry_after: wait / 1000 });
    const code = cmd.data.code;
    const language = cmd.data.language || 'python';
    const simulated = Boolean(cmd.data.simulated);
    if (!simulated) {
      try {
        await validateLanguage(language, this.cfg, this.svc.judge);
        validateCode(code, this.cfg);
      } catch (e) {
        if (e instanceof AppError) throw new RuleError(e.code, e.message);
        throw e;
      }
    }
    const p = this.svc.problems.get(slug);
    const sub = {
      id: null, match_id: this.id, profile_id: this.side(n).profile_id, problem_id: p.id, slot, language, code,
      cmd_id: cmd.cmdId || `auto-${randomBytes(16).toString('hex')}`, status: 'judging', verdict: null, failed_test: null,
      tests_passed: 0, tests_total: 0, time_ms: 0, memory_kb: 0, damage: 0, recoil: 0, blocked: false, crit: false,
      is_bot: simulated, created_at: new Date(),
    };
    this._pendingSubmissions.push(sub);
    rt.inflight = sub;
    rt.inflightSlot = slot;
    this.stat(n, 'submissions');
    const total = p.allTests.length;
    this.emit('submission.accepted', { submission_id: 'pending', slot, problem: slug, total, queue_position: this.svc.judge.queued }, `p${n}`);
    this.transient(3 - n, 'opponent.activity', { side: n, state: 'judging' });
    if (simulated) this._after.push(() => this.bots[n] && this.bots[n].onSubmitted(sub, total));
    else this._after.push(() => this._startJudging(n, sub, p, language, code));
    return { submission_id_pending: true, slot, _sub: sub };
  }

  _startJudging(n, sub, problem, language, code) {
    const job = { cancelled: false, done: false };
    this.rt[n].judging = job;
    const total = problem.allTests.length;
    const onProgress = async (v) => {
      if (this.rt[n].inflight === sub) {
        await this.hub.sendSide(this.id, n, envelope('submission.progress', {
          submission_id: sub.id, index: v.index, code: v.code, passed: v.code === 'AC' ? v.index + 1 : v.index, total,
        }));
      }
    };
    (async () => {
      let res;
      let tot = total;
      try {
        [res, tot] = await judgeFull(this.svc.judge, this.cfg, problem, language, code, onProgress);
      } catch (e) {
        if (!(e instanceof AppError)) log.error('judging failed', { match: this.id, error: String(e && e.stack ? e.stack : e) });
        res = systemError(e instanceof AppError ? 'judge busy' : 'judge failure');
      }
      job.done = true;
      if (!job.cancelled) this.enqueue({ kind: 'verdict', side: n, data: { submission: sub, result: res, total: tot } });
    })();
  }

  _cmd_verdict(cmd) {
    const n = cmd.side;
    if (this.rt[n].inflight !== cmd.data.submission) return null;
    this._resolve(n, cmd.data.result, cmd.data.total);
    return null;
  }

  /** A verdict re-enters the actor: re-validate, then hit, block or backfire. */
  _resolve(n, res, total) {
    const rt = this.rt[n];
    const sub = rt.inflight;
    const slot = rt.inflightSlot !== null ? rt.inflightSlot : sub.slot;
    rt.inflight = null;
    rt.inflightSlot = null;
    this._pendingSubmissions.push(sub);
    const [verdict, failed, passed] = summarize(res, total);
    const verdicts = res.verdicts || [];
    sub.verdict = verdict;
    sub.failed_test = failed;
    sub.tests_passed = passed;
    sub.tests_total = total;
    sub.time_ms = verdicts.reduce((a, v) => Math.max(a, v.time_ms || 0), 0);
    sub.memory_kb = verdicts.reduce((a, v) => Math.max(a, v.memory_kb || 0), 0);
    const other = 3 - n;
    const base = {
      submission_id: sub.id, slot, verdict, failed_test: failed, passed, total, time_ms: sub.time_ms,
      memory_kb: sub.memory_kb, compile_error: res.compile_error || null,
    };
    this.transient(other, 'opponent.activity', { side: n, state: 'editor' });

    if (this.finished || this.m.status !== 'live') {
      sub.status = 'void';
      this.emit('submission.verdict', { ...base, void: true, reason: 'match_ended' }, `p${n}`);
      return;
    }
    if (verdict === 'SE') {
      sub.status = 'void';
      this.stat(n, 'system_errors');
      this.emit('submission.verdict', { ...base, void: true, reason: 'system_error' }, `p${n}`);
      if (this.statGet(n, 'system_errors') >= this.cfg.judge.system_error_flag_after) {
        const count = this.statGet(n, 'system_errors');
        const pid = this.side(n).profile_id;
        this._tx.push((tx) => tx.flag.create({
          data: { match_id: this.id, profile_id: pid, kind: 'judge_system_errors', severity: 1, details: { count }, created_at: new Date() },
        }));
      }
      return;
    }

    sub.status = 'done';
    const slug = this.hands[n].slots[slot];
    const p = this.svc.problems.byId.get(sub.problem_id);
    const att = this.side(n);
    const dfn = this.side(other);
    const pv = R.computePreview(att.tier, p.tier, p.base_damage, p.base_recoil, this.cfg);
    const level = H.difficultyLevel(att.tier, p.tier, this.cfg); // picks the animation only
    sub.crit = pv.crit;
    rt.cooldownUntilMs = this.now() + this.cfg.match.submit_cooldown_s * 1000;
    const cooldownMs = this.cfg.match.submit_cooldown_s * 1000;

    if (verdict === 'AC') {
      att.hits_landed = att.hits_landed + 1;
      this.stat(n, 'accepted');
      this.stat(n, 'accepted_run_after');
      this.stat(n, 'streak');
      this.statSet(n, 'max_streak', Math.max(this.statGet(n, 'max_streak'), this.statGet(n, 'streak')));
      const solveMs = this.now() - this.rt[n].dealtAtMs[slot];
      const best = this.statGet(n, 'fastest_solve_ms', null);
      if (best === null || solveMs < best) this.statSet(n, 'fastest_solve_ms', solveMs);
      if (pv.tier_diff <= -1) this.stat(n, 'hits_stretching');
      if (pv.tier_diff <= -4) this.stat(n, 'heroic_hits');
      if (pv.crit) this.stat(n, 'crits');
      const cls = R.damageClass(pv.damage, dfn.max_hp, this.cfg);
      this.emit('submission.verdict', { ...base, void: false, damage: pv.damage, recoil: 0, cooldown_ms: cooldownMs }, `p${n}`);
      if (R.shieldActive(dfn.shield_until_ms, this.now())) {
        dfn.shield_until_ms = null;
        this._cancel(`shield:${other}`);
        sub.blocked = true;
        this.stat(other, 'blocks_absorbed');
        this.emit('attack.blocked', {
          attacker: n, defender: other, prevented_damage: pv.damage, damage_class: cls, crit: pv.crit,
          scenario: pv.scenario, problem: slug, hits_landed: att.hits_landed, level,
        });
      } else {
        const fullBefore = dfn.hp === dfn.max_hp;
        dfn.hp = R.applyHpLoss(dfn.hp, pv.damage);
        att.damage_dealt = att.damage_dealt + pv.damage; // overkill counts in full
        sub.damage = pv.damage;
        this.stat(other, 'damage_taken', pv.damage);
        this.statSet(n, 'biggest_hit', Math.max(this.statGet(n, 'biggest_hit'), pv.damage));
        if (fullBefore && dfn.hp === 0) this.statSet(n, 'one_shot', true);
        this._trackLow(other);
        this.emit('attack.landed', {
          attacker: n, defender: other, damage: pv.damage, damage_class: cls, crit: pv.crit, scenario: pv.scenario,
          tier_diff: pv.tier_diff, problem: slug, defender_hp: dfn.hp, attacker_damage_dealt: att.damage_dealt,
          hits_landed: att.hits_landed, level,
        });
      }
      // The card is spent; the slot gets the next problem of its tier later.
      this.hands[n] = H.consumeSlot(this.hands[n], slot);
      att.hand = H.handToJson(this.hands[n]);
      this.emit('hand.updated', { cards: this.handView(n) }, `p${n}`);
      this._clearDraft(n, slot);
      this._schedule(`redeal:${n}:${slot}`, this.cfg.hand.redeal_ms / 1000, 'redeal', { side: n, slot });
      if (dfn.hp === 0) this._end('ko');
    } else {
      att.hp = R.applyHpLoss(att.hp, pv.recoil);
      sub.recoil = pv.recoil;
      this.stat(n, 'backfires');
      this.stat(n, 'recoil_taken', pv.recoil);
      this.statSet(n, 'streak', 0);
      this.statSet(n, 'accepted_run_after', 0);
      this.statSet(n, 'failed_any', true);
      this._trackLow(n);
      const cls = R.damageClass(pv.recoil, att.max_hp, this.cfg);
      this.emit('submission.verdict', { ...base, void: false, damage: 0, recoil: pv.recoil, cooldown_ms: cooldownMs }, `p${n}`);
      this.emit('attack.backfire', {
        attacker: n, recoil: pv.recoil, recoil_class: cls, verdict, problem: slug, attacker_hp: att.hp,
        crit: pv.crit, scenario: pv.scenario, level,
      });
      if (att.hp === 0) {
        this.statSet(n, 'ko_by_recoil', true);
        this._end('ko');
      }
    }
    if (!this.finished) for (const [s, brain] of Object.entries(this.bots)) brain.afterVerdict(Number(s) === n, verdict);
  }

  _trackLow(n) {
    const sd = this.side(n);
    this.statSet(n, 'lowest_hp', Math.min(this.statGet(n, 'lowest_hp', sd.max_hp), sd.hp));
  }

  _clearDraft(n, slot) {
    const pid = this.side(n).profile_id;
    this._tx.push((tx) => tx.draft.deleteMany({ where: { match_id: this.id, profile_id: pid, slot } }));
  }

  // ------------------------------------------------------------------ powerups and actions
  _cmd_block(cmd) {
    const n = cmd.side;
    this._requireLive();
    const sd = this.side(n);
    if (!R.hasCharge(sd.blocks_left) || sd.blocks_left === 0) throw new RuleError('no_charges', 'No Block charges left');
    if (R.shieldActive(sd.shield_until_ms, this.now())) throw new RuleError('conflict', 'Your shield is already up');
    sd.blocks_left = R.spend(sd.blocks_left);
    sd.shield_until_ms = R.shieldUntil(this.now(), this.cfg);
    this.stat(n, 'blocks_used');
    this.emit('powerup.used', { side: n, kind: 'block', shield_ms: this.cfg.powerups.block.window_s * 1000, charges_left: sd.blocks_left });
    this._schedule(`shield:${n}`, this.cfg.powerups.block.window_s, 'shield_expire', { side: n });
    return { ok: true, charges_left: sd.blocks_left };
  }

  _cmd_hint(cmd) {
    const n = cmd.side;
    this._requireLive();
    const slot = parseInt(cmd.data.slot, 10);
    const slug = this._requireCard(n, slot);
    const sd = this.side(n);
    if (!R.hasCharge(sd.hints_left)) throw new RuleError('no_charges', 'No Hint charges left');
    const revealed = { ...(sd.hints_revealed || {}) };
    const level = R.nextHintLevel(revealed[slug] ?? 0, this.cfg);
    if (level === null) throw new RuleError('conflict', 'Every hint for this card is already revealed');
    const p = this.svc.problems.get(slug);
    revealed[slug] = level;
    sd.hints_revealed = revealed;
    sd.hints_left = R.spend(sd.hints_left);
    this.stat(n, 'hints_used');
    const text = level - 1 < p.hints.length ? p.hints[level - 1] : '';
    this.emit('hint.revealed', { slot, problem: slug, level, text, tags: level === 1 ? p.tags : null }, `p${n}`);
    this.emit('powerup.used', { side: n, kind: 'hint', charges_left: sd.hints_left });
    return { ok: true, level, text, charges_left: sd.hints_left };
  }

  _cmd_reroll(cmd) {
    const n = cmd.side;
    this._requireLive();
    const slot = parseInt(cmd.data.slot, 10);
    this._requireCard(n, slot);
    const sd = this.side(n);
    const rt = this.rt[n];
    if (sd.rerolls_left <= 0) throw new RuleError('no_charges', 'No rerolls left');
    if (rt.inflight && rt.inflightSlot === slot) throw new RuleError('busy', 'That card is being judged');
    if (sd.last_reroll_ms !== null && sd.last_reroll_ms !== undefined) {
      const wait = sd.last_reroll_ms + this.cfg.hand.reroll_gap_s * 1000 - this.now();
      if (wait > 0) throw new RuleError('cooldown', 'Reroll is cooling down', { retry_after: wait / 1000 });
    }
    const before = this.hands[n].slots[slot];
    const next = H.rerollSlot(this.hands[n], this.decks, slot);
    if (next.slots[slot] === before) throw new RuleError('conflict', 'No other problem of that tier to swap in');
    this.hands[n] = next;
    sd.hand = H.handToJson(next);
    sd.rerolls_left = sd.rerolls_left - 1;
    sd.last_reroll_ms = this.now();
    rt.dealtAtMs[slot] = this.now();
    this.stat(n, 'rerolls_used');
    this._clearDraft(n, slot);
    this.emit('hand.updated', { cards: this.handView(n), rerolled: slot, rerolls_left: sd.rerolls_left }, `p${n}`);
    return { ok: true, rerolls_left: sd.rerolls_left };
  }

  _cmd_forfeit(cmd) {
    const n = cmd.side;
    if (this.finished) throw new RuleError('match_not_live', 'The match is over');
    if (this.m.status === 'starting' || this._earlyLeave()) this._abort('early_leave', [n]);
    else this._end('forfeit', n);
    return { ok: true };
  }

  _cmd_emote(cmd) {
    const n = cmd.side;
    if (!feature(this.cfg, 'emotes')) throw new RuleError('forbidden', 'Emotes are switched off');
    if (this.finished) throw new RuleError('match_not_live', 'The match is over');
    const emote = cmd.data.id;
    if (!this.cfg.emotes.includes(emote)) throw new RuleError('validation', 'Unknown emote');
    const rt = this.rt[n];
    const wait = rt.lastEmoteMs + this.cfg.match.emote_cooldown_s * 1000 - this.now();
    if (wait > 0) throw new RuleError('cooldown', 'Emote is cooling down', { retry_after: wait / 1000 });
    rt.lastEmoteMs = this.now();
    this.emit('emote', { side: n, id: emote });
    return { ok: true };
  }

  _cmd_activity(cmd) {
    const state = cmd.data.state;
    if ((state === 'arena' || state === 'editor') && this.m.status === 'live' && !this.rt[cmd.side].inflight) {
      this.transient(3 - cmd.side, 'opponent.activity', { side: cmd.side, state });
    }
    return null;
  }

  _cmd_abort(cmd) {
    if (this.finished) throw new RuleError('match_not_live', 'The match is over');
    this._abort(cmd.data.reason || 'admin');
    return { ok: true };
  }

  /** Leaving in the first 30 s before anyone submitted aborts the match. */
  _earlyLeave() {
    if (this.m.status !== 'live' || this.liveMs === null) return true;
    const noSubmissions = [1, 2].every((s) => this.statGet(s, 'submissions') === 0);
    return noSubmissions && this.elapsedMs() < this.cfg.match.early_leave_s * 1000;
  }

  // ------------------------------------------------------------------ ending
  _finishCommon() {
    this.finished = true;
    this.m.end_time = new Date();
    this.m.elapsed_ms = this.liveMs !== null ? Math.max(0, this.now() - this.liveMs) : 0;
    for (const key of [...this.timers.keys()]) this._cancel(key);
    for (const n of [1, 2]) {
      const rt = this.rt[n];
      if (rt.inflight) {
        const sub = rt.inflight;
        sub.status = 'void';
        this._pendingSubmissions.push(sub);
        this.emit('submission.verdict', { submission_id: sub.id, slot: rt.inflightSlot, verdict: null, void: true, reason: 'match_ended' }, `p${n}`);
        rt.inflight = null;
        rt.inflightSlot = null;
      }
      if (rt.judging && !rt.judging.done) rt.judging.cancelled = true;
    }
    this._tx.push((tx) => tx.draft.deleteMany({ where: { match_id: this.id } }));
    this._after.push(this.svc.onFinishedSoon(this));
  }

  _abort(reason, strikeSides = []) {
    this.m.status = 'aborted';
    this.m.end_reason = 'aborted';
    this.m.outcome = 'aborted';
    this._finishCommon();
    const payload = {
      outcome: 'aborted', end_reason: 'aborted', reason, winner_side: null, labels: {},
      final_hp: { 1: this.m.player1_hp, 2: this.m.player2_hp }, sides: {}, elapsed_ms: this.m.elapsed_ms,
    };
    this.m.result = payload;
    const strikes = strikeSides.filter((s) => !this.side(s).is_bot).map((s) => this.side(s).profile_id);
    if (strikes.length && (this.m.mode === 'ranked' || this.m.mode === 'friendly')) this._tx.push((tx) => applyStrikes(tx, strikes, this.cfg));
    this.emit('match.ended', payload);
  }

  _end(reason, leaver = null) {
    const a = this.side(1);
    const b = this.side(2);
    const o = R.classify(reason,
      { hp: a.hp, hits_landed: a.hits_landed, ko_by_recoil: Boolean(this.statGet(1, 'ko_by_recoil', false)), left: leaver === 1 },
      { hp: b.hp, hits_landed: b.hits_landed, ko_by_recoil: Boolean(this.statGet(2, 'ko_by_recoil', false)), left: leaver === 2 });
    if (o.outcome === 'aborted') {
      this._abort(reason);
      return;
    }
    this.m.status = 'finished';
    this.m.end_reason = o.end_reason;
    this.m.outcome = o.outcome;
    this.m.winner_side = o.winner_side;
    this.m.labels = Object.fromEntries(Object.entries(o.labels).map(([k, v]) => [String(k), v]));
    this._finishCommon();
    const payload = {
      outcome: o.outcome, winner_side: o.winner_side, end_reason: o.end_reason, labels: this.m.labels,
      final_hp: { 1: a.hp, 2: b.hp }, max_hp: { 1: a.max_hp, 2: b.max_hp },
      elapsed_ms: this.m.elapsed_ms, stats: { 1: { ...(a.stats || {}) }, 2: { ...(b.stats || {}) } },
      hits_landed: { 1: a.hits_landed, 2: b.hits_landed },
      damage_dealt: { 1: a.damage_dealt, 2: b.damage_dealt }, sides: {},
    };
    const rewards = {};
    const ev = this.emit('match.ended', payload);
    const rewardEvents = {};
    for (const n of [1, 2]) if (!this.side(n).is_bot) rewardEvents[n] = this.emit('rewards.granted', { side: n }, `p${n}`);
    this._tx.push(async (tx) => {
      await finishTx(tx, this.m, o, this.cfg, payload, rewards);
      payload.rewards = Object.fromEntries(Object.entries(rewards).map(([n, r]) => [String(n), r]));
      ev.data = payload;
      for (const [n, rev] of Object.entries(rewardEvents)) rev.data = { side: Number(n), ...(rewards[n] || {}) };
      this.m.result = payload;
    });
  }
}
