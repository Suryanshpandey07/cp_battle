// Generate the frozen parts of shared/golden/*.json from the rule functions.
//
// The hand-written anchors (the brief's 5x5 tables, the seven rating cases and
// the outcome cases) live in the same files under keys that this script never
// overwrites.
//
//   node scripts/gen-golden.js           # rewrite the frozen parts
//   node scripts/gen-golden.js --check   # recompute and fail if anything differs

import fs from 'node:fs';
import path from 'node:path';
import { loadGameConfigFile, SHARED_DIR } from '../src/config.js';
import { mapCfg, tierRow } from '../src/domain/gameconfig.js';
import { buildDecks, dealHand } from '../src/domain/hand.js';
import { computePreview, ratingDelta } from '../src/domain/rules.js';

const GOLDEN = path.join(SHARED_DIR, 'golden');
const ascii = (s) => s.replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
const compact = (v) => ascii(JSON.stringify(v));

const load = (name) => {
  const p = path.join(GOLDEN, name);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
};

/** One top-level key per line, list items one per line, each item compact. */
export function format(data) {
  const parts = Object.entries(data).map(([k, v]) => {
    if (Array.isArray(v) && v.length && v[0] !== null && typeof v[0] === 'object') {
      return ` ${compact(k)}: [\n  ${v.map(compact).join(',\n  ')}\n ]`;
    }
    return ` ${compact(k)}: ${compact(v)}`;
  });
  return `{\n${parts.join(',\n')}\n}\n`;
}

export function build() {
  const cfg = loadGameConfigFile();

  // damage.json: every rating pair at the seed ratings
  const dmg = load('damage.json');
  const pairs = [];
  for (const p of cfg.tiers) {
    for (const q of cfg.tiers) {
      for (const pr of [p.min_rating, p.seed_rating]) {
        const pv = computePreview(p.tier, q.tier, q.base_damage, q.base_recoil, cfg);
        pairs.push({ player_rating: pr, problem_rating: q.seed_rating, damage: pv.damage, recoil: pv.recoil, tier_diff: pv.tier_diff, scenario: pv.scenario, crit: pv.crit });
      }
    }
  }
  dmg.rating_pairs = pairs;

  // rating.json: the frozen grid
  const rat = load('rating.json');
  const grid = [];
  for (let wt = 1; wt <= 5; wt++) {
    for (let lt = 1; lt <= 5; lt++) {
      const wMax = tierRow(cfg, wt).max_hp;
      const lMax = tierRow(cfg, lt).max_hp;
      for (const wPct of [5, 20, 21, 50, 80, 100]) {
        for (const lPct of [0, 10]) {
          for (const minutes of [10, 15, 16, 30, 31, 60, 61, 179]) {
            for (const hits of [0, 3]) {
              const wHp = Math.floor((wMax * wPct) / 100);
              const lHp = Math.floor((lMax * lPct) / 100);
              const r = ratingDelta(wt, lt, wHp, wMax, lHp, lMax, minutes * 60, hits, cfg);
              grid.push([wt, lt, wHp, wMax, lHp, lMax, minutes * 60, hits, r.winner, r.loser]);
            }
          }
        }
      }
    }
  }
  rat.grid_columns = ['w_tier', 'l_tier', 'w_hp', 'w_max', 'l_hp', 'l_max', 'elapsed_s', 'winner_hits', 'winner_delta', 'loser_delta'];
  rat.grid = grid;

  // hands.json
  const pool = [
    ['b1a', 1, 'bit'], ['b1b', 1, 'bit'], ['b2a', 2, 'bit'], ['b2b', 2, 'bit'], ['b3a', 3, 'bit'], ['b3b', 3, 'bit'],
    ['b4a', 4, 'bit'], ['b5a', 5, 'bit'], ['n1a', 1, 'binary'], ['n2a', 2, 'binary'], ['n3a', 3, 'binary'], ['n4a', 4, 'binary'],
    ['n5a', 5, 'binary'], ['g1a', 1, 'general'], ['g2a', 2, 'general'], ['g3a', 3, 'general'], ['g4a', 4, 'general'],
  ].map(([slug, tier, biome]) => ({ slug, tier, biome }));
  const cases = [];
  for (const seed of [1, 42, 987654321]) {
    for (const mapId of ['bit', 'binary', 'prestige']) {
      for (const tier of [1, 2, 3, 5]) {
        const { decks } = buildDecks(pool, seed, mapCfg(cfg, mapId), cfg);
        const hand = dealHand(decks, tier, cfg);
        cases.push({
          seed, map: mapId, player_tier: tier, tiers: [...hand.tiers], slots: [...hand.slots],
          decks: Object.fromEntries(Object.entries(decks).map(([k, v]) => [String(k), v])),
        });
      }
    }
  }
  const hands = load('hands.json');
  hands.pool = pool;
  hands.cases = cases;
  return { 'damage.json': dmg, 'rating.json': rat, 'hands.json': hands, counts: [pairs.length, grid.length, cases.length] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const out = build();
  const check = process.argv.includes('--check');
  let stale = 0;
  for (const name of ['damage.json', 'rating.json', 'hands.json']) {
    const text = format(out[name]);
    const file = path.join(GOLDEN, name);
    if (check) {
      const same = fs.readFileSync(file, 'utf8') === text;
      if (!same) stale++;
      console.log(`${name.padEnd(12)} ${same ? 'identical' : 'DIFFERS'}`);
    } else {
      fs.writeFileSync(file, text);
    }
  }
  const [p, g, c] = out.counts;
  console.log(`damage pairs=${p} rating grid=${g} hand cases=${c}`);
  if (stale) process.exit(1);
}
