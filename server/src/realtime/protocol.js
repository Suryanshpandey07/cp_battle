// The WebSocket protocol, defined once here.
//
// `npm run types` turns these models into frontend/src/net/protocol.generated.ts.
// test/protocol.test.js validates every message a scripted match emits against
// EVENT_MODELS, so the generated types describe what is really sent.
//
// A tiny schema language: int, num, str, bool, lit(...values), list(t), dict(t),
// union(...types), NULL, a model (model(name, fields, {extra})), and per-field
// optional(t) for fields that may be left out.

export const int = { kind: 'int' };
export const num = { kind: 'num' };
export const str = { kind: 'str' };
export const bool = { kind: 'bool' };
export const NULL = { kind: 'null' };
export const lit = (...values) => ({ kind: 'lit', values });
export const list = (item) => ({ kind: 'list', item });
export const dict = (value) => ({ kind: 'dict', value });
export const union = (...types) => ({ kind: 'union', types });
export const nullable = (t) => union(t, NULL);
/** A field that may be missing (it has a default). */
export const optional = (type, { min, max } = {}) => ({ optional: true, type, min, max });

export function model(name, fields, { extra = 'forbid' } = {}) {
  const norm = {};
  for (const [k, f] of Object.entries(fields)) norm[k] = f && 'optional' in f ? f : { optional: false, type: f };
  return { kind: 'model', name, fields: norm, extra };
}

const DamageClass = lit('light', 'heavy', 'massive', 'nuke');
const Scenario = lit('heroic', 'brave', 'ambitious', 'stretching', 'on_level', 'safe', 'lazy', 'cowardly', 'pathetic');
const Verdict = lit('AC', 'WA', 'TLE', 'MLE', 'RE', 'CE', 'OLE', 'SE');
const optStr = optional(nullable(str));
const level = optional(int, { min: 0, max: 3 });

const Skins = model('Skins', {
  card: optStr, avatar: optStr, arena: optStr, weapon: optStr, color: optStr, personality: optStr,
}, { extra: 'allow' });

const PlayerView = model('PlayerView', {
  side: int, profile_id: int, name: str, rating: int, tier: int, max_hp: int, hp: int, skins: Skins, is_bot: bool,
  connected: bool, hits_landed: int, damage_dealt: int, shield_ms_left: int, judging: bool,
});
const Stage = model('Stage', { theme: str, owner_side: nullable(int), owner_name: nullable(str) });
const ClockView = model('ClockView', { status: str, elapsed_ms: int, server_time_ms: int, max_ms: int, bracket: str });
const ProblemRef = model('ProblemRef', { slug: str, title: str, tier: int, biome: str, tags: list(str) });
const Preview = model('Preview', { damage: int, recoil: int, tier_diff: int, scenario: Scenario, crit: bool, dmg_pct: int, recoil_pct: int });
const Card = model('Card', {
  slot: int, tier: int, pending: bool, level, problem: optional(nullable(ProblemRef)), preview: optional(nullable(Preview)),
  hints_revealed: optional(int),
});
const Charges = model('Charges', { blocks_left: int, hints_left: int, rerolls_left: int, next_reroll_ms: int });
const MatchInfo = model('MatchInfo', { id: str, mode: str, map: str, status: str, stage: Stage });
const Inflight = model('Inflight', { submission_id: nullable(int), slot: nullable(int) });
const RatingStep = model('RatingStep', { key: str, delta: int });
const Promotion = model('Promotion', {
  from_tier: int, to_tier: int, title: str, old_max_hp: int, new_max_hp: int, direction: lit('up', 'down'),
});
const ProfileAfter = model('ProfileAfter', { rating: int, tier: int, max_hp: int, peak_rating: int });
const RatingBlock = model('RatingBlock', {
  before: int, after: int, delta: int, steps: list(RatingStep), multiplier: int, profile_after: ProfileAfter,
  raw_delta: optional(nullable(int)), promotion: optional(nullable(Promotion)), practice: optional(nullable(bool)),
});
const RewardLine = model('RewardLine', { key: str, ap: int });
const QuestTick = model('QuestTick', { id: str, progress: int, target: int, ap: int, complete: bool });
const RewardsGranted = model('RewardsGranted', {
  side: optional(nullable(int)), ap: optional(int), lines: optional(list(RewardLine)), quests: optional(list(QuestTick)),
  achievements: optional(list(str)), unlocked: optional(list(str)),
});
const MatchEnded = model('MatchEnded', {
  outcome: lit('win', 'draw', 'aborted'), winner_side: nullable(int), end_reason: str, labels: dict(str),
  final_hp: dict(int), sides: dict(RatingBlock), elapsed_ms: int, reason: optional(nullable(str)),
  max_hp: optional(nullable(dict(int))), stats: optional(nullable(dict(dict(union(int, bool, NULL))))),
  hits_landed: optional(nullable(dict(int))), damage_dealt: optional(nullable(dict(int))),
  rewards: optional(nullable(dict(RewardsGranted))),
});
const StateSnapshot = model('StateSnapshot', {
  match: MatchInfo, you: int, players: list(PlayerView), clock: ClockView, hand: list(Card), charges: Charges,
  hints: dict(list(str)), cooldown_ms: int, inflight: nullable(Inflight), seq: int, result: nullable(MatchEnded),
});
const Countdown = model('Countdown', { n: int });
const MatchStarted = model('MatchStarted', { players: list(PlayerView), mode: str, map: str, stage: Stage, clock: ClockView });
const HandUpdated = model('HandUpdated', { cards: list(Card), rerolled: optional(nullable(int)), rerolls_left: optional(nullable(int)) });
const CardDealt = model('CardDealt', { card: Card });
const OpponentActivity = model('OpponentActivity', { side: int, state: lit('arena', 'editor', 'judging') });
const SubmissionAccepted = model('SubmissionAccepted', { submission_id: int, slot: int, problem: str, total: int, queue_position: int });
const SubmissionProgress = model('SubmissionProgress', { submission_id: int, index: int, code: str, passed: int, total: int });
const optInt = optional(nullable(int));
const SubmissionVerdict = model('SubmissionVerdict', {
  submission_id: nullable(int), slot: nullable(int), verdict: nullable(Verdict), void: bool,
  failed_test: optInt, passed: optInt, total: optInt, time_ms: optInt, memory_kb: optInt,
  compile_error: optStr, damage: optInt, recoil: optInt, cooldown_ms: optInt, reason: optStr,
});
const AttackLanded = model('AttackLanded', {
  attacker: int, defender: int, damage: int, damage_class: DamageClass, crit: bool, scenario: Scenario, tier_diff: int,
  problem: str, defender_hp: int, attacker_damage_dealt: int, hits_landed: int, level,
});
const AttackBlocked = model('AttackBlocked', {
  attacker: int, defender: int, prevented_damage: int, damage_class: DamageClass, crit: bool, scenario: Scenario,
  problem: str, hits_landed: int, level,
});
const AttackBackfire = model('AttackBackfire', {
  attacker: int, recoil: int, recoil_class: DamageClass, verdict: Verdict, problem: str, attacker_hp: int, crit: bool,
  scenario: Scenario, level,
});
const PowerupUsed = model('PowerupUsed', { side: int, kind: lit('block', 'hint'), charges_left: int, shield_ms: optInt });
const HintRevealed = model('HintRevealed', { slot: int, problem: str, level: int, text: str, tags: optional(nullable(list(str))) });
const SideOnly = model('SideOnly', { side: int });
const PlayerDisconnected = model('PlayerDisconnected', { side: int, grace_s: int });
const Emote = model('Emote', { side: int, id: str });
const SessionMoved = model('SessionMoved', { reason: str, message: optStr });
const Pong = model('Pong', { id: union(int, str, NULL), server_time_ms: optInt });

