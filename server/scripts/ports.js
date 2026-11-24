// Pick a free TCP port on 127.0.0.1, starting at the preferred one.
//
// Usage: node scripts/ports.js PREFERRED LABEL  ->  prints the chosen port on stdout.
// When the preferred port is taken it says which process holds it (via lsof) on
// stderr, so a server left over from an earlier run is easy to find.

import { spawnSync } from 'node:child_process';
import net from 'node:net';

/** Something accepting connections (even a suspended process), or a port we cannot bind. */
async function busy(port) {
  const accepting = await new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port });
    s.setTimeout(300);
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('timeout', () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
  });
  if (accepting) return true;
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(true));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(false)));
  });
}

function holder(port) {
  const out = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'], { encoding: 'utf8', timeout: 5000 }).stdout || '';
  const pids = out.split('\n').filter((l) => l.startsWith('p')).map((l) => l.slice(1));
  if (!pids.length) return '';
  const cmd = (spawnSync('ps', ['-o', 'stat=,command=', '-p', pids[0]], { encoding: 'utf8', timeout: 5000 }).stdout || '').trim();
  const i = cmd.indexOf(' ');
  const stat = i < 0 ? cmd : cmd.slice(0, i);
  const command = i < 0 ? '' : cmd.slice(i + 1);
  const stopped = stat.startsWith('T') ? ' (it is suspended: probably a Ctrl-Z in some terminal)' : '';
  return `PID ${pids[0]}${stopped}: ${command.trim().slice(0, 160)}`;
}

const preferred = Number(process.argv[2]);
const label = process.argv[3] || 'server';
if (!(await busy(preferred))) {
  console.log(preferred);
  process.exit(0);
}
const who = holder(preferred);
for (let port = preferred + 1; port < preferred + 20; port++) {
  if (!(await busy(port))) {
    console.error(`  ! Port ${preferred} is already in use, so the ${label} will use ${port}.`);
    if (who) {
      console.error(`    ${who}`);
      console.error(`    If that is an old AlgoArena run, stop it with: kill ${who.split(' ')[1].replace(/:$/, '')}`);
    }
    console.log(port);
    process.exit(0);
  }
}
console.error(`  ! No free port between ${preferred} and ${preferred + 19} for the ${label}.`);
process.exit(1);
