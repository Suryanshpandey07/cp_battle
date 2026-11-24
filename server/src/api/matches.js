// Queue, matches, drafts and match actions. Every mutation is a command to the
// match actor; no route accepts a rating, an HP or a result from a client.

import { Router } from 'express';
import { AppError } from '../errors.js';
import { mapCfg } from '../domain/gameconfig.js';
import { getTier } from '../domain/rules.js';
import { enforce } from '../ratelimit.js';
import { runSamples } from '../services/judging.js';
import { iso } from '../util.js';
import { ah, body, clientIp, current, intParam, query } from './http.js';
import { matchBrief } from './players.js';

const ACTION = {
  cmd_id: { type: 'str', min: 4, max: 64 },
  slot: { type: 'int', min: 0, max: 3, nullable: true, default: null },
  id: { type: 'str', max: 16, nullable: true, default: null },
};

function playersDetail(m, withHp) {
  return [1, 2].map((n) => ({
    side: n, name: m[`player${n}_name`], rating: m[`player${n}_rating`], tier: m[`player${n}_tier`], max_hp: m[`player${n}_max_hp`],
    ...(withHp ? { hp: m[`player${n}_hp`] } : {}), skins: m[`player${n}_skins`], is_bot: m[`player${n}_is_bot`],
  }));
}

