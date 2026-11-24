// A scripted two-player match covering every row of the edge-case table, plus
// reconnect and idempotency. FakeClock + FakeRunner + the in-memory database.
//
// Two Pupils (1200): hand tiers 1..4; tier-1 card hits for 3,200 (recoil 2,400),
// tier-2 for 8,000 (recoil 4,000), tier-4 for 39,200 (crit, recoil 8,400).

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { RuleError } from '../src/errors.js';
import { Connection } from '../src/realtime/hub.js';
import { closeAll, FakeWS, makeArena } from './helpers.js';

after(closeAll);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reload = (a, pid) => a.ctx.db.profile.findUnique({ where: { id: pid } });

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (e) => e instanceof RuleError && e.code === code);
}

test('a hit lands on both screens and the card is re-dealt', async () => {
  const a = await makeArena();
  const s1 = a.slotWithTier(1, 1);
  const first = a.actor.hands[1].slots[s1];
  await a.submitAndJudge(1, s1, 'AC');
  assert.equal(a.hp(2), 28000 - 3200);
  const l1 = a.ws[1].last('attack.landed');
  const l2 = a.ws[2].last('attack.landed');
  assert.deepEqual(l1, l2);
  assert.equal(l1.data.damage, 3200);
  assert.equal(l1.data.damage_class, 'heavy');
  assert.equal(l1.data.scenario, 'safe');
  assert.equal(l1.data.defender_hp, 24800);
  assert.ok(a.ws[1].types().includes('hand.updated'));
  assert.ok(!a.ws[2].types().slice(-3).includes('hand.updated'));
  assert.equal(a.actor.hands[1].slots[s1], null); // spent, waiting for a re-deal
  await a.advance(1.6);
  const dealt = a.ws[1].last('card.dealt').data.card;
  assert.equal(dealt.slot, s1);
  assert.ok(dealt.problem.slug && dealt.problem.slug !== first);
  assert.equal(a.ws[2].of('card.dealt').length, 0); // the opponent never sees your hand
});

test('cards and attacks carry their difficulty level', async () => {
  const a = await makeArena();
  const hand = a.actor.handView(1);
  assert.deepEqual(hand.map((c) => c.level).sort(), [0, 1, 2, 3]);
  const tough = hand.find((c) => c.level === 3).slot;
  const easy = hand.find((c) => c.level === 0).slot;
  await a.submitAndJudge(1, easy, 'WA 1');
  assert.equal(a.ws[2].last('attack.backfire').data.level, 0);
  await a.advance(4);
  await a.submitAndJudge(1, tough, 'AC'); // a tough card can be a one-shot KO
  const landed = a.ws[2].last('attack.landed').data;
  assert.equal(landed.level, 3);
  assert.deepEqual(landed, a.ws[1].last('attack.landed').data);
});

test('a backfire costs recoil and keeps the card', async () => {
  const a = await makeArena();
  const s = a.slotWithTier(1, 2);
  const slug = a.actor.hands[1].slots[s];
  await a.submitAndJudge(1, s, 'WA 2');
  assert.equal(a.hp(1), 28000 - 4000);
  const bf = a.ws[2].last('attack.backfire').data;
  assert.deepEqual(bf, a.ws[1].last('attack.backfire').data);
  assert.equal(bf.recoil, 4000);
  assert.equal(bf.verdict, 'WA');
  assert.equal(bf.recoil_class, 'heavy');
  assert.equal(a.actor.hands[1].slots[s], slug); // a wrong attempt leaves the card in the hand
  const v = a.ws[1].last('submission.verdict').data;
  assert.equal(v.failed_test, 2);
  assert.equal(v.verdict, 'WA');
  assert.equal(a.ws[2].of('submission.verdict').length, 0); // verdict details are private
  // Same card again after the 3 s cooldown: allowed, and it costs recoil again.
  await rejectsWith(a.submit(1, s, 'WA 1'), 'cooldown');
  await a.advance(3.0);
  await a.submitAndJudge(1, s, 'WA 1');
  assert.equal(a.hp(1), 28000 - 8000);
});

