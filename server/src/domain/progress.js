// Arena Points, daily quests and achievements, computed from a match summary.
// Pure functions over plain data. Practice matches never reach these with a
// non-zero result; computeAp returns nothing for them as a second guard.

import { PyRandom } from '../pyrandom.js';

const SUMMARY_DEFAULTS = {
  hits_landed: 0, hits_stretching: 0, heroic_hits: 0, crits: 0, blocks_absorbed: 0, backfires: 0, accepted: 0,
  submissions: 0, accepted_run_after: 0, failed_any: false, flawless: false, blitz: false, elapsed_s: 0,
  lowest_hp: 0, max_hp: 1, one_shot: false, max_streak: 0,
};

/** {mode, map, label, end_reason, ...counts}; label is null for an aborted match. */
export function sideSummary(fields) {
  return { ...SUMMARY_DEFAULTS, ...fields };
}

export const won = (s) => s.label === 'victory' || s.label === 'hollow_victory';
export const counts = (s) => s.mode !== 'practice' && s.label !== null && s.label !== undefined;

/** Returns [total, lines] where lines is [[key, ap], ...]. */
export function computeAp(s, firstWinToday, casualGainedToday, cfg) {
  const e = cfg.economy;
  if (!counts(s)) return [0, []];
  let lines = [['match', e.match]];
  if (won(s)) lines.push(['win', e.win]);
  if (s.label === 'draw') lines.push(['draw', e.draw]);
  if (s.hits_landed) lines.push(['hits', Math.min(e.per_match_hit_cap, e.per_hit * s.hits_landed)]);
  if (won(s) && s.flawless) lines.push(['flawless', e.flawless]);
  if (won(s) && s.blitz) lines.push(['blitz', e.blitz]);
  if (won(s) && firstWinToday) lines.push(['first_win_of_day', e.first_win_of_day]);
  if (s.max_streak >= 2) lines.push(['streak', Math.min(e.streak_cap, e.streak_per_level * (s.max_streak - 1))]);

  if (s.mode === 'bot' || s.mode === 'friendly') {
    lines = lines.map(([k, v]) => [k, Math.floor((v * e.casual_modes_pct) / 100)]);
    let room = Math.max(0, e.casual_modes_daily_cap - casualGainedToday);
    const capped = [];
    for (const [k, v] of lines) {
      const take = Math.min(v, room);
      room -= take;
      capped.push([k, take]);
    }
    const sum = (ls) => ls.reduce((a, [, v]) => a + v, 0);
    if (sum(capped) < sum(lines)) capped.push(['daily_cap', 0]);
    lines = capped;
  }
  lines = lines.filter(([k, v]) => v > 0 || k === 'daily_cap');
  return [lines.reduce((a, [, v]) => a + v, 0), lines];
}

/** Three quests per day, a seeded random choice from the UTC date (YYYY-MM-DD). */
export function dailyQuests(utcDate, cfg) {
  const rng = new PyRandom(`quests:${utcDate}`);
  const pool = rng.shuffle([...cfg.quests]);
  return pool.slice(0, cfg.quests_per_day).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function questIncrement(q, s) {
  if (!counts(s)) return 0;
  switch (q.kind) {
    case 'hits': return s.hits_landed;
    case 'hits_stretching': return s.hits_stretching;
    case 'blocks_absorbed': return s.blocks_absorbed;
    case 'win_on_map': return won(s) && s.map === q.map ? 1 : 0;
    case 'finish_bot': return s.mode === 'bot' ? 1 : 0;
    case 'win_no_backfire': return won(s) && s.backfires === 0 ? 1 : 0;
    case 'matches_played': return 1;
    default: return 0;
  }
}

// Achievements -------------------------------------------------------------------

const COUNTER_KEYS = ['career_blocks', 'ac_streak', 'ranked_win_streak', 'bit_wins'];

/** Career counters as stored in profiles.counters (unknown keys are kept). */
export function countersFromJson(d) {
  const out = { career_blocks: 0, ac_streak: 0, ranked_win_streak: 0, bit_wins: 0, extra: {} };
  for (const [k, v] of Object.entries(d || {})) {
    if (COUNTER_KEYS.includes(k)) out[k] = v; else out.extra[k] = v;
  }
  return out;
}

export function countersToJson(c) {
  return { career_blocks: c.career_blocks, ac_streak: c.ac_streak, ranked_win_streak: c.ranked_win_streak, bit_wins: c.bit_wins, ...c.extra };
}

export function updateCounters(c, s) {
  if (!counts(s)) return c;
  const ac = !s.failed_any ? c.ac_streak + s.accepted : s.accepted_run_after;
  let rw = c.ranked_win_streak;
  if (s.mode === 'ranked') rw = won(s) ? rw + 1 : 0;
  return {
    ...c,
    career_blocks: c.career_blocks + s.blocks_absorbed,
    ac_streak: ac,
    ranked_win_streak: rw,
    bit_wins: c.bit_wins + (won(s) && s.map === 'bit' ? 1 : 0),
  };
}

/** Achievement ids newly earned by this match (counters already updated). */
export function achievementsEarned(s, after, already, cfg) {
  if (!counts(s)) return [];
  const out = [];
  for (const a of cfg.achievements) {
    if (already.has(a.id)) continue;
    let hit = false;
    switch (a.id) {
      case 'flawless': hit = won(s) && s.flawless; break;
      case 'comeback': hit = won(s) && s.lowest_hp * 100 <= (a.hp_pct || 10) * s.max_hp; break;
      case 'one_shot': hit = won(s) && s.one_shot; break;
      case 'heroic': hit = s.heroic_hits > 0; break;
      case 'wall': hit = after.career_blocks >= (a.target || 3); break;
      case 'crit_machine': hit = s.crits >= (a.target || 5); break;
      case 'bit_master': hit = after.bit_wins >= (a.target || 25); break;
      case 'perfectionist': hit = after.ac_streak >= (a.target || 10); break;
      case 'marathon': hit = s.elapsed_s > (a.min_s || 3600) && s.end_reason !== 'aborted'; break;
      case 'hot_streak': hit = after.ranked_win_streak >= (a.target || 5); break;
      default: break;
    }
    if (hit) out.push(a.id);
  }
  return out;
}
