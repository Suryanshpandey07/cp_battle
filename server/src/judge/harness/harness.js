#!/usr/bin/env node
// Judge harness. Runs inside the sandbox (Docker) or as the dev runner's child.
//
// Reads one job spec as JSON on stdin, writes the source into the current
// directory, compiles it (a syntax check for Python, the configured compiler for
// C++ and other compiled languages), then runs each test with the input on
// stdin. Resource limits are set with the shell's ulimit just before the user
// program starts, and its CPU time is read back with the shell's `times`.
// Prints one JSON object per line:
//
//   {"type": "compile_error", "message": "line 3: invalid syntax"}
//   {"type": "system_error", "message": "the g++ compiler is not installed on the judge"}
//   {"type": "test", "index": 0, "status": "OK|TLE|MLE|RE|OLE", "time_ms", "memory_kb", "stdout", "stderr_tail"}
//   {"type": "done"}
//
// It never sees expected outputs: comparing is done by the caller, outside the
// sandbox. Standalone on purpose: it imports nothing from the app.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const INCLUDE_DIR = path.join(HERE, 'include'); // bits/stdc++.h for compilers that lack it (clang on macOS)
const LINUX = process.platform === 'linux';
const SIGNALS = { SIGKILL: 9, SIGXCPU: 24, SIGXFSZ: 25 };

const emit = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function which(cmd, envPath) {
  if (cmd.includes('/')) return fs.existsSync(cmd) ? cmd : null;
  for (const dir of (envPath || '').split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, cmd);
    try {
      fs.accessSync(p, fs.constants.X_OK);
      if (fs.statSync(p).isFile()) return p;
    } catch { /* keep looking */ }
  }
  return null;
}

function killGroup(child) {
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch { /* already gone */ }
}

/** Resident memory of a process tree, in KB, and its peak where the OS reports one. */
function linuxTree(pid) {
  let rss = 0;
  let hwm = 0;
  const stack = [pid];
  while (stack.length) {
    const p = stack.pop();
    try {
      const status = fs.readFileSync(`/proc/${p}/status`, 'utf8');
      const r = status.match(/^VmRSS:\s+(\d+)/m);
      const h = status.match(/^VmHWM:\s+(\d+)/m);
      if (r) rss += Number(r[1]);
      if (h) hwm = Math.max(hwm, Number(h[1]));
      for (const t of fs.readdirSync(`/proc/${p}/task`)) {
        const kids = fs.readFileSync(`/proc/${p}/task/${t}/children`, 'utf8').trim();
        if (kids) stack.push(...kids.split(/\s+/).map(Number));
      }
    } catch { /* exited */ }
  }
  return { rss, hwm };
}

function psTree(pgid) {
  const r = spawnSync('ps', ['-o', 'rss=', '-g', String(pgid)], { encoding: 'utf8' });
  if (r.status !== 0 && !r.stdout) return { rss: 0, hwm: 0 };
  const rss = r.stdout.split('\n').map((s) => parseInt(s, 10) || 0).reduce((a, b) => a + b, 0);
  return { rss, hwm: 0 };
}

const treeMemory = (child) => (LINUX ? linuxTree(child.pid) : psTree(child.pid));