test('one submission in flight, and a double click is idempotent', async () => {
  const a = await makeArena();
  const s = a.slotWithTier(1, 1);
  const data = { slot: s, code: '# VERDICT: AC\n# DELAY_MS: 30\n', language: 'python' };
  const r1 = await a.actor.send('submit', 1, data, 'dbl-1');
  const r2 = await a.actor.send('submit', 1, data, 'dbl-1');
  assert.equal(r1, r2); // the repeated cmd_id returns the earlier result and changes nothing
  await rejectsWith(a.submit(1, a.slotWithTier(1, 2)), 'busy');
  await sleep(1000);
  await a.settle();
  const subs = await a.ctx.db.submission.findMany({ where: { match_id: a.actor.id } });
  assert.equal(subs.length, 1);
  assert.equal(subs[0].verdict, 'AC');
});

test('empty and oversized code are rejected before judging', async () => {
  const a = await makeArena();
  for (const [code, err] of [['   ', 'empty_code'], ['x'.repeat(70000), 'code_too_large']]) {
    await rejectsWith(a.actor.send('submit', 1, { slot: 0, code, language: 'python' }, a.cmd()), err);
  }
});

test('a system error is void with no recoil, and a retry is allowed', async () => {
  const a = await makeArena();
  const s = a.slotWithTier(1, 3);
  await a.submitAndJudge(1, s, 'SE');
  assert.equal(a.hp(1), 28000);
  const v = a.ws[1].last('submission.verdict').data;
  assert.equal(v.void, true);
  assert.equal(v.reason, 'system_error');
  await a.submitAndJudge(1, s, 'AC'); // no cooldown after a system error
  assert.equal(a.hp(2), 28000 - 18000);
});

test('two lethal verdicts: queue order decides', async () => {
  const a = await makeArena();
  a.actor.m.player1_hp = 1000;
  a.actor.m.player2_hp = 1000;
  await a.submit(1, a.slotWithTier(1, 1), 'AC');
  await a.submit(2, a.slotWithTier(2, 1), 'AC');
  await a.settle();
  assert.equal(a.actor.m.status, 'finished');
  const landed = a.ws[1].of('attack.landed');
  assert.equal(landed.length, 1);
  const winner = landed[0].data.attacker;
  const loser = 3 - winner;
  assert.equal(a.actor.m.winner_side, winner);
  const v = a.ws[loser].last('submission.verdict').data;
  assert.equal(v.void, true);
  assert.equal(v.reason, 'match_ended');
  assert.equal(a.hp(winner), 1000); // the voided verdict changed nothing
});

test('a verdict after the match ended is void', async () => {
  const a = await makeArena();
  await a.actor.send('submit', 1, { slot: 0, code: '# VERDICT: AC\n# DELAY_MS: 200\n', language: 'python' }, a.cmd());
  await a.actor.send('forfeit', 2, {}, a.cmd()); // someone submitted, so this is a real forfeit
  await sleep(500);
  await a.settle();
  assert.equal(a.actor.m.end_reason, 'forfeit');
  assert.equal(a.actor.m.winner_side, 1);
  assert.equal(a.ws[1].last('submission.verdict').data.void, true);
  assert.equal(a.hp(2), 28000);
});

test('a recoil KO is a self-destruct and a hollow victory', async () => {
  const a = await makeArena();
  a.actor.m.player1_hp = 1000;
  await a.submitAndJudge(1, a.slotWithTier(1, 4), 'TLE 3');
  assert.equal(a.hp(1), 0);
  assert.deepEqual(a.actor.m.labels, { 1: 'self_destruct', 2: 'hollow_victory' });
  const ended = a.ws[2].last('match.ended').data;
  assert.equal(ended.sides['2'].delta, 0); // hollow victory pays 0
  assert.ok(ended.sides['1'].delta < 0);
});

test('overkill counts in full', async () => {
  const a = await makeArena();
  a.actor.m.player2_hp = 5000;
  await a.submitAndJudge(1, a.slotWithTier(1, 4), 'AC');
  assert.equal(a.hp(2), 0);
  assert.equal(a.actor.m.player1_damage_dealt, 39200);
  const landed = a.ws[2].last('attack.landed').data;
  assert.equal(landed.crit, true);
  assert.equal(landed.damage_class, 'nuke');
  assert.equal(landed.scenario, 'ambitious');
  assert.deepEqual(a.actor.m.labels, { 1: 'victory', 2: 'defeat' });
});

