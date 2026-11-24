// Tiers, damage, hands, outcomes, power-ups, rating and progress against the
// golden vectors in shared/golden/ (the same vectors the Python rules passed).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SHARED_DIR, loadGameConfigFile } from '../src/config.js';
import { mapCfg, tierRow, validateGameConfig } from '../src/domain/gameconfig.js';
import * as R from '../src/domain/rules.js';
import * as H from '../src/domain/hand.js';
import * as P from '../src/domain/progress.js';

const CFG = loadGameConfigFile();
const golden = (name) => JSON.parse(fs.readFileSync(path.join(SHARED_DIR, 'golden', name), 'utf8'));

// Tiers ------------------------------------------------------------------------

test('tier thresholds', () => {
  const cases = [[0, 1], [800, 1], [1199, 1], [1200, 2], [1399, 2], [1400, 3], [1599, 3], [1600, 4], [1899, 4], [1900, 5], [3500, 5]];
  for (const [r, t] of cases) assert.equal(R.getTier(r, CFG), t, `rating ${r}`);
  for (const row of CFG.tiers) assert.equal(R.getTier(row.seed_rating, CFG), row.tier);
  assert.equal(R.maxHpForRating(1200, CFG), 28000);
  assert.equal(R.maxHpForRating(2100, CFG), 180000);
});

// Damage -----------------------------------------------------------------------

const DMG = golden('damage.json');

test('damage and recoil grids, and the derived balance tables', () => {
  for (let a = 1; a <= 5; a++) {
    for (let p = 1; p <= 5; p++) {
      const row = tierRow(CFG, p);
      const pv = R.computePreview(a, p, row.base_damage, row.base_recoil, CFG);
      assert.equal(pv.damage, DMG.grid_damage[a - 1][p - 1]);
      assert.equal(pv.recoil, DMG.grid_recoil[a - 1][p - 1]);
      const ownMax = tierRow(CFG, a).max_hp;
      assert.equal((Math.round((pv.recoil * 100 / ownMax + 1e-9) * 10) / 10).toFixed(1), DMG.recoil_share_pct_1dp[a - 1][p - 1]);
      assert.equal(Math.ceil(ownMax / pv.damage), DMG.hits_to_kill_same_tier[a - 1][p - 1]);
      assert.equal(Math.ceil(50000 / pv.damage), DMG.hits_to_kill_specialist[a - 1][p - 1]);
    }
  }
});

test('damage anchors, rating pairs and damage classes', () => {
  for (const a of DMG.anchors) {
    const row = tierRow(CFG, a.problem_tier);
    const pv = R.computePreview(a.player_tier, a.problem_tier, row.base_damage, row.base_recoil, CFG);
    assert.deepEqual([pv.damage, pv.recoil], [a.damage, a.recoil]);
  }
  for (const p of DMG.rating_pairs) {
    const pt = R.getTier(p.player_rating, CFG);
    const qt = R.getTier(p.problem_rating, CFG);
    const row = tierRow(CFG, qt);
    const pv = R.computePreview(pt, qt, row.base_damage, row.base_recoil, CFG);
    assert.deepEqual([pv.damage, pv.recoil, pv.tier_diff, pv.scenario, pv.crit], [p.damage, p.recoil, p.tier_diff, p.scenario, p.crit]);
  }
  for (const c of DMG.damage_classes) assert.equal(R.damageClass(c.amount, c.max_hp, CFG), c.class);
});

test('crits, scenarios and the HP floor', () => {
  assert.deepEqual([-4, -3, -2, -1, 0, 1, 2, 3, 4].map((d) => R.isCrit(d, CFG)), [true, true, true, false, false, false, false, false, false]);
  assert.deepEqual([-4, -3, -2, -1, 0, 1, 2, 3, 4].map((d) => R.scenarioName(d, CFG)),
    ['heroic', 'brave', 'ambitious', 'stretching', 'on_level', 'safe', 'lazy', 'cowardly', 'pathetic']);
  assert.equal(R.applyHpLoss(1000, 5000), 0);
  assert.equal(R.applyHpLoss(10000, 4000), 6000);
});

test('rule functions never accept a skin', () => {
  const fns = [R.computePreview, R.multiplierPcts, R.damageClass, R.applyHpLoss, R.ratingDelta, R.scaleDelta, R.applyRating, R.getTier, R.maxHpForRating];
  for (const fn of fns) {
    const params = fn.toString().slice(fn.toString().indexOf('(') + 1, fn.toString().indexOf(')')).toLowerCase();
    assert.ok(!/skin|cosmetic|equipped/.test(params), fn.name);
  }
});

