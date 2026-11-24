// The Prisma client, made once at start-up and passed around in the app context
// (ctx.db), never imported directly, so tests can hand in an in-memory stand-in.

import { getSettings } from './config.js';

/**
 * PostgreSQL through Prisma (DATABASE_URL=postgresql://...), or with
 * DATABASE_URL=memory a throwaway in-memory database that is seeded on start.
 */
export async function createPrisma() {
  const s = getSettings();
  const url = s.databaseUrl;
  if (url.startsWith('memory')) {
    if (s.isProd) throw new Error('DATABASE_URL=memory loses every account on restart and is refused with ENV=prod');
    const { MemoryDb } = await import('./db/memory.js');
    const { RAW_HANDLERS } = await import('./db/memory-sql.js');
    return new MemoryDb(RAW_HANDLERS);
  }
  if (!url) throw new Error('Set DATABASE_URL: postgresql://user:pass@localhost:5432/algoarena (or DATABASE_URL=memory for a throwaway demo database)');
  const { PrismaClient } = await import('@prisma/client');
  return new PrismaClient({ datasources: { db: { url } } });
}

/** Timestamps are stored as UTC without a time zone, as before. */
export const utcnow = () => new Date();

/** Run fn(tx) in one transaction (long enough for the end-of-match writes). */
export function inTx(db, fn) {
  return db.$transaction(fn, { timeout: 20_000, maxWait: 10_000 });
}

/** True when an error is a unique-key violation (Prisma P2002). */
export const isUniqueViolation = (e) => e && e.code === 'P2002';
