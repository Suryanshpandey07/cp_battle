// Matchmaker: pairs queued players by rating window and runs the ready-check.
//
// The window starts at 50 and widens by 25 every 5 s of waiting, up to 400. Two
// players match when their gap is within the smaller of their windows. The loop
// runs every 500 ms, sorts by rating and pairs nearest neighbours, longest wait
// first. A labelled bot is offered after BOT_FALLBACK_SECONDS; it only starts
// when the player asks for it.

import { randomBytes } from 'node:crypto';
import { AppError } from '../errors.js';
import { mapCfg } from '../domain/gameconfig.js';
import { getTier } from '../domain/rules.js';
import { PyRandom } from '../pyrandom.js';
import { pyRound } from '../util.js';
import { log } from '../log.js';

const monotonic = () => performance.now() / 1000;
const pairKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);

export class Matchmaker {
  constructor(cfg, hub, matches, now = monotonic) {
    this.cfg = cfg;
    this.hub = hub;
    this.matches = matches;
    this.now = now;
    this.queue = new Map();
    this.proposals = new Map();
    this.cooldowns = new Map();
    this.recent = new Map();
    this.leaveTimers = new Map();
    this.timer = null;
    this.lastTickPush = 0;
  }

  // ------------------------------------------------------------------ lifecycle
  start() {
    if (this.timer) return;
    const loop = async () => {
      try {
        await this.tick();
      } catch (e) {
        log.error('matchmaker tick failed', { error: String(e && e.stack ? e.stack : e) });
      }
      if (this.timer) this.timer = setTimeout(loop, this.cfg.matchmaking.tick_ms);
    };
    this.timer = setTimeout(loop, this.cfg.matchmaking.tick_ms);
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const h of this.leaveTimers.values()) clearTimeout(h);
    this.leaveTimers.clear();
  }

  // ------------------------------------------------------------------ queue API
  window(e) {
    const mm = this.cfg.matchmaking;
    const steps = Math.floor((this.now() - e.joined_at) / mm.window_step_s);
    return Math.min(mm.window_max, mm.window_start + steps * mm.window_step);
  }

  status(profileId) {
    const e = this.queue.get(profileId);
    if (!e) {
      for (const p of this.proposals.values()) {
        if (profileId === p.a.profile_id || profileId === p.b.profile_id) {
          const other = p.a.profile_id === profileId ? p.b : p.a;
          return {
            state: 'proposal', proposal_id: p.id, map: p.map,
            expires_in: Math.max(0, pyRound(p.expires_at - this.now(), 1)), accepted: p.accepted.has(profileId),
            opponent: { name: other.name, rating: other.rating, tier: other.tier },
          };
        }
      }
      return { state: 'idle' };
    }
    const wait = this.now() - e.joined_at;
    const fallback = this.cfg.matchmaking.bot_fallback_s;
    return {
      state: 'queued', wait_s: pyRound(wait, 1), window: this.window(e), map: e.map,
      bot_available: wait >= fallback, bot_in_s: Math.max(0, pyRound(fallback - wait, 1)),
    };
  }

  async join(prof, mapId, ip = '') {
    const pid = prof.id;
    if (prof.queue_ban_until && new Date(prof.queue_ban_until) > new Date()) {
      throw new AppError('forbidden', 'Queue ban for leaving matches early', { until: new Date(prof.queue_ban_until).toISOString() });
    }
    const cd = (this.cooldowns.get(pid) || 0) - this.now();
    if (cd > 0) throw new AppError('cooldown', 'You declined a match; wait a moment', { retry_after: cd });
    const active = this.matches.activeMatchFor(pid);
    if (active) throw new AppError('conflict', 'You are already in a match', { match_id: active });
    const tier = getTier(prof.rating, this.cfg);
    if (mapId !== 'any') {
      let mc;
      try {
        mc = mapCfg(this.cfg, mapId);
      } catch {
        throw new AppError('validation', 'Unknown map');
      }
      if (tier < mc.min_tier) throw new AppError('forbidden', `The ${mapId} map needs tier ${mc.min_tier} or higher`);
    }
    const prev = this.queue.get(pid);
    this.queue.set(pid, {
      profile_id: pid, name: prof.display_name, rating: prof.rating, tier, map: mapId,
      joined_at: prev ? prev.joined_at : this.now(), ip, mode: 'ranked',
    });
    this._cancelLeave(pid);
    await this.hub.lobbySend(pid, 'queue.joined', this.status(pid));
    return this.status(pid);
  }

  async leave(profileId) {
    this.queue.delete(profileId);
    this._cancelLeave(profileId);
  }

  /** A closed lobby socket leaves the queue after a short grace period. */
  lobbyClosed(profileId) {
    if (!this.queue.has(profileId)) return;
    this._cancelLeave(profileId);
    const h = setTimeout(() => this.queue.delete(profileId), this.cfg.matchmaking.lobby_leave_grace_s * 1000);
    if (h.unref) h.unref();
    this.leaveTimers.set(profileId, h);
  }

  lobbyOpened(profileId) {
    this._cancelLeave(profileId);
  }

  _cancelLeave(pid) {
    const h = this.leaveTimers.get(pid);
    if (h) clearTimeout(h);
    this.leaveTimers.delete(pid);
  }

  // ------------------------------------------------------------------ pairing
  _compatibleMap(a, b) {
    if (a.map !== 'any' && b.map !== 'any') return a.map === b.map ? a.map : null;
    const fixed = a.map !== 'any' ? a.map : b.map;
    if (fixed !== 'any') return fixed;
    const options = this.cfg.maps.filter((m) => Math.min(a.tier, b.tier) >= m.min_tier).map((m) => m.id);
    return new PyRandom(`${a.profile_id}:${b.profile_id}:${Math.trunc(a.joined_at)}`).choice(options);
  }

  findPairs() {
    const mm = this.cfg.matchmaking;
    const entries = [...this.queue.values()].sort((x, y) => x.joined_at - y.joined_at);
    const byRating = [...entries].sort((x, y) => x.rating - y.rating);
    const taken = new Set();
    const pairs = [];
    const now = this.now();
    for (const e of entries) {
      if (taken.has(e.profile_id)) continue;
      let best = null;
      for (const o of byRating) {
        if (o.profile_id === e.profile_id || taken.has(o.profile_id)) continue;
        const gap = Math.abs(o.rating - e.rating);
        if (gap > Math.min(this.window(e), this.window(o))) continue;
        const mapId = this._compatibleMap(e, o);
        if (mapId === null) continue;
        const met = this.recent.get(pairKey(e.profile_id, o.profile_id));
        if (met && now - met < mm.recent_opponent_min * 60) {
          if (Math.max(now - e.joined_at, now - o.joined_at) <= mm.recent_override_wait_s) continue;
        }
        if (mm.same_ip_block && e.ip && e.ip === o.ip) continue;
        if (best === null || gap < best[0]) best = [gap, o, mapId];
      }
      if (best) {
        taken.add(e.profile_id);
        taken.add(best[1].profile_id);
        pairs.push([e, best[1], best[2]]);
      }
    }
    return pairs;
  }

  async tick() {
    const now = this.now();
    for (const [a, b, mapId] of this.findPairs()) {
      this.queue.delete(a.profile_id);
      this.queue.delete(b.profile_id);
      const p = { id: randomBytes(6).toString('base64url'), a, b, map: mapId, expires_at: now + this.cfg.matchmaking.ready_check_s, accepted: new Set() };
      this.proposals.set(p.id, p);
      for (const [me, other] of [[a, b], [b, a]]) {
        await this.hub.lobbySend(me.profile_id, 'match.found', {
          proposal_id: p.id, expires_in: this.cfg.matchmaking.ready_check_s, map: mapId,
          opponent: { name: other.name, rating: other.rating, tier: other.tier },
        });
      }
    }
    for (const p of [...this.proposals.values()]) if (p.expires_at <= now) await this._expire(p);
    if (now - this.lastTickPush >= 1.0) {
      this.lastTickPush = now;
      for (const pid of [...this.queue.keys()]) await this.hub.lobbySend(pid, 'queue.tick', this.status(pid));
    }
  }

  async _expire(p) {
    this.proposals.delete(p.id);
    for (const e of [p.a, p.b]) {
      if (p.accepted.has(e.profile_id)) {
        this.queue.set(e.profile_id, e); // wait time intact
        await this.hub.lobbySend(e.profile_id, 'queue.joined', this.status(e.profile_id));
      } else {
        await this._cooldown(e.profile_id);
      }
    }
  }

  async _cooldown(pid) {
    this.cooldowns.set(pid, this.now() + this.cfg.matchmaking.decline_cooldown_s);
    await this.hub.lobbySend(pid, 'queue.cooldown', { seconds: this.cfg.matchmaking.decline_cooldown_s });
  }

  async respond(profileId, proposalId, accept) {
    const p = this.proposals.get(proposalId);
    if (!p || (profileId !== p.a.profile_id && profileId !== p.b.profile_id)) throw new AppError('not_found', 'That match offer has expired');
    if (!accept) {
      this.proposals.delete(p.id);
      await this._cooldown(profileId);
      const other = p.a.profile_id === profileId ? p.b : p.a;
      this.queue.set(other.profile_id, other);
      await this.hub.lobbySend(other.profile_id, 'queue.joined', { ...this.status(other.profile_id), requeued: true });
      return { state: 'declined' };
    }
    p.accepted.add(profileId);
    if (p.accepted.size < 2) return { state: 'waiting' };
    this.proposals.delete(p.id);
    const db = this.matches.db;
    const pa = await db.profile.findUnique({ where: { id: p.a.profile_id } });
    const pb = await db.profile.findUnique({ where: { id: p.b.profile_id } });
    const actor = await this.matches.createMatch('ranked', p.map, pa, pb);
    this.recent.set(pairKey(p.a.profile_id, p.b.profile_id), this.now());
    for (const e of [p.a, p.b]) await this.hub.lobbySend(e.profile_id, 'match.ready', { match_id: actor.id });
    return { state: 'ready', match_id: actor.id };
  }
}
