// Generate hidden tests for the seed problems and write seed/problems/<slug>.json.
//
// Inputs come from fixed-seed generators below (a Python-compatible Mersenne
// Twister, so the files are byte-identical to the ones first generated);
// expected outputs come from each problem's reference_solution in
// seed/catalog.js, run with python3. The generated files are committed.
//
//   node scripts/gen-tests.js            # all problems
//   node scripts/gen-tests.js range-and  # one problem
//   node scripts/gen-tests.js --check    # regenerate in memory and compare with the committed files

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PyRandom } from '../src/pyrandom.js';
import { PROBLEMS, STUB_HEADER } from '../seed/catalog.js';

const SEED_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'seed');
const OUT = path.join(SEED_DIR, 'problems');

const R = (slug, i) => new PyRandom(`${slug}:${i}:algoarena`);
const lines = (...rows) => `${rows.map(String).join('\n')}\n`;
const join = (xs) => [...xs].map(String).join(' ');
const range = (a, b) => (b === undefined ? Array.from({ length: a }, (_, i) => i) : Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i));
const times = (n, f) => Array.from({ length: n }, f);
const rng = (lo, hi) => ({ lo, hi }); // a range() for sample()

// ------------------------------------------------------------------ generators

function gLonely(slug) {
  const make = (r, pairs, lo, hi) => {
    const vals = r.sample(rng(lo, hi), pairs + 1);
    const [single, ...rest] = vals;
    const a = [...rest, ...rest, single];
    r.shuffle(a);
    return lines(a.length, join(a));
  };
  return [
    lines(1, 0),
    lines(1, -1000000000),
    make(R(slug, 1), 3, -5, 5),
    lines(5, join([1000000000, -1000000000, 1000000000, 7, -1000000000])),
    make(R(slug, 2), 8000, -(10 ** 9), 10 ** 9),
    make(R(slug, 3), 6000, 0, 100000),
  ];
}

function gPower(slug) {
  const r = R(slug, 1);
  const edge = [0n, 1n, 2n, 3n, 2n ** 59n, 2n ** 60n - 1n, 10n ** 18n, 2n ** 59n + 1n, 576460752303423488n];
  const big = times(6000, () => {
    const a = 1n << BigInt(r.randrange(60));
    const b = r.randrange(10n ** 18n + 1n);
    return r.choice([a, b]);
  });
  const mid = times(3000, () => r.randrange(1, 5000));
  return [lines(1, 0), lines(1, 1), lines(edge.length, ...edge), lines(mid.length, ...mid), lines(big.length, ...big),
    lines(2000, ...Array(2000).fill(1n << 59n))];
}

function gSubset(slug) {
  const out = [lines(1, 42), lines(11, join(range(89, 100)))];
  [4, 7, 11, 11].forEach((n, i) => out.push(lines(n, join(R(slug, i).sample(rng(1, 100), n)))));
  return out;
}

const gGray = () => [1, 4, 7, 10, 11, 12].map((n) => lines(n));

function gRangeAnd(slug) {
  const m = 2 ** 31 - 1;
  const edge = [[0, 0], [m, m], [0, m], [1, m], [m - 1, m], [2 ** 30, m], [2 ** 30 - 1, 2 ** 30], [12, 15]];
  const pairs = (qs) => qs.map(([a, b]) => `${a} ${b}`);
  const out = [lines(edge.length, ...pairs(edge))];
  let r = R(slug, 1);
  const small = times(200, () => {
    const a = r.randrange(0, 1000);
    return [a, a + r.randrange(0, 50)];
  });
  out.push(lines(small.length, ...pairs(small)));
  r = R(slug, 2);
  const same = times(300, () => r.randrange(m + 1)).map((x) => [x, x]);
  out.push(lines(same.length, ...pairs(same)));
  for (const k of [3, 4]) {
    r = R(slug, k);
    const qs = times(5000, () => {
      const a = r.randrange(0, 2 ** 31 - 2 ** 27);
      return [a, a + r.randrange(2 ** 25, 2 ** 27)]; // wide ranges defeat the brute force
    });
    out.push(lines(qs.length, ...pairs(qs)));
  }
  return out;
}

