// End-of-match writes, all inside the transaction that closes the match: rating,
// profile stats, rating_history, Arena Points, quests, achievements and skin
// unlocks. Practice matches change none of it. tx is a Prisma transaction client.

import { tierRow, feature } from '../domain/gameconfig.js';
import * as P from '../domain/progress.js';
import { applyDailyCap, applyRating, getTier, modePct, ratingDelta, rematchPct, scaleDelta, speedBracket } from '../domain/rules.js';
import { evaluateUnlocks } from '../skins/service.js';
import { utcDay } from '../util.js';
import { side } from './side.js';

export const todayUtc = () => utcDay();

function rollDay(p, day) {
  if (p.daily_day !== day) {
    p.daily_day = day;
    p.bot_gain_today = 0;
    p.casual_ap_today = 0;
  }
}

const PROFILE_WRITABLE = ['rating', 'peak_rating', 'wins', 'losses', 'draws', 'points', 'bot_gain_today', 'casual_ap_today',
  'daily_day', 'last_win_day', 'no_show_strikes', 'queue_ban_until', 'counters', 'badges'];
const saveProfile = (tx, p) => tx.profile.update({ where: { id: p.id }, data: Object.fromEntries(PROFILE_WRITABLE.map((k) => [k, p[k]])) });

export async function applyStrikes(tx, profileIds, cfg) {
  for (const pid of profileIds) {
    const p = await tx.profile.findUnique({ where: { id: pid } });
    if (!p) continue;
    p.no_show_strikes += 1;
    if (p.no_show_strikes >= cfg.match.no_show_strikes) {
      p.queue_ban_until = new Date(Date.now() + cfg.match.no_show_ban_min * 60_000);
      p.no_show_strikes = 0;
    }
    await saveProfile(tx, p);
  }
}

async function previousMeetings(tx, m, cfg) {
  const since = new Date(Date.now() - cfg.rating.rematch_window_min * 60_000);
  const a = m.player1_profile_id;
  const b = m.player2_profile_id;
  return tx.match.count({
    where: {
      mode: 'ranked', status: 'finished', id: { not: m.id }, end_time: { gte: since },
      OR: [{ player1_profile_id: a, player2_profile_id: b }, { player1_profile_id: b, player2_profile_id: a }],
    },
  });
}

function profileAfter(p, cfg) {
  const t = getTier(p.rating, cfg);
  return { rating: p.rating, tier: t, max_hp: tierRow(cfg, t).max_hp, peak_rating: p.peak_rating };
}

/** o: {outcome, winner_side, end_reason, labels}; fills payload.sides and rewards. */
export async function finishTx(tx, m, o, cfg, payload, rewards) {
  const day = todayUtc();
  const elapsedS = Math.floor(m.elapsed_ms / 1000);
  const sides = { 1: side(m, 1), 2: side(m, 2) };
  let raw = { 1: [[], 0], 2: [[], 0] };

  if (o.outcome === 'win' && o.winner_side) {
    const w = sides[o.winner_side];
    const l = sides[3 - o.winner_side];
    const r = ratingDelta(w.tier, l.tier, w.hp, w.max_hp, l.hp, l.max_hp, elapsedS, w.hits_landed, cfg);
    raw[o.winner_side] = [r.steps.map(([lbl, wd]) => [lbl, wd, 0]), r.winner];
    raw[3 - o.winner_side] = [r.steps.map(([lbl, , ld]) => [lbl, 0, ld]), r.loser];
  } else if (o.outcome === 'draw') {
    raw = { 1: [[['draw', 0, 0]], 0], 2: [[['draw', 0, 0]], 0] };
  }

  let rematch = 100;
  if (m.mode === 'ranked') rematch = rematchPct(await previousMeetings(tx, m, cfg), cfg);

  for (const n of [1, 2]) {
    const sd = sides[n];
    if (sd.is_bot) continue;
    const prof = await tx.profile.findUnique({ where: { id: sd.profile_id } });
    if (!prof) continue;
    let [steps, deltaRaw] = raw[n];
    if (m.mode === 'practice') {
      payload.sides[String(n)] = { before: prof.rating, after: prof.rating, delta: 0, steps: [], multiplier: 0, profile_after: profileAfter(prof, cfg), practice: true };
      rewards[n] = { ap: 0, lines: [], quests: [], achievements: [], unlocked: [] };
      continue;
    }
    rollDay(prof, day);
    const pct = Math.floor((modePct(m.mode, true, cfg) * rematch) / 100);
    let delta = scaleDelta(deltaRaw, pct);
    if (m.mode === 'bot') {
      const capped = applyDailyCap(delta, prof.bot_gain_today, cfg.rating.bot_daily_gain_cap);
      if (capped !== delta) steps = [...steps, ['daily_cap', 0, 0]];
      delta = capped;
      if (delta > 0) prof.bot_gain_today += delta;
    }
    const before = prof.rating;
    const tierBefore = getTier(before, cfg);
    prof.rating = applyRating(before, delta, cfg);
    prof.peak_rating = Math.max(prof.peak_rating, prof.rating);
    const label = o.labels[n];
    if (label === 'victory' || label === 'hollow_victory') prof.wins += 1;
    else if (label === 'draw') prof.draws += 1;
    else prof.losses += 1;
    const tierAfter = getTier(prof.rating, cfg);
    const stepRows = steps.map(([lbl, wd, ld]) => ({ key: lbl, delta: n === o.winner_side ? wd : ld }));
    await tx.ratingHistory.create({
      data: { profile_id: prof.id, match_id: m.id, before, after: prof.rating, delta: prof.rating - before, steps: stepRows, multiplier: pct, created_at: new Date() },
    });
    const block = {
      before, after: prof.rating, delta: prof.rating - before, raw_delta: deltaRaw,
      steps: stepRows, multiplier: pct, profile_after: profileAfter(prof, cfg),
    };
    if (tierAfter !== tierBefore) {
      block.promotion = {
        from_tier: tierBefore, to_tier: tierAfter, title: tierRow(cfg, tierAfter).title,
        old_max_hp: tierRow(cfg, tierBefore).max_hp, new_max_hp: tierRow(cfg, tierAfter).max_hp,
        direction: tierAfter > tierBefore ? 'up' : 'down',
      };
    }
    payload.sides[String(n)] = block;
    rewards[n] = await progressFor(tx, m, n, prof, o, payload, cfg, day);
    await saveProfile(tx, prof);
  }
}

