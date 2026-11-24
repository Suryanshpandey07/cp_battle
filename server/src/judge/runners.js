// Runners: where a job's code actually runs.
//   subprocess  DEVELOPMENT ONLY, not a security boundary: the harness as a child process
//   docker      one locked-down container per job (the default when the image is built)
//   judge0      a self-hosted Judge0 CE (for hosts that cannot start containers)
//   fake        ENV=test only: simulated verdicts from marker comments, never runs code

import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { check } from './checkers.js';
import { driveHarness, HARNESS } from './driver.js';
import { log } from '../log.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const health = (ok, name, sandboxed, detail = '') => ({ ok, name, sandboxed, detail });

// ---------------------------------------------------------------------------- tripwires
// A tripwire, not security: blocks the obvious, nothing more.
const PY_MODULES = ['subprocess', 'socket', 'ctypes', 'multiprocessing', 'pty', 'shutil', 'signal', 'resource'];
const PY_OS_CALLS = ['system', 'popen', 'fork', 'forkpty', 'kill', 'killpg', 'remove', 'unlink', 'rmdir',
  'removedirs', 'rename', 'execv', 'execve', 'execvp', 'execl', 'spawnv', 'setsid'];

/** Drop comments and string literals so they cannot trip (or hide from) the checks. */
function pythonCode(source) {
  return source.replace(/("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|#[^\n]*)/g, (m) => (m.startsWith('#') ? '' : '""'));
}

export function tripwire(source) {
  const code = pythonCode(source);
  for (const m of code.matchAll(/^\s*import\s+([^\n#;]+)/gm)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+/)[0];
      if (PY_MODULES.includes(name.split('.')[0])) return `import of ${name} is not allowed in the dev sandbox`;
    }
  }
  for (const m of code.matchAll(/^\s*from\s+([\w.]+)\s+import\b/gm)) {
    if (PY_MODULES.includes(m[1].split('.')[0])) return `import of ${m[1]} is not allowed in the dev sandbox`;
  }
  for (const m of code.matchAll(/\bos\s*\.\s*(\w+)/g)) {
    const attr = m[1];
    if (PY_OS_CALLS.includes(attr) || attr.startsWith('exec') || attr.startsWith('spawn')) return `os.${attr} is not allowed in the dev sandbox`;
  }
  if (/\b__import__\s*\(/.test(code)) return '__import__ is not allowed in the dev sandbox';
  return null;
}

// The same idea for C++: process control, shells and sockets.
const CPP_TRIPWIRE = new RegExp(
  String.raw`\b(system|popen|fork|vfork|execv|execve|execvp|execl|execlp|posix_spawn|kill|socket|connect|remove|unlink|rename)\s*\(`
  + String.raw`|#\s*include\s*<\s*(unistd\.h|sys/socket\.h|sys/wait\.h|spawn\.h|netinet/in\.h|arpa/inet\.h|dlfcn\.h)\s*>`,
);

export function cppTripwire(source) {
  const code = source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ''); // ignore comments
  const m = code.match(CPP_TRIPWIRE);
  if (!m) return null;
  return `${m[1] || `<${m[2]}>`} is not allowed in the dev sandbox`;
}

// ---------------------------------------------------------------------------- subprocess
export class SubprocessRunner {
  constructor(env = 'dev', useTripwire = true) {
    if (env === 'prod') throw new Error('SubprocessRunner is development-only and refuses to start with ENV=prod');
    this.name = 'subprocess';
    this.sandboxed = false;
    this.useTripwire = useTripwire;
    log.warn('DEV SANDBOX: the subprocess judge runner is not safe for untrusted users');
  }

  async healthcheck() {
    return health(true, this.name, false, 'dev sandbox: not safe for untrusted users');
  }

  async run(job, onProgress, signal) {
    if (this.useTripwire) {
      const reason = job.language === 'python' ? tripwire(job.source) : job.language === 'cpp' ? cppTripwire(job.source) : null;
      if (reason) return { compile_error: `DEV SANDBOX tripwire: ${reason}`, system_error: false, system_message: '', verdicts: [] };
    }
    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-job-'));
    fs.chmodSync(workdir, 0o700);
    try {
      return await driveHarness([process.execPath, HARNESS], job, onProgress,
        { cwd: workdir, env: { PATH: process.env.PATH || '/usr/bin:/bin' }, signal });
    } finally {
      fs.rmSync(workdir, { recursive: true, force: true });
    }
  }
}

// ---------------------------------------------------------------------------- docker
export function dockerAvailable() {
  const r = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { timeout: 10_000 });
  return r.status === 0;
}

/** True when the daemon answers and the judge image is built (make judge-image). */
export function dockerImagePresent(image) {
  const r = spawnSync('docker', ['image', 'inspect', image], { timeout: 10_000, stdio: 'ignore' });
  return r.status === 0;
}

export class DockerRunner {
  constructor(image) {
    this.name = 'docker';
    this.sandboxed = true;
    this.image = image;
  }

  async healthcheck() {
    if (!dockerAvailable()) return health(false, this.name, true, 'docker unavailable');
    if (!dockerImagePresent(this.image)) return health(false, this.name, true, `image ${this.image} missing: run make judge-image`);
    return health(true, this.name, true, this.image);
  }

  argv(job, name) {
    const lim = job.limits;
    // Compilers need far more memory than the program they build; the program's
    // own cap is still the address-space limit (and RSS polling) the harness applies per test.
    const mem = job.compile_argv ? Math.max(lim.memory_mb, job.compile_memory_mb) + 128 : lim.memory_mb + 128;
    return [
      'docker', 'run', '--rm', '-i', '--name', name,
      '--network', 'none',
      '--read-only',
      '--tmpfs', '/tmp:rw,nosuid,size=64m',
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges',
      '--pids-limit', String(lim.nproc),
      '--memory', `${mem}m`,
      '--memory-swap', `${mem}m`,
      '--cpus', '1',
      '--user', '65534:65534',
      '--ulimit', `nofile=${lim.nofile}`,
      '-w', '/tmp',
      '-e', 'PYTHONDONTWRITEBYTECODE=1',
      this.image,
      'node', '/harness/harness.js',
    ];
  }

  async run(job, onProgress, signal) {
    const name = `aa-job-${randomBytes(6).toString('hex')}`;
    try {
      return await driveHarness(this.argv(job, name), job, onProgress, { signal });
    } finally {
      // --rm removes it on exit; this covers a cancelled or killed client.
      await new Promise((r) => spawn('docker', ['rm', '-f', name], { stdio: 'ignore' }).on('close', r).on('error', r));
    }
  }
}

// ---------------------------------------------------------------------------- judge0
const JUDGE0_LANGUAGE_IDS = { python: 71, cpp: 54 }; // Judge0 CE: Python 3.8.1, C++ (GCC 9.2.0); config judge0_id wins
const JUDGE0_STATUS = { 3: 'OK', 4: 'WA', 5: 'TLE', 6: 'CE', 7: 'RE', 8: 'RE', 9: 'RE', 10: 'RE', 11: 'RE', 12: 'RE', 13: 'SE', 14: 'SE' };
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const unb64 = (s) => (s ? Buffer.from(s, 'base64').toString('utf8') : '');

/** Optional: a self-hosted Judge0 CE through JUDGE0_URL. Each test is one submission in a batch. */
export class Judge0Runner {
  constructor(url) {
    if (!url) throw new Error('JUDGE0_URL is not set');
    this.name = 'judge0';
    this.sandboxed = true;
    this.url = url.replace(/\/$/, '');
  }

  async healthcheck() {
    try {
      const r = await fetch(`${this.url}/about`, { signal: AbortSignal.timeout(5000) });
      return health(r.status === 200, this.name, true, this.url);
    } catch (e) {
      return health(false, this.name, true, String(e.message || e));
    }
  }

  async run(job, onProgress) {
    const lang = job.judge0_id || JUDGE0_LANGUAGE_IDS[job.language];
    const result = { compile_error: null, system_error: false, system_message: '', verdicts: [] };
    if (!lang) return { ...result, system_error: true, system_message: 'language not mapped for Judge0' };
    const lim = job.limits;
    const subs = job.tests.map((t) => ({
      language_id: lang, source_code: b64(job.source), stdin: b64(t.input),
      cpu_time_limit: lim.time_ms / 1000, wall_time_limit: lim.wall_ms / 1000, memory_limit: lim.memory_mb * 1024, enable_network: false,
    }));
    const r = await fetch(`${this.url}/submissions/batch?base64_encoded=true`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ submissions: subs }), signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) throw new Error(`Judge0 answered ${r.status}`);
    const tokens = (await r.json()).map((x) => x.token);
    for (let i = 0; i < job.tests.length; i++) {
      const t = job.tests[i];
      let data;
      for (;;) {
        data = await (await fetch(`${this.url}/submissions/${tokens[i]}?base64_encoded=true`, { signal: AbortSignal.timeout(30_000) })).json();
        if (data.status.id > 2) break;
        await sleep(250);
      }
      let code = JUDGE0_STATUS[data.status.id] || 'SE';
      if (code === 'CE') return { ...result, compile_error: unb64(data.compile_output).slice(0, 2000) };
      if (code === 'SE') return { ...result, system_error: true };
      const out = unb64(data.stdout);
      if (code === 'OK' && t.expected !== null && t.expected !== undefined) code = check(job.checker, t.expected, out, t.input) ? 'AC' : 'WA';
      const show = job.mode === 'samples' || job.mode === 'custom';
      const v = {
        index: t.index, code, time_ms: Math.trunc(Number(data.time || 0) * 1000), memory_kb: Math.trunc(Number(data.memory || 0)),
        stdout_tail: show ? out : null, stderr_tail: show ? unb64(data.stderr).slice(-4096) : null,
      };
      result.verdicts.push(v);
      await onProgress(v);
      if (job.stop_on_first_fail && code !== 'AC' && code !== 'OK') break;
    }
    return result;
  }
}

// ---------------------------------------------------------------------------- fake
const VERDICT_RE = /(?:#|\/\/)\s*VERDICT:\s*(AC|WA|TLE|MLE|RE|OLE|CE|SE)(?:\s+(\d+))?/i;
const DELAY_RE = /(?:#|\/\/)\s*DELAY_MS:\s*(\d+)/i;

/**
 * Exists only when ENV=test. Simulated, never runs code. A marker comment picks the verdict:
 *   # VERDICT: AC     every test passes          # VERDICT: WA 3   wrong answer on test 3
 *   # VERDICT: CE     compile error              # VERDICT: SE     judge system error (no recoil)
 *   # DELAY_MS: 400   simulated judging time per test (default 60)
 * Code without a marker is treated as AC. C++ uses // instead of #.
 */
export class FakeRunner {
  constructor(env) {
    if (env !== 'test') throw new Error('FakeRunner is only available with ENV=test');
    this.name = 'fake';
    this.sandboxed = false;
  }

  async healthcheck() {
    return health(true, this.name, false, 'simulated verdicts (ENV=test)');
  }

  async run(job, onProgress) {
    const m = job.source.match(VERDICT_RE);
    const code = m ? m[1].toUpperCase() : 'AC';
    const failAt = m && m[2] ? parseInt(m[2], 10) : 1;
    const d = job.source.match(DELAY_RE);
    const delay = d ? parseInt(d[1], 10) : 60;
    if (code === 'CE') {
      await sleep(delay);
      return { compile_error: 'line 1: invalid syntax (simulated)', system_error: false, system_message: '', verdicts: [] };
    }
    if (code === 'SE') {
      await sleep(delay);
      return { compile_error: null, system_error: true, system_message: 'simulated system error', verdicts: [] };
    }
    const result = { compile_error: null, system_error: false, system_message: '', verdicts: [] };
    const show = job.mode === 'samples' || job.mode === 'custom';
    for (const t of job.tests) {
      await sleep(delay);
      const failing = code !== 'AC' && t.index + 1 >= failAt;
      const vcode = failing ? code : t.expected === null || t.expected === undefined ? 'OK' : 'AC';
      const out = failing ? 'simulated wrong output\n' : (t.expected || '');
      const v = { index: t.index, code: vcode, time_ms: 12, memory_kb: 9000, stdout_tail: show ? out : null, stderr_tail: null };
      result.verdicts.push(v);
      await onProgress(v);
      if (failing && job.stop_on_first_fail) break;
    }
    return result;
  }
}