function gTwoSingles(slug) {
  const make = (r, pairs, hi) => {
    const vals = r.sample(rng(0, hi), pairs + 2);
    const a = [...vals.slice(2), ...vals.slice(2), ...vals.slice(0, 2)];
    r.shuffle(a);
    return lines(a.length, join(a));
  };
  return [
    lines(2, '0 1000000000'),
    lines(4, '5 5 6 7'),
    lines(6, '1 2 3 1 2 1000000000'),
    make(R(slug, 1), 50, 200),
    make(R(slug, 2), 12000, 10 ** 9 + 1),
    make(R(slug, 3), 12000, 10 ** 6),
  ];
}

function gMaxXor(slug) {
  const r1 = R(slug, 1);
  const r2 = R(slug, 2);
  const big1 = times(45000, () => r1.randrange(2 ** 30));
  const big2 = times(25000, () => {
    const lo = r2.randrange(2 ** 20);
    return lo | (r2.randrange(2) << 29);
  });
  return [
    lines(2, '0 0'),
    lines(2, `${2 ** 30 - 1} 0`),
    lines(5, '7 7 7 7 7'),
    lines(8, join(R(slug, 3).sample(rng(0, 1000), 8))),
    lines(big1.length, join(big1)),
    lines(big2.length, join(big2)),
  ];
}

function gXorBasis(slug) {
  const r = R(slug, 1);
  const rank40 = range(40).map((i) => 2 ** i);
  r.shuffle(rank40);
  const full = times(8000, () => r.randrange(2n ** 60n));
  return [
    lines(1, 0),
    lines(1, 2n ** 60n - 1n),
    lines(6, '3 3 3 3 3 3'),
    lines(5, '1 2 4 8 16'),
    lines(rank40.length, join(rank40)),
    lines(full.length, join(full)),
  ];
}

function gFirstNotSmaller(slug) {
  const make = (r, n, q, lo, hi) => {
    const a = times(n, () => r.randrange(lo, hi)).sort((x, y) => x - y);
    const qs = times(q, () => r.randrange(lo - 5, hi + 5));
    return lines(`${n} ${q}`, join(a), ...qs);
  };
  return [
    lines('1 1', 0, 0),
    lines('3 3', '-1000000000 0 1000000000', -1000000000, 1000000000, 1000000001 - 1),
    lines('6 4', '2 2 2 2 2 2', 1, 2, 3, 2),
    make(R(slug, 1), 100, 100, -50, 50),
    make(R(slug, 2), 20000, 8000, -(10 ** 9), 10 ** 9),
    make(R(slug, 3), 20000, 8000, 0, 10),
  ];
}

function gSplit(slug) {
  const make = (r, n, k, hi) => lines(`${n} ${k}`, join(times(n, () => r.randrange(hi + 1))));
  return [
    lines('1 1', 0),
    lines('1 1', 10000),
    lines('5 3', '0 0 0 0 0'),
    make(R(slug, 1), 30, 4, 20),
    make(R(slug, 2), 30000, 37, 10000),
    make(R(slug, 3), 30000, 29999, 10000),
  ];
}

function gBalanced(slug) {
  const r1 = R(slug, 1);
  const r2 = R(slug, 2);
  return [
    lines('0'),
    lines('01'),
    lines('1'.repeat(1000)),
    lines(times(300, () => r1.choice('01')).join('')),
    lines(times(200000, () => r1.choice('01')).join('')),
    lines('01'.repeat(60000)),
    lines(times(120000, () => (r2.random() < 0.52 ? '0' : '1')).join('')),
  ];
}

