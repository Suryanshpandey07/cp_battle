// Checkers (golden vectors), the harness through the dev runner, the pool, and
// C++ through the real compiler. Tests that need python3 or g++ skip without them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getGameConfig, SHARED_DIR } from '../../src/config.js';
import { AppError } from '../../src/errors.js';
import { language } from '../../src/domain/gameconfig.js';
import { check } from '../../src/judge/checkers.js';
import { which } from '../../src/judge/harness/harness.js';
import { buildJob, languageToolsPresent, summarize } from '../../src/judge/index.js';
import { JudgePool } from '../../src/judge/pool.js';
import { cppTripwire, FakeRunner, SubprocessRunner, tripwire } from '../../src/judge/runners.js';
import { setLevel } from '../../src/log.js';

setLevel('ERROR');
const CFG = getGameConfig();
const CASES = JSON.parse(fs.readFileSync(path.join(SHARED_DIR, 'golden', 'checkers.json'), 'utf8')).cases;
const noGxx = !which('g++', process.env.PATH) && 'g++ is not installed';
const noPython = !which('python3', process.env.PATH) && 'python3 is not installed';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = (index, input, expected, isSample = false) => ({ index, input, expected, is_sample: isSample });
const v = (i, code) => ({ index: i, code, time_ms: 1, memory_kb: 1 });

test('checker golden vectors', () => {
  for (const c of CASES) assert.equal(check(c.checker, c.expected, c.actual), c.pass, `${c.checker} ${JSON.stringify(c.actual).slice(0, 30)}`);
});

test('a custom checker script (JavaScript)', () => {
  const script = "import fs from 'node:fs';\nconst w = (f) => fs.readFileSync(f, 'utf8').split(/\\s+/).filter(Boolean).sort().join(' ');\nprocess.exit(w(process.argv[3]) === w(process.argv[4]) ? 0 : 1);\n";
  assert.equal(check('custom', '1 2 3', '3 1 2', '', script), true);
  assert.equal(check('custom', '1 2 3', '3 1 1', '', script), false);
});

test('summary logic', () => {
  const r = (ce, verdicts, se = false) => ({ compile_error: ce, verdicts, system_error: se });
  assert.deepEqual(summarize(r(null, [v(0, 'AC'), v(1, 'AC')]), 2), ['AC', null, 2]);
  assert.deepEqual(summarize(r(null, [v(0, 'AC'), v(1, 'WA')]), 3), ['WA', 2, 1]);
  assert.deepEqual(summarize(r('line 1: bad', []), 3), ['CE', null, 0]);
  assert.deepEqual(summarize(r(null, [], true), 3), ['SE', null, 0]);
  assert.deepEqual(summarize(r(null, [v(0, 'AC')]), 3), ['SE', null, 1]); // missing results are never a pass
});

test('the tripwire is only a tripwire', () => {
  assert.ok(tripwire('import subprocess') && tripwire('from socket import socket') && tripwire("import os\nos.system('x')"));
  assert.ok(tripwire('import os, ctypes') && tripwire("__import__('subprocess')"));
  assert.equal(tripwire('import sys\ninput = sys.stdin.readline'), null);
  assert.equal(tripwire('import os\ndata = os.read(0, 10)'), null);
  assert.equal(tripwire('# import subprocess in a comment\nprint("os.system is fine in a string")'), null);
});

test('the fake runner refuses outside tests and the dev runner refuses prod', () => {
  assert.throws(() => new FakeRunner('dev'));
  assert.throws(() => new SubprocessRunner('prod'));
});

const pyJob = (src, tests, mode = 'full', tl = 2000) => buildJob(CFG, { language: 'python', source: src, tests, mode, time_limit_ms: tl, memory_mb: 256, checker: 'exact' });

test('input is fed on stdin and hidden outputs never leave', { skip: noPython }, async () => {
  const r = new SubprocessRunner('test');
  const tests = [T(0, '2 3\n', '5\n', true), T(1, '10 20\n', '30\n')];
  const src = 'a, b = map(int, input().split())\nprint(a + b)\n';
  const full = await r.run(pyJob(src, tests), async () => {});
  assert.deepEqual(summarize(full, 2), ['AC', null, 2]);
  assert.ok(full.verdicts.every((x) => x.stdout_tail === null && x.stderr_tail === null)); // full mode: no outputs
  const samples = await r.run(pyJob(src, tests.slice(0, 1), 'samples'), async () => {});
  assert.equal(samples.verdicts[0].stdout_tail, '5\n');
});