test('a block absorbs exactly one hit, even a lethal one', async () => {
  const a = await makeArena();
  a.actor.m.player2_hp = 5000;
  await a.actor.send('block', 2, {}, a.cmd());
  assert.equal(a.ws[1].last('powerup.used').data.kind, 'block');
  await a.submitAndJudge(1, a.slotWithTier(1, 4), 'AC');
  const blk = a.ws[1].last('attack.blocked').data;
  assert.equal(blk.prevented_damage, 39200);
  assert.equal(a.hp(2), 5000);
  assert.equal(a.actor.m.status, 'live');
  assert.equal(a.actor.m.player1_hits_landed, 1); // the blocked attacker still counts a hit
  assert.equal(a.actor.hands[1].slots[a.slotWithTier(1, 4)], null); // and loses the card
  await a.advance(3.0);
  await a.submitAndJudge(1, a.slotWithTier(1, 1), 'AC');
  assert.equal(a.hp(2), 5000 - 3200); // the shield is gone after one hit
  await rejectsWith(a.actor.send('block', 2, {}, a.cmd()), 'no_charges');
});

test('a block expires after 20 s and never stops recoil', async () => {
  const a = await makeArena();
  await a.actor.send('block', 1, {}, a.cmd());
  await a.submitAndJudge(1, a.slotWithTier(1, 2), 'WA 1');
  assert.equal(a.hp(1), 28000 - 4000);
  await a.advance(20.5);
  assert.equal(a.ws[2].last('shield.expired').data.side, 1);
  await a.submitAndJudge(2, a.slotWithTier(2, 1), 'AC');
  assert.equal(a.hp(1), 24000 - 3200);
});

test('hint levels come in order and the opponent never sees the text', async () => {
  const a = await makeArena();
  const s = a.slotWithTier(1, 1);
  const r1 = await a.actor.send('hint', 1, { slot: s }, a.cmd());
  const r2 = await a.actor.send('hint', 1, { slot: s }, a.cmd());
  assert.deepEqual([r1.level, r2.level], [1, 2]);
  assert.deepEqual(a.ws[1].of('hint.revealed').map((e) => e.data.level), [1, 2]);
  assert.equal(a.ws[2].of('hint.revealed').length, 0);
  assert.deepEqual(a.ws[2].of('powerup.used').map((e) => e.data.kind), ['hint', 'hint']);
  assert.ok(!('text' in a.ws[2].last('powerup.used').data));
  await rejectsWith(a.actor.send('hint', 1, { slot: s }, a.cmd()), 'no_charges');
});

test('reroll rules', async () => {
  const a = await makeArena();
  const s = a.slotWithTier(1, 1);
  const before = a.actor.hands[1].slots[s];
  await a.actor.send('reroll', 1, { slot: s }, a.cmd());
  assert.notEqual(a.actor.hands[1].slots[s], before);
  await rejectsWith(a.actor.send('reroll', 1, { slot: s }, a.cmd()), 'cooldown');
  await a.advance(60.5);
  await a.actor.send('reroll', 1, { slot: s }, a.cmd());
  await a.advance(60.5);
  await rejectsWith(a.actor.send('reroll', 1, { slot: s }, a.cmd()), 'no_charges');
});

test('tiers are snapshots during a match', async () => {
  const a = await makeArena();
  await a.ctx.db.profile.update({ where: { id: a.actor.m.player1_profile_id }, data: { rating: 2500 } });
  await a.submitAndJudge(1, a.slotWithTier(1, 1), 'AC');
  assert.equal(a.hp(2), 28000 - 3200); // still computed from the Pupil snapshot
});

test('a KO updates rating and shows the promotion', async () => {
  const a = await makeArena({ r1: 1390, r2: 1390 });
  await a.submitAndJudge(1, a.slotWithTier(1, 4), 'AC');
  assert.equal(a.actor.m.status, 'finished');
  assert.equal(a.actor.m.end_reason, 'ko');
  const me = a.ws[1].last('match.ended').data.sides['1'];
  assert.deepEqual(me.steps.map((s) => s.key), ['win', 'flawless', 'blitz']);
  assert.equal(me.delta, 100);
  assert.equal(me.after, 1490);
  assert.deepEqual(me.promotion, { from_tier: 2, to_tier: 3, title: 'Specialist', old_max_hp: 28000, new_max_hp: 50000, direction: 'up' });
  assert.equal(me.profile_after.max_hp, 50000);
  const p1 = await reload(a, a.actor.m.player1_profile_id);
  const p2 = await reload(a, a.actor.m.player2_profile_id);
  assert.deepEqual([p1.rating, p1.wins, p2.rating, p2.losses], [1490, 1, 1320, 1]);
  const hist = await a.ctx.db.ratingHistory.findMany({ where: { match_id: a.actor.id } });
  assert.deepEqual(new Set(hist.map((h) => h.delta)), new Set([100, -70]));
  const rewards = a.ws[1].last('rewards.granted').data;
  assert.ok(rewards.ap > 0);
  assert.ok(rewards.lines.some((l) => l.key === 'win'));
  assert.ok(!a.ws[2].of('rewards.granted').length || a.ws[2].last('rewards.granted').data.side === 2);
});