function gAncestor(slug) {
  const pathTree = (n) => range(2, n + 1).map((v) => v - 1);
  const make = (r, parents, q, deep) => {
    const n = parents.length + 1;
    const depth = new Array(n + 1).fill(0);
    for (let v = 2; v <= n; v++) depth[v] = depth[parents[v - 2]] + 1;
    const qs = times(q, () => {
      const v = deep ? r.randrange(n - Math.floor(n / 10), n + 1) : r.randrange(1, n + 1);
      const k = deep ? r.randrange(Math.max(0, depth[v] - 50), depth[v] + 2) : r.randrange(0, n + 1);
      return `${v} ${k}`;
    });
    return lines(n, join(parents), q, ...qs);
  };
  const r = R(slug, 1);
  const randParents = range(2, 2001).map((v) => r.randrange(1, v));
  return [
    lines(1, '', 2, '1 0', '1 1'),
    lines(2, 1, 3, '2 0', '2 1', '2 2'),
    make(R(slug, 2), randParents, 500, false),
    make(R(slug, 3), pathTree(300), 300, false),
    make(R(slug, 4), pathTree(90000), 8000, true),
    make(R(slug, 5), range(2, 30001).map((v) => Math.max(1, v - 1 - (v % 3 === 0 ? 1 : 0))), 8000, true),
  ];
}

function gKth(slug) {
  const make = (r, n, hi, k = null) => {
    const a = times(n, () => r.randrange(hi + 1));
    const total = (n * (n - 1)) / 2;
    return lines(`${n} ${k || r.randrange(1, total + 1)}`, join(a));
  };
  return [
    lines('2 1', '0 1000000000'),
    lines('3 3', '5 5 5'),
    make(R(slug, 1), 50, 100),
    make(R(slug, 2), 500, 10 ** 9, 1),
    make(R(slug, 3), 20000, 10 ** 9),
    make(R(slug, 4), 20000, 1000, (20000 * 19999) / 2),
  ];
}

const gStairs = () => [1, 2, 44, 1000, 999999, 1000000].map((n) => lines(n));

function gRooms(slug) {
  const make = (r, n, span, maxlen) => {
    const iv = times(n, () => {
      const s = r.randrange(span);
      return `${s} ${s + r.randrange(1, maxlen + 1)}`;
    });
    return lines(n, ...iv);
  };
  return [
    lines(1, '0 1000000000'),
    lines(3, '1 2', '2 3', '3 4'),
    lines(4, '5 9', '5 9', '5 9', '5 9'),
    make(R(slug, 1), 100, 1000, 50),
    make(R(slug, 2), 15000, 10 ** 9 - 10 ** 6, 10 ** 6),
    make(R(slug, 3), 15000, 10 ** 5, 10 ** 4),
  ];
}

function gGrid(slug) {
  const make = (r, h, w, p) => {
    const rows = times(h, () => times(w, () => (r.random() < p ? '#' : '.')).join(''));
    rows[0] = `.${rows[0].slice(1)}`;
    rows[rows.length - 1] = `${rows[rows.length - 1].slice(0, -1)}.`;
    return lines(`${h} ${w}`, ...rows);
  };
  return [
    lines('1 1', '#'),
    lines('1 5', '.....'),
    lines('2 3', '...', '..#'),
    make(R(slug, 1), 12, 12, 0.15),
    make(R(slug, 2), 500, 500, 0.05),
    make(R(slug, 3), 500, 500, 0.0),
  ];
}

function gRoad(slug) {
  const make = (r, n, extra, q, adversarial) => {
    const edges = adversarial ? range(1, n).map((v) => [v, v + 1, r.randrange(1, 100)]) : [];
    for (let i = 0; i < extra; i++) {
      const u = r.randrange(1, n + 1);
      const v = r.randrange(1, n + 1);
      edges.push([u, v, r.randrange(10 ** 6, 10 ** 9)]);
    }
    if (adversarial) edges.reverse(); // Bellman-Ford then propagates one step per pass
    else r.shuffle(edges);
    const targets = times(q, () => r.randrange(1, n + 1));
    return lines(`${n} ${edges.length}`, ...edges.map(([u, v, w]) => `${u} ${v} ${w}`), q, join(targets));
  };
  return [
    lines('1 0', 1, 1),
    lines('2 0', 2, '1 2'),
    lines('3 3', '1 2 0', '2 3 0', '1 3 5', 3, '1 2 3'),
    make(R(slug, 1), 50, 80, 50, false),
    make(R(slug, 2), 12000, 12000, 5000, true),
    make(R(slug, 3), 10000, 10000, 5000, false),
  ];
}

