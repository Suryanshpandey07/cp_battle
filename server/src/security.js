// Passwords (scrypt), JWT access tokens (HS256), refresh tokens and WebSocket
// tickets. Only node:crypto: no native packages to build.

import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { getSettings } from './config.js';

const scrypt = promisify(scryptCb);

// scrypt with N=2^15, r=8, p=1 (OWASP's minimum profile for scrypt).
const SCRYPT_LOG_N = 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

export const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890', 'qwerty123',
  'qwertyuiop', 'iloveyou', '11111111', '00000000', 'abc12345', 'abcd1234', 'letmein1',
  'welcome1', 'admin123', 'monkey123', 'dragon12', 'sunshine', 'princess', 'football',
  'baseball', 'superman', 'trustno1', 'starwars', 'passw0rd', 'p@ssw0rd', 'algoarena',
]);
export const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

const b64 = (buf) => buf.toString('base64').replace(/=+$/, '');
const unb64 = (s) => Buffer.from(s, 'base64');

/** "$scrypt$ln=15,r=8,p=1$<salt>$<hash>" */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const digest = await scrypt(password, salt, 32, { N: 2 ** SCRYPT_LOG_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM });
  return `$scrypt$ln=${SCRYPT_LOG_N},r=${SCRYPT_R},p=${SCRYPT_P}$${b64(salt)}$${b64(digest)}`;
}

export async function verifyPassword(password, encoded) {
  try {
    const [, alg, params, saltB64, hashB64] = encoded.split('$');
    if (alg !== 'scrypt') return false;
    const kv = Object.fromEntries(params.split(',').map((p) => p.split('=')));
    const want = unb64(hashB64);
    const got = await scrypt(password, unb64(saltB64), want.length, {
      N: 2 ** Number(kv.ln), r: Number(kv.r), p: Number(kv.p), maxmem: SCRYPT_MAXMEM,
    });
    return got.length === want.length && timingSafeEqual(got, want);
  } catch {
    return false;
  }
}

export function passwordProblem(password, username) {
  if (password.length < 8) return 'Password must be at least 8 characters';
  if (password.length > 128) return 'Password is too long';
  if (COMMON_PASSWORDS.has(password.toLowerCase()) || password.toLowerCase() === username.toLowerCase()) {
    return 'That password is too common';
  }
  return null;
}

// JWT access tokens --------------------------------------------------------------
export const ACCESS_TTL_S = 15 * 60;
export const REFRESH_TTL_S = 7 * 24 * 3600;
export const REFRESH_COOKIE = 'aa_refresh';

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function makeAccessToken(userId, profileId, role) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ sub: String(userId), pid: profileId, role, iat: now, exp: now + ACCESS_TTL_S, typ: 'access' }));
  const sig = createHmac('sha256', getSettings().jwtSecret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

/** {userId, profileId, role} or null. */
export function decodeAccessToken(token) {
  try {
    const [header, payload, sig] = token.split('.');
    const h = JSON.parse(Buffer.from(header, 'base64url').toString());
    if (h.alg !== 'HS256') return null;
    const want = createHmac('sha256', getSettings().jwtSecret).update(`${header}.${payload}`).digest();
    const got = Buffer.from(sig, 'base64url');
    if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (p.typ !== 'access' || typeof p.exp !== 'number' || p.exp < Math.floor(Date.now() / 1000)) return null;
    return { userId: Number(p.sub), profileId: Number(p.pid), role: String(p.role || 'player') };
  } catch {
    return null;
  }
}

// Refresh tokens: random, stored only as a hash, rotated on every use ------------
export const hashToken = (raw) => createHash('sha256').update(raw).digest('hex');

export function newRefreshToken() {
  const raw = randomBytes(32).toString('base64url');
  return [raw, hashToken(raw)];
}

// Single-use WebSocket tickets (30 s, bound to the user) -------------------------
export class TicketStore {
  static TTL_MS = 30_000;

  constructor() {
    this.tickets = new Map();
  }

  issue(userId, profileId, scope, matchId) {
    this.sweep();
    const t = randomBytes(24).toString('base64url');
    this.tickets.set(t, { userId, profileId, scope, matchId: matchId || null, expiresAt: performance.now() + TicketStore.TTL_MS });
    return t;
  }

  consume(ticket, scope, matchId = null) {
    const t = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    if (!t || t.expiresAt < performance.now() || t.scope !== scope) return null;
    if ((scope === 'match' || scope === 'spectate') && t.matchId !== matchId) return null;
    return t;
  }

  sweep() {
    const now = performance.now();
    for (const [k, v] of this.tickets) if (v.expiresAt < now) this.tickets.delete(k);
  }
}

export const tickets = new TicketStore();
