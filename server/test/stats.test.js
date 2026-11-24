// Career statistics: streaks, maps, activity and totals from finished matches.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newMatchRow } from '../src/engine/side.js';
import { summarize } from '../src/services/stats.js';

const ME = 7;
const TODAY = '2026-11-20';

function m(i, winner, { meSide = 1, map = 'bit', reason = 'ko', daysAgo = 0, status = 'finished', stats = null, dmg = 1000 } = {}) {
  const other = 99;
  const [p1, p2] = meSide === 1 ? [ME, other] : [other, ME];
  const row = newMatchRow({
    id: `m${i}`, mode: 'ranked', map, seed: i, status, end_reason: reason, outcome: winner === null ? 'draw' : 'win', winner_side: winner,
    elapsed_ms: 60_000 + i, created_at: new Date(Date.UTC(2026, 10, 20, 12) - daysAgo * 86_400_000 - (100 - i) * 60_000),
    player1_profile_id: p1, player2_profile_id: p2,
  });
  row[`player${meSide}_stats`] = stats || {};
  row[`player${meSide}_damage_dealt`] = dmg;
  row[`player${meSide}_hits_landed`] = 2;
  return row;
}

test('no matches gives zeros', () => {
  const s = summarize([], ME, TODAY);
  assert.equal(s.played, 0);
  assert.equal(s.win_rate, 0);
  assert.deepEqual(s.streak, { kind: null, count: 0 });
  assert.deepEqual(s.form, []);
});

test('streaks, results and maps are from my side', () => {
  const rows = [
    m(1, 1), // W
    m(2, 1, { meSide: 2 }), // I am side 2, side 1 won: L
    m(3, 2, { meSide: 2, map: 'binary' }), // W
    m(4, 1, { map: 'binary', reason: 'timer' }), // W (not a KO)
    m(5, 1), // W
    m(6, null), // a draw is neither W nor L
    m(7, 1, { status: 'aborted' }), // ignored
  ];
  const s = summarize(rows, ME, TODAY);
  assert.deepEqual([s.played, s.wins, s.losses, s.draws], [6, 4, 1, 1]);
  assert.deepEqual(s.form, ['W', 'L', 'W', 'W', 'W', 'D']);
  assert.deepEqual(s.streak, { kind: null, count: 0 }); // the latest match was a draw
  assert.equal(s.best_win_streak, 3);
  assert.equal(s.ko_wins, 3);
  assert.deepEqual(s.by_map.binary, { played: 2, wins: 2, losses: 0 });
  assert.equal(s.win_rate, 67);
});

test('the current streak counts back from the latest', () => {
  assert.deepEqual(summarize([m(1, 2), m(2, 1), m(3, 1), m(4, 1)], ME, TODAY).streak, { kind: 'W', count: 3 });
  assert.deepEqual(summarize([m(1, 1), m(2, 2), m(3, 2)], ME, TODAY).streak, { kind: 'L', count: 2 });
});

test('totals, bests and the activity window', () => {
  const rows = [
    m(1, 1, { stats: { crits: 2, backfires: 1, biggest_hit: 9000, fastest_solve_ms: 50_000 }, dmg: 12000 }),
    m(2, 2, { stats: { crits: 1, biggest_hit: 4000, fastest_solve_ms: 30_000 }, dmg: 3000, daysAgo: 3 }),
    m(3, 1, { daysAgo: 200 }), // counts in totals, not in the 12-week heatmap
  ];
  const s = summarize(rows, ME, TODAY);
  assert.equal(s.damage_dealt, 16000);
  assert.equal(s.crits, 3);
  assert.equal(s.backfires, 1);
  assert.equal(s.biggest_hit, 9000);
  assert.equal(s.fastest_solve_ms, 30_000);
  assert.equal(Object.values(s.activity).reduce((a, b) => a + b, 0), 2);
  assert.ok('2026-11-17' in s.activity);
});
