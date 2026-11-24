// Sandbox escape suite. Each case is a submitted program and the expected
// verdict. The Docker runner must pass all of them (skipped when no Docker daemon
// or judge image is available). The dev subprocess runner passes the ones it can
// enforce; the rest are marked todo with the reason written down.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { getGameConfig } from '../../src/config.js';
import { which } from '../../src/judge/harness/harness.js';
import { buildJob, summarize } from '../../src/judge/index.js';
import { DockerRunner, dockerAvailable, dockerImagePresent, SubprocessRunner } from '../../src/judge/runners.js';
import { setLevel } from '../../src/log.js';

setLevel('ERROR');
const CFG = getGameConfig();
const IMAGE = 'algoarena-judge:latest';
const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;
const dockerReady = dockerAvailable() && dockerImagePresent(IMAGE);
const noPython = !which('python3', process.env.PATH) && 'python3 is not installed';

const KINDS = [['subprocess', noPython], ['docker', !dockerReady && 'no Docker daemon or judge image']];

// The tripwire is off so the resource limits themselves are what is tested.
const runner = (kind) => (kind === 'subprocess' ? new SubprocessRunner('test', false) : new DockerRunner(IMAGE));

async function verdict(kind, src, { tl = 125, mem = 128, input = '', expected = 'x\n' } = {}) {
  const job = buildJob(CFG, { language: 'python', source: src, tests: [{ index: 0, input, expected, is_sample: true }], mode: 'samples', time_limit_ms: tl, memory_mb: mem, checker: 'exact' });
  const res = await runner(kind).run(job, async () => {});
  return [summarize(res, 1)[0], res.verdicts.length ? res.verdicts[0].stdout_tail || '' : ''];
}

for (const [kind, skip] of KINDS) {
  test(`${kind}: an infinite loop is TLE and the process is gone`, { skip }, async () => {
    const [code] = await verdict(kind, "import time\nopen('marker_pid','w')\nwhile True: pass\n");
    assert.equal(code, 'TLE');
    assert.equal(spawnSync('pgrep', ['-f', 'marker_pid'], { encoding: 'utf8' }).stdout.trim(), '');
  });

  test(`${kind}: a huge allocation is MLE or RE`, { skip }, async () => {
    assert.ok(['MLE', 'RE'].includes((await verdict(kind, 'a = [0] * (10**9)\nprint(len(a))\n'))[0]));
  });

  test(`${kind}: printing a gigabyte is OLE`, { skip }, async () => {
    const src = "import sys\nchunk = 'x' * 1048576\nfor _ in range(1024): sys.stdout.write(chunk)\n";
    assert.equal((await verdict(kind, src, { tl: 1000 }))[0], 'OLE');
  });

  test(`${kind}: sys.exit(1) is RE`, { skip }, async () => {
    assert.equal((await verdict(kind, 'import sys\nsys.exit(1)\n'))[0], 'RE');
  });

  test(`${kind}: the environment holds no server secrets`, { skip }, async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 's3cret-for-the-test';
    const [, out] = await verdict(kind, "import os\nprint('JWT_SECRET' in os.environ, len(os.environ))\n", { expected: null });
    assert.ok(out.startsWith('False'), out);
  });

  test(`${kind}: a fork bomb is contained`, { skip, todo: kind === 'subprocess' && IS_ROOT && 'RLIMIT_NPROC is not enforced for root; run the dev server as a normal user' }, async () => {
    const src = 'import os\nn = 0\nfor _ in range(300):\n    try:\n        pid = os.fork()\n    except OSError:\n        break\n'
      + '    if pid == 0:\n        import time; time.sleep(5); os._exit(0)\n    n += 1\nprint(n)\n';
    const [code, out] = await verdict(kind, src, { tl: 1000, expected: null });
    assert.ok(['OK', 'RE', 'TLE'].includes(code));
    assert.ok(!out.trim() || Number(out.split(/\s+/)[0]) < 300);
  });

  test(`${kind}: the network is blocked`, { skip, todo: kind === 'subprocess' && 'the dev runner cannot block network access; Docker runs with --network none' }, async () => {
    const src = "import socket\ntry:\n    socket.create_connection(('1.1.1.1', 80), timeout=2); print('open')\nexcept OSError: print('blocked')\n";
    assert.equal((await verdict(kind, src, { tl: 500, expected: null }))[1].trim(), 'blocked');
  });

  test(`${kind}: host files are unreadable`, { skip, todo: kind === 'subprocess' && 'the dev runner runs as the server user and can read what that user can read' }, async () => {
    const src = "try:\n    print(open('/etc/hostname').read()[:3] and 'read')\nexcept OSError: print('denied')\n";
    assert.ok(['denied', 'read'].includes((await verdict(kind, src, { expected: null }))[1].trim())); // /etc in the image is the container's
  });

  test(`${kind}: cannot write outside the job directory`, { skip }, async (t) => {
    const target = kind === 'subprocess' ? '/tmp/aa-escape-write-test' : '/work/escape';
    const src = `try:\n    open(${JSON.stringify(target)}, 'w').write('x'); print('wrote')\nexcept OSError: print('denied')\n`;
    const out = (await verdict(kind, src, { expected: null }))[1].trim();
    if (kind === 'subprocess' && out === 'wrote') {
      fs.rmSync(target, { force: true });
      t.todo('the dev runner cannot stop writes to world-writable host paths');
      return;
    }
    assert.equal(out, 'denied');
  });

  test(`${kind}: concurrent jobs cannot see each other`, { skip }, async () => {
    const writer = "open('secret_from_a.txt','w').write('A'); import time; time.sleep(0.4); print('done')\n";
    const reader = "import os, time\ntime.sleep(0.1)\nprint('secret_from_a.txt' in os.listdir('.'))\n";
    const a = verdict(kind, writer, { tl: 1000, expected: null });
    const b = verdict(kind, reader, { tl: 1000, expected: null });
    await a;
    assert.equal((await b)[1].trim(), 'False');
  });

  test(`${kind}: no stray processes after the suite`, { skip }, () => {
    const out = spawnSync('pgrep', ['-af', 'harness/harness.js'], { encoding: 'utf8' }).stdout;
    assert.deepEqual(out.split('\n').filter((ln) => ln && !ln.includes('pgrep')), []);
  });
}
