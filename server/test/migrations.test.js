// The committed migration is what schema.prisma generates, and (when a
// PostgreSQL is reachable through PG_TEST_URL) it applies cleanly, builds the
// 17 tables with every index, and the raw queries in src/db/sql.js run on it
// and use the expression indexes.
//
//   PG_TEST_URL='postgresql://postgres@localhost:5432/postgres' npm test

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sql from '../src/db/sql.js';
import { render } from '../scripts/migration-sql.js';
import { readSchema } from '../src/db/prisma-schema.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = path.join(HERE, '..', 'prisma', 'migrations', '20261123000000_init', 'migration.sql');
const PG = process.env.PG_TEST_URL || '';
const hasPsql = spawnSync('psql', ['--version']).status === 0;
const skipPg = (!PG && 'set PG_TEST_URL to run against PostgreSQL') || (!hasPsql && 'psql is not installed');
const DB = `aa_migtest_${process.pid}`;

function psql(url, cmd, input = undefined) {
  const r = spawnSync('psql', [url, '-X', '-v', 'ON_ERROR_STOP=1', '-At', ...(cmd ? ['-c', cmd] : [])], { input, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
}

const dbUrl = () => {
  const u = new URL(PG);
  u.pathname = `/${DB}`;
  return u.toString();
};

/** The SQL text of a src/db/sql.js query with its parameters inlined as literals. */
async function sqlOf(fn) {
  let text = '';
  const fake = {
    $queryRaw(strings, ...values) {
      const lit = (v) => (typeof v === 'string' ? `'${v.replaceAll("'", "''")}'` : String(v));
      text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? lit(values[i]) : ''), '');
      return [{ n: 0, id: 0 }];
    },
  };
  await fn(fake);
  return text;
}

test('the committed migration is what schema.prisma generates', () => {
  assert.equal(fs.readFileSync(MIGRATION, 'utf8'), render());
  assert.equal(Object.keys(readSchema()).length, 17);
});

test('on PostgreSQL: the migration builds every table and index, and the raw queries run', { skip: skipPg }, async () => {
  psql(PG, `DROP DATABASE IF EXISTS ${DB}`);
  psql(PG, `CREATE DATABASE ${DB}`);
  after(() => psql(PG, `DROP DATABASE IF EXISTS ${DB}`));
  const url = dbUrl();
  psql(url, null, fs.readFileSync(MIGRATION, 'utf8'));
  const tables = psql(url, "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'");
  assert.equal(tables, '17');
  const idx = psql(url, "SELECT indexname FROM pg_indexes WHERE schemaname = 'public'").split('\n');
  for (const name of ['ix_profiles_ladder', 'ix_profiles_display_name_lower', 'ix_profiles_bot_personality',
    'ix_matches_finished_end_time', 'ix_matches_map_winners', 'ix_matches_created_at', 'ix_users_username_lower']) {
    assert.ok(idx.includes(name), name);
  }
  // some people, then the three raw queries
  psql(url, null, `
    INSERT INTO users (username, username_lower, password_hash, role, created_at)
      SELECT 'u' || g, 'u' || g, 'x', 'player', now() FROM generate_series(1, 300) g;
    INSERT INTO profiles (user_id, display_name, rating, peak_rating, avatar_color, is_bot, created_at)
      SELECT id, upper(username), 1000 + (id * 37) % 900, 1500, '#000000', false, now() FROM users;
    ANALYZE;`);
  const top = psql(url, await sqlOf((db) => sql.ladderTop(db, 100))).split('\n');
  assert.equal(top.length, 100);
  const ratings = top.map((row) => Number(row.split('|')[2]));
  assert.deepEqual(ratings, [...ratings].sort((a, b) => b - a));
  const ahead = Number(psql(url, await sqlOf((db) => sql.ladderAhead(db, 1500, 'U7'))));
  const direct = Number(psql(url, "SELECT count(*) FROM profiles WHERE rating > 1500 OR (rating = 1500 AND lower(display_name) < 'u7')"));
  assert.equal(ahead, direct);
  assert.equal(psql(url, await sqlOf((db) => sql.profileIdByName(db, 'u42'))), psql(url, "SELECT id FROM profiles WHERE display_name = 'U42'"));
  // the planner can answer the name lookup and the ladder from their expression indexes
  psql(url, 'SET enable_seqscan = off');
  const plan = psql(url, `SET enable_seqscan = off; EXPLAIN ${await sqlOf((db) => sql.profileIdByName(db, 'u42'))}`);
  assert.match(plan, /ix_profiles_display_name_lower/);
  const ladderPlan = psql(url, `SET enable_seqscan = off; EXPLAIN ${await sqlOf((db) => sql.ladderTop(db, 100))}`);
  assert.match(ladderPlan, /ix_profiles_ladder/);
});
