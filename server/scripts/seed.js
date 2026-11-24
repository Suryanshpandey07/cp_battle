// node scripts/seed.js [--demo | --no-demo]   (npm run seed)
//
// Validates the skin manifests, loads the seed problems with their tests, and
// creates demo users (alice, bob), an admin and the bot profiles. Safe to run
// repeatedly: problems are upserted by slug. Run the migrations first
// (npm run db:migrate).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSettings } from '../src/config.js';
import { createPrisma } from '../src/db.js';
import { seed } from '../src/seed.js';

export { DEMO_USERS, ensureBots, ensureUser, loadProblemFiles, PROBLEMS_DIR, seed, upsertProblem } from '../src/seed.js';

async function main() {
  // Demo accounts have published passwords, so prod skips them unless asked.
  const argv = process.argv.slice(2);
  const demo = !argv.includes('--no-demo') && (!getSettings().isProd || argv.includes('--demo'));
  const db = await createPrisma();
  try {
    const out = await seed(db, { demoUsers: demo });
    console.log(`seeded ${out.problems} problems, ${demo ? 'demo users alice/bob/admin and ' : ''}bot profiles`);
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
