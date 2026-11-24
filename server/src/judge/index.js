// Judging: runner selection, job building and the pool the rest of the server talks to.
//
// The server calls judge.run({mode, language, source, tests, priority,
// time_limit_ms, memory_mb, checker, checker_script}, onProgress) and gets back
// {compile_error, system_error, system_message, verdicts: [{index, code, time_ms,
// memory_kb, stdout_tail, stderr_tail}]}.

import { language as languageCfg } from '../domain/gameconfig.js';
import { log } from '../log.js';
import { which } from './harness/harness.js';
import { JudgePool } from './pool.js';
import { DockerRunner, dockerAvailable, dockerImagePresent, FakeRunner, Judge0Runner, SubprocessRunner } from './runners.js';

export const PRIORITY_SUBMIT = 0;
export const PRIORITY_RUN = 1;
export const PRIORITY_PRACTICE = 2;

/** [verdict code, failed test number (1-based) or null, tests passed]. */
export function summarize(res, total) {
  if (res.system_error) return ['SE', null, 0];
  if (res.compile_error !== null && res.compile_error !== undefined) return ['CE', null, 0];
  let passed = 0;
  for (const v of res.verdicts || []) {
    if (v.code === 'AC' || v.code === 'OK') { passed++; continue; }
    return [v.code, v.index + 1, passed];
  }
  if (passed < total) return ['SE', null, passed];
  return [total ? 'AC' : 'SE', null, passed];
}

export const systemError = (message) => ({ compile_error: null, system_error: true, system_message: message, verdicts: [] });

export function makeRunner(settings) {
  const backend = settings.judgeBackend;
  if (backend === 'fake' || (backend === 'auto' && settings.env === 'test')) return new FakeRunner(settings.env);
  if (backend === 'judge0') return new Judge0Runner(settings.judge0Url);
  if (backend === 'docker') return new DockerRunner(settings.judgeImage);
  if (backend === 'auto') {
    if (dockerAvailable() && dockerImagePresent(settings.judgeImage)) return new DockerRunner(settings.judgeImage);
    if (settings.isProd) {
      throw new Error(`JUDGE_BACKEND=auto found no Docker judge image '${settings.judgeImage}'; run \`make judge-image\` or set JUDGE_BACKEND=judge0`);
    }
    log.warn('Docker or the judge image is missing; using the DEV SANDBOX subprocess runner (run `make judge-image` to judge in containers)');
  }
  return new SubprocessRunner(settings.env);
}

export function buildLimits(timeLimitMs, memoryMb, langMult, cfg, capMs = null) {
  const j = cfg.judge;
  let t = timeLimitMs * langMult;
  if (capMs !== null) t = Math.min(t, capMs);
  return {
    time_ms: t, wall_ms: j.wall_factor * t + j.wall_extra_ms, memory_mb: memoryMb, output_kb: j.output_limit_kb,
    fsize_bytes: j.dev_fsize_mb * 1024 * 1024, nofile: 64, nproc: j.max_processes, stderr_tail_kb: j.stderr_tail_kb,
  };
}

export function buildJob(cfg, { language, source, tests, mode, time_limit_ms: timeLimitMs, memory_mb: memoryMb, checker, checker_script: checkerScript = null }) {
  const lang = languageCfg(cfg, language);
  const cap = mode === 'samples' || mode === 'custom' ? cfg.judge.run_time_cap_ms : null;
  return {
    language, source, tests, mode,
    stop_on_first_fail: mode === 'full' ? cfg.judge.stop_on_first_fail : false,
    limits: buildLimits(timeLimitMs, memoryMb, lang.time_multiplier, cfg, cap),
    run_argv: lang.run.split(/\s+/),
    file: lang.file,
    compile_argv: lang.compile ? lang.compile.split(/\s+/) : null,
    compile_time_s: cfg.judge.compile_time_s,
    compile_memory_mb: cfg.judge.compile_memory_mb,
    judge0_id: lang.judge0_id,
    checker,
    checker_script: checkerScript,
  };
}

/** Which languages this judge can run. Docker, Judge0 and the test judge bring their
 * own toolchains; the dev runner uses this machine's, so look for the tool. */
export function languageToolsPresent(cfg, runnerName) {
  const out = {};
  for (const l of cfg.languages) {
    const tool = (l.compile || l.run).split(/\s+/)[0];
    out[l.id] = runnerName !== 'subprocess' || Boolean(which(tool, process.env.PATH));
  }
  return out;
}

/** The judge the server uses: a priority pool in front of one runner. */
export class Judge extends JudgePool {
  constructor(runner, cfg) {
    const j = cfg.judge;
    super(runner, { concurrency: j.concurrency, maxQueued: j.max_queued, queueTimeoutS: j.queue_timeout_s, jobTimeoutS: j.job_timeout_s });
    this.cfg = cfg;
    this._languages = null;
  }

  healthcheck() {
    return this.runner.healthcheck();
  }

  async languages(cfg = this.cfg) {
    if (!this._languages) this._languages = languageToolsPresent(cfg, this.runner.name);
    return this._languages;
  }

  run(job, onProgress) {
    return this.submit(buildJob(this.cfg, job), job.priority ?? PRIORITY_RUN, onProgress);
  }
}

export const makeJudge = (settings, cfg) => new Judge(makeRunner(settings), cfg);