export function summaryFor(m, n, o, payload, cfg) {
  const sd = side(m, n);
  const st = sd.stats || {};
  const block = payload.sides[String(n)] || {};
  const keys = (block.steps || []).map((s) => s.key);
  const won = o.labels[n] === 'victory' || o.labels[n] === 'hollow_victory';
  return P.sideSummary({
    mode: m.mode, map: m.map, label: o.labels[n] ?? null, end_reason: o.end_reason,
    hits_landed: sd.hits_landed, hits_stretching: st.hits_stretching ?? 0, heroic_hits: st.heroic_hits ?? 0,
    crits: st.crits ?? 0, blocks_absorbed: st.blocks_absorbed ?? 0, backfires: st.backfires ?? 0,
    accepted: st.accepted ?? 0, submissions: st.submissions ?? 0,
    accepted_run_after: st.accepted_run_after ?? 0, failed_any: Boolean(st.failed_any),
    flawless: won && keys.includes('flawless'),
    blitz: won && speedBracket(Math.floor(m.elapsed_ms / 1000), cfg) === 'blitz',
    elapsed_s: Math.floor(m.elapsed_ms / 1000), lowest_hp: st.lowest_hp ?? sd.hp, max_hp: sd.max_hp,
    one_shot: Boolean(st.one_shot), max_streak: st.max_streak ?? 0,
  });
}

async function progressFor(tx, m, n, prof, o, payload, cfg, day) {
  const summ = summaryFor(m, n, o, payload, cfg);
  const out = { ap: 0, lines: [], quests: [], achievements: [], unlocked: [] };
  const won = P.won(summ);
  const firstWin = won && prof.last_win_day !== day;
  const casual = m.mode === 'bot' || m.mode === 'friendly';
  let [ap, lines] = P.computeAp(summ, firstWin, prof.casual_ap_today, cfg);
  if (!feature(cfg, 'streaks')) {
    lines = lines.filter(([k]) => k !== 'streak');
    ap = lines.reduce((a, [, v]) => a + v, 0);
  }
  prof.points += ap;
  if (casual) prof.casual_ap_today += ap;
  if (won) prof.last_win_day = day;
  out.ap = ap;
  out.lines = lines.map(([k, v]) => ({ key: k, ap: v }));

  if (feature(cfg, 'quests')) {
    for (const q of P.dailyQuests(day, cfg)) {
      const inc = P.questIncrement(q, summ);
      const row = await tx.questProgress.findFirst({ where: { profile_id: prof.id, day, key: q.id } });
      if (inc && (!row || row.earned_at === null)) {
        const progress = Math.min(q.target, (row ? row.progress : 0) + inc);
        const earnedAt = progress >= q.target ? new Date() : null;
        if (row) await tx.questProgress.update({ where: { id: row.id }, data: { progress, earned_at: earnedAt } });
        else await tx.questProgress.create({ data: { profile_id: prof.id, day, key: q.id, progress, target: q.target, earned_at: earnedAt } });
        out.quests.push({ id: q.id, progress, target: q.target, ap: q.ap, complete: earnedAt !== null });
      }
    }
  }

  if (feature(cfg, 'achievements')) {
    const counters = P.updateCounters(P.countersFromJson(prof.counters), summ);
    prof.counters = P.countersToJson(counters);
    const have = new Set((await tx.achievement.findMany({ where: { profile_id: prof.id }, select: { key: true } })).map((a) => a.key));
    for (const key of P.achievementsEarned(summ, counters, have, cfg)) {
      await tx.achievement.create({ data: { profile_id: prof.id, key, progress: 1, earned_at: new Date() } });
      out.achievements.push(key);
      prof.badges = [...(prof.badges || []), key];
    }
  }

  out.unlocked = await evaluateUnlocks(tx, prof, cfg, out.achievements);
  return out;
}
