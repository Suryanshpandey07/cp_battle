// Drives the harness (src/judge/harness/harness.js) as a child process and reads
// its JSON lines. The harness never sees expected outputs: this side compares
// each test's stdout with the problem's checker and turns statuses into verdicts.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from './checkers.js';
import { log } from '../log.js';

export const HARNESS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'harness');
export const HARNESS = path.join(HARNESS_DIR, 'harness.js');

export function harnessSpec(job) {
  return {
    language: job.language,
    file: job.file,
    source: job.source,
    run: job.run_argv,
    compile: job.compile_argv,
    compile_limits: { cpu_s: job.compile_time_s, memory_mb: job.compile_memory_mb },
    limits: job.limits,
    stop_on_first_fail: job.stop_on_first_fail,
    tests: job.tests.map((t) => ({ index: t.index, input: t.input })),
  };
}

export function toVerdict(job, line) {
  const test = job.tests.find((t) => t.index === line.index);
  const stdout = line.stdout || '';
  let code = line.status;
  if (code === 'OK' && test.expected !== null && test.expected !== undefined) {
    code = check(job.checker, test.expected, stdout, test.input, job.checker_script) ? 'AC' : 'WA';
  }
  const show = job.mode === 'samples' || job.mode === 'custom';
  return {
    index: test.index, code, time_ms: Math.trunc(line.time_ms || 0), memory_kb: Math.trunc(line.memory_kb || 0),
    stdout_tail: show ? stdout : null, stderr_tail: show ? (line.stderr_tail || null) : null,
  };
}

const failed = (v) => v.code !== 'AC' && v.code !== 'OK';

/** Run argv (the harness, directly or inside a container), feed it the spec, collect verdicts. */
export function driveHarness(argv, job, onProgress, { cwd = undefined, env = process.env, signal = undefined } = {}) {
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), { cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const result = { compile_error: null, system_error: false, system_message: '', verdicts: [] };
    let done = false;
    let finished = false;
    let buf = '';
    let stderr = '';
    let chain = Promise.resolve();

    const kill = () => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch { /* gone */ }
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      kill();
      chain.then(() => {
        const stoppedEarly = result.verdicts.length && job.stop_on_first_fail && failed(result.verdicts[result.verdicts.length - 1]);
        if (!done && result.compile_error === null && !result.system_error && !stoppedEarly) {
          log.warn('harness ended early', { stderr_tail: stderr.slice(-500) });
          result.system_error = true;
          result.system_message = 'judge harness ended unexpectedly';
        }
        resolve(result);
      });
    };
    if (signal) signal.addEventListener('abort', () => { result.system_error = true; result.system_message = 'judge job timeout'; done = true; finish(); });

    const handle = (msg) => {
      if (finished) return;
      if (msg.type === 'compile_error') {
        result.compile_error = msg.message;
      } else if (msg.type === 'system_error') {
        result.system_error = true;
        result.system_message = msg.message;
        done = true;
        finish();
      } else if (msg.type === 'test') {
        const v = toVerdict(job, msg);
        result.verdicts.push(v);
        chain = chain.then(() => onProgress(v)).catch(() => {});
        if (job.stop_on_first_fail && failed(v)) finish();
      } else if (msg.type === 'done') {
        done = true;
        finish();
      }
    };

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          handle(JSON.parse(line));
        } catch {
          stderr += `\nbad harness line: ${line.slice(0, 200)}`;
        }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
    child.on('error', (e) => { stderr += String(e); finish(); });
    child.on('close', finish);
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(harnessSpec(job)));
  });
}
