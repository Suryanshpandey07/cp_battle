// AlgoArena API: the Express app and start-up wiring.
//
//   npm start          (from server/)

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { adminRouter } from './api/admin.js';
import { authRouter } from './api/auth.js';
import { matchesRouter } from './api/matches.js';
import { playersRouter } from './api/players.js';
import { skinsRouter } from './api/skins.js';
import { RealClock } from './clock.js';
import { getGameConfig, getSettings, publicConfig } from './config.js';
import { createPrisma } from './db.js';
import { ping } from './db/sql.js';
import { MatchService } from './engine/service.js';
import { Matchmaker } from './engine/matchmaker.js';
import { envelope, errorMiddleware } from './errors.js';
import { makeJudge } from './judge/index.js';
import { log, requestId, setLevel } from './log.js';
import { Hub } from './realtime/hub.js';
import { attachWebSockets } from './realtime/ws.js';
import { ProblemCache } from './services/problems.js';
import { registryVersion } from './skins/registry.js';

const MAX_BODY = 256 * 1024;
const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; "
  + "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; "
  + "img-src 'self' data: blob:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'";

/** Process-wide services, built once at start-up and handed to every route. */
export function buildContext({ db, clock = null, judge = null, settings = getSettings(), cfg = getGameConfig() }) {
  const hub = new Hub();
  const problems = new ProblemCache();
  const j = judge || makeJudge(settings, cfg);
  const clk = clock || new RealClock();
  const matches = new MatchService({ cfg, clock: clk, hub, judge: j, problems, db });
  const matchmaker = new Matchmaker(cfg, hub, matches);
  return { settings, cfg, clock: clk, judge: j, hub, problems, matches, matchmaker, db, runsInflight: new Set(), cache: new Map() };
}

function securityHeaders(req, res, next) {
  res.set({
    'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY',
    'referrer-policy': 'strict-origin-when-cross-origin', 'content-security-policy': CSP,
  });
  next();
}

function cors(origins) {
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && origins.includes(origin)) {
      res.set({ 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', vary: 'Origin' });
      if (req.method === 'OPTIONS' && req.headers['access-control-request-method']) {
        res.set({
          'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE',
          'access-control-allow-headers': 'Authorization, Content-Type', 'access-control-max-age': '600',
        });
        res.status(200).end();
        return;
      }
    }
    next();
  };
}

/** Reject JSON bodies over 256 KB before they are read. */
function bodyLimit(req, res, next) {
  const len = Number(req.headers['content-length'] || 0);
  if (len > MAX_BODY) {
    res.status(413).json(envelope('validation', 'Request body too large'));
    return;
  }
  next();
}

function metaRouter(ctx) {
  const r = express.Router();
  r.get('/config', async (req, res, next) => {
    try {
      const data = publicConfig(ctx.cfg);
      try {
        data.skin_registry_version = registryVersion();
      } catch {
        data.skin_registry_version = null;
      }
      data.judge_backend = { name: ctx.judge.name, sandboxed: ctx.judge.sandboxed };
      const present = await ctx.judge.languages(ctx.cfg);
      for (const lang of data.languages) lang.available = present[lang.id] ?? false;
      res.json(data);
    } catch (e) {
      next(e);
    }
  });
  r.get('/healthz', async (req, res) => {
    let dbOk = true;
    try {
      await ping(ctx.db);
    } catch {
      dbOk = false;
    }
    const judge = await ctx.judge.healthcheck();
    res.json({
      ok: dbOk && judge.ok, database: dbOk,
      judge: { backend: judge.name, ok: judge.ok, sandboxed: judge.sandboxed, detail: judge.detail },
      problems: ctx.problems.bySlug.size,
    });
  });
  r.get('/metrics', (req, res) => res.json({
    queue_length: ctx.matchmaker.queue.size, live_matches: ctx.matches.liveMatches().length,
    lobby_sockets: ctx.hub.lobby.size, judge: ctx.judge.snapshot(),
  }));
  return r;
}

export function createApp(ctx) {
  const app = express();
  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  app.use(requestId());
  app.use(bodyLimit);
  app.use(securityHeaders);
  app.use(cors(ctx.settings.corsOrigins));
  app.use('/api', express.json({ limit: MAX_BODY, strict: false }));

  const api = express.Router();
  for (const r of [metaRouter(ctx), authRouter(ctx), playersRouter(ctx), matchesRouter(ctx), adminRouter(ctx), skinsRouter(ctx)]) api.use(r);
  api.use((req, res) => res.status(404).json(envelope('not_found', 'Not found')));
  app.use('/api', api);

  const dist = ctx.settings.frontendDist;
  if (dist && fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist, { index: false }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      if (req.path.startsWith('/ws/')) return res.status(404).json(envelope('not_found', 'Not found'));
      return res.sendFile(path.join(dist, 'index.html'));
    });
  }
  app.use((req, res) => res.status(404).json(envelope('not_found', 'Not found')));
  app.use(errorMiddleware(log));
  return app;
}

/** Start everything: database checks, the problem cache, the matchmaker, HTTP and WebSockets. */
export async function start({ ctx = null, port = null, host = null } = {}) {
  const settings = getSettings();
  setLevel(settings.logLevel);
  if (!ctx) ctx = buildContext({ db: await createPrisma() });
  if (ctx.db.fake && !ctx.db.problem.rows.length) {
    const { seed } = await import('./seed.js');
    await seed(ctx.db, { demoUsers: !settings.isProd });
    log.warn('DATABASE_URL=memory: a throwaway in-memory database, seeded now; nothing survives a restart');
  }
  const aborted = await MatchService.abortStale(ctx.db);
  if (aborted) log.warn(`aborted ${aborted} matches left running by a previous server`);
  await ctx.problems.reload(ctx.db);
  ctx.matchmaker.start();
  if (!ctx.judge.sandboxed) log.warn(`judge backend ${ctx.judge.name} is NOT a sandbox (DEV SANDBOX)`);
  const app = createApp(ctx);
  const server = http.createServer(app);
  attachWebSockets(server, ctx);
  await new Promise((resolve) => server.listen(port ?? settings.port, host ?? settings.host, resolve));
  log.info('started', { env: settings.env, judge: ctx.judge.name, problems: ctx.problems.bySlug.size, port: server.address().port });

  const stop = async () => {
    ctx.matchmaker.stop();
    await ctx.matches.shutdown();
    ctx.judge.stop();
    await new Promise((resolve) => server.close(resolve));
    server.closeAllConnections?.();
    await ctx.db.$disconnect();
  };
  return { app, server, ctx, stop };
}