test('stop on first fail, and progress streams', { skip: noPython }, async () => {
  const r = new SubprocessRunner('test');
  const tests = [0, 1, 2, 3, 4].map((i) => T(i, `${i}\n`, `${i}\n`));
  const seen = [];
  const res = await r.run(pyJob('x = int(input())\nprint(x if x < 2 else -1)\n', tests), async (x) => { seen.push(x.code); });
  assert.deepEqual(summarize(res, 5), ['WA', 3, 2]);
  assert.deepEqual(seen, ['AC', 'AC', 'WA']);
});

test('a Python syntax error is a compile error with the line', { skip: noPython }, async () => {
  const res = await new SubprocessRunner('test').run(pyJob('x = (\n', [T(0, '', '1\n')]), async () => {});
  assert.match(res.compile_error, /^line 1:/);
});

test('the pool orders jobs and reports busy and timeouts', async () => {
  const slow = {
    name: 'slow', sandboxed: false,
    async run() {
      await sleep(300);
      return { compile_error: null, system_error: false, verdicts: [v(0, 'AC')] };
    },
  };
  const pool = new JudgePool(slow, { concurrency: 1, maxQueued: 1, queueTimeoutS: 0.1, jobTimeoutS: 0.2 });
  const job = pyJob('print(1)', [T(0, '', '1\n')]);
  const t1 = pool.submit(job, 0);
  await sleep(10);
  const t2 = pool.submit(job, 0);
  await sleep(10);
  await assert.rejects(pool.submit(job, 0), (e) => e instanceof AppError && e.code === 'busy');
  const [r1, r2] = [await t1, await t2];
  assert.equal(r1.system_error, true);
  assert.equal(r1.system_message, 'judge job timeout');
  assert.equal(r2.system_error, true);
  assert.equal(r2.system_message, 'judge queue timeout');
  pool.stop();
});

test('priorities: submits before runs before practice', async () => {
  const order = [];
  const runner = { name: 'rec', sandboxed: false, async run(job) { order.push(job.source); await sleep(5); return { compile_error: null, verdicts: [v(0, 'AC')] }; } };
  const pool = new JudgePool(runner, { concurrency: 1, maxQueued: 10, queueTimeoutS: 5, jobTimeoutS: 5 });
  const mk = (s) => ({ ...pyJob(s, [T(0, '', '1\n')]) });
  const all = [pool.submit(mk('first'), 1), pool.submit(mk('practice'), 2), pool.submit(mk('run'), 1), pool.submit(mk('submit'), 0)];
  await Promise.all(all);
  assert.deepEqual(order, ['first', 'submit', 'run', 'practice']);
});

// ---------------------------------------------------------------- C++

const SUM = "#include <bits/stdc++.h>\nusing namespace std;\nint main(){ios::sync_with_stdio(false);cin.tie(nullptr);long long a,b;cin>>a>>b;cout<<a+b<<'\\n';}\n";
const TESTS = [T(0, '1 2\n', '3', true), T(1, '1000000000000 1\n', '1000000000001')];
const cppJob = (src, tests = TESTS, tl = 1000, mem = 256, mode = 'full') => buildJob(CFG, { language: 'cpp', source: src, tests, mode, time_limit_ms: tl, memory_mb: mem, checker: 'tokens' });

async function run(job) {
  const seen = [];
  const res = await new SubprocessRunner('test').run(job, async (x) => { seen.push(x); });
  return [res, seen];
}

test('C++ config and job shape', () => {
  const cpp = language(CFG, 'cpp');
  assert.equal(cpp.time_multiplier, 1);
  assert.equal(cpp.comment, '//');
  assert.ok(cpp.compile.includes('{include}'));
  const j = cppJob(SUM);
  assert.equal(j.compile_argv[0], 'g++');
  assert.deepEqual(j.run_argv, ['./main']);
  assert.equal(j.file, 'main.cpp');
  const py = pyJob('print(1)', TESTS, 'full', 1000);
  assert.equal(py.compile_argv, null);
  assert.equal(py.limits.time_ms, 8 * j.limits.time_ms); // limits are set for C++
});

test('accepted with <bits/stdc++.h>, and progress streams', { skip: noGxx }, async () => {
  const [res, seen] = await run(cppJob(SUM));
  assert.equal(res.compile_error, null);
  assert.deepEqual(res.verdicts.map((x) => x.code), ['AC', 'AC']);
  assert.deepEqual(seen.map((x) => x.index), [0, 1]);
});

