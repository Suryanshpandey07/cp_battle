// Profiles, settings, leaderboard, problems (practice browser) and the dojo Run.

import { Router } from 'express';
import { AppError } from '../errors.js';
import { inTx } from '../db.js';
import { ladderAhead, ladderTop, profileIdByName } from '../db/sql.js';
import * as P from '../domain/progress.js';
import { getTier } from '../domain/rules.js';
import { todayUtc } from '../engine/finish.js';
import { enforce } from '../ratelimit.js';
import { runSamples } from '../services/judging.js';
import { profilePrivate, profilePublic } from '../services/profiles.js';
import { playerStats } from '../services/stats.js';
import { evaluateUnlocks } from '../skins/service.js';
import { iso } from '../util.js';
import { ah, body, current, query } from './http.js';

const PEOPLE = { is_bot: false, user_id: { not: null } }; // bots and the practice dummy have no login

export function matchBrief(m, me = null) {
  const side = m.player1_profile_id === me ? 1 : m.player2_profile_id === me ? 2 : null;
  return {
    id: m.id, mode: m.mode, map: m.map, status: m.status, end_reason: m.end_reason,
    outcome: m.outcome, winner_side: m.winner_side, labels: m.labels, created_at: iso(m.created_at),
    elapsed_ms: m.elapsed_ms, your_side: side,
    players: [
      { side: 1, name: m.player1_name, tier: m.player1_tier, is_bot: m.player1_is_bot },
      { side: 2, name: m.player2_name, tier: m.player2_tier, is_bot: m.player2_is_bot },
    ],
    rating_delta: side ? ((((m.result || {}).sides || {})[String(side)] || {}).delta ?? null) : null,
  };
}

async function questsOf(db, pid, ctx) {
  if (!ctx.cfg.features.quests) return [];
  const day = todayUtc();
  const rows = new Map((await db.questProgress.findMany({ where: { profile_id: pid, day } })).map((r) => [r.key, r]));
  return P.dailyQuests(day, ctx.cfg).map((q) => {
    const r = rows.get(q.id);
    return { id: q.id, target: q.target, ap: q.ap, progress: r ? r.progress : 0, complete: Boolean(r && r.earned_at), claimed: Boolean(r && r.claimed_at) };
  });
}

const recentWhere = (pid) => ({ OR: [{ player1_profile_id: pid }, { player2_profile_id: pid }], status: { in: ['finished', 'aborted'] } });

function boardRow(rank, pid, name, rating, score, wins, losses, ctx) {
  return { rank, profile_id: pid, name, rating, tier: getTier(rating, ctx.cfg), score, wins, losses };
}

/** The ranked rows of one board. All-time is the top 100, read in order from
 * ix_profiles_ladder; the weekly and map boards add up every finished match. */
async function board(db, scope, map, ctx) {
  if (scope === 'all' && !map) {
    const top = await ladderTop(db, 100);
    return top.map((p, i) => boardRow(i + 1, Number(p.id), p.display_name, p.rating, p.rating, p.wins, p.losses, ctx));
  }
  const people = new Map((await db.profile.findMany({
    where: PEOPLE, select: { id: true, display_name: true, rating: true, wins: true, losses: true },
  })).map((p) => [p.id, p]));
  const since = scope === 'week' ? new Date(Date.now() - 7 * 86_400_000) : null;
  const score = new Map();
  const add = (pid, n) => score.set(pid, (score.get(pid) || 0) + n);
  if (map) { // wins on the map (ix_matches_map_winners)
    const where = { status: 'finished', map, winner_side: { not: null }, ...(since ? { end_time: { gte: since } } : {}) };
    for (const m of await db.match.findMany({ where, select: { winner_side: true, player1_profile_id: true, player2_profile_id: true } })) {
      const wid = m.winner_side === 1 ? m.player1_profile_id : m.player2_profile_id;
      if (people.has(wid)) add(wid, 1);
    }
  } else { // rating gained this week (ix_matches_finished_end_time)
    const rows = await db.match.findMany({
      where: { status: 'finished', end_time: { gte: since } }, select: { player1_profile_id: true, player2_profile_id: true, result: true },
    });
    for (const m of rows) {
      for (const [n, pid] of [['1', m.player1_profile_id], ['2', m.player2_profile_id]]) {
        const blk = ((m.result || {}).sides || {})[n];
        if (blk && people.has(pid)) add(pid, Math.trunc(Number(blk.delta || 0)));
      }
    }
  }
  const lower = (pid) => people.get(pid).display_name.toLowerCase();
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1] || (lower(a[0]) < lower(b[0]) ? -1 : lower(a[0]) > lower(b[0]) ? 1 : 0));
  return ranked.map(([pid, sc], i) => {
    const p = people.get(pid);
    return boardRow(i + 1, pid, p.display_name, p.rating, sc, p.wins, p.losses, ctx);
  });
}

