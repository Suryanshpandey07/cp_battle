// Sign-up, login, refresh-token rotation, logout and WebSocket tickets.

import { Router } from 'express';
import { AppError } from '../errors.js';
import { inTx } from '../db.js';
import { enforce } from '../ratelimit.js';
import {
  hashPassword, hashToken, makeAccessToken, newRefreshToken, passwordProblem, REFRESH_COOKIE, REFRESH_TTL_S, tickets,
  USERNAME_RE, verifyPassword,
} from '../security.js';
import { grantDefaults, profilePrivate } from '../services/profiles.js';
import { ah, body, clientIp, cookies, current } from './http.js';

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const COOKIE_PATH = '/api/auth';

async function issueRefresh(tx, userId) {
  const [raw, digest] = newRefreshToken();
  await tx.refreshToken.create({ data: { user_id: userId, token_hash: digest, expires_at: new Date(Date.now() + REFRESH_TTL_S * 1000) } });
  return raw;
}

function setCookie(res, raw, ctx) {
  res.cookie(REFRESH_COOKIE, raw, {
    maxAge: REFRESH_TTL_S * 1000, httpOnly: true, secure: ctx.settings.secureCookies, sameSite: 'lax', path: COOKIE_PATH,
  });
}

async function sessionPayload(tx, u, p, ctx) {
  return { access_token: makeAccessToken(u.id, p.id, u.role), token_type: 'bearer', profile: await profilePrivate(tx, p, ctx.cfg) };
}

const suspended = (u) => u.suspended_until && new Date(u.suspended_until) > new Date();

export function authRouter(ctx) {
  const r = Router();
  const db = ctx.db;

  r.post('/auth/signup', ah(async (req, res) => {
    const b = body(req, {
      username: { type: 'str', min: 1, max: 40 }, password: { type: 'str', min: 1, max: 200 },
      avatar_color: { type: 'str', max: 9, nullable: true, default: null },
    });
    enforce(`signup:${clientIp(req)}`, ctx.cfg.rate_limits.signup);
    const name = b.username.trim();
    if (!USERNAME_RE.test(name)) throw new AppError('validation', 'Username must be 3 to 20 letters, digits or underscores', { field: 'username' });
    const problem = passwordProblem(b.password, name);
    if (problem) throw new AppError('validation', problem, { field: 'password' });
    const color = b.avatar_color && COLOR_RE.test(b.avatar_color) ? b.avatar_color : '#3b82f6';
    const pwHash = await hashPassword(b.password);
    let out;
    try {
      out = await inTx(db, async (tx) => {
        if (await tx.user.findFirst({ where: { username_lower: name.toLowerCase() } })) {
          throw new AppError('conflict', 'That username is taken', { field: 'username' });
        }
        const u = await tx.user.create({ data: { username: name, username_lower: name.toLowerCase(), password_hash: pwHash } });
        const p = await tx.profile.create({
          data: { user_id: u.id, display_name: name, rating: ctx.cfg.rating.starting, peak_rating: ctx.cfg.rating.starting, avatar_color: color },
        });
        await grantDefaults(tx, p);
        return [await sessionPayload(tx, u, p, ctx), await issueRefresh(tx, u.id)];
      });
    } catch (e) {
      if (e && e.code === 'P2002') throw new AppError('conflict', 'That username is taken', { field: 'username' });
      throw e;
    }
    setCookie(res, out[1], ctx);
    res.json(out[0]);
  }));

  r.post('/auth/login', ah(async (req, res) => {
    const b = body(req, { username: { type: 'str', min: 1, max: 40 }, password: { type: 'str', min: 1, max: 200 } });
    const uname = b.username.trim().toLowerCase();
    enforce(`login-ip:${clientIp(req)}`, ctx.cfg.rate_limits.login);
    enforce(`login-user:${uname}`, ctx.cfg.rate_limits.login);
    const u = await db.user.findFirst({ where: { username_lower: uname } });
    if (!u || !(await verifyPassword(b.password, u.password_hash))) throw new AppError('unauthorized', 'Wrong username or password');
    if (suspended(u)) throw new AppError('forbidden', 'This account is suspended', { until: new Date(u.suspended_until).toISOString() });
    const out = await inTx(db, async (tx) => {
      const p = await tx.profile.findFirst({ where: { user_id: u.id } });
      return [await sessionPayload(tx, u, p, ctx), await issueRefresh(tx, u.id)];
    });
    setCookie(res, out[1], ctx);
    res.json(out[0]);
  }));

  r.post('/auth/refresh', ah(async (req, res) => {
    const raw = cookies(req)[REFRESH_COOKIE];
    if (!raw) throw new AppError('unauthorized', 'No session');
    const digest = hashToken(raw);
    const row = await db.refreshToken.findFirst({ where: { token_hash: digest } });
    if (!row || new Date(row.expires_at) < new Date()) throw new AppError('unauthorized', 'Session expired');
    if (row.revoked_at !== null) {
      // A rotated token was replayed: revoke every session of this user.
      await db.refreshToken.updateMany({ where: { user_id: row.user_id, revoked_at: null }, data: { revoked_at: new Date() } });
      throw new AppError('unauthorized', 'Session expired');
    }
    const out = await inTx(db, async (tx) => {
      // Revoke only if still live, so two racing refreshes cannot both rotate.
      const n = await tx.refreshToken.updateMany({ where: { id: row.id, revoked_at: null }, data: { revoked_at: new Date() } });
      if (n.count !== 1) throw new AppError('unauthorized', 'Session expired');
      const u = await tx.user.findUnique({ where: { id: row.user_id } });
      if (suspended(u)) throw new AppError('forbidden', 'This account is suspended');
      const p = await tx.profile.findFirst({ where: { user_id: u.id } });
      return [await sessionPayload(tx, u, p, ctx), await issueRefresh(tx, u.id)];
    });
    setCookie(res, out[1], ctx);
    res.json(out[0]);
  }));

  r.post('/auth/logout', ah(async (req, res) => {
    const raw = cookies(req)[REFRESH_COOKIE];
    if (raw) await db.refreshToken.updateMany({ where: { token_hash: hashToken(raw), revoked_at: null }, data: { revoked_at: new Date() } });
    res.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
    res.json({ ok: true });
  }));

  r.post('/auth/ws-ticket', current(ctx), ah(async (req, res) => {
    const b = body(req, {
      scope: { type: 'str', enum: ['lobby', 'match', 'spectate'] }, match_id: { type: 'str', max: 36, nullable: true, default: null },
    });
    const caller = req.caller;
    if (b.scope === 'match') {
      if (!b.match_id) throw new AppError('validation', 'match_id is required');
      const actor = ctx.matches.get(b.match_id);
      if (!actor) throw new AppError('not_found', 'Match not found or already archived');
      if (actor.sideOf(caller.profileId) === null) throw new AppError('forbidden', 'You are not in this match');
    }
    if (b.scope === 'spectate') throw new AppError('forbidden', 'Spectating is switched off in this build');
    res.json({ ticket: tickets.issue(caller.userId, caller.profileId, b.scope, b.match_id), expires_in: 30 });
  }));

  return r;
}
