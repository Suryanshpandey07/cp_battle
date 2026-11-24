// The shape of shared/game-config.json, validated strictly (unknown keys are an
// error) with the same defaults the original Pydantic models filled in. Pure:
// loading the file lives in src/config.js.

const int = { t: 'int' };
const num = { t: 'num' };
const str = { t: 'str' };
const bool = { t: 'bool' };
const opt = (spec, dflt = null) => ({ ...spec, optional: true, dflt });
const list = (of) => ({ t: 'list', of });
const dict = (of) => ({ t: 'dict', of });
const obj = (fields) => ({ t: 'obj', fields });
const ge = (spec, min) => ({ ...spec, min });

const TierRow = obj({
  tier: { ...int, min: 1, max: 5 }, title: str, min_rating: ge(int, 0), max_hp: ge(int, 1),
  base_damage: ge(int, 0), base_recoil: ge(int, 0), seed_rating: ge(int, 0),
});
const Bucket = obj({ capacity: int, per_s: num });
const Personality = obj({
  slot_weights: list(int), prefer_on_level: bool, time_scale: num, skill_offset: num, block_below_pct: int,
  weapon: opt(str, 'weapon.fireball'),
});

export const GAME_CONFIG = obj({
  game_name: str,
  config_version: int,
  tiers: list(TierRow),
  tier_colors: list(str),
  multiplier: obj({ step_pct: int, min_pct: int, max_pct: int }),
  scenarios: dict(str),
  damage_classes: obj({ light_below_pct: int, heavy_below_pct: int, massive_below_pct: int }),
  crit_max_tier_diff: int,
  hand: obj({
    size: int, window_offset: int, window_lo_min: int, window_lo_max: int, reroll_max: int, reroll_gap_s: int,
    redeal_ms: int, prestige_min_tier: int, min_deck_per_tier: int, levels: list(str),
  }),
  maps: list(obj({ id: str, biomes: list(str), default_arena: str, min_tier: int })),
  match: obj({
    max_minutes: int, countdown_s: int, connect_grace_s: int, disconnect_grace_s: int, submit_cooldown_s: int,
    timer_broadcast_s: int, early_leave_s: int, registry_linger_s: int, max_code_bytes: int, snapshot_gap: int,
    no_show_strikes: int, no_show_ban_min: int, emote_cooldown_s: int,
  }),
  powerups: obj({ block: obj({ charges: int, window_s: int }), hint: obj({ charges: int, levels: int }) }),
  rating: obj({
    starting: int, floor: int, win: int, rank_gap: int, flawless_points: int, flawless_bonus: int,
    narrow_win_share_pct: int, narrow_win_penalty: int,
    speed_brackets: list(obj({ name: str, max_s: int, bonus: int })), slow_bracket_name: str,
    bot_multiplier_pct: int, bot_daily_gain_cap: int, friendly_multiplier_pct: int,
    rematch_multiplier_pct: list(int), rematch_window_min: int,
  }),
  matchmaking: obj({
    window_start: int, window_step: int, window_step_s: int, window_max: int, ready_check_s: int,
    bot_fallback_s: int, tick_ms: int, recent_opponent_min: int, recent_override_wait_s: int,
    decline_cooldown_s: int, same_ip_block: bool, lobby_leave_grace_s: int,
  }),
  languages: list(obj({
    id: str, name: str, monaco: str, run: str, file: str, time_multiplier: int,
    compile: opt(str), comment: opt(str, '#'), judge0_id: opt(int),
  })),
  judge: obj({
    stop_on_first_fail: bool, compile_time_s: opt(int, 20), compile_memory_mb: opt(int, 1536), concurrency: int,
    time_limit_ms: int, memory_mb: int, output_limit_kb: int, source_limit_kb: int, input_limit_kb: int,
    custom_input_limit_kb: int, wall_factor: int, wall_extra_ms: int, max_processes: int, dev_fsize_mb: int,
    job_timeout_s: int, queue_timeout_s: int, max_queued: int, run_time_cap_ms: int, run_wait_s: int,
    stderr_tail_kb: int, system_error_flag_after: int,
  }),
  rate_limits: obj({ login: Bucket, signup: Bucket, run: Bucket, queue_join: Bucket, rest: Bucket, ws_msgs: Bucket }),
  bots: obj({
    think_median_s: list(num), think_sigma: num, miss_wait_s: list(num), judge_delay_s: list(num),
    rating_spread: int, default_personality: str, personalities: dict(Personality), names: list(str),
  }),
  economy: obj({
    match: int, win: int, draw: int, per_hit: int, per_match_hit_cap: int, flawless: int, blitz: int,
    first_win_of_day: int, streak_per_level: int, streak_cap: int, casual_modes_pct: int,
    casual_modes_daily_cap: int, tutorial_reward: int,
  }),
  quests: list(obj({ id: str, kind: str, target: int, ap: int, map: opt(str) })),
  quests_per_day: int,
  achievements: list(obj({ id: str, reward: str, target: opt(int), hp_pct: opt(int), min_s: opt(int) })),
  emotes: list(str),
  features: dict(bool),
  quality: dict(obj({ max_particles: int, dpr_cap: int })),
  bot_time_scale: num,
});