export const GENERATORS = {
  'lonely-number': gLonely, 'power-check': gPower, 'subset-parade': gSubset, 'gray-ladder': gGray,
  'range-and': gRangeAnd, 'two-singles': gTwoSingles, 'max-xor-pair': gMaxXor,
  'xor-basis-count': gXorBasis, 'first-not-smaller': gFirstNotSmaller, 'split-capacity': gSplit,
  'balanced-bits': gBalanced, 'ancestor-jumps': gAncestor, 'kth-pair-gap': gKth, 'stair-ways': gStairs,
  'room-sweep': gRooms, 'grid-routes': gGrid, 'road-race': gRoad,
};

/** Expected output: the problem's reference solution (Python, the problems' answer key) run on the input. */
function runSolution(p, stdin) {
  const { slug } = p;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-ref-'));
  const file = path.join(dir, 'reference.py');
  fs.writeFileSync(file, p.reference_solution);
  const r = spawnSync('python3', ['-I', file], { input: stdin, encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
  fs.rmSync(dir, { recursive: true, force: true });
  if (r.error) throw new Error(`${slug}: could not run the reference solution: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${slug}: reference solution failed:\n${r.stderr}`);
  return r.stdout;
}

const words = (s) => s.split(/\s+/).filter(Boolean).join(' ');

export function build(p) {
  const { slug } = p;
  const tests = [];
  for (const [inp, out] of p.samples) {
    const got = runSolution(p, inp);
    if (words(got) !== words(out)) throw new Error(`${slug}: sample disagrees with the reference\ninput:\n${inp}\nexpected:\n${out}\ngot:\n${got}`);
    tests.push({ input: inp, expected: out, is_sample: true });
  }
  for (const inp of GENERATORS[slug](slug)) {
    if (Buffer.byteLength(inp) > 1024 * 1024) throw new Error(`${slug}: test input over 1 MB`);
    const out = runSolution(p, inp);
    if (Buffer.byteLength(out) > 64 * 1024) throw new Error(`${slug}: expected output over 64 KB`);
    tests.push({ input: inp, expected: out, is_sample: false });
  }
  const { rating } = p;
  const tier = rating < 1200 ? 1 : rating < 1400 ? 2 : rating < 1600 ? 3 : rating < 1900 ? 4 : 5;
  return {
    slug, title: p.title, biome: p.biome, rating,
    statement_md: p.statement_md, input_md: p.input_md, output_md: p.output_md,
    constraints_md: p.constraints_md, tags: p.tags, hints: p.hints,
    stubs: { python: STUB_HEADER + p.stub },
    time_limit_ms: tier >= 4 ? 3000 : 2000, memory_mb: 256, checker: 'exact',
    reference_solution: p.reference_solution,
    tests,
  };
}

/** JSON with a one-space indent and non-ASCII escaped, as the committed files are written. */
export const toJson = (data) => `${JSON.stringify(data, null, 1).replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)}\n`;

function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const only = new Set(args.filter((a) => !a.startsWith('--')));
  fs.mkdirSync(OUT, { recursive: true });
  let stale = 0;
  for (const p of PROBLEMS) {
    if (only.size && !only.has(p.slug)) continue;
    const data = build(p);
    const text = toJson(data);
    const file = path.join(OUT, `${p.slug}.json`);
    const hidden = data.tests.filter((t) => !t.is_sample).length;
    if (check) {
      const same = fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text;
      if (!same) stale++;
      console.log(`${p.slug.padEnd(18)} ${same ? 'identical' : 'DIFFERS'}`);
    } else {
      fs.writeFileSync(file, text);
      console.log(`${p.slug.padEnd(18)} samples=${data.tests.length - hidden} hidden=${hidden} size=${Math.floor(fs.statSync(file).size / 1024)} KB`);
    }
  }
  if (check && stale) {
    console.log(`${stale} problem file(s) differ: run node scripts/gen-tests.js`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