/** A player's own row on the all-time board when they are outside the top 100. */
async function ladderPlace(db, profileId, ctx) {
  const p = await db.profile.findUnique({ where: { id: profileId } });
  if (!p || p.is_bot || p.user_id === null) return null;
  const ahead = await ladderAhead(db, p.rating, p.display_name);
  return boardRow(ahead + 1, p.id, p.display_name, p.rating, p.rating, p.wins, p.losses, ctx);
}

const TEMPLATE_MAX_BYTES = 16 * 1024;

export function playersRouter(ctx) {
  const r = Router();
  const db = ctx.db;
  const auth = current(ctx);

  r.get('/me', auth, ah(async (req, res) => {
    const pid = req.caller.profileId;
    const p = await db.profile.findUnique({ where: { id: pid } });
    if (!p) throw new AppError('not_found', 'Profile not found');
    const recent = await db.match.findMany({ where: recentWhere(p.id), orderBy: { created_at: 'desc' }, take: 8 });
    const d = await profilePrivate(db, p, ctx.cfg);
    d.quests = await questsOf(db, p.id, ctx);
    d.recent_matches = recent.map((m) => matchBrief(m, p.id));
    d.active_match = ctx.matches.activeMatchFor(pid);
    d.judge = { backend: ctx.judge.name, sandboxed: ctx.judge.sandboxed };
    d.queue = ctx.matchmaker.status(pid);
    res.json(d);
  }));

  r.patch('/me/settings', auth, ah(async (req, res) => {
    const b = body(req, { settings: { type: 'obj' } });
    // Code templates (one per language) live here too, so the budget is generous;
    // everything else together must stay small.
    const templates = b.settings.templates ?? {};
    if (templates === null || typeof templates !== 'object' || Array.isArray(templates)) {
      throw new AppError('validation', 'templates must map a language to its code');
    }
    const known = new Set(ctx.cfg.languages.map((l) => l.id));
    for (const [lang, code] of Object.entries(templates)) {
      if (!known.has(lang)) throw new AppError('validation', `Unknown language '${lang}' in templates`);
      if (typeof code !== 'string' || Buffer.byteLength(code, 'utf8') > TEMPLATE_MAX_BYTES) throw new AppError('validation', 'Each template must be text under 16 KB');
    }
    const rest = Object.fromEntries(Object.entries(b.settings).filter(([k]) => k !== 'templates'));
    if (JSON.stringify(rest).length > 4096) throw new AppError('validation', 'Settings are too large');
    const p = await db.profile.update({ where: { id: req.caller.profileId }, data: { settings: b.settings } });
    res.json({ settings: p.settings });
  }));

  r.post('/quests/:questId/claim', auth, ah(async (req, res) => {
    const day = todayUtc();
    const q = P.dailyQuests(day, ctx.cfg).find((x) => x.id === req.params.questId);
    if (!q) throw new AppError('not_found', 'That quest is not active today');
    const pid = req.caller.profileId;
    const out = await inTx(db, async (tx) => {
      const row = await tx.questProgress.findFirst({ where: { profile_id: pid, day, key: q.id } });
      if (!row || row.earned_at === null) throw new AppError('conflict', 'Quest not complete yet');
      // Claim only if still unclaimed, so a double click cannot pay twice.
      const n = await tx.questProgress.updateMany({ where: { id: row.id, claimed_at: null }, data: { claimed_at: new Date() } });
      if (n.count !== 1) throw new AppError('conflict', 'Already claimed');
      const p = await tx.profile.update({ where: { id: pid }, data: { points: { increment: q.ap } } });
      const unlocked = await evaluateUnlocks(tx, p, ctx.cfg);
      return { ap: q.ap, points: p.points, unlocked };
    });
    res.json(out);
  }));

  r.post('/reports', auth, ah(async (req, res) => {
    const b = body(req, { match_id: { type: 'str', max: 36, nullable: true, default: null }, reason: { type: 'str', min: 3, max: 500 } });
    const pid = req.caller.profileId;
    const m = b.match_id ? await db.match.findUnique({ where: { id: b.match_id } }) : null;
    let target = null;
    if (m) target = m.player1_profile_id === pid ? m.player2_profile_id : m.player1_profile_id;
    await db.report.create({ data: { reporter_id: pid, match_id: m ? b.match_id : null, target_profile_id: target, reason: b.reason } });
    res.json({ ok: true });
  }));

  r.get('/quests', auth, ah(async (req, res) => {
    res.json({ day: todayUtc(), quests: await questsOf(db, req.caller.profileId, ctx) });
  }));

  r.get('/profiles/:username', auth, ah(async (req, res) => {
    const id = await profileIdByName(db, req.params.username);
    const p = id === null ? null : await db.profile.findUnique({ where: { id } });
    if (!p) throw new AppError('not_found', 'No such player');
    const hist = await db.ratingHistory.findMany({ where: { profile_id: p.id, voided: false }, orderBy: { created_at: 'desc' }, take: 50 });
    const matches = await db.match.findMany({ where: recentWhere(p.id), orderBy: { created_at: 'desc' }, take: 20 });
    const accepted = await db.submission.count({ where: { profile_id: p.id, verdict: 'AC' } });
    const judged = await db.submission.count({ where: { profile_id: p.id, status: 'done' } });
    const d = profilePublic(p, ctx.cfg);
    d.rating_history = hist.reverse().map((h) => ({ match_id: h.match_id, before: h.before, after: h.after, delta: h.delta, at: iso(h.created_at) }));
    d.matches = matches.map((m) => matchBrief(m, p.id));
    d.accuracy = { accepted, judged };
    d.stats = await playerStats(db, p, ctx.cfg, ctx.problems.byId);
    res.json(d);
  }));

  r.get('/leaderboard', auth, ah(async (req, res) => {
    const q = query(req, { scope: { type: 'str', enum: ['all', 'week'], default: 'all' }, map: { type: 'str', max: 16, nullable: true, default: null } });
    const map = q.map || null;
    const key = `lb:${q.scope}:${map}`;
    const hit = ctx.cache.get(key);
    let rows;
    if (hit && performance.now() - hit[0] < 30_000) {
      rows = hit[1];
    } else {
      rows = await board(db, q.scope, map, ctx);
      ctx.cache.set(key, [performance.now(), rows]);
    }
    let mine = rows.find((x) => x.profile_id === req.caller.profileId) || null;
    if (!mine && q.scope === 'all' && !map) mine = await ladderPlace(db, req.caller.profileId, ctx);
    res.json({
      scope: q.scope, map, rows: rows.slice(0, 100), me: mine,
      metric: q.scope === 'all' && !map ? 'rating' : map ? 'wins' : 'rating_gained',
    });
  }));

  // Problems (practice browser) ---------------------------------------------------
  r.get('/problems', auth, ah(async (req, res) => {
    const done = new Set((await db.submission.findMany({
      where: { profile_id: req.caller.profileId, verdict: 'AC' }, select: { problem_id: true },
    })).map((s) => s.problem_id));
    const key = (p) => [p.biome, p.tier, p.slug];
    const items = [...ctx.problems.bySlug.values()].sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
      return 0;
    });
    res.json({ problems: items.map((p) => ({ ...p.summary(), solved: done.has(p.id) })) });
  }));

  r.get('/problems/:slug', auth, ah(async (req, res) => {
    const p = ctx.problems.get(req.params.slug);
    if (!p) throw new AppError('not_found', 'No such problem');
    res.json(p.public());
  }));

  r.post('/problems/:slug/run', auth, ah(async (req, res) => {
    const b = body(req, {
      language: { type: 'str', max: 16, default: 'python' }, code: { type: 'str', max: 70000 },
      input: { type: 'str', max: 70000, nullable: true, default: null },
    });
    const p = ctx.problems.get(req.params.slug);
    if (!p) throw new AppError('not_found', 'No such problem');
    const pid = req.caller.profileId;
    enforce(`run:${pid}`, ctx.cfg.rate_limits.run);
    if (ctx.runsInflight.has(pid)) throw new AppError('busy', 'A Run is already in progress');
    ctx.runsInflight.add(pid);
    try {
      res.json(await runSamples(ctx.judge, ctx.cfg, p, b.language, b.code, b.input, true));
    } finally {
      ctx.runsInflight.delete(pid);
    }
  }));

  return r;
}
