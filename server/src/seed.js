// Seeding: validates the skin manifests, loads the seed problems with their
// tests, and creates demo users (alice, bob), an admin and the bot profiles.
// Safe to run repeatedly: problems are upserted by slug. scripts/seed.js is the
// command line; the server also seeds an in-memory database (DATABASE_URL=memory)
// on start.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getGameConfig } from './config.js';
import { inTx } from './db.js';
import { tierRow } from './domain/gameconfig.js';
import { getTier } from './domain/rules.js';
import { hashPassword } from './security.js';
import { grantDefaults } from './services/profiles.js';
import { loadRegistry } from './skins/registry.js';

export const PROBLEMS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'seed', 'problems');

export const DEMO_USERS = [
  ['alice', 'alice-pass', 'player', '#f97316'],
  ['bob', 'bob-pass', 'player', '#22c55e'],
  ['admin', 'admin-pass', 'admin', '#a855f7'],
];

export function loadProblemFiles(dir = PROBLEMS_DIR) {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

export async function upsertProblem(tx, data, cfg) {
  const tier = getTier(data.rating, cfg);
  const row = tierRow(cfg, tier);
  const fields = {
    title: data.title, statement_md: data.statement_md, input_md: data.input_md ?? '', output_md: data.output_md ?? '',
    constraints_md: data.constraints_md ?? '', biome: data.biome, rating: data.rating, tier,
    base_damage: data.base_damage ?? row.base_damage, base_recoil: data.base_recoil ?? row.base_recoil,
    time_limit_ms: data.time_limit_ms ?? cfg.judge.time_limit_ms, memory_mb: data.memory_mb ?? cfg.judge.memory_mb,
    checker: data.checker ?? 'exact', checker_script: data.checker_script ?? null, tags: data.tags ?? [], hints: data.hints ?? [],
    stubs: data.stubs ?? {}, reference_solution: data.reference_solution ?? '', status: data.status ?? 'published',
  };
  const p = await tx.problem.upsert({ where: { slug: data.slug }, create: { slug: data.slug, ...fields }, update: fields });
  await tx.testCase.deleteMany({ where: { problem_id: p.id } });
  await tx.testCase.createMany({
    data: data.tests.map((t, i) => ({ problem_id: p.id, idx: i, input_text: t.input, expected_text: t.expected, is_sample: t.is_sample })),
  });
  return p;
}

export async function ensureUser(tx, username, password, role, color, cfg) {
  let u = await tx.user.findFirst({ where: { username_lower: username.toLowerCase() } });
  if (!u) u = await tx.user.create({ data: { username, username_lower: username.toLowerCase(), password_hash: await hashPassword(password), role } });
  let prof = await tx.profile.findFirst({ where: { user_id: u.id } });
  if (!prof) {
    prof = await tx.profile.create({
      data: { user_id: u.id, display_name: username, rating: cfg.rating.starting, peak_rating: cfg.rating.starting, avatar_color: color },
    });
    await grantDefaults(tx, prof);
  }
  return prof;
}

export async function ensureBots(tx, cfg) {
  for (const name of Object.keys(cfg.bots.personalities)) {
    const have = await tx.profile.findFirst({ where: { is_bot: true, personality: name } });
    if (!have) {
      await tx.profile.create({
        data: { display_name: `${name[0].toUpperCase()}${name.slice(1)} (BOT)`, is_bot: true, personality: name, rating: cfg.rating.starting, peak_rating: cfg.rating.starting, avatar_color: '#64748b' },
      });
    }
  }
  if (!(await tx.profile.findFirst({ where: { personality: 'dummy' } }))) {
    await tx.profile.create({
      data: { display_name: 'Training Dummy', is_bot: true, personality: 'dummy', rating: cfg.rating.starting, peak_rating: cfg.rating.starting, avatar_color: '#94a3b8' },
    });
  }
}

export async function seed(db, { demoUsers = true, problemsDir = PROBLEMS_DIR } = {}) {
  const cfg = getGameConfig();
  loadRegistry(); // throws on an invalid skin manifest
  const problems = loadProblemFiles(problemsDir);
  // Password hashing is slow on purpose, so hash outside the transaction's time budget.
  for (const data of problems) await inTx(db, (tx) => upsertProblem(tx, data, cfg));
  if (demoUsers) for (const u of DEMO_USERS) await ensureUser(db, ...u, cfg);
  await inTx(db, (tx) => ensureBots(tx, cfg));
  return { problems: problems.length };
}
