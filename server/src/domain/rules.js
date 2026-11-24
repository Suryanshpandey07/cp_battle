// The game rules: tiers, damage, outcomes, power-ups and rating. Pure functions
// with integer maths only; no I/O, no clock, no randomness. Skins never change a
// number, so nothing here takes a skin or cosmetic argument.

import { tierRow } from './gameconfig.js';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const floorDiv = (a, b) => Math.floor(a / b);

// Tiers ------------------------------------------------------------------------

/** A rating (player or problem) to its tier: 1 below 1200, 2 below 1400, ... 5. */
export function getTier(rating, cfg) {
  let tier = 1;
  for (const row of cfg.tiers) if (rating >= row.min_rating) tier = row.tier;
  return tier;
}

export const tierRowForRating = (rating, cfg) => tierRow(cfg, getTier(rating, cfg));
export const maxHpForRating = (rating, cfg) => tierRowForRating(rating, cfg).max_hp;
export const clampRating = (rating, cfg) => Math.max(cfg.rating.floor, rating);

// Damage -----------------------------------------------------------------------

export function multiplierPcts(tierDiff, cfg) {
  const m = cfg.multiplier;
  return [clamp(100 - m.step_pct * tierDiff, m.min_pct, m.max_pct), clamp(100 + m.step_pct * tierDiff, m.min_pct, m.max_pct)];
}

export const scenarioName = (tierDiff, cfg) => cfg.scenarios[String(tierDiff)];
export const isCrit = (tierDiff, cfg) => tierDiff <= cfg.crit_max_tier_diff;

/** Damage on a correct submission and recoil on a wrong one (tier_diff = player - problem). */
export function computePreview(playerTier, problemTier, baseDamage, baseRecoil, cfg) {
  const diff = playerTier - problemTier;
  const [dmgPct, recoilPct] = multiplierPcts(diff, cfg);
  return {
    damage: floorDiv(baseDamage * dmgPct, 100),
    recoil: floorDiv(baseRecoil * recoilPct, 100),
    tier_diff: diff,
    scenario: scenarioName(diff, cfg),
    crit: isCrit(diff, cfg),
    dmg_pct: dmgPct,
    recoil_pct: recoilPct,
  };
}

/** Light under 10% of max HP, heavy under 25%, massive under 50%, else nuke. */
export function damageClass(amount, maxHp, cfg) {
  const c = cfg.damage_classes;
  const scaled = amount * 100;
  if (scaled < c.light_below_pct * maxHp) return 'light';
  if (scaled < c.heavy_below_pct * maxHp) return 'heavy';
  if (scaled < c.massive_below_pct * maxHp) return 'massive';
  return 'nuke';
}

export const applyHpLoss = (hp, amount) => Math.max(0, hp - amount);

// Outcomes ---------------------------------------------------------------------

/**
 * Who won a finished match and what to call each side's result.
 * p1, p2: {hp, hits_landed, ko_by_recoil, left}
 * Returns {outcome: win|draw|aborted, winner_side, end_reason, labels: {side: label}}.
 */
export function classify(endReason, p1, p2) {
  if (endReason === 'aborted') return { outcome: 'aborted', winner_side: null, end_reason: endReason, labels: {} };
  let winner;
  if (endReason === 'forfeit' || endReason === 'disconnect') {
    if (p1.left && p2.left) return { outcome: 'aborted', winner_side: null, end_reason: 'aborted', labels: {} };
    winner = p1.left ? 2 : 1;
  } else if (endReason === 'ko') {
    if (p1.hp === 0 && p2.hp === 0) return { outcome: 'draw', winner_side: null, end_reason: endReason, labels: { 1: 'draw', 2: 'draw' } };
    winner = p1.hp === 0 ? 2 : 1;
  } else {
    if (p1.hp === p2.hp) return { outcome: 'draw', winner_side: null, end_reason: endReason, labels: { 1: 'draw', 2: 'draw' } };
    winner = p1.hp > p2.hp ? 1 : 2;
  }
  const [w, l] = winner === 1 ? [p1, p2] : [p2, p1];
  const loser = 3 - winner;
  const wLabel = w.hits_landed > 0 ? 'victory' : 'hollow_victory';
  const lLabel = l.hp === 0 && l.ko_by_recoil && w.hits_landed === 0 ? 'self_destruct' : 'defeat';
  return { outcome: 'win', winner_side: winner, end_reason: endReason, labels: { [winner]: wLabel, [loser]: lLabel } };
}