// Rating -----------------------------------------------------------------------

const RAT = golden('rating.json');

test('the golden rating cases and grid', () => {
  for (const c of RAT.cases) {
    const r = R.ratingDelta(c.w_tier, c.l_tier, c.w_hp, c.w_max, c.l_hp, c.l_max, c.minutes * 60, c.winner_hits, CFG);
    assert.deepEqual([r.winner, r.loser], [c.winner, c.loser], c.name);
    assert.deepEqual(r.steps.map((s) => s[0]), c.labels, c.name);
  }
  for (const row of RAT.grid) {
    const [wt, lt, wHp, wMax, lHp, lMax, el, hits, wExp, lExp] = row;
    const r = R.ratingDelta(wt, lt, wHp, wMax, lHp, lMax, el, hits, CFG);
    assert.deepEqual([r.winner, r.loser], [wExp, lExp], JSON.stringify(row));
  }
});

function* allInputs() {
  for (let wt = 1; wt <= 5; wt++) {
    for (let lt = 1; lt <= 5; lt++) {
      const wMax = tierRow(CFG, wt).max_hp;
      const lMax = tierRow(CFG, lt).max_hp;
      for (let wPct = 1; wPct < 101; wPct += 3) {
        for (const lPct of [0, 5, 19, 20, 21, 60]) {
          for (const el of [60, 900, 901, 1800, 1801, 3600, 3601, 10800]) {
            for (const hits of [0, 1, 7]) {
              yield [wt, lt, Math.floor((wMax * wPct) / 100) || 1, wMax, Math.floor((lMax * lPct) / 100), lMax, el, hits];
            }
          }
        }
      }
    }
  }
}

test('rating properties over a grid of inputs', () => {
  for (const args of allInputs()) {
    const r = R.ratingDelta(...args, CFG);
    if (args[7] === 0) assert.equal(r.winner, 0);
    if (args[0] < args[1]) assert.ok(!r.steps.some((s) => s[0] === 'narrow_win'));
    for (const [label, w, l] of r.steps) if (['blitz', 'fast', 'standard'].includes(label)) assert.ok(w > 0 && l === 0);
    for (const start of [0, 10, 49, 50, 800, 1200]) {
      assert.ok(R.applyRating(start, r.loser, CFG) >= 0);
      assert.ok(R.applyRating(start, r.winner, CFG) >= 0);
    }
  }
});

test('speed brackets, multipliers and caps', () => {
  assert.deepEqual([0, 900, 901, 1800, 1801, 3600, 3601].map((s) => R.speedBracket(s, CFG)),
    ['blitz', 'blitz', 'fast', 'fast', 'standard', 'standard', 'methodical']);
  assert.equal(R.scaleDelta(75, 50), 37);
  assert.equal(R.scaleDelta(-75, 50), -37);
  assert.equal(R.scaleDelta(-1, 50), 0);
  assert.equal(R.applyDailyCap(60, 70, 100), 30);
  assert.equal(R.applyDailyCap(60, 120, 100), 0);
  assert.equal(R.applyDailyCap(-60, 500, 100), -60);
  assert.equal(R.modePct('bot', true, CFG), 50);
  assert.equal(R.modePct('practice', true, CFG), 0);
  assert.deepEqual([0, 1, 5].map((n) => R.rematchPct(n, CFG)), [100, 50, 25]);
});

// Hands ------------------------------------------------------------------------

const HANDS = golden('hands.json');
const POOL = HANDS.pool;

test('hand window', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((t) => H.handWindow(t, CFG)), [[1, 2, 3, 4], [1, 2, 3, 4], [2, 3, 4, 5], [2, 3, 4, 5], [2, 3, 4, 5]]);
});

test('hand golden vectors (decks shuffled exactly as before)', () => {
  for (const c of HANDS.cases) {
    const { decks } = H.buildDecks(POOL, c.seed, mapCfg(CFG, c.map), CFG);
    const asJson = Object.fromEntries(Object.entries(decks).map(([k, v]) => [String(k), v]));
    assert.deepEqual(asJson, c.decks, `${c.seed}-${c.map}`);
    const h = H.dealHand(decks, c.player_tier, CFG);
    assert.deepEqual(h.tiers, c.tiers);
    assert.deepEqual(h.slots, c.slots);
  }
});

