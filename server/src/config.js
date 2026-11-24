// Environment settings and the shared game config.

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateGameConfig } from './domain/gameconfig.js';

export const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = path.resolve(SERVER_DIR, '..');
export const SHARED_DIR = process.env.SHARED_DIR || path.join(REPO_ROOT, 'shared');
export const DEFAULT_JWT_SECRET = 'dev-only-change-me-dev-only-change-me-dev-only';

/** Minimal .env reader (KEY=VALUE lines); real environment variables always win. */
function loadDotenv() {
  for (const file of [path.join(REPO_ROOT, '.env'), path.join(SERVER_DIR, '.env')]) {
    if (!fs.existsSync(file)) continue;
    for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const i = line.indexOf('=');
      const key = line.slice(0, i).trim();
      const value = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

const envInt = (name) => (process.env[name] ? parseInt(process.env[name], 10) : null);
const envFloat = (name) => (process.env[name] ? parseFloat(process.env[name]) : null);

let settingsCache = null;

export function getSettings() {
  if (settingsCache) return settingsCache;
  loadDotenv();
  const env = process.env.ENV || 'dev';
  let secret = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;
  if (env === 'prod' && secret === DEFAULT_JWT_SECRET) throw new Error('Refusing to boot in prod with the default JWT_SECRET');
  if (env === 'test' && secret === DEFAULT_JWT_SECRET) secret = `test-secret-${randomBytes(24).toString('hex')}`;
  const origins = (process.env.CORS_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
  settingsCache = {
    env,
    isProd: env === 'prod',
    port: envInt('PORT') || 8000,
    host: process.env.HOST || '127.0.0.1',
    databaseUrl: process.env.DATABASE_URL || '',
    jwtSecret: secret,
    corsOrigins: origins.length ? origins : ['http://localhost:5173', 'http://127.0.0.1:5173'],
    // Judging runs in this process: auto | docker | subprocess | judge0 | fake (ENV=test only).
    judgeBackend: process.env.JUDGE_BACKEND || 'auto',
    judgeImage: process.env.JUDGE_IMAGE || 'algoarena-judge:latest',
    judge0Url: process.env.JUDGE0_URL || '',
    judgeConcurrency: envInt('JUDGE_CONCURRENCY'),
    matchMaxMinutes: envInt('MATCH_MAX_MINUTES'),
    botFallbackSeconds: envInt('BOT_FALLBACK_SECONDS'),
    botTimeScale: envFloat('BOT_TIME_SCALE'),
    logLevel: process.env.LOG_LEVEL || 'info',
    frontendDist: process.env.FRONTEND_DIST || path.join(REPO_ROOT, 'frontend', 'dist'),
    secureCookies: env === 'prod',
  };
  return settingsCache;
}

/** Tests may change the environment and ask again. */
export function resetSettings() {
  settingsCache = null;
  gameConfigCache = null;
}

export function loadGameConfigFile(file = path.join(SHARED_DIR, 'game-config.json')) {
  return validateGameConfig(JSON.parse(fs.readFileSync(file, 'utf8')));
}

let gameConfigCache = null;

/** The validated game config with the few environment overrides applied. */
export function getGameConfig() {
  if (gameConfigCache) return gameConfigCache;
  const cfg = loadGameConfigFile();
  const s = getSettings();
  if (s.botTimeScale !== null) cfg.bot_time_scale = s.botTimeScale;
  if (s.matchMaxMinutes !== null) cfg.match = { ...cfg.match, max_minutes: s.matchMaxMinutes };
  if (s.botFallbackSeconds !== null) cfg.matchmaking = { ...cfg.matchmaking, bot_fallback_s: s.botFallbackSeconds };
  if (s.judgeConcurrency) cfg.judge = { ...cfg.judge, concurrency: s.judgeConcurrency };
  gameConfigCache = cfg;
  return cfg;
}

/** The part of the config the client may see (GET /api/config). */
export function publicConfig(cfg) {
  const data = structuredClone(cfg);
  delete data.bots;
  delete data.rate_limits;
  const j = cfg.judge;
  data.judge = {
    stop_on_first_fail: j.stop_on_first_fail, source_limit_kb: j.source_limit_kb,
    custom_input_limit_kb: j.custom_input_limit_kb, run_time_cap_ms: j.run_time_cap_ms,
  };
  return data;
}