export function matchesRouter(ctx) {
  const r = Router();
  const db = ctx.db;
  const auth = current(ctx);

  async function profileOf(caller) {
    const p = await db.profile.findUnique({ where: { id: caller.profileId } });
    if (!p) throw new AppError('not_found', 'Profile not found');
    return p;
  }

  function actorFor(matchId, caller) {
    const actor = ctx.matches.get(matchId);
    if (!actor) throw new AppError('match_not_live', 'This match is not running');
    const side = actor.sideOf(caller.profileId);
    if (side === null) throw new AppError('forbidden', 'You are not in this match');
    return [actor, side];
  }

  // Queue -------------------------------------------------------------------------
  r.post('/queue/join', auth, ah(async (req, res) => {
    const b = body(req, { mode: { type: 'str', enum: ['ranked'], default: 'ranked' }, map: { type: 'str', max: 16, default: 'any' } });
    enforce(`queue:${req.caller.profileId}`, ctx.cfg.rate_limits.queue_join);
    res.json(await ctx.matchmaker.join(await profileOf(req.caller), b.map, clientIp(req)));
  }));

  r.delete('/queue', auth, ah(async (req, res) => {
    await ctx.matchmaker.leave(req.caller.profileId);
    res.json({ state: 'idle' });
  }));

  r.get('/queue', auth, (req, res) => res.json(ctx.matchmaker.status(req.caller.profileId)));

  r.post('/queue/respond', auth, ah(async (req, res) => {
    const b = body(req, { proposal_id: { type: 'str', max: 40 }, accept: { type: 'bool' } });
    res.json(await ctx.matchmaker.respond(req.caller.profileId, b.proposal_id, b.accept));
  }));

  // Starting bot and practice matches -----------------------------------------------
  async function startVsCpu(kind, req, res) {
    const b = body(req, { map: { type: 'str', max: 16, default: 'bit' }, personality: { type: 'str', max: 16, nullable: true, default: null } });
    const pid = req.caller.profileId;
    if (kind === 'bot' && !ctx.cfg.features.bots) throw new AppError('forbidden', 'Bot matches are switched off');
    const active = ctx.matches.activeMatchFor(pid);
    if (active) throw new AppError('conflict', 'You are already in a match', { match_id: active });
    const prof = await profileOf(req.caller);
    if (kind === 'bot' && prof.queue_ban_until && new Date(prof.queue_ban_until) > new Date()) {
      throw new AppError('forbidden', 'Queue ban for leaving matches early');
    }
    let mc;
    try {
      mc = mapCfg(ctx.cfg, b.map);
    } catch {
      throw new AppError('validation', 'Unknown map');
    }
    if (getTier(prof.rating, ctx.cfg) < mc.min_tier) throw new AppError('forbidden', `The ${b.map} map needs tier ${mc.min_tier} or higher`);
    await ctx.matchmaker.leave(pid);
    let actor;
    if (kind === 'bot') {
      if (b.personality && !(b.personality in ctx.cfg.bots.personalities)) throw new AppError('validation', 'Unknown bot personality');
      const opp = await ctx.matches.botProfile(b.personality);
      actor = await ctx.matches.createMatch('bot', b.map, prof, opp, { opponentKind: 'bot' });
    } else {
      const opp = await ctx.matches.botProfile('dummy');
      actor = await ctx.matches.createMatch('practice', b.map, prof, opp, { opponentKind: 'dummy' });
    }
    res.json({ match_id: actor.id });
  }

  r.post('/matches/bot', auth, ah((req, res) => startVsCpu('bot', req, res)));
  r.post('/matches/practice', auth, ah((req, res) => startVsCpu('practice', req, res)));

  // Reading matches -----------------------------------------------------------------
  /** Featured live matches for spectating (declared before /matches/:id). */
  r.get('/matches/live', auth, (req, res) => {
    if (!ctx.cfg.features.spectate) return res.json({ matches: [], enabled: false });
    return res.json({
      enabled: true,
      matches: ctx.matches.liveMatches().filter((a) => a.m.mode === 'ranked' && a.m.status === 'live')
        .map((a) => ({ id: a.id, mode: a.m.mode, map: a.m.map, players: [a.side(1).name, a.side(2).name] })),
    });
  });

  r.get('/matches/:matchId', auth, ah(async (req, res) => {
    const { matchId } = req.params;
    const actor = ctx.matches.get(matchId);
    if (actor) {
      const side = actor.sideOf(req.caller.profileId);
      const out = matchBrief(actor.m, req.caller.profileId);
      if (side !== null) out.snapshot = actor.snapshot(side);
      if (actor.finished) out.result = actor.m.result;
      return res.json(out);
    }
    const m = await db.match.findUnique({ where: { id: matchId } });
    if (!m) throw new AppError('not_found', 'Match not found');
    const out = matchBrief(m, req.caller.profileId);
    out.result = m.status === 'finished' || m.status === 'aborted' ? m.result : null;
    out.players_detail = playersDetail(m, true);
    out.stage = { theme: m.stage_theme, owner_side: m.stage_owner_side };
    return res.json(out);
  }));

  /** Public events only (no code, hands or hint text): the replay feed. */
  r.get('/matches/:matchId/events', auth, ah(async (req, res) => {
    const q = query(req, { after_seq: { type: 'int', min: 0, default: 0 }, limit: { type: 'int', max: 1000, default: 500 } });
    if (!ctx.cfg.features.replays) throw new AppError('forbidden', 'Replays are switched off');
    const { matchId } = req.params;
    const actor = ctx.matches.get(matchId);
    if (actor && !actor.finished) throw new AppError('conflict', 'Replays open when the match ends');
    const m = await db.match.findUnique({ where: { id: matchId } });
    if (!m) throw new AppError('not_found', 'Match not found');
    const rows = await db.matchEvent.findMany({
      where: { match_id: matchId, seq: { gt: q.after_seq }, visibility: 'both' }, orderBy: { seq: 'asc' }, take: Math.max(0, q.limit),
    });
    res.json({
      match: matchBrief(m, req.caller.profileId),
      events: rows.map((e) => ({ seq: e.seq, t_ms: e.t_ms, type: e.type, data: e.payload })),
      players: playersDetail(m, false),
      stage: { theme: m.stage_theme, owner_side: m.stage_owner_side },
    });
  }));

  // Actions -----------------------------------------------------------------------------
  r.post('/matches/:matchId/run', auth, ah(async (req, res) => {
    const b = body(req, {
      slot: { type: 'int', min: 0, max: 3 }, language: { type: 'str', max: 16, default: 'python' },
      code: { type: 'str', max: 70000 }, input: { type: 'str', max: 70000, nullable: true, default: null },
    });
    const [actor, side] = actorFor(req.params.matchId, req.caller);
    if (actor.m.status !== 'live') throw new AppError('match_not_live', 'The match is not live');
    const slug = actor.cardSlug(side, b.slot);
    const pid = req.caller.profileId;
    enforce(`run:${pid}`, ctx.cfg.rate_limits.run);
    if (ctx.runsInflight.has(pid)) throw new AppError('busy', 'A Run is already in progress');
    ctx.runsInflight.add(pid);
    try {
      const out = await runSamples(ctx.judge, ctx.cfg, ctx.problems.get(slug), b.language, b.code, b.input, actor.m.mode === 'practice');
      out.problem = slug;
      res.json(out);
    } finally {
      ctx.runsInflight.delete(pid);
    }
  }));

  r.post('/matches/:matchId/submit', auth, ah(async (req, res) => {
    const b = body(req, {
      slot: { type: 'int', min: 0, max: 3 }, language: { type: 'str', max: 16, default: 'python' }, code: { type: 'str', max: 70000 },
      cmd_id: { type: 'str', min: 4, max: 64 }, problem: { type: 'str', max: 64, nullable: true, default: null },
    });
    const [actor, side] = actorFor(req.params.matchId, req.caller);
    const out = await actor.send('submit', side, { slot: b.slot, code: b.code, language: b.language, problem: b.problem }, b.cmd_id);
    const sub = out && out._sub;
    res.status(202).json({ submission_id: sub ? sub.id : null, slot: out ? out.slot : null });
  }));

  for (const kind of ['block', 'hint', 'reroll', 'forfeit', 'emote']) {
    r.post(`/matches/:matchId/${kind}`, auth, ah(async (req, res) => {
      const b = body(req, ACTION);
      const [actor, side] = actorFor(req.params.matchId, req.caller);
      const data = {};
      if (b.slot !== null) data.slot = b.slot;
      if (b.id !== null) data.id = b.id;
      if ((kind === 'hint' || kind === 'reroll') && b.slot === null) throw new AppError('validation', 'slot is required');
      res.json(await actor.send(kind, side, data, b.cmd_id));
    }));
  }

  // Drafts (owner-only, last write wins) ----------------------------------------------
  r.put('/matches/:matchId/drafts/:slot', auth, ah(async (req, res) => {
    const slot = intParam(req, 'slot');
    const b = body(req, { language: { type: 'str', max: 16, default: 'python' }, code: { type: 'str', max: 70000 }, problem: { type: 'str', max: 64, default: '' } });
    if (slot < 0 || slot > 3) throw new AppError('validation', 'slot must be 0 to 3');
    if (Buffer.byteLength(b.code, 'utf8') > ctx.cfg.match.max_code_bytes) throw new AppError('code_too_large', 'Drafts must be under 64 KB');
    const { matchId } = req.params;
    const [actor] = actorFor(matchId, req.caller);
    if (actor.finished) throw new AppError('match_not_live', 'The match is over');
    const pid = req.caller.profileId;
    const now = new Date();
    const d = await db.draft.findFirst({ where: { match_id: matchId, profile_id: pid, slot, language: b.language } });
    if (d) await db.draft.update({ where: { id: d.id }, data: { code: b.code, problem_slug: b.problem, updated_at: now } });
    else await db.draft.create({ data: { match_id: matchId, profile_id: pid, slot, language: b.language, code: b.code, problem_slug: b.problem, updated_at: now } });
    res.json({ saved_at: iso(now) });
  }));

  r.get('/matches/:matchId/drafts', auth, ah(async (req, res) => {
    const rows = await db.draft.findMany({ where: { match_id: req.params.matchId, profile_id: req.caller.profileId }, orderBy: { id: 'asc' } });
    res.json({ drafts: rows.map((d) => ({ slot: d.slot, language: d.language, code: d.code, problem: d.problem_slug, saved_at: iso(d.updated_at) })) });
  }));

  r.get('/matches/:matchId/drafts/:slot', auth, ah(async (req, res) => {
    const slot = intParam(req, 'slot');
    const d = await db.draft.findFirst({ where: { match_id: req.params.matchId, profile_id: req.caller.profileId, slot }, orderBy: { id: 'asc' } });
    if (!d) throw new AppError('not_found', 'No draft');
    res.json({ slot: d.slot, language: d.language, code: d.code, problem: d.problem_slug });
  }));

  return r;
}
