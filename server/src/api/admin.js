// Admin console endpoints (admin role only). Every action is written to audit_log.

import { Router } from 'express';
import { AppError } from '../errors.js';
import { inTx } from '../db.js';
import { tierRow } from '../domain/gameconfig.js';
import { computePreview, damageClass } from '../domain/rules.js';
import { iso, pyRound } from '../util.js';
import { adminOnly, ah, body, current, intParam, query } from './http.js';
import { matchBrief } from './players.js';

const audit = (tx, caller, action, target, details = {}) =>
  tx.auditLog.create({ data: { actor_id: caller.userId, action, target, details } });

async function profileByUsername(tx, username) {
  const u = await tx.user.findFirst({ where: { username_lower: username.toLowerCase() } });
  return u ? tx.profile.findFirst({ where: { user_id: u.id } }) : null;
}

export function adminRouter(ctx) {
  const r = Router();
  const db = ctx.db;
  r.use('/admin', current(ctx), adminOnly);

  r.get('/admin/calculator', (req, res) => {
    const q = query(req, {
      attacker_tier: { type: 'int', min: 1, max: 5 }, problem_tier: { type: 'int', min: 1, max: 5 },
      base_damage: { type: 'int', min: 0, nullable: true, default: null }, base_recoil: { type: 'int', min: 0, nullable: true, default: null },
    });
    const row = tierRow(ctx.cfg, q.problem_tier);
    const bd = q.base_damage ?? row.base_damage;
    const br = q.base_recoil ?? row.base_recoil;
    const pv = computePreview(q.attacker_tier, q.problem_tier, bd, br, ctx.cfg);
    const own = tierRow(ctx.cfg, q.attacker_tier).max_hp;
    res.json({
      damage: pv.damage, recoil: pv.recoil, tier_diff: pv.tier_diff, scenario: pv.scenario, crit: pv.crit,
      hits_to_kill_same_tier: pv.damage ? Math.ceil(own / pv.damage) : null,
      recoil_share_pct: pyRound((pv.recoil * 100) / own, 1),
      damage_class_vs_same_tier: damageClass(pv.damage, own, ctx.cfg),
    });
  });

  r.get('/admin/matches', ah(async (req, res) => {
    const q = query(req, { q: { type: 'str', max: 40, nullable: true, default: null } });
    let rows = await db.match.findMany({ orderBy: { created_at: 'desc' }, take: 100 });
    if (q.q) rows = rows.filter((m) => (m.player1_name + m.player2_name + m.id).toLowerCase().includes(q.q.toLowerCase()));
    res.json({ matches: rows.map((m) => matchBrief(m)) });
  }));

  /** The full event log, private events included. */
  r.get('/admin/matches/:matchId/events', ah(async (req, res) => {
    const rows = await db.matchEvent.findMany({ where: { match_id: req.params.matchId }, orderBy: { seq: 'asc' } });
    res.json({ events: rows.map((e) => ({ seq: e.seq, t_ms: e.t_ms, type: e.type, visibility: e.visibility, data: e.payload })) });
  }));

  /** Reverse the match's rating_history rows and log the action. */
  r.post('/admin/matches/:matchId/void', ah(async (req, res) => {
    const b = body(req, { reason: { type: 'str', max: 200 } });
    const { matchId } = req.params;
    const out = await inTx(db, async (tx) => {
      const rows = await tx.ratingHistory.findMany({ where: { match_id: matchId, voided: false } });
      for (const h of rows) {
        const p = await tx.profile.findUnique({ where: { id: h.profile_id } });
        if (p) await tx.profile.update({ where: { id: p.id }, data: { rating: Math.max(0, p.rating - h.delta) } });
        await tx.ratingHistory.update({ where: { id: h.id }, data: { voided: true } });
      }
      await audit(tx, req.caller, 'void_match', matchId, { reason: b.reason, rows: rows.length });
      return { reversed: rows.length };
    });
    res.json(out);
  }));

  r.post('/admin/matches/:matchId/abort', ah(async (req, res) => {
    const actor = ctx.matches.get(req.params.matchId);
    if (!actor) throw new AppError('not_found', 'Match is not running');
    await actor.send('abort', 0, { reason: 'admin' });
    await audit(db, req.caller, 'abort_match', req.params.matchId);
    res.json({ ok: true });
  }));

  r.get('/admin/flags', ah(async (req, res) => {
    const rows = await db.flag.findMany({ orderBy: { created_at: 'desc' }, take: 200 });
    res.json({ flags: rows.map((f) => ({ ...f, created_at: iso(f.created_at) })) });
  }));

  r.post('/admin/flags/:flagId', ah(async (req, res) => {
    const flagId = intParam(req, 'flagId');
    const b = body(req, { status: { type: 'str', pattern: /^(dismissed|warned|actioned)$/ } });
    await inTx(db, async (tx) => {
      const f = await tx.flag.findUnique({ where: { id: flagId } });
      if (!f) throw new AppError('not_found', 'No such flag');
      await tx.flag.update({ where: { id: flagId }, data: { status: b.status } });
      await audit(tx, req.caller, `flag_${b.status}`, String(flagId));
    });
    res.json({ ok: true });
  }));

  r.post('/admin/users/:username/suspend', ah(async (req, res) => {
    const b = body(req, { minutes: { type: 'int', min: 0, max: 60 * 24 * 365 } });
    const { username } = req.params;
    const out = await inTx(db, async (tx) => {
      const u = await tx.user.findFirst({ where: { username_lower: username.toLowerCase() } });
      if (!u) throw new AppError('not_found', 'No such user');
      const until = b.minutes ? new Date(Date.now() + b.minutes * 60_000) : null;
      await tx.user.update({ where: { id: u.id }, data: { suspended_until: until } });
      await audit(tx, req.caller, 'suspend', username, { minutes: b.minutes });
      return { suspended_until: iso(until) };
    });
    res.json(out);
  }));

  r.post('/admin/users/:username/grant-skin', ah(async (req, res) => {
    const b = body(req, { skin_id: { type: 'str', max: 48 } });
    const { username } = req.params;
    await inTx(db, async (tx) => {
      const p = await profileByUsername(tx, username);
      if (!p) throw new AppError('not_found', 'No such user');
      if (!(await tx.inventory.findFirst({ where: { profile_id: p.id, skin_id: b.skin_id } }))) {
        await tx.inventory.create({ data: { profile_id: p.id, skin_id: b.skin_id, source: 'admin' } });
      }
      await audit(tx, req.caller, 'grant_skin', username, { skin_id: b.skin_id });
    });
    res.json({ ok: true });
  }));

  r.post('/admin/users/:username/reset-daily-cap', ah(async (req, res) => {
    const { username } = req.params;
    await inTx(db, async (tx) => {
      const p = await profileByUsername(tx, username);
      if (!p) throw new AppError('not_found', 'No such user');
      await tx.profile.update({ where: { id: p.id }, data: { bot_gain_today: 0, casual_ap_today: 0 } });
      await audit(tx, req.caller, 'reset_daily_cap', username);
    });
    res.json({ ok: true });
  }));

  r.post('/admin/problems/reload', ah(async (req, res) => {
    await ctx.problems.reload(db);
    res.json({ problems: ctx.problems.bySlug.size });
  }));

  return r;
}