test('a draw at the timer changes nothing', async () => {
  const a = await makeArena();
  await a.advance(31);
  a.clock.advance(180 * 60);
  await a.settle();
  assert.equal(a.actor.m.end_reason, 'timer');
  assert.equal(a.actor.m.outcome, 'draw');
  const p1 = await reload(a, a.actor.m.player1_profile_id);
  assert.equal(p1.rating, 1200);
  assert.equal(p1.draws, 1);
});

test('an early flee aborts with a strike and no rating', async () => {
  const a = await makeArena();
  await a.actor.send('forfeit', 1, {}, a.cmd());
  await a.settle();
  assert.equal(a.actor.m.status, 'aborted');
  const p1 = await reload(a, a.actor.m.player1_profile_id);
  assert.equal(p1.no_show_strikes, 1);
  assert.equal(p1.rating, 1200);
  assert.equal(a.ws[2].last('match.ended').data.outcome, 'aborted');
});

test('a forfeit after 30 s', async () => {
  const a = await makeArena();
  await a.advance(31);
  await a.actor.send('forfeit', 1, {}, a.cmd());
  await a.settle();
  assert.equal(a.actor.m.end_reason, 'forfeit');
  assert.equal(a.actor.m.winner_side, 2);
  assert.deepEqual(a.actor.m.labels, { 2: 'hollow_victory', 1: 'defeat' });
});

test('a disconnect becomes an auto-forfeit after the grace period', async () => {
  const a = await makeArena();
  await a.advance(31);
  await a.actor.send('leave', 1, { conn: a.ctx.hub.current(a.actor.id, 1) });
  assert.deepEqual(a.ws[2].last('player.disconnected').data, { side: 1, grace_s: 60 });
  await a.advance(59);
  assert.equal(a.actor.m.status, 'live');
  await a.advance(2);
  assert.equal(a.actor.m.end_reason, 'disconnect');
  assert.equal(a.actor.m.winner_side, 2);
});

test('both gone aborts', async () => {
  const a = await makeArena();
  await a.advance(31);
  for (const side of [1, 2]) await a.actor.send('leave', side, { conn: a.ctx.hub.current(a.actor.id, side) });
  await a.advance(61);
  assert.equal(a.actor.m.status, 'aborted');
});

test('a reconnect replays missed events without loss', async () => {
  const a = await makeArena();
  const lastSeqSeen = Math.max(...a.ws[2].sent.map((m) => m.seq || 0));
  await a.actor.send('leave', 2, { conn: a.ctx.hub.current(a.actor.id, 2) });
  await a.submitAndJudge(1, a.slotWithTier(1, 1), 'AC');
  const fresh = new FakeWS();
  await a.actor.send('join', 2, { conn: new Connection(fresh, 0), last_seq: lastSeqSeen });
  await a.settle();
  assert.ok(fresh.types().includes('attack.landed'));
  assert.equal(fresh.last('attack.landed').data.defender_hp, a.hp(2));
  assert.ok(fresh.sent.filter((m) => 'seq' in m).every((m) => m.seq > lastSeqSeen));
  assert.equal(a.ws[1].last('player.reconnected').data.side, 2);
  // A far-behind client gets a snapshot instead, and the snapshot never holds the other hand.
  const fresh2 = new FakeWS();
  await a.actor.send('join', 2, { conn: new Connection(fresh2, 0), last_seq: 0 });
  const snap = fresh2.last('state.snapshot').data;
  assert.equal(snap.you, 2);
  assert.equal(snap.hand.length, 4);
  assert.deepEqual(new Set(snap.players.map((p) => p.hp)), new Set([28000, a.hp(2)]));
  assert.ok(snap.hand.filter((c) => c.problem).every((c) => a.actor.hands[2].slots.includes(c.problem.slug)));
});