const PATH_RE = /(\/[^\s"']+\/)([^/\s"']+)/g;

export function scrub(text, workdir) {
  return text.split(`${workdir}${path.sep}`).join('').split(workdir).join('.').replace(PATH_RE, (_, _dir, name) => name);
}

/** `times` prints two lines (the shell, then its children): "0m0.010s 0m0.002s". */
function parseTimes(text) {
  const lines = text.trim().split('\n');
  const m = (lines[lines.length - 1] || '').match(/(\d+)m([\d.]+)s\s+(\d+)m([\d.]+)s/);
  if (!m) return null;
  return Math.round((Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) * 60 + Number(m[4])) * 1000);
}

/**
 * The shell wrapper: set limits on itself, run the program, report its CPU time on fd 3.
 * Every limit is best effort ("|| true"): some do not exist on every system
 * (RLIMIT_AS is ignored on macOS, dash calls the process limit -p).
 */
function limitScript({ cpuS, memMb, fsizeKb, nofile, nproc, stackKb }) {
  const lines = [
    'ulimit -c 0 2>/dev/null || true',
    // Soft limit first: SIGXCPU at the limit, SIGKILL one second later at the hard limit.
    `ulimit -H -t ${cpuS + 1} 2>/dev/null || true`,
    `ulimit -S -t ${cpuS} 2>/dev/null || true`,
    `ulimit -f ${fsizeKb} 2>/dev/null || true`,
    `ulimit -n ${nofile} 2>/dev/null || true`,
  ];
  if (nproc > 0) lines.push(`ulimit -u ${nproc} 2>/dev/null || ulimit -p ${nproc} 2>/dev/null || true`);
  if (stackKb > 0) lines.push(`ulimit -s ${stackKb} 2>/dev/null || ulimit -s "$(ulimit -H -s)" 2>/dev/null || true`);
  if (LINUX && memMb > 0) lines.push(`ulimit -v ${(memMb + 96) * 1024} 2>/dev/null || true`); // headroom for the runtime's own mappings
  lines.push('"$@" <.in >.out 2>.err 3>&-', 'rc=$?', 'times >&3', 'exit $rc');
  return lines.join('\n');
}

/** Run argv under the limits; resolve when it ends or is killed. */
async function supervise(argv, limits, workdir, env, { wallMs, memKb, poll }) {
  const child = spawn('/bin/sh', ['-c', limitScript(limits), 'sh', ...argv], {
    cwd: workdir, env, detached: true, stdio: ['ignore', 'ignore', 'ignore', 'pipe'],
  });
  let timesOut = '';
  child.stdio[3].on('data', (d) => { timesOut += d; });
  let exit = null;
  const exited = new Promise((resolve) => child.on('close', (code, signal) => { exit = { code, signal }; resolve(); }));
  const t0 = performance.now();
  let killed = null;
  let peakKb = 0;
  while (exit === null) {
    const elapsed = performance.now() - t0;
    if (elapsed > wallMs) {
      killed = 'TLE';
      killGroup(child);
      break;
    }
    if (poll) {
      const { rss, hwm } = treeMemory(child);
      peakKb = Math.max(peakKb, rss, hwm);
      if (memKb > 0 && rss > memKb) {
        killed = 'MLE';
        killGroup(child);
        break;
      }
    }
    await Promise.race([exited, sleep(elapsed < 50 ? 3 : LINUX ? 10 : 50)]);
  }
  await exited;
  killGroup(child); // reap anything the program left behind
  const wallTaken = Math.round(performance.now() - t0);
  let rc = exit.code;
  if (rc === null) rc = 128 + (SIGNALS[exit.signal] || 9); // the shell itself was killed
  return { killed, rc, cpuMs: parseTimes(timesOut) ?? wallTaken, peakKb, wallTaken };
}

function readTail(file, bytes) {
  const size = fs.statSync(file).size;
  const fd = fs.openSync(file, 'r');
  try {
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function readHead(file, bytes) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

export async function runOne(argv, input, lim, workdir, env) {
  const [inPath, outPath, errPath] = ['.in', '.out', '.err'].map((n) => path.join(workdir, n));
  fs.writeFileSync(inPath, input);
  const timeMs = Number(lim.time_ms);
  const memMb = Number(lim.memory_mb);
  const outCap = Number(lim.output_kb) * 1024;
  const r = await supervise(argv, {
    cpuS: Math.max(1, Math.ceil(timeMs / 1000)), memMb, fsizeKb: Math.max(1, Math.floor(Number(lim.fsize_bytes) / 1024)),
    nofile: Number(lim.nofile), nproc: Number(lim.nproc), stackKb: memMb * 1024,
  }, workdir, env, { wallMs: Number(lim.wall_ms), memKb: memMb * 1024, poll: true });

  const outSize = fs.existsSync(outPath) ? fs.statSync(outPath).size : 0;
  let stdout = outSize ? readHead(outPath, outCap + 1) : '';
  let stderrTail = fs.existsSync(errPath) ? scrub(readTail(errPath, Number(lim.stderr_tail_kb) * 1024), workdir) : '';
  const cpuMs = r.killed === 'TLE' ? Math.max(r.cpuMs, timeMs) : r.cpuMs;
  let status;
  if (r.killed) {
    status = r.killed;
  } else if (stderrTail.includes('std::bad_alloc')) {
    status = 'MLE'; // C++ new failed against the memory cap
  } else if (outSize > outCap || stderrTail.includes('File too large')) {
    // CPython ignores SIGXFSZ, so hitting the file-size cap shows up as an
    // OSError and exit code 1 rather than a signal: it is still OLE.
    status = 'OLE';
  } else if (r.rc > 128) {
    const sig = r.rc - 128;
    if (sig === SIGNALS.SIGXCPU || (sig === SIGNALS.SIGKILL && cpuMs >= timeMs)) {
      status = 'TLE';
    } else if (sig === SIGNALS.SIGXFSZ) {
      status = 'OLE';
    } else {
      status = 'RE';
      stderrTail = `${stderrTail}\nkilled by signal ${sig}`.trim();
    }
  } else if (r.rc > 0) {
    status = stderrTail.includes('MemoryError') ? 'MLE' : 'RE';
    if (status === 'RE' && !stderrTail) stderrTail = `exit code ${r.rc}`;
  } else if (cpuMs > timeMs) {
    status = 'TLE';
  } else {
    status = 'OK';
  }
  if (status === 'OLE') stdout = stdout.slice(0, outCap);
  return { status, time_ms: cpuMs, memory_kb: r.peakKb, stdout, stderr_tail: stderrTail };
}

const DIAG_RE = /^(?:main\.\w+:\d+:\d+: (?:error|fatal error)|.*error:)/;

/** Run the compiler under limits: ["ok"|"error"|"missing", message]. */
export async function compileSource(argv, lim, workdir, env) {
  if (!which(argv[0], env.PATH)) return ['missing', `the ${argv[0]} compiler is not installed on the judge`];
  const cpuS = Number(lim.cpu_s ?? 20);
  const memMb = Number(lim.memory_mb ?? 1536);
  // No address-space or process-count limit here: the compiler driver forks the
  // assembler and linker, and on macOS the process limit counts all of the user's processes.
  const errPath = path.join(workdir, '.err');
  fs.writeFileSync(path.join(workdir, '.in'), '');
  const r = await supervise(argv, { cpuS, memMb: 0, fsizeKb: 64 * 1024, nofile: 256, nproc: 0, stackKb: 0 }, workdir, env,
    { wallMs: (cpuS * 1.5 + 5) * 1000, memKb: memMb * 1024, poll: LINUX });
  if (r.killed === 'TLE') return ['error', `compilation took longer than ${cpuS} s`];
  if (r.killed === 'MLE') return ['error', `the compiler used more than ${memMb} MB`];
  const text = scrub(readHead(errPath, 64 * 1024) + readHead(path.join(workdir, '.out'), 64 * 1024), workdir);
  if (r.rc === 0) return ['ok', ''];
  if (r.rc - 128 === SIGNALS.SIGXCPU) return ['error', `compilation took longer than ${cpuS} s`];
  const lines = text.split('\n').filter((ln) => ln.trim());
  // Lead with the first error, then as much context as fits.
  const first = Math.max(0, lines.findIndex((ln) => DIAG_RE.test(ln)));
  const msg = lines.slice(first, first + 30).join('\n') || `compiler exited with code ${r.rc}`;
  return ['error', msg.slice(0, 3000)];
}

const PY_SYNTAX_CHECK = [
  'import sys',
  'src = open(sys.argv[1], encoding="utf-8").read()',
  'try:',
  '    compile(src, sys.argv[1], "exec", dont_inherit=True)',
  'except SyntaxError as e:',
  '    print(f"line {e.lineno}: {e.msg}"); sys.exit(1)',
  'except ValueError as e:',
  '    print(e); sys.exit(1)',
].join('\n');

/** Python has no compile step, so check the syntax up front for a clear message. */
function pythonSyntax(interpreter, file, workdir, env) {
  const r = spawnSync(interpreter, ['-I', '-c', PY_SYNTAX_CHECK, file], { cwd: workdir, env, encoding: 'utf8', timeout: 20_000 });
  if (r.error) return ['missing', `the ${interpreter} interpreter is not installed on the judge`];
  if (r.status === 0) return ['ok', ''];
  return ['error', (r.stdout || r.stderr || 'syntax error').trim()];
}

export async function runSpec(spec, workdir, out = emit) {
  const srcName = spec.file || 'main.py';
  fs.writeFileSync(path.join(workdir, srcName), spec.source);
  const env = {
    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONIOENCODING: 'utf-8',
    LANG: 'C.UTF-8',
    HOME: workdir,
    TMPDIR: workdir,
  };
  const run = spec.run.map((a) => a.replaceAll('{src}', srcName));
  if ((spec.language || 'python') === 'python') {
    if (!which(run[0], env.PATH)) {
      out({ type: 'system_error', message: `the ${run[0]} interpreter is not installed on the judge` });
      return;
    }
    const [state, message] = pythonSyntax(run[0], srcName, workdir, env);
    if (state === 'missing') {
      out({ type: 'system_error', message });
      return;
    }
    if (state === 'error') {
      out({ type: 'compile_error', message });
      out({ type: 'done' });
      return;
    }
  }
  if (spec.compile) {
    const cargv = spec.compile.map((a) => a.replaceAll('{src}', srcName).replaceAll('{include}', INCLUDE_DIR));
    const [state, message] = await compileSource(cargv, spec.compile_limits || {}, workdir, env);
    if (state === 'missing') {
      out({ type: 'system_error', message });
      return;
    }
    if (state === 'error') {
      out({ type: 'compile_error', message });
      out({ type: 'done' });
      return;
    }
  }
  for (const t of spec.tests) {
    const res = await runOne(run, t.input, spec.limits, workdir, env);
    out({ ...res, type: 'test', index: t.index });
    if (spec.stop_on_first_fail && res.status !== 'OK') break;
  }
  out({ type: 'done' });
}

async function main() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const spec = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  await runSpec(spec, process.cwd());
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    emit({ type: 'system_error', message: `harness failure: ${e.message}` });
    process.exitCode = 1;
  });
}
