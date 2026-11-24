// API: auth flows, rate limits, authorization, skins, templates, the leaderboard,
// and a full queue -> match over real WebSockets (ENV=test, FakeRunner).

import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { limiter } from '../src/ratelimit.js';
import { getGameConfig } from '../src/config.js';
import { validateLanguage } from '../src/services/judging.js';
import { Judge } from '../src/judge/index.js';
import { SubprocessRunner } from '../src/judge/runners.js';
import { loadRegistry, validate } from '../src/skins/registry.js';
import { AppError } from '../src/errors.js';
import fs from 'node:fs';
import path from 'node:path';
import { SHARED_DIR } from '../src/config.js';
import { Client, H, HJ, openSocket, startServer } from './helpers.js';

let srv;
let c;
let n = 0;

before(async () => {
  srv = await startServer();
  c = new Client(srv.base);
});
after(() => srv.stop());
beforeEach(() => limiter.reset());

async function signup(name = null) {
  name = name || `user${n++}_${Date.now() % 10000}`;
  limiter.reset();
  const r = await c.post('/api/auth/signup', { json: { username: name, password: `${name}-pass-9` } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return [r.body.access_token, r.body.profile];
}

test('signup validation and the starting profile', async () => {
  const bad = await c.post('/api/auth/signup', { json: { username: 'x', password: 'longenough1' } });
  assert.equal(bad.status, 422);
  assert.equal(bad.body.error.details.field, 'username');
  limiter.reset();
  const weak = await c.post('/api/auth/signup', { json: { username: 'weakling', password: 'password' } });
  assert.equal(weak.body.error.code, 'validation');
  limiter.reset();
  const extra = await c.post('/api/auth/signup', { json: { username: 'cheater1', password: 'cheater-pass', rating: 3000 } });
  assert.equal(extra.status, 422); // unknown fields are rejected: no client-set rating
  const [, prof] = await signup();
  assert.deepEqual([prof.rating, prof.tier, prof.max_hp], [1200, 2, 28000]);
  limiter.reset();
  const dup = await c.post('/api/auth/signup', { json: { username: prof.display_name.toUpperCase(), password: 'another-pass' } });
  assert.equal(dup.body.error.code, 'conflict'); // unique ignoring case
});

test('login, refresh rotation and reuse detection', async () => {
  const name = `rot${n++}`;
  await signup(name);
  c.cookies.clear();
  assert.equal((await c.post('/api/auth/login', { json: { username: name, password: 'nope-nope' } })).status, 401);
  const r = await c.post('/api/auth/login', { json: { username: name, password: `${name}-pass-9` } });
  assert.equal(r.status, 200);
  const first = c.cookies.get('aa_refresh');
  const r2 = await c.post('/api/auth/refresh');
  assert.equal(r2.status, 200);
  assert.notEqual(c.cookies.get('aa_refresh'), first);
  // Replaying the old, rotated token revokes the whole session family.
  const second = c.cookies.get('aa_refresh');
  c.cookies.set('aa_refresh', first);
  assert.equal((await c.post('/api/auth/refresh')).status, 401);
  c.cookies.set('aa_refresh', second);
  assert.equal((await c.post('/api/auth/refresh')).status, 401);
  c.cookies.clear();
});

test('rate limits return 429 with Retry-After', async () => {
  const codes = [];
  for (let i = 0; i < 7; i++) codes.push((await c.post('/api/auth/login', { json: { username: 'ghost', password: 'whatever1' } })).status);
  assert.ok(codes.includes(429));
  const r = await c.post('/api/auth/login', { json: { username: 'ghost', password: 'whatever1' } });
  assert.equal(r.status, 429);
  assert.ok(Number(r.headers.get('retry-after')) >= 1);
  assert.equal(r.body.error.code, 'rate_limited');
});

test('no route accepts a rating, an HP or a result', async () => {
  const [tok, prof] = await signup();
  for (const [method, p] of [['PUT', `/api/players/${prof.id}?new_elo=3000`], ['DELETE', '/api/match/1/end'],
    ['PUT', '/api/battle/1/attacker/1/problem/1'], ['POST', '/api/players/']]) {
    assert.ok([404, 405].includes((await c.request(method, p, H(tok))).status), p);
  }
  assert.equal((await c.patch('/api/me/settings', HJ(tok, { rating: 3000 }))).status, 422);
});

test('config and health are public', async () => {
  const cfg = (await c.get('/api/config')).body;
  assert.equal(cfg.game_name, 'AlgoArena');
  assert.ok(!('bots' in cfg) && !('rate_limits' in cfg));
  assert.equal((await c.get('/api/healthz')).body.database, true);
  const r = await c.get('/api/healthz');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(r.headers.get('x-request-id'));
});

test('you cannot act in someone else\'s match or read their drafts', async () => {
  const [ta] = await signup();
  const [tb] = await signup();
  const mid = (await c.post('/api/matches/practice', HJ(ta, { map: 'bit' }))).body.match_id;
  const r = await c.post(`/api/matches/${mid}/submit`, HJ(tb, { slot: 0, code: 'print(1)', cmd_id: 'abcd' }));
  assert.equal(r.status, 403);
  assert.deepEqual((await c.get(`/api/matches/${mid}/drafts`, H(tb))).body.drafts, []);
  assert.equal((await c.put(`/api/matches/${mid}/drafts/0`, HJ(tb, { code: 'x' }))).status, 403);
  assert.equal((await c.post('/api/auth/ws-ticket', HJ(tb, { scope: 'match', match_id: mid }))).status, 403);
  // the owner's draft round-trips
  assert.equal((await c.put(`/api/matches/${mid}/drafts/2`, HJ(ta, { code: 'print(2)', problem: 'x' }))).status, 200);
  assert.equal((await c.get(`/api/matches/${mid}/drafts/2`, H(ta))).body.code, 'print(2)');
  await c.post(`/api/matches/${mid}/forfeit`, HJ(ta, { cmd_id: 'flee-1' }));
});

test('sockets refuse bad tickets with close codes', async () => {
  const lobby = openSocket(`${srv.ws}/ws/lobby?ticket=nope`);
  assert.equal(await lobby.closed, 4401);
  const [ta] = await signup();
  const t = (await c.post('/api/auth/ws-ticket', HJ(ta, { scope: 'lobby' }))).body.ticket;
  const again = openSocket(`${srv.ws}/ws/lobby?ticket=${t}`);
  assert.equal((await again.until('hello')).type, 'hello');
  const reuse = openSocket(`${srv.ws}/ws/lobby?ticket=${t}`); // tickets are single-use
  assert.equal(await reuse.closed, 4401);
  again.close();
});

test('two players queue, pass the ready check and fight', async () => {
  const [ta, pa] = await signup();
  const [tb, pb] = await signup();
  const ticketA = (await c.post('/api/auth/ws-ticket', HJ(ta, { scope: 'lobby' }))).body.ticket;
  const ticketB = (await c.post('/api/auth/ws-ticket', HJ(tb, { scope: 'lobby' }))).body.ticket;
  const la = openSocket(`${srv.ws}/ws/lobby?ticket=${ticketA}`);
  const lb = openSocket(`${srv.ws}/ws/lobby?ticket=${ticketB}`);
  assert.equal((await la.until('hello')).type, 'hello');
  await lb.until('hello');
  assert.equal((await c.post('/api/queue/join', HJ(ta, { map: 'bit' }))).body.state, 'queued');
  assert.equal((await c.post('/api/queue/join', HJ(tb, { map: 'any' }))).body.state, 'queued');
  const foundA = (await la.until('match.found')).data;
  const foundB = (await lb.until('match.found')).data;
  assert.equal(foundA.proposal_id, foundB.proposal_id);
  assert.equal(foundA.map, 'bit');
  assert.equal(foundA.opponent.name, pb.display_name);
  assert.equal((await c.post('/api/queue/respond', HJ(ta, { proposal_id: foundA.proposal_id, accept: true }))).body.state, 'waiting');
  const ready = (await c.post('/api/queue/respond', HJ(tb, { proposal_id: foundA.proposal_id, accept: true }))).body;
  const mid = ready.match_id;
  assert.equal((await la.until('match.ready')).data.match_id, mid);
  la.close();
  lb.close();

  const ma = (await c.post('/api/auth/ws-ticket', HJ(ta, { scope: 'match', match_id: mid }))).body.ticket;
  const mb = (await c.post('/api/auth/ws-ticket', HJ(tb, { scope: 'match', match_id: mid }))).body.ticket;
  const wa = openSocket(`${srv.ws}/ws/match/${mid}?ticket=${ma}`);
  const wb = openSocket(`${srv.ws}/ws/match/${mid}?ticket=${mb}`);
  await wa.opened;
  await wb.opened;
  wa.send({ v: 1, type: 'hello', data: { last_seq: 0 } });
  const snap = (await wa.until('state.snapshot')).data;
  assert.equal(snap.you, 1);
  assert.equal(snap.match.status, 'starting');
  wb.send({ v: 1, type: 'hello', data: { last_seq: 0 } });
  assert.equal((await wa.until('match.countdown')).data.n, 3);
  const started = (await wa.until('match.started', 200)).data;
  assert.deepEqual(started.players.map((p) => p.name), [pa.display_name, pb.display_name]);
  const hand = (await wa.until('hand.updated')).data.cards;
  const slot = hand.find((card) => card.tier === 4).slot;
  assert.equal(hand[slot].preview.damage, 39200);
  assert.equal(hand[slot].preview.crit, true);

  wa.send({ v: 1, type: 'ping', data: { id: 7 } });
  assert.equal((await wa.until('pong')).data.id, 7);

  const run = await c.post(`/api/matches/${mid}/run`, HJ(ta, { slot, code: '# VERDICT: WA 1\nprint(0)' }));
  assert.equal(run.status, 200);
  assert.equal(run.body.mode, 'samples');
  const body = { slot, code: '# VERDICT: AC\n# DELAY_MS: 5\nprint(1)', cmd_id: 'attack-1' };
  const r1 = await c.post(`/api/matches/${mid}/submit`, HJ(ta, body));
  const r2 = await c.post(`/api/matches/${mid}/submit`, HJ(ta, body)); // double click
  assert.equal(r1.status, 202);
  assert.deepEqual(r1.body, r2.body);
  assert.equal((await wb.until('opponent.activity')).data.state, 'judging');
  const landedB = (await wb.until('attack.landed')).data;
  const landedA = (await wa.until('attack.landed')).data;
  assert.deepEqual(landedA, landedB);
  assert.equal(landedA.defender_hp, 0);
  assert.equal(landedA.damage_class, 'nuke');
  const ended = (await wb.until('match.ended')).data;
  assert.equal(ended.outcome, 'win');
  assert.equal(ended.winner_side, 1);
  assert.deepEqual(ended.labels, { 1: 'victory', 2: 'defeat' });
  assert.ok(ended.sides['1'].delta > 0 && ended.sides['2'].delta < 0);
  const rewards = (await wa.until('rewards.granted')).data;
  assert.ok(rewards.ap >= 30);
  wa.close();
  wb.close();

  const me = (await c.get('/api/me', H(ta))).body;
  assert.equal(me.rating, 1200 + ended.sides['1'].delta);
  assert.equal(me.wins, 1);
  assert.equal(me.active_match, null);
  const summary = (await c.get(`/api/matches/${mid}`, H(tb))).body;
  assert.equal(summary.result.outcome, 'win');
  const kinds = (await c.get(`/api/matches/${mid}/events`, H(tb))).body.events.map((e) => e.type);
  assert.ok(kinds.includes('attack.landed') && !kinds.includes('hand.updated') && !kinds.includes('submission.verdict'));
});

/** The leaderboard as the app first built it: every person ranked in memory. */
function boardsTheOldWay(db, scope, map) {
  const profs = new Map(db.profile.rows.filter((p) => p.is_bot === false && p.user_id !== null).map((p) => [p.id, p]));
  let score = new Map();
  if (scope === 'all' && !map) {
    score = new Map([...profs].map(([id, p]) => [id, p.rating]));
  } else {
    const since = Date.now() - 7 * 86_400_000;
    for (const m of db.match.rows) {
      if (m.status !== 'finished') continue;
      if (scope === 'week' && !(m.end_time && m.end_time.getTime() >= since)) continue;
      if (map && m.map !== map) continue;
      if (map) {
        const wid = m.winner_side === 1 ? m.player1_profile_id : m.player2_profile_id;
        if (m.winner_side && profs.has(wid)) score.set(wid, (score.get(wid) || 0) + 1);
      } else {
        for (const [k, pid] of [['1', m.player1_profile_id], ['2', m.player2_profile_id]]) {
          const blk = ((m.result || {}).sides || {})[k];
          if (blk && profs.has(pid)) score.set(pid, (score.get(pid) || 0) + Math.trunc(blk.delta || 0));
        }
      }
    }
  }
  const low = (id) => profs.get(id).display_name.toLowerCase();
  return [...score].sort((a, b) => b[1] - a[1] || (low(a[0]) < low(b[0]) ? -1 : low(a[0]) > low(b[0]) ? 1 : 0));
}

test('the leaderboards rank like before', async () => {
  const [tok, me] = await signup(`mid${n++}`);
  // 120 people rated above the default 1200, then ten tied at 1200: some named before "mid…", some after
  const db = srv.db;
  const made = [];
  for (let i = 0; i < 130; i++) {
    const name = i < 120 ? `lb${n++}_${i}` : i % 4 === 0 ? `zz${n++}` : `aa${n++}`;
    const u = await db.user.create({ data: { username: name, username_lower: name.toLowerCase(), password_hash: 'x' } });
    const p = await db.profile.create({ data: { user_id: u.id, display_name: name, rating: i < 120 ? 1300 + ((i * 7) % 400) : 1200 } });
    made.push(p.id);
  }
  const { newMatchRow } = await import('../src/engine/side.js');
  for (let k = 0; k < 12; k++) { // finished matches this week, with rating changes and winners on two maps
    await db.match.create({
      data: newMatchRow({
        id: `lbm-${k}-${Date.now()}`, mode: 'ranked', map: k % 3 ? 'bit' : 'prestige', status: 'finished', seed: k, end_time: new Date(),
        winner_side: 1 + (k % 2), outcome: 'win', player1_profile_id: made[k], player2_profile_id: made[k + 1],
        result: { sides: { 1: { delta: 10 + k }, 2: { delta: -8 - k } } },
      }),
    });
  }
  srv.ctx.cache.clear();
  for (const [scope, map] of [['all', null], ['week', null], ['all', 'bit'], ['week', 'prestige']]) {
    const q = `scope=${scope}${map ? `&map=${map}` : ''}`;
    const got = (await c.get(`/api/leaderboard?${q}`, H(tok))).body;
    const want = boardsTheOldWay(db, scope, map);
    assert.deepEqual(got.rows.map((r) => [r.profile_id, r.score]), want.slice(0, 100), q);
    assert.deepEqual(got.rows.map((r) => r.rank), got.rows.map((_, i) => i + 1));
    const mine = want.findIndex(([pid]) => pid === me.id);
    assert.equal((got.me || {}).rank ?? null, mine >= 0 ? mine + 1 : null, q);
  }
  // outside the top 100 on the all-time board, "me" comes from a count, not the list
  const allt = (await c.get('/api/leaderboard', H(tok))).body;
  assert.ok(allt.me.rank > 100);
  assert.equal(allt.me.profile_id, me.id);
});

// ---------------------------------------------------------------- skins and weapons

const WEAPONS = ['arrows', 'fireball', 'gun', 'laser', 'lightning', 'meteor', 'shuriken', 'spear'];
const RECIPES = JSON.parse(fs.readFileSync(path.join(SHARED_DIR, 'skin-recipes.json'), 'utf8'));

test('every manifest validates and the weapons cover all styles', () => {
  const reg = loadRegistry();
  assert.deepEqual(Object.values(reg).filter((m) => m.kind === 'weapon').map((m) => m.style).sort(), WEAPONS);
  assert.deepEqual([...RECIPES.weapon_style].sort(), WEAPONS);
  for (const m of Object.values(reg)) if (m.kind === 'weapon') assert.deepEqual(Object.keys(m.levels), ['easy', 'normal', 'medium', 'tough']);
});

test('weapon manifest rules', () => {
  const good = { ...loadRegistry()['weapon.spear'] };
  assert.deepEqual(validate(good, RECIPES, 'weapon.spear.json'), []);
  const bad = { ...good, style: 'bazooka', levels: { easy: 'a', tough: 'b' }, palette: { ramp: ['#fff'] } };
  const errs = validate(bad, RECIPES, 'weapon.spear.json').join(' ');
  for (const want of ['unknown weapon style', 'levels must name', 'palette.ramp needs 5', 'palette.metal is required']) assert.ok(errs.includes(want), want);
  assert.ok(validate({ ...good, id: 'card.spear' }, RECIPES, 'card.spear.json').length > 0); // prefix must match kind
});

test('default weapons are owned and locked ones are not', async () => {
  const [tok] = await signup();
  const skins = (await c.get('/api/skins', H(tok))).body;
  const owned = new Set(skins.skins.filter((s) => s.owned).map((s) => s.id));
  for (const w of ['weapon.fireball', 'weapon.spear', 'weapon.gun', 'weapon.lightning', 'weapon.arrows']) assert.ok(owned.has(w), w);
  for (const w of ['weapon.shuriken', 'weapon.laser', 'weapon.meteor']) assert.ok(!owned.has(w), w);
  assert.equal(skins.equipped.weapon, 'weapon.fireball');
  assert.equal((await c.get('/api/me', H(tok))).body.equipped.weapon, 'weapon.fireball');
});

test('equip checks kind and ownership', async () => {
  const [tok] = await signup();
  const r = await c.post('/api/skins/equip', HJ(tok, { kind: 'weapon', skin_id: 'weapon.spear' }));
  assert.equal(r.status, 200);
  assert.equal(r.body.equipped.weapon, 'weapon.spear');
  assert.equal((await c.post('/api/skins/equip', HJ(tok, { kind: 'weapon', skin_id: 'weapon.laser' }))).body.error.code, 'forbidden');
  assert.equal((await c.post('/api/skins/equip', HJ(tok, { kind: 'card', skin_id: 'weapon.gun' }))).body.error.code, 'validation');
  assert.equal((await c.post('/api/skins/equip', HJ(tok, { kind: 'weapon', skin_id: null }))).body.equipped.weapon, 'weapon.fireball');
});

test('buying a weapon is idempotent and needs points', async () => {
  const [tok, prof] = await signup();
  assert.equal((await c.post('/api/skins/weapon.shuriken/buy', HJ(tok, { idempotency_key: 'k-poor' }))).body.error.code, 'conflict');
  await srv.db.profile.update({ where: { id: prof.id }, data: { points: 500 } });
  const first = (await c.post('/api/skins/weapon.shuriken/buy', HJ(tok, { idempotency_key: 'key-0001' }))).body;
  const again = (await c.post('/api/skins/weapon.shuriken/buy', HJ(tok, { idempotency_key: 'key-0001' }))).body;
  assert.equal(first.points, 200);
  assert.equal(again.repeat, true);
  assert.equal(again.points, 200);
  assert.equal((await c.post('/api/skins/equip', HJ(tok, { kind: 'weapon', skin_id: 'weapon.shuriken' }))).body.equipped.weapon, 'weapon.shuriken');
  assert.equal((await c.post('/api/skins/weapon.laser/buy', HJ(tok, { idempotency_key: 'key-0002' }))).body.error.code, 'forbidden');
});

test('the equipped weapon travels into the match', async () => {
  const [tok] = await signup();
  await c.post('/api/skins/equip', HJ(tok, { kind: 'weapon', skin_id: 'weapon.gun' }));
  const r = await c.post('/api/matches/bot', HJ(tok, { map: 'bit' }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const { players } = (await c.get(`/api/matches/${r.body.match_id}`, H(tok))).body.snapshot;
  assert.equal(players.find((p) => !p.is_bot).skins.weapon, 'weapon.gun');
  assert.ok(players.find((p) => p.is_bot).skins.weapon.startsWith('weapon.'));
  await c.post(`/api/matches/${r.body.match_id}/forfeit`, HJ(tok, { cmd_id: 'ff-1' }));
});

// ---------------------------------------------------------------- languages and templates

test('config lists C++ with its availability', async () => {
  const langs = Object.fromEntries((await c.get('/api/config')).body.languages.map((l) => [l.id, l]));
  assert.deepEqual(Object.keys(langs).sort(), ['cpp', 'python']);
  assert.equal(langs.cpp.monaco, 'cpp');
  assert.equal(langs.cpp.comment, '//');
  assert.equal(langs.cpp.available, true);
});

test('C++ runs in practice and unknown languages are refused', async () => {
  const [tok] = await signup();
  const ok = await c.post('/api/problems/power-check/run', HJ(tok, { language: 'cpp', code: '// VERDICT: AC\nint main(){}' }));
  assert.equal(ok.status, 200);
  assert.equal(ok.body.verdict, 'AC');
  const bad = await c.post('/api/problems/power-check/run', HJ(tok, { language: 'rust', code: 'fn main(){}' }));
  assert.equal(bad.body.error.code, 'validation');
});

test('a missing compiler gives a helpful message', async () => {
  const cfg = getGameConfig();
  const saved = process.env.PATH;
  process.env.PATH = '/nonexistent';
  try {
    const judge = new Judge(new SubprocessRunner('dev'), cfg);
    await assert.rejects(validateLanguage('cpp', cfg, judge), (e) => e instanceof AppError
      && e.message.includes('C++17 is not available') && e.message.includes('g++') && e.message.includes('xcode-select'));
    judge.stop();
  } finally {
    process.env.PATH = saved;
  }
  await validateLanguage('cpp', cfg, srv.ctx.judge); // the test judge (like Docker) brings its own compiler
});

test('templates are saved per language and validated', async () => {
  const [tok] = await signup();
  const tpl = '#include <bits/stdc++.h>\nusing namespace std;\nint main(){\n}\n';
  const r = await c.patch('/api/me/settings', HJ(tok, { settings: { sfx: 0.5, templates: { cpp: tpl } } }));
  assert.equal(r.status, 200);
  assert.equal(r.body.settings.templates.cpp, tpl);
  assert.equal((await c.get('/api/me', H(tok))).body.settings.templates.cpp, tpl);
  assert.equal((await c.patch('/api/me/settings', HJ(tok, { settings: { templates: { rust: 'fn main(){}' } } }))).body.error.code, 'validation');
  assert.equal((await c.patch('/api/me/settings', HJ(tok, { settings: { templates: { cpp: 'x'.repeat(20000) } } }))).body.error.code, 'validation');
  assert.equal((await c.patch('/api/me/settings', HJ(tok, { settings: { templates: { cpp: '/'.repeat(12000), python: '#'.repeat(12000) } } }))).status, 200);
});

test('the profile page has stats, achievements and the collection', async () => {
  const [tok, prof] = await signup();
  const st = (await c.get(`/api/profiles/${prof.display_name.toUpperCase()}`, H(tok))).body.stats;
  assert.equal(st.played, 0);
  assert.ok(st.rank.position >= 1 && st.rank.of >= 1);
  const ids = new Set(st.achievements.map((a) => a.id));
  assert.ok(ids.has('flawless') && ids.has('hot_streak'));
  assert.ok(!st.achievements.some((a) => a.earned));
  assert.equal(st.collection.arena.total, 10);
  assert.ok(st.collection.weapon.owned >= 1);
  assert.equal(st.solved.of, 17);
  assert.equal(st.submissions.judged, 0);
});

test('admin routes need the admin role', async () => {
  const [tok] = await signup();
  assert.equal((await c.get('/api/admin/flags', H(tok))).body.error.code, 'forbidden');
  assert.equal((await c.get('/api/admin/flags')).status, 401);
});