test('a wrong answer stops at the first failure', { skip: noGxx }, async () => {
  const [res] = await run(cppJob(SUM.replace('a+b', 'a-b')));
  assert.deepEqual(res.verdicts.map((x) => x.code), ['WA']);
});

test('a compile error shows the compiler message without temp paths', { skip: noGxx }, async () => {
  const [res] = await run(cppJob('#include <bits/stdc++.h>\nint main(){ undeclared_thing = 1; }\n'));
  assert.ok(res.compile_error.includes('undeclared_thing') && res.compile_error.includes('error'));
  assert.ok(!res.compile_error.includes('aa-job-') && !res.compile_error.includes('/tmp'));
  assert.ok(res.compile_error.split('\n')[0].startsWith('main.cpp:'));
  assert.deepEqual(res.verdicts, []);
});

test('runtime errors, the time limit and memory', { skip: noGxx }, async () => {
  const one = [T(0, '\n', '0')];
  assert.equal((await run(cppJob('int main(){ volatile int* p = nullptr; return *p; }', one)))[0].verdicts[0].code, 'RE');
  assert.equal((await run(cppJob('int main(){ return 3; }', one)))[0].verdicts[0].code, 'RE');
  assert.equal((await run(cppJob('int main(){ volatile unsigned long long x = 0; for(;;) x++; }', one, 500)))[0].verdicts[0].code, 'TLE');
  const big = '#include <vector>\n#include <cstdio>\nint main(){ std::vector<int> v(400000000, 1); printf("%d", v[123]); }';
  assert.equal((await run(cppJob(big, one, 1000, 64)))[0].verdicts[0].code, 'MLE');
});

test('the output limit', { skip: noGxx }, async () => {
  const [res] = await run(cppJob('#include <cstdio>\nint main(){ for(long i=0;i<100000000;i++) puts("spam spam spam"); }', [T(0, '', 'x')]));
  assert.equal(res.verdicts[0].code, 'OLE');
});

test('deep recursion has a big stack', { skip: noGxx }, async () => {
  const src = '#include <bits/stdc++.h>\nusing namespace std;\nlong long f(int n){ return n==0?0:n+f(n-1); }\nint main(){ int n; cin>>n; cout<<f(n)<<endl; }';
  const [res] = await run(cppJob(src, [T(0, '1000000\n', '500000500000')], 1000, 256));
  assert.equal(res.verdicts[0].code, 'AC', JSON.stringify(res.verdicts));
});

test('a custom-input run shows stdout', { skip: noGxx }, async () => {
  const [res] = await run(cppJob(SUM, [T(0, '40 2\n', null, true)], 1000, 256, 'custom'));
  assert.equal(res.verdicts[0].code, 'OK');
  assert.equal(res.verdicts[0].stdout_tail, '42\n');
});

test('a missing compiler is a system error, not a compile error', async () => {
  const j = cppJob(SUM);
  j.compile_argv = ['no-such-compiler-xyz', ...j.compile_argv.slice(1)];
  const [res] = await run(j);
  assert.equal(res.system_error, true);
  assert.ok(res.system_message.includes('no-such-compiler-xyz'));
  assert.equal(res.compile_error, null);
});

test('language availability follows the runner', () => {
  const present = languageToolsPresent(CFG, 'subprocess');
  assert.equal(present.python, Boolean(which('python3', process.env.PATH)));
  assert.equal(present.cpp, Boolean(which('g++', process.env.PATH)));
  assert.ok(Object.values(languageToolsPresent(CFG, 'docker')).every(Boolean)); // the image brings its own compiler
});

test('the C++ tripwire is only a tripwire', () => {
  assert.ok(cppTripwire('#include <cstdlib>\nint main(){ system("ls"); }'));
  assert.ok(cppTripwire('#include <unistd.h>\nint main(){}'));
  assert.ok(cppTripwire('int main(){ fork(); }'));
  assert.equal(cppTripwire(SUM), null);
  assert.equal(cppTripwire('// system("x") in a comment is fine\nint main(){}'), null);
  assert.equal(cppTripwire('int main(){ int systematic(3); }'), null);
});

test('the fake runner reads C++ comments', async () => {
  const fake = new FakeRunner('test');
  const res = await fake.run(cppJob('// VERDICT: WA 2\n// DELAY_MS: 1\nint main(){}'), async () => {});
  assert.deepEqual(res.verdicts.map((x) => x.code), ['AC', 'WA']);
  assert.ok((await fake.run(cppJob('// VERDICT: CE\nint main(){}'), async () => {})).compile_error);
});