function check(spec, value, path) {
  const fail = (msg) => { throw new Error(`game config ${path || '(root)'}: ${msg}`); };
  switch (spec.t) {
    case 'int':
      if (typeof value !== 'number' || !Number.isInteger(value)) fail('must be an integer');
      if (spec.min !== undefined && value < spec.min) fail(`must be at least ${spec.min}`);
      if (spec.max !== undefined && value > spec.max) fail(`must be at most ${spec.max}`);
      return value;
    case 'num':
      if (typeof value !== 'number') fail('must be a number');
      return value;
    case 'str':
      if (typeof value !== 'string') fail('must be text');
      return value;
    case 'bool':
      if (typeof value !== 'boolean') fail('must be true or false');
      return value;
    case 'list':
      if (!Array.isArray(value)) fail('must be a list');
      return value.map((v, i) => check(spec.of, v, `${path}[${i}]`));
    case 'dict': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) fail('must be an object');
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = check(spec.of, v, `${path}.${k}`);
      return out;
    }
    case 'obj': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) fail('must be an object');
      for (const k of Object.keys(value)) if (!(k in spec.fields)) fail(`unknown key ${k}`);
      const out = {};
      for (const [k, fs] of Object.entries(spec.fields)) {
        const p = path ? `${path}.${k}` : k;
        if (value[k] === undefined || (value[k] === null && fs.optional)) {
          if (!fs.optional) fail(`missing ${k}`);
          out[k] = fs.dflt;
        } else {
          out[k] = check(fs, value[k], p);
        }
      }
      return out;
    }
    default:
      throw new Error(`bad spec ${spec.t}`);
  }
}

/** Validate a parsed game-config.json; returns a normalised copy with defaults. */
export function validateGameConfig(raw) {
  const cfg = check(GAME_CONFIG, raw, '');
  const fail = (msg) => { throw new Error(`game config: ${msg}`); };
  const tiers = cfg.tiers.map((t) => t.tier);
  if (tiers.some((t, i) => t !== i + 1)) fail('tiers must be listed 1..N in order');
  const mins = cfg.tiers.map((t) => t.min_rating);
  if (mins[0] !== 0 || mins.some((m, i) => i > 0 && m < mins[i - 1])) fail('tier min_rating must start at 0 and increase');
  if (cfg.tier_colors.length !== cfg.tiers.length) fail('one tier colour per tier');
  const n = cfg.tiers.length;
  for (let d = -(n - 1); d < n; d++) if (!(String(d) in cfg.scenarios)) fail(`missing scenario name for tier_diff ${d}`);
  if (cfg.hand.size !== 4) fail('the game is designed around a hand of four cards');
  if (!(cfg.bots.default_personality in cfg.bots.personalities)) fail('default bot personality is not defined');
  if (cfg.bots.think_median_s.length !== n) fail('one bot think median per tier');
  for (const p of Object.values(cfg.bots.personalities)) {
    if (p.slot_weights.length !== cfg.hand.size || p.slot_weights.reduce((a, b) => a + b, 0) <= 0) {
      fail('bot slot_weights must have one positive-sum weight per hand slot');
    }
  }
  if (cfg.hand.levels.length !== cfg.hand.size) fail('hand.levels needs one name per hand slot');
  const ids = cfg.maps.map((m) => m.id);
  if (new Set(ids).size !== ids.length) fail('duplicate map id');
  const brackets = cfg.rating.speed_brackets.map((b) => b.max_s);
  if (brackets.some((b, i) => i > 0 && b < brackets[i - 1])) fail('speed brackets must be in increasing order');
  return cfg;
}

// Lookups (the GameConfig methods of the original) ----------------------------

export const tierRow = (cfg, tier) => cfg.tiers[tier - 1];

export function mapCfg(cfg, mapId) {
  const m = cfg.maps.find((x) => x.id === mapId);
  if (!m) { const e = new Error(`unknown map ${mapId}`); e.code = 'KeyError'; throw e; }
  return m;
}

export function language(cfg, langId) {
  const l = cfg.languages.find((x) => x.id === langId);
  if (!l) { const e = new Error(`unknown language ${langId}`); e.code = 'KeyError'; throw e; }
  return l;
}

export const feature = (cfg, name) => Boolean(cfg.features[name]);
