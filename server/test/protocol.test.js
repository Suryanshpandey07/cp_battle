// Every message a scripted match sends must validate against the protocol models
// that the TypeScript types are generated from; the committed types must be current.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../src/config.js';
import { EVENT_MODELS, check } from '../src/realtime/protocol.js';
import { render } from '../scripts/make-types.js';
import { closeAll, makeArena } from './helpers.js';

after(closeAll);

test('every emitted message matches the protocol', async () => {
  const a = await makeArena({ r1: 1300, r2: 1250 });
  await a.actor.send('hint', 1, { slot: 0 }, a.cmd());
  await a.actor.send('block', 2, {}, a.cmd());
  await a.submitAndJudge(1, a.slotWithTier(1, 2), 'AC'); // blocked
  await a.submitAndJudge(2, a.slotWithTier(2, 1), 'WA 2'); // backfire
  await a.actor.send('emote', 1, { id: 'gg' }, a.cmd());
  await a.advance(20);
  await a.actor.send('reroll', 2, { slot: 0 }, a.cmd());
  await a.submitAndJudge(1, a.slotWithTier(1, 4), 'AC'); // KO
  const seen = new Set();
  for (const side of [1, 2]) {
    for (const m of a.ws[side].sent) {
      const model = EVENT_MODELS[m.type];
      assert.ok(model, `no protocol model for ${m.type}`);
      assert.deepEqual(check(model, m.data, m.type), []);
      seen.add(m.type);
    }
  }
  for (const must of ['state.snapshot', 'match.started', 'hand.updated', 'card.dealt', 'attack.blocked', 'attack.backfire',
    'attack.landed', 'powerup.used', 'hint.revealed', 'match.ended', 'rewards.granted', 'emote',
    'submission.verdict', 'submission.accepted', 'opponent.activity', 'match.timer']) assert.ok(seen.has(must), must);
});

test('the validator rejects what the models forbid', () => {
  const m = EVENT_MODELS['attack.landed'];
  assert.ok(check(m, { attacker: 1 }, 'x').length > 0);
  assert.ok(check(EVENT_MODELS.pong, { id: 'a', extra: 1 }, 'x').some((e) => e.includes('unexpected')));
  assert.deepEqual(check(EVENT_MODELS.pong, { id: null }, 'x'), []);
});

test('the committed TypeScript protocol types are up to date', () => {
  const file = path.join(REPO_ROOT, 'frontend', 'src', 'net', 'protocol.generated.ts');
  assert.equal(fs.readFileSync(file, 'utf8'), render());
});
