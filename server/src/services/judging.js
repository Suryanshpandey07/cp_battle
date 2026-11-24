// Run (free) and Submit (the attack) on top of the judge.

import { AppError } from '../errors.js';
import { language as languageCfg } from '../domain/gameconfig.js';
import { PRIORITY_PRACTICE, PRIORITY_RUN, PRIORITY_SUBMIT, summarize } from '../judge/index.js';

export function validateCode(code, cfg) {
  if (!code.trim()) throw new AppError('empty_code', 'Write some code first');
  if (Buffer.byteLength(code, 'utf8') > cfg.match.max_code_bytes) throw new AppError('code_too_large', 'Code must be under 64 KB');
}

export async function validateLanguage(lang, cfg, judge) {
  let l;
  try {
    l = languageCfg(cfg, lang);
  } catch {
    throw new AppError('validation', `Unknown language '${lang}'`);
  }
  const present = judge ? await judge.languages(cfg) : {};
  if (present[lang] === false) {
    const tool = (l.compile || l.run).split(' ')[0];
    throw new AppError('validation', `${l.name} is not available on this server: ${tool} was not found. `
      + 'Install it (on a Mac: xcode-select --install) or judge in Docker (make judge-image).');
  }
}

function job(cfg, problem, lang, code, tests, mode, priority) {
  return {
    mode, language: lang, source: code, tests, priority,
    time_limit_ms: problem.time_limit_ms, memory_mb: problem.memory_mb,
    checker: problem.checker, checker_script: problem.checker_script,
  };
}

/** The time limit a Run gets: the problem's, scaled for the language, capped for Runs. */
function runTimeCap(cfg, problem, lang) {
  return Math.min(problem.time_limit_ms * languageCfg(cfg, lang).time_multiplier, cfg.judge.run_time_cap_ms);
}

/** A free Run: the sample tests, or one custom input. Never touches HP. */
export async function runSamples(judge, cfg, problem, lang, code, customInput, practice = false) {
  await validateLanguage(lang, cfg, judge);
  validateCode(code, cfg);
  let tests;
  let mode;
  if (customInput !== null && customInput !== undefined) {
    if (Buffer.byteLength(customInput, 'utf8') > cfg.judge.custom_input_limit_kb * 1024) {
      throw new AppError('validation', 'Custom input must be under 64 KB');
    }
    tests = [{ index: 0, input: customInput, expected: null, is_sample: true }];
    mode = 'custom';
  } else {
    tests = problem.samples;
    mode = 'samples';
  }
  const res = await judge.run(job(cfg, problem, lang, code, tests, mode, practice ? PRIORITY_PRACTICE : PRIORITY_RUN));
  const [verdict, failed, passed] = summarize(res, tests.length);
  const byIndex = new Map(tests.map((t) => [t.index, t]));
  return {
    mode,
    verdict: mode === 'custom' && verdict === 'AC' ? 'OK' : verdict,
    failed_test: failed,
    passed,
    total: tests.length,
    compile_error: res.compile_error ?? null,
    system_error: Boolean(res.system_error),
    time_cap_ms: runTimeCap(cfg, problem, lang),
    tests: (res.verdicts || []).map((v) => ({
      index: v.index, code: v.code, time_ms: v.time_ms, memory_kb: v.memory_kb,
      input: byIndex.get(v.index).input, expected: byIndex.get(v.index).expected,
      output: v.stdout_tail ?? null, stderr: v.stderr_tail ?? null,
    })),
  };
}

/** Submit: every test, samples first, stopping at the first failure. Returns [result, total]. */
export async function judgeFull(judge, cfg, problem, lang, code, onProgress) {
  const tests = problem.allTests;
  const res = await judge.run(job(cfg, problem, lang, code, tests, 'full', PRIORITY_SUBMIT), onProgress);
  return [res, tests.length];
}