// Power-ups (callers pass the time) ---------------------------------------------

export const shieldActive = (until, nowMs) => until !== null && until !== undefined && nowMs < until;
export const shieldUntil = (nowMs, cfg) => nowMs + cfg.powerups.block.window_s * 1000;
/** [blocks, hints]. Practice: no Block and unlimited hints (-1). */
export const initialCharges = (mode, cfg) => (mode === 'practice' ? [0, -1] : [cfg.powerups.block.charges, cfg.powerups.hint.charges]);
export function nextHintLevel(revealed, cfg) {
  const nxt = revealed + 1;
  return nxt <= cfg.powerups.hint.levels ? nxt : null;
}
export const spend = (charges) => (charges < 0 ? charges : charges - 1);
export const hasCharge = (charges) => charges < 0 || charges > 0;

// Rating -----------------------------------------------------------------------

export function speedBracket(elapsedS, cfg) {
  for (const b of cfg.rating.speed_brackets) if (elapsedS <= b.max_s) return b.name;
  return cfg.rating.slow_bracket_name;
}

/**
 * The rating change of a win. Steps are [label, winner change, loser change].
 * Shares are compared as exact fractions (cross-multiplied integers).
 */
export function ratingDelta(wTier, lTier, wHp, wMax, lHp, lMax, elapsedS, winnerHits, cfg) {
  const r = cfg.rating;
  const steps = [['win', r.win, -r.win]];
  const d = lTier - wTier;
  if (d) steps.push(['rank_gap', r.rank_gap * d, -r.rank_gap * d]);
  // wHp/wMax - lHp/lMax >= flawless_points/100  <=>  100*(wHp*lMax - lHp*wMax) >= fp*wMax*lMax
  if (100 * (wHp * lMax - lHp * wMax) >= r.flawless_points * wMax * lMax) {
    steps.push(['flawless', r.flawless_bonus, -r.flawless_bonus]);
  } else if (100 * wHp <= r.narrow_win_share_pct * wMax && wTier >= lTier) {
    steps.push(['narrow_win', -r.narrow_win_penalty, r.narrow_win_penalty]);
  }
  for (const b of r.speed_brackets) {
    if (elapsedS <= b.max_s) { steps.push([b.name, b.bonus, 0]); break; }
  }
  let winner = steps.reduce((a, s) => a + s[1], 0);
  const loser = steps.reduce((a, s) => a + s[2], 0);
  if (winnerHits === 0) { // Hollow Victory, applied last; overrides the speed bonus
    steps.push(['hollow_victory', -winner, 0]);
    winner = 0;
  }
  return { steps, winner, loser };
}

/** Multiply, then divide, rounding toward zero. */
export function scaleDelta(delta, pct) {
  const q = Math.floor((Math.abs(delta) * pct) / 100);
  return delta >= 0 || q === 0 ? q : -q;
}

export function rematchPct(previousMeetings, cfg) {
  const table = cfg.rating.rematch_multiplier_pct;
  return table[Math.min(previousMeetings, table.length - 1)];
}

export function modePct(mode, isHuman, cfg) {
  if (mode === 'ranked') return 100;
  if (mode === 'bot') return isHuman ? cfg.rating.bot_multiplier_pct : 0;
  if (mode === 'friendly') return cfg.rating.friendly_multiplier_pct;
  return 0;
}

/** Cap gains only; losses are never capped. */
export function applyDailyCap(delta, gainedToday, cap) {
  if (delta <= 0) return delta;
  return Math.min(delta, Math.max(0, cap - gainedToday));
}

export const applyRating = (rating, delta, cfg) => Math.max(cfg.rating.floor, rating + delta);
