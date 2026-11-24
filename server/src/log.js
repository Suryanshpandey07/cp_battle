// Structured JSON logs. Never logs passwords, tokens or code.

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

export const requestContext = new AsyncLocalStorage();
const REDACT = ['password', 'token', 'code', 'secret', 'authorization', 'cookie', 'ticket'];
const LEVELS = { DEBUG: 10, INFO: 20, WARNING: 30, ERROR: 40 };
let threshold = LEVELS[(process.env.LOG_LEVEL || 'INFO').toUpperCase()] ?? 20;

export function setLevel(level) {
  threshold = LEVELS[String(level).toUpperCase()] ?? 20;
}

function write(level, msg, fields = {}, logger = 'algoarena') {
  if (LEVELS[level] < threshold) return;
  const out = { ts: Math.round(Date.now()) / 1000, level, logger, msg, request_id: requestContext.getStore()?.rid || '-' };
  for (const [k, v] of Object.entries(fields)) out[k] = REDACT.some((r) => k.toLowerCase().includes(r)) ? '[redacted]' : v;
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

export const log = {
  debug: (m, f) => write('DEBUG', m, f),
  info: (m, f) => write('INFO', m, f),
  warn: (m, f) => write('WARNING', m, f),
  error: (m, f) => write('ERROR', m, f),
};

/** Express middleware: a request id per request, logged with method, path, status and time. */
export function requestId() {
  return (req, res, next) => {
    const rid = randomBytes(6).toString('hex');
    const start = performance.now();
    res.setHeader('x-request-id', rid);
    res.on('finish', () => {
      if (req.path.startsWith('/api')) {
        requestContext.run({ rid }, () => write('INFO', 'request', {
          method: req.method, path: req.path, status: res.statusCode, ms: Math.round((performance.now() - start) * 10) / 10,
        }, 'algoarena.http'));
      }
    });
    requestContext.run({ rid }, next);
  };
}