test('every hand has four tiers and both players see the same cards', () => {
  for (let seed = 0; seed < 200; seed++) {
    for (const m of ['bit', 'binary', 'prestige']) {
      const { decks } = H.buildDecks(POOL, seed, mapCfg(CFG, m), CFG);
      for (let t = 1; t <= 5; t++) {
        const a = H.dealHand(decks, t, CFG);
        const b = H.dealHand(decks, t, CFG);
        assert.equal(new Set(a.tiers).size, 4);
        assert.deepEqual(a.slots, b.slots);
        assert.ok(a.slots.every((s) => s !== null));
      }
    }
  }
});

test('map filter with fallback, consume, re-deal and reroll', () => {
  const { decks, warnings } = H.buildDecks(POOL, 7, mapCfg(CFG, 'binary'), CFG);
  for (const deck of Object.values(decks)) assert.ok(deck[0].startsWith('n'));
  assert.ok(warnings.length);
  const d3 = H.buildDecks(POOL, 3, mapCfg(CFG, 'bit'), CFG).decks;
  const h = H.dealHand(d3, 1, CFG);
  const first = h.slots[0];
  const h2 = H.consumeSlot(h, 0);
  assert.equal(h2.slots[0], null);
  assert.ok(h2.solved.includes(first));
  const h3 = H.fillSlot(h2, d3, 0);
  assert.ok(h3.slots[0] !== null && h3.slots[0] !== first);
  const h4 = H.rerollSlot(h3, d3, 1);
  assert.notEqual(h4.slots[1], h3.slots[1]);
  assert.deepEqual(h4.tiers, h.tiers);
});

test('draw skips solved problems, then allows repeats; JSON round trip', () => {
  const decks = { 1: ['a', 'b'], 2: ['c'], 3: ['d'], 4: ['e'], 5: [] };
  let h = H.dealHand(decks, 1, CFG);
  assert.equal(h.slots[0], 'a');
  h = H.fillSlot(H.consumeSlot(h, 0), decks, 0);
  assert.equal(h.slots[0], 'b');
  h = H.fillSlot(H.consumeSlot(h, 0), decks, 0);
  assert.ok(['a', 'b'].includes(h.slots[0]));
  assert.deepEqual(H.handFromJson(JSON.parse(JSON.stringify(H.handToJson(h)))), H.handFromJson(H.handToJson(h)));
});

test('difficulty level is the card place in the hand window', () => {
  for (let t = 1; t <= 5; t++) assert.deepEqual(H.handWindow(t, CFG).map((p) => H.difficultyLevel(t, p, CFG)), [0, 1, 2, 3]);
  assert.equal(H.difficultyLevel(1, 1, CFG), 0);
  assert.equal(H.difficultyLevel(1, 4, CFG), 3);
  assert.equal(H.difficultyLevel(5, 2, CFG), 0);
  assert.equal(H.difficultyLevel(5, 5, CFG), 3);
  assert.equal(H.difficultyLevel(3, 1, CFG), 0);
  assert.deepEqual(CFG.hand.levels, ['easy', 'normal', 'medium', 'tough']);
});

// Outcomes and power-ups ---------------------------------------------------------

test('outcome vectors', () => {
  for (const c of golden('outcomes.json').cases) {
    const side = (s) => ({ ko_by_recoil: false, left: false, ...s });
    const o = R.classify(c.end_reason, side(c.p1), side(c.p2));
    assert.equal(o.outcome, c.outcome, c.name);
    assert.equal(o.winner_side, c.winner_side, c.name);
    assert.deepEqual(Object.fromEntries(Object.entries(o.labels).map(([k, v]) => [String(k), v])), c.labels, c.name);
  }
});

test('power-ups', () => {
  assert.deepEqual(R.initialCharges('ranked', CFG), [1, 2]);
  assert.deepEqual(R.initialCharges('practice', CFG), [0, -1]);
  const until = R.shieldUntil(1000, CFG);
  assert.ok(R.shieldActive(until, 20999) && !R.shieldActive(until, 21000));
  assert.deepEqual([0, 1, 2, 3].map((n) => R.nextHintLevel(n, CFG)), [1, 2, 3, null]);
  assert.ok(R.spend(-1) === -1 && R.hasCharge(-1));
  assert.ok(R.spend(1) === 0 && !R.hasCharge(0));
});

test('config validates and rejects bad files', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(SHARED_DIR, 'game-config.json'), 'utf8'));
  validateGameConfig(raw);
  assert.throws(() => validateGameConfig({ ...raw, unknown_key: 1 }));
  const bad = structuredClone(raw);
  bad.tiers[1].min_rating = 5000;
  assert.throws(() => validateGameConfig(bad));
});

