// Career statistics for the home page and profiles: streaks, damage, solves,
// maps, activity, achievements and the collection. summarize() is pure (it
// takes rows) so it is tested without a database; playerStats() runs the queries.

import { KINDS, loadRegistry } from '../skins/registry.js';
import { iso, pyRound, sortedObject, utcDay, daysBetween, DAY_MS } from '../util.js';

export const ACTIVITY_DAYS = 84; // twelve weeks for the heatmap

const sideOf = (m, pid) => (m.player1_profile_id === pid ? 1 : m.player2_profile_id === pid ? 2 : null);

/** W, L or D from one side's point of view. */
function resultOf(m, side) {
  if (m.outcome === 'draw' || m.winner_side === null || m.winner_side === undefined) return 'D';
  return m.winner_side === side ? 'W' : 'L';
}

const bump = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };

/** Aggregate finished matches (any order) for one profile. today: YYYY-MM-DD. */
export function summarize(matches, pid, today = utcDay()) {
  const rows = matches.filter((m) => m.status === 'finished' && sideOf(m, pid))
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const results = [];
  const byMap = {};
  const byMode = {};
  const activity = {};
  const totals = {};
  let biggest = 0;
  let fastest = null;
  let koWins = 0;
  const elapsed = [];
  for (const m of rows) {
    const side = sideOf(m, pid) || 1;
    const r = resultOf(m, side);
    results.push(r);
    const mp = (byMap[m.map] ||= { played: 0, wins: 0, losses: 0 });
    mp.played += 1;
    mp.wins += r === 'W' ? 1 : 0;
    mp.losses += r === 'L' ? 1 : 0;
    bump(byMode, m.mode);
    const day = utcDay(m.created_at);
    if (daysBetween(day, today) < ACTIVITY_DAYS) bump(activity, day);
    const st = (side === 1 ? m.player1_stats : m.player2_stats) || {};
    bump(totals, 'damage_dealt', side === 1 ? m.player1_damage_dealt : m.player2_damage_dealt);
    bump(totals, 'hits_landed', side === 1 ? m.player1_hits_landed : m.player2_hits_landed);
    for (const k of ['crits', 'backfires', 'blocks_absorbed', 'accepted', 'submissions', 'hints_used', 'damage_taken']) {
      bump(totals, k, parseInt(st[k] || 0, 10));
    }
    biggest = Math.max(biggest, parseInt(st.biggest_hit || 0, 10));
    const fs = st.fastest_solve_ms;
    if (fs) fastest = fastest === null ? parseInt(fs, 10) : Math.min(fastest, parseInt(fs, 10));
    if (r === 'W' && m.end_reason === 'ko') koWins++;
    if (m.elapsed_ms) elapsed.push(m.elapsed_ms);
  }
  // streaks: the current run (from the latest match back) and the best winning run
  let kind = null;
  let count = 0;
  for (const r of [...results].reverse()) {
    if (r === 'D' || (kind !== null && kind !== r)) break;
    kind = r;
    count++;
  }
  let best = 0;
  let run = 0;
  for (const r of results) {
    run = r === 'W' ? run + 1 : 0;
    best = Math.max(best, run);
  }
  const played = results.length;
  const wins = results.filter((r) => r === 'W').length;
  return {
    played,
    wins,
    losses: results.filter((r) => r === 'L').length,
    draws: results.filter((r) => r === 'D').length,
    win_rate: played ? pyRound((100 * wins) / played) : 0,
    streak: { kind, count },
    best_win_streak: best,
    form: results.slice(-10),
    ko_wins: koWins,
    damage_dealt: totals.damage_dealt || 0,
    damage_taken: totals.damage_taken || 0,
    hits_landed: totals.hits_landed || 0,
    crits: totals.crits || 0,
    backfires: totals.backfires || 0,
    blocks_absorbed: totals.blocks_absorbed || 0,
    hints_used: totals.hints_used || 0,
    biggest_hit: biggest,
    fastest_solve_ms: fastest,
    avg_match_ms: elapsed.length ? pyRound(elapsed.reduce((a, b) => a + b, 0) / elapsed.length) : 0,
    by_map: byMap,
    by_mode: byMode,
    activity: sortedObject(activity),
  };
}

export async function playerStats(db, p, cfg, problemsById) {
  const pid = p.id;
  const matches = await db.match.findMany({
    where: { OR: [{ player1_profile_id: pid }, { player2_profile_id: pid }], status: 'finished' },
    orderBy: { created_at: 'desc' },
    take: 1000,
  });
  const out = summarize(matches, pid);

  // submissions: languages, verdicts and distinct problems solved
  const subs = await db.submission.findMany({
    where: { profile_id: pid, status: 'done' }, select: { language: true, verdict: true, problem_id: true },
  });
  const langs = {};
  const verdicts = {};
  const solved = new Set();
  for (const s of subs) {
    bump(langs, s.language);
    bump(verdicts, s.verdict || '?');
    if (s.verdict === 'AC') solved.add(s.problem_id);
  }
  const byBiome = {};
  const byTier = {};
  for (const id of solved) {
    const cp = problemsById.get(id);
    if (cp) { bump(byBiome, cp.biome); bump(byTier, String(cp.tier)); }
  }
  out.submissions = { judged: subs.length, accepted: verdicts.AC || 0, by_language: langs, by_verdict: verdicts };
  out.solved = { count: solved.size, of: problemsById.size, by_biome: byBiome, by_tier: sortedObject(byTier) };

  // achievements: every one, earned or not
  const earned = new Map((await db.achievement.findMany({ where: { profile_id: pid } })).map((a) => [a.key, a.earned_at]));
  const badges = new Set(p.badges || []);
  const counters = p.counters || {};
  const progress = {
    wall: counters.career_blocks ?? 0, bit_master: counters.bit_wins ?? 0,
    perfectionist: counters.ac_streak ?? 0, hot_streak: counters.ranked_win_streak ?? 0,
  };
  out.achievements = cfg.achievements.map((a) => ({
    id: a.id, reward: a.reward, target: a.target, earned: earned.has(a.id) || badges.has(a.id),
    earned_at: iso(earned.get(a.id)), progress: progress[a.id] ?? null,
  }));

  // the collection: owned out of available, per kind
  const reg = loadRegistry();
  const owned = new Set((await db.inventory.findMany({ where: { profile_id: pid }, select: { skin_id: true } })).map((r) => r.skin_id));
  out.collection = Object.fromEntries(KINDS.map((k) => [k, {
    owned: Object.entries(reg).filter(([sid, m]) => m.kind === k && owned.has(sid)).length,
    total: Object.values(reg).filter((m) => m.kind === k).length,
  }]));

  // rank by rating among people (not bots)
  const people = { is_bot: false, user_id: { not: null } };
  const above = await db.profile.count({ where: { ...people, rating: { gt: p.rating } } });
  const players = await db.profile.count({ where: people });
  out.rank = { position: above + 1, of: players };
  out.member_since = iso(p.created_at);
  out.since = utcDay(new Date(Date.now() - (ACTIVITY_DAYS - 1) * DAY_MS));
  return out;
}
