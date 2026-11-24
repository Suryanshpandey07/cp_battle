// Bots and the practice dummy. Labelled "BOT (simulated)" in the UI: no code runs.
//
// A bot is a participant whose behaviour runs inside the match actor. It picks a
// card by personality weights, "thinks" for a log-normal time whose median grows
// with the problem tier, then sends a Submit command with a simulated verdict.
// The chance of a correct result is clamp(0.5 + 0.12 * (bot_tier - problem_tier)
// + skill_offset, 0.05, 0.95). bot_time_scale shrinks every delay for demos.
// The practice dummy is passive: it never attacks.

import { RuleError } from '../errors.js';
import { PyRandom } from '../pyrandom.js';

export const BOT_CODE = '# BOT (simulated): no code was executed for this submission\n';

export const successChance = (botTier, problemTier, skillOffset) =>
  Math.max(0.05, Math.min(0.95, 0.5 + 0.12 * (botTier - problemTier) + skillOffset));

const verdict = (index, code) => ({ index, code, time_ms: 20, memory_kb: 9000, stdout_tail: null, stderr_tail: null });

export class BotBrain {
  constructor(actor, side, personality) {
    this.a = actor;
    this.n = side;
    this.cfg = actor.cfg;
    this.p = this.cfg.bots.personalities[personality];
    this.rng = new PyRandom(`bot:${actor.m.seed}:${side}`);
    this.targetSlot = null;
  }

  get scale() {
    return Math.max(0.001, this.cfg.bot_time_scale) * this.p.time_scale;
  }

  _thinkSeconds(problemTier) {
    const median = this.cfg.bots.think_median_s[problemTier - 1];
    return median * Math.exp(this.rng.gauss(0, this.cfg.bots.think_sigma)) * this.scale;
  }

  _pickSlot() {
    const hand = this.a.hands[this.n];
    const weights = hand.slots.map((slug, i) => {
      let w = slug !== null ? this.p.slot_weights[i] : 0;
      if (this.p.prefer_on_level && hand.tiers[i] === this.a.side(this.n).tier) w *= 3;
      return w;
    });
    if (weights.reduce((a, b) => a + b, 0) <= 0) {
      const options = hand.slots.map((s, i) => (s !== null ? i : null)).filter((i) => i !== null);
      return options.length ? this.rng.choice(options) : null;
    }
    return this.rng.weightedChoice(weights.map((_, i) => i), weights);
  }

  _schedule(delayS, action) {
    this.a._schedule(`bot:${this.n}`, delayS, 'bot', { side: this.n, action });
  }

  // -- hooks called by the actor ----------------------------------------------------
  onLive() {
    this._plan();
  }

  _plan(extraWait = 0) {
    const slot = this._pickSlot();
    if (slot === null) {
      this._schedule(2 * this.scale + 0.05, 'plan');
      return;
    }
    this.targetSlot = slot;
    this._schedule(extraWait + this._thinkSeconds(this.a.hands[this.n].tiers[slot]), 'submit');
  }

  onTick(data) {
    if (data.action === 'plan') {
      this._plan();
      return;
    }
    if (data.action !== 'submit') return;
    const slot = this.targetSlot;
    if (slot === null || this.a.hands[this.n].slots[slot] === null) {
      this._plan();
      return;
    }
    try {
      // Bot submissions are simulated, so validation never awaits: the promise settles synchronously enough.
      this.a._cmd_submit({ kind: 'submit', side: this.n, data: { slot, code: BOT_CODE, language: 'python', simulated: true }, cmdId: null })
        .catch((e) => this._retry(e));
    } catch (e) {
      this._retry(e);
    }
  }

  _retry(e) {
    if (!(e instanceof RuleError)) throw e;
    const retry = e.details && e.details.retry_after !== undefined ? Number(e.details.retry_after) : 1.0;
    this._schedule(retry + 0.05, 'submit');
  }

  onSubmitted(sub, total) {
    const p = this.a.svc.problems.byId.get(sub.problem_id);
    const correct = this.rng.random() < successChance(this.a.side(this.n).tier, p.tier, this.p.skill_offset);
    const [lo, hi] = this.cfg.bots.judge_delay_s;
    const delay = this.rng.uniform(lo, hi) * Math.max(0.001, this.cfg.bot_time_scale);
    let res;
    if (correct) {
      res = { compile_error: null, system_error: false, verdicts: Array.from({ length: total }, (_, i) => verdict(i, 'AC')) };
    } else {
      const fail = this.rng.randrange(total);
      const code = this.rng.choice(['WA', 'WA', 'WA', 'TLE', 'RE']);
      res = { compile_error: null, system_error: false, verdicts: [...Array.from({ length: fail }, (_, i) => verdict(i, 'AC')), verdict(fail, code)] };
    }
    this.a._schedule(`botv:${this.n}`, delay, 'bot_verdict', { side: this.n, submission: sub, result: res, total });
  }

  afterVerdict(mine, v) {
    const me = this.a.side(this.n);
    if (!mine && me.blocks_left > 0 && me.hp * 100 < this.p.block_below_pct * me.max_hp && !me.shield_until_ms) {
      try {
        this.a._cmd_block({ kind: 'block', side: this.n, data: {}, cmdId: null });
      } catch (e) {
        if (!(e instanceof RuleError)) throw e;
      }
    }
    if (mine) {
      if (v === 'AC') {
        this._plan(1.0 * this.scale);
      } else {
        const [lo, hi] = this.cfg.bots.miss_wait_s;
        const wait = this.rng.uniform(lo, hi) * this.scale;
        const slot = this.targetSlot;
        const tier = slot !== null ? this.a.hands[this.n].tiers[slot] : 1;
        this._schedule(wait + this._thinkSeconds(tier) * 0.5, 'submit');
      }
    }
  }
}

export function makeBrain(actor, side) {
  const sd = actor.side(side);
  if (!sd.is_bot || actor.m.mode === 'practice') return null;
  let personality = (sd.skins || {}).personality || actor.cfg.bots.default_personality;
  if (!(personality in actor.cfg.bots.personalities)) personality = actor.cfg.bots.default_personality;
  return new BotBrain(actor, side, personality);
}