test('the domain modules do no I/O and read no clock', () => {
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'src', 'domain');
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/from '([^']+)'/g)) {
      assert.ok(m[1].startsWith('./') || m[1] === '../pyrandom.js', `${f} imports ${m[1]}`);
    }
    assert.ok(!/Date\.now|new Date|performance\.now|Math\.random/.test(src), `${f} reads the clock or Math.random`);
  }
});

// Progress -----------------------------------------------------------------------

const summary = (kw = {}) => P.sideSummary({ mode: 'ranked', map: 'bit', label: 'victory', end_reason: 'ko', ...kw });

test('Arena Points', () => {
  let [total, lines] = P.computeAp(summary({ hits_landed: 4, flawless: true, blitz: true, max_streak: 3 }), true, 0, CFG);
  assert.deepEqual(Object.fromEntries(lines), { match: 10, win: 20, hits: 8, flawless: 10, blitz: 10, first_win_of_day: 25, streak: 4 });
  assert.equal(total, 87);
  [, lines] = P.computeAp(summary({ label: 'draw', hits_landed: 30 }), false, 0, CFG);
  assert.deepEqual(Object.fromEntries(lines), { match: 10, draw: 5, hits: 20 });
  [total] = P.computeAp(summary({ mode: 'bot', hits_landed: 2 }), false, 0, CFG);
  assert.equal(total, 5 + 10 + 2);
  [total, lines] = P.computeAp(summary({ mode: 'bot', hits_landed: 2 }), false, 145, CFG);
  assert.equal(total, 5);
  assert.ok(lines.some(([k, v]) => k === 'daily_cap' && v === 0));
  assert.deepEqual(P.computeAp(summary({ mode: 'practice', hits_landed: 5 }), true, 0, CFG), [0, []]);
  assert.deepEqual(P.computeAp(summary({ label: null, end_reason: 'aborted' }), true, 0, CFG), [0, []]);
});

test('daily quests are seeded by date (same picks as before)', () => {
  const a = P.dailyQuests('2026-11-20', CFG).map((q) => q.id);
  assert.deepEqual(a, P.dailyQuests('2026-11-20', CFG).map((q) => q.id));
  assert.equal(new Set(a).size, 3);
  const days = new Set();
  for (let d = 1; d <= 28; d++) days.add(P.dailyQuests(`2026-11-${String(d).padStart(2, '0')}`, CFG).map((q) => q.id).join());
  assert.ok(days.size > 3);
  // Python's random.Random("quests:2026-11-23") picked these; the port must agree.
  assert.deepEqual(P.dailyQuests('2026-11-23', CFG).map((q) => q.id), QUESTS_2026_11_23);
});

test('quest increments', () => {
  const qs = Object.fromEntries(CFG.quests.map((q) => [q.id, q]));
  const s = summary({ hits_landed: 2, hits_stretching: 1, blocks_absorbed: 1, backfires: 0 });
  assert.equal(P.questIncrement(qs.first_blood, s), 2);
  assert.equal(P.questIncrement(qs.bit_hunter, s), 1);
  assert.equal(P.questIncrement(qs.binary_hunter, s), 0);
  assert.equal(P.questIncrement(qs.clean_sweep, s), 1);
  assert.equal(P.questIncrement(qs.daily_grind, summary({ mode: 'practice' })), 0);
});

test('achievements and counters', () => {
  const s = summary({ crits: 5, heroic_hits: 1, flawless: true, lowest_hp: 1000, max_hp: 28000, accepted: 3 });
  const c = P.updateCounters(P.countersFromJson({}), s);
  const got = P.achievementsEarned(s, c, new Set(), CFG);
  for (const k of ['crit_machine', 'heroic', 'flawless', 'comeback']) assert.ok(got.includes(k), k);
  assert.ok(!P.achievementsEarned(s, c, new Set(['crit_machine']), CFG).includes('crit_machine'));
  const c3 = P.updateCounters(P.countersFromJson({ ac_streak: 8 }), summary({ accepted: 2 }));
  assert.equal(c3.ac_streak, 10);
  assert.ok(P.achievementsEarned(summary({ accepted: 2 }), c3, new Set(), CFG).includes('perfectionist'));
  const c4 = P.updateCounters(c3, summary({ accepted: 1, failed_any: true, accepted_run_after: 0 }));
  assert.equal(c4.ac_streak, 0);
  assert.deepEqual(P.countersToJson(P.countersFromJson({ bit_wins: 2, other: 1 })), { career_blocks: 0, ac_streak: 0, ranked_win_streak: 0, bit_wins: 2, other: 1 });
});

const QUESTS_2026_11_23 = ['ambitious', 'binary_hunter', 'bit_hunter'];
