// One side of a match row: side(m, 1).hp reads and writes m.player1_hp.

export const SIDE_FIELDS = [
  'profile_id', 'name', 'rating', 'tier', 'max_hp', 'hp', 'damage_dealt', 'hits_landed', 'skins', 'is_bot',
  'blocks_left', 'hints_left', 'shield_until_ms', 'rerolls_left', 'last_reroll_ms', 'hand', 'hints_revealed',
  'stats', 'connected',
];

export function side(m, n) {
  return new Proxy({}, {
    get: (_, k) => m[`player${n}_${String(k)}`],
    set: (_, k, v) => { m[`player${n}_${String(k)}`] = v; return true; },
  });
}

const SIDE_DEFAULTS = {
  profile_id: 0, name: '', rating: 0, tier: 1, max_hp: 0, hp: 0, damage_dealt: 0, hits_landed: 0, skins: {},
  is_bot: false, blocks_left: 0, hints_left: 0, shield_until_ms: null, rerolls_left: 0, last_reroll_ms: null,
  hand: {}, hints_revealed: {}, stats: {}, connected: false,
};

/** A new match row with every column at its default (as the old model did). */
export function newMatchRow(fields) {
  const m = {
    id: null, mode: 'ranked', map: 'bit', status: 'starting', seed: 0, stage_theme: 'arena.bit', stage_owner_side: null,
    created_at: new Date(), start_time: null, end_time: null, elapsed_ms: 0, end_reason: null, outcome: null,
    winner_side: null, labels: {}, result: {}, decks: {}, last_seq: 0,
  };
  for (const n of [1, 2]) for (const [k, v] of Object.entries(SIDE_DEFAULTS)) m[`player${n}_${k}`] = structuredClone(v);
  return Object.assign(m, fields);
}
