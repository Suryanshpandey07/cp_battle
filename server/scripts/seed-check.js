// node scripts/seed-check.js [slug ...] [--brute] [--lang python|cpp]   (npm run seed:check)
//
// Runs every problem's reference solutions through the configured judge runner:
// the Python one stored with the problem and seed/solutions_cpp/<slug>.cpp when
// the judge can compile C++. Fails if any test disagrees or any solution uses
// more than half of the time limit. With --brute it also runs the problem's
// brute_solution (seed/catalog.js) on the hidden tests and expects it to fail
// (TLE or MLE): slow, so it is opt-in.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getGameConfig, getSettings } from '../src/config.js';
import { buildJob, languageToolsPresent, makeRunner, summarize } from '../src/judge/index.js';
import { loadProblemFiles } from '../src/seed.js';
import { PROBLEMS } from '../seed/catalog.js';

const SEED_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'seed');
const noProgress = async () => {};

function references(data, langs) {
  const out = [['python', data.reference_solution]];
  const cpp = path.join(SEED_DIR, 'solutions_cpp', `${data.slug}.cpp`);
  if (fs.existsSync(cpp)) out.push(['cpp', fs.readFileSync(cpp, 'utf8')]);
  return out.filter(([lang]) => !langs || langs.has(lang));
}

export async function checkProblem(runner, data, brute, langs = null) {
  const cfg = getGameConfig();
  const errors = [];
  const tests = data.tests.map((t, i) => ({ index: i, input: t.input, expected: t.expected, is_sample: t.is_sample }));
  const present = languageToolsPresent(cfg, runner.name);
  const parts = [];
  const spec = { tests, mode: 'full', time_limit_ms: data.time_limit_ms, memory_mb: data.memory_mb, checker: data.checker };
  for (const [lang, source] of references(data, langs)) {
    if (!present[lang]) {
      parts.push(`${lang}: skipped (no compiler)`);
      continue;
    }
    const job = { ...buildJob(cfg, { ...spec, language: lang, source }), stop_on_first_fail: false };
    const res = await runner.run(job, noProgress);
    const [verdict, failed, passed] = summarize(res, tests.length);
    const half = Math.floor(job.limits.time_ms / 2);
    const slowest = res.verdicts.reduce((a, v) => Math.max(a, v.time_ms), 0);
    if (verdict !== 'AC') errors.push(`${lang} reference got ${verdict} on test ${failed} (${res.compile_error || res.system_message})`);
    if (slowest > half) errors.push(`${lang} reference took ${slowest} ms, over half the limit (${half} ms)`);
    parts.push(`${lang} ${verdict} ${passed}/${tests.length} slowest ${slowest} ms / half limit ${half} ms`);
  }
  let line = `${data.slug.padEnd(18)} ${parts.join(' | ')}`;
  if (brute) {
    const bruteSource = (PROBLEMS.find((p) => p.slug === data.slug) || {}).brute_solution;
    if (bruteSource) {
      const hidden = tests.filter((t) => !t.is_sample);
      const bres = await runner.run(buildJob(cfg, { ...spec, tests: hidden, language: 'python', source: bruteSource }), noProgress);
      const [bv, bf] = summarize(bres, hidden.length);
      line += ` | brute force: ${bv} on hidden test ${bf}`;
      if (bv === 'AC') errors.push('the brute force passed every hidden test');
    }
  }
  console.log(line);
  return errors;
}

async function main() {
  let argv = process.argv.slice(2);
  let langs = null;
  const i = argv.indexOf('--lang');
  if (i >= 0) {
    langs = new Set([argv[i + 1]]);
    argv = [...argv.slice(0, i), ...argv.slice(i + 2)];
  }
  const slugs = new Set(argv.filter((a) => !a.startsWith('--')));
  const runner = makeRunner(getSettings());
  console.log(`runner: ${runner.name} (sandboxed=${runner.sandboxed})`);
  let failures = 0;
  for (const data of loadProblemFiles()) {
    if (slugs.size && !slugs.has(data.slug)) continue;
    for (const e of await checkProblem(runner, data, argv.includes('--brute'), langs)) {
      failures++;
      console.log(`  FAIL ${data.slug}: ${e}`);
    }
  }
  console.log(failures ? `seed-check FAILED (${failures})` : 'seed-check passed');
  process.exit(failures ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