test('the newest tab takes over and the old one sees session.moved', async () => {
  const a = await makeArena();
  const old = a.ws[1];
  const fresh = new FakeWS();
  await a.actor.send('join', 1, { conn: new Connection(fresh, 0), last_seq: 0 });
  assert.equal(old.last('session.moved').data.reason, 'session_moved');
  assert.equal(old.closedWith, 4001);
  assert.equal(fresh.types()[0], 'state.snapshot');
});

test('a connect timeout aborts and strikes the no-shows', async () => {
  const a = await makeArena({ connect: false });
  const ws1 = new FakeWS();
  await a.actor.send('join', 1, { conn: new Connection(ws1, 0), last_seq: 0 });
  await a.advance(31);
  assert.equal(a.actor.m.status, 'aborted');
  assert.equal((await reload(a, a.actor.m.player2_profile_id)).no_show_strikes, 1);
  assert.equal((await reload(a, a.actor.m.player1_profile_id)).no_show_strikes, 0);
});

test('a bot match uses the same pipeline and half rating', async () => {
  const a = await makeArena({ mode: 'bot', botPersonality: 'sprinter' });
  await a.advance(600); // the bot thinks, then submits simulated verdicts
  const botSubs = await a.ctx.db.submission.findMany({ where: { match_id: a.actor.id, is_bot: true } });
  assert.ok(botSubs.length > 0);
  assert.ok(botSubs.every((s) => s.code.includes('BOT (simulated)')));
  if (a.actor.m.status === 'live') {
    a.actor.m.player2_hp = 1000;
    await a.submitAndJudge(1, a.slotWithTier(1, 1), 'AC');
  }
  assert.equal(a.actor.m.status, 'finished');
  const ended = a.ws[1].last('match.ended').data;
  if (a.actor.m.winner_side === 1) {
    assert.equal(ended.sides['1'].multiplier, 50);
    const raw = ended.sides['1'].raw_delta;
    assert.equal(ended.sides['1'].delta, Math.min(Math.floor((raw * 50) / 100), 100));
  }
  assert.ok(!('2' in ended.sides)); // bots have no rating
});

test('practice changes nothing', async () => {
  const a = await makeArena({ mode: 'practice' });
  assert.equal(a.actor.m.player1_blocks_left, 0);
  assert.equal(a.actor.m.player1_hints_left, -1);
  for (let i = 0; i < 3; i++) await a.actor.send('hint', 1, { slot: 0 }, a.cmd()); // unlimited hints
  a.actor.m.player2_hp = 100;
  await a.submitAndJudge(1, a.slotWithTier(1, 1), 'AC');
  assert.equal(a.actor.m.status, 'finished');
  const p = await reload(a, a.actor.m.player1_profile_id);
  assert.deepEqual([p.rating, p.wins, p.losses, p.points], [1200, 0, 0, 0]);
  assert.equal((await a.ctx.db.ratingHistory.findMany({ where: { match_id: a.actor.id } })).length, 0);
});

test('persist, then broadcast: every event is in the log', async () => {
  const a = await makeArena();
  await a.submitAndJudge(1, a.slotWithTier(1, 2), 'AC');
  await a.submitAndJudge(2, a.slotWithTier(2, 2), 'WA 1');
  const rows = await a.ctx.db.matchEvent.findMany({ where: { match_id: a.actor.id } });
  const logged = new Set(rows.map((r) => `${r.seq}:${r.type}`));
  for (const side of [1, 2]) {
    for (const m of a.ws[side].sent) if ('seq' in m && m.type !== 'state.snapshot') assert.ok(logged.has(`${m.seq}:${m.type}`), `${m.seq}:${m.type}`);
  }
  const seqs = rows.map((r) => r.seq).sort((x, y) => x - y);
  assert.deepEqual(seqs, seqs.map((_, i) => i + 1));
  const row = await a.ctx.db.match.findUnique({ where: { id: a.actor.id } });
  assert.equal(row.player2_hp, a.hp(2));
  assert.equal(row.player1_hp, a.hp(1));
});

test('verdict payloads never carry outputs', async () => {
  const a = await makeArena();
  await a.submitAndJudge(1, a.slotWithTier(1, 2), 'WA 3');
  const allowed = new Set(['submission_id', 'slot', 'verdict', 'failed_test', 'passed', 'total', 'time_ms', 'memory_kb',
    'compile_error', 'void', 'damage', 'recoil', 'cooldown_ms', 'reason']);
  for (const m of a.ws[1].of('submission.verdict')) for (const k of Object.keys(m.data)) assert.ok(allowed.has(k), k);
});
