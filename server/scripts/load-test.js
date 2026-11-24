// Load test: N simultaneous bot-vs-bot matches in one process.
//
//   node scripts/load-test.js            # 50 matches (default)
//   node scripts/load-test.js 100
//
// Runs the real match actors and judge pool with BOT_TIME_SCALE shrinking every
// bot delay, then reports how many matches finished, how long it took and any
// errors. Uses PostgreSQL through Prisma when DATABASE_URL is set, otherwise the
// in-memory test database. Bots use simulated verdicts, so no code is executed.

process.env.ENV = process.env.ENV || 'test';
process.env.BOT_TIME_SCALE = process.env.BOT_TIME_SCALE || '0.003';

const { buildContext } = await import('../src/app.js');
const { getGameConfig } = await import('../src/config.js');
const { createPrisma } = await import('../src/db.js');
const { Judge } = await import('../src/judge/index.js');
const { FakeRunner } = await import('../src/judge/runners.js');
const { setLevel } = await import('../src/log.js');
const { seed } = await import('../src/seed.js');

setLevel('ERROR');

async function main(n) {
  let db;
  if (process.env.DATABASE_URL) {
    db = await createPrisma();
  } else {
    const { MemoryDb } = await import('../src/db/memory.js');
    const { RAW_HANDLERS } = await import('../src/db/memory-sql.js');
    db = new MemoryDb(RAW_HANDLERS);
  }
  await seed(db, { demoUsers: false });
  const cfg = getGameConfig();
  const ctx = buildContext({ db, cfg, judge: new Judge(new FakeRunner('test'), cfg) });
  await ctx.problems.reload(db);
  const bots = await db.profile.findMany({ where: { is_bot: true, personality: { not: 'dummy' } }, orderBy: { id: 'asc' } });
  const maps = ['bit', 'binary'];
  const t0 = performance.now();
  const actors = [];
  for (let i = 0; i < n; i++) {
    const a = bots[i % bots.length];
    const b = bots[(i + 1) % bots.length];
    actors.push(await ctx.matches.createBotVsBot(maps[i % 2], a, b, 1000 + i));
  }
  const created = (performance.now() - t0) / 1000;
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline && !actors.every((x) => x.finished)) await new Promise((r) => setTimeout(r, 250));
  const elapsed = (performance.now() - t0) / 1000;
  const finished = actors.filter((x) => x.finished);
  const outcomes = {};
  for (const x of finished) {
    const key = `${x.m.end_reason}/${x.m.outcome}`;
    outcomes[key] = (outcomes[key] || 0) + 1;
  }
  const events = await db.matchEvent.count({ where: { match_id: { in: actors.map((x) => x.id) } } });
  const errors = actors.filter((x) => x.m.status === 'starting' || x.m.status === 'live').length;
  console.log(`matches: ${n}  created in ${created.toFixed(2)}s  finished: ${finished.length}/${n}  wall time: ${elapsed.toFixed(1)}s`);
  console.log(`events persisted: ${events}  outcomes: ${JSON.stringify(outcomes)}`);
  console.log(`judge pool: ${JSON.stringify(ctx.judge.snapshot())}`);
  await ctx.matches.shutdown();
  ctx.judge.stop();
  await db.$disconnect();
  const ok = errors === 0 && finished.length === n;
  console.log(ok ? 'LOAD TEST PASSED' : `LOAD TEST FAILED (${errors} unfinished)`);
  return ok ? 0 : 1;
}

process.exit(await main(Number(process.argv[2] || 50)));
