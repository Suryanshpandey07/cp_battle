// Shared request helpers: the caller from the access token, body and query
// validation (422 with {errors: [{loc, msg}]}), cookies and the client IP.

import { AppError } from '../errors.js';
import { enforce } from '../ratelimit.js';
import { decodeAccessToken } from '../security.js';

/** Wrap an async handler (Express 5 already forwards rejections; this keeps it explicit). */
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function clientIp(req) {
  return req.socket?.remoteAddress || req.ip || 'unknown';
}

export function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || k in out) continue;
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim().replace(/^"|"$/g, ''));
    } catch {
      out[k] = part.slice(i + 1).trim();
    }
  }
  return out;
}

/** The acting user always comes from the access token. Sets req.caller. */
export function current(ctx) {
  return (req, _res, next) => {
    const header = req.headers.authorization || '';
    const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7) : '';
    const claims = token ? decodeAccessToken(token) : null;
    if (!claims) return next(new AppError('unauthorized', 'Sign in first'));
    try {
      enforce(`rest:${claims.userId}`, ctx.cfg.rate_limits.rest);
    } catch (e) {
      return next(e);
    }
    req.caller = { userId: claims.userId, profileId: claims.profileId, role: claims.role, isAdmin: claims.role === 'admin' };
    return next();
  };
}

export function adminOnly(req, _res, next) {
  if (!req.caller || !req.caller.isAdmin) return next(new AppError('forbidden', 'Admins only'));
  return next();
}

// ---------------------------------------------------------------------------- validation
// A field spec: {type: 'str'|'int'|'bool'|'obj', min, max (length for str, value for int),
// enum, pattern, nullable, default}. A field without a default is required.

const invalid = (errors) => new AppError('validation', 'Invalid request', { errors });

function checkField(where, name, spec, raw, errors, coerce) {
  if (raw === undefined) {
    if ('default' in spec) return spec.default;
    errors.push({ loc: [where, name], msg: 'Field required' });
    return undefined;
  }
  if (raw === null) {
    if (spec.nullable) return null;
    errors.push({ loc: [where, name], msg: 'Input should not be null' });
    return undefined;
  }
  let v = raw;
  const bad = (msg) => { errors.push({ loc: [where, name], msg }); return undefined; };
  switch (spec.type) {
    case 'str':
      if (typeof v !== 'string') return bad('Input should be a valid string');
      if (spec.min !== undefined && [...v].length < spec.min) return bad(`String should have at least ${spec.min} characters`);
      if (spec.max !== undefined && [...v].length > spec.max) return bad(`String should have at most ${spec.max} characters`);
      if (spec.pattern && !spec.pattern.test(v)) return bad('String should match pattern');
      break;
    case 'int':
      if (coerce && typeof v === 'string' && /^-?\d+$/.test(v.trim())) v = Number(v);
      if (typeof v !== 'number' || !Number.isInteger(v)) return bad('Input should be a valid integer');
      if (spec.min !== undefined && v < spec.min) return bad(`Input should be greater than or equal to ${spec.min}`);
      if (spec.max !== undefined && v > spec.max) return bad(`Input should be less than or equal to ${spec.max}`);
      break;
    case 'bool':
      if (typeof v !== 'boolean') return bad('Input should be a valid boolean');
      break;
    case 'obj':
      if (typeof v !== 'object' || Array.isArray(v)) return bad('Input should be a valid dictionary');
      break;
    default: throw new Error(`unknown field type ${spec.type}`);
  }
  if (spec.enum && !spec.enum.includes(v)) return bad(`Input should be ${spec.enum.map((x) => `'${x}'`).join(' or ')}`);
  return v;
}

/** Validate a JSON body against fields (extra keys are rejected). */
export function body(req, fields) {
  const raw = req.body;
  if (raw === undefined || raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw invalid([{ loc: ['body'], msg: 'Input should be a valid dictionary' }]);
  }
  const errors = [];
  const out = {};
  for (const [k, spec] of Object.entries(fields)) out[k] = checkField('body', k, spec, raw[k], errors, false);
  for (const k of Object.keys(raw)) if (!(k in fields)) errors.push({ loc: ['body', k], msg: 'Extra inputs are not permitted' });
  if (errors.length) throw invalid(errors);
  return out;
}

/** Validate query parameters (strings, coerced to ints where asked). */
export function query(req, fields) {
  const errors = [];
  const out = {};
  for (const [k, spec] of Object.entries(fields)) {
    let v = req.query[k];
    if (Array.isArray(v)) v = v[v.length - 1];
    out[k] = checkField('query', k, spec, v, errors, true);
  }
  if (errors.length) throw invalid(errors);
  return out;
}

/** A path parameter that must be an integer. */
export function intParam(req, name) {
  const v = req.params[name];
  if (!/^-?\d+$/.test(v)) throw invalid([{ loc: ['path', name], msg: 'Input should be a valid integer' }]);
  return Number(v);
}