export const EVENT_MODELS = {
  'state.snapshot': StateSnapshot,
  'match.countdown': Countdown,
  'match.started': MatchStarted,
  'hand.updated': HandUpdated,
  'card.dealt': CardDealt,
  'opponent.activity': OpponentActivity,
  'submission.accepted': SubmissionAccepted,
  'submission.progress': SubmissionProgress,
  'submission.verdict': SubmissionVerdict,
  'attack.landed': AttackLanded,
  'attack.blocked': AttackBlocked,
  'attack.backfire': AttackBackfire,
  'powerup.used': PowerupUsed,
  'hint.revealed': HintRevealed,
  'shield.expired': SideOnly,
  'player.disconnected': PlayerDisconnected,
  'player.reconnected': SideOnly,
  'match.timer': ClockView,
  emote: Emote,
  'match.ended': MatchEnded,
  'rewards.granted': RewardsGranted,
  'session.moved': SessionMoved,
  pong: Pong,
};

// ---------------------------------------------------------------------------- validation
/** Errors (as "path: problem" strings) for value against type; [] when it fits. */
export function check(type, value, at = '$') {
  switch (type.kind) {
    case 'int': return Number.isInteger(value) ? [] : [`${at}: expected an integer, got ${JSON.stringify(value)}`];
    case 'num': return typeof value === 'number' && Number.isFinite(value) ? [] : [`${at}: expected a number`];
    case 'str': return typeof value === 'string' ? [] : [`${at}: expected a string, got ${JSON.stringify(value)}`];
    case 'bool': return typeof value === 'boolean' ? [] : [`${at}: expected a boolean, got ${JSON.stringify(value)}`];
    case 'null': return value === null ? [] : [`${at}: expected null`];
    case 'lit': return type.values.includes(value) ? [] : [`${at}: ${JSON.stringify(value)} is not one of ${type.values.join(', ')}`];
    case 'list':
      if (!Array.isArray(value)) return [`${at}: expected a list`];
      return value.flatMap((v, i) => check(type.item, v, `${at}[${i}]`));
    case 'dict':
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return [`${at}: expected an object`];
      return Object.entries(value).flatMap(([k, v]) => check(type.value, v, `${at}.${k}`));
    case 'union': {
      const all = type.types.map((t) => check(t, value, at));
      return all.some((e) => e.length === 0) ? [] : all.flat();
    }
    case 'model': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return [`${at}: expected a ${type.name} object`];
      const errs = [];
      for (const [k, f] of Object.entries(type.fields)) {
        if (!(k in value) || value[k] === undefined) {
          if (!f.optional) errs.push(`${at}.${k}: missing`);
          continue;
        }
        errs.push(...check(f.type, value[k], `${at}.${k}`));
        if (typeof value[k] === 'number' && ((f.min !== undefined && value[k] < f.min) || (f.max !== undefined && value[k] > f.max))) {
          errs.push(`${at}.${k}: ${value[k]} is out of range`);
        }
      }
      if (type.extra === 'forbid') for (const k of Object.keys(value)) if (!(k in type.fields)) errs.push(`${at}.${k}: unexpected field`);
      return errs;
    }
    default: throw new Error(`unknown schema kind ${type.kind}`);
  }
}

/** Throws when a server message does not match its event model. */
export function validateMessage(msg) {
  const m = EVENT_MODELS[msg.type];
  if (!m) throw new Error(`unknown event type ${msg.type}`);
  const errs = check(m, msg.data, msg.type);
  if (errs.length) throw new Error(errs.slice(0, 5).join('\n'));
}

