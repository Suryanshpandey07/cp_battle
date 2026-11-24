// WebSocket endpoints: /ws/lobby and /ws/match/:id, authenticated with a
// single-use ticket. The battle socket is mostly server push; commands go over
// REST. Messages: {"v": 1, "type", "seq"?, "t", "data"}.

import { WebSocketServer } from 'ws';
import { MemoryRateLimiter } from '../ratelimit.js';
import { tickets } from '../security.js';
import { log } from '../log.js';
import { Connection, envelope } from './hub.js';

const wsLimiter = new MemoryRateLimiter();
let connSeq = 0;

/** The hub's view of a ws socket: send(text) resolves once written, close(code). */
function adapt(sock) {
  return {
    send: (text) => new Promise((resolve, reject) => {
      if (sock.readyState !== 1) {
        reject(new Error('socket closed'));
        return;
      }
      sock.send(text, (e) => (e ? reject(e) : resolve()));
    }),
    close: (code) => sock.close(code),
  };
}

function parse(raw) {
  try {
    const data = JSON.parse(raw.toString('utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

function lobby(ctx, sock, params) {
  const t = tickets.consume(params.get('ticket') || '', 'lobby');
  if (!t) {
    sock.close(4401);
    return;
  }
  const conn = new Connection(adapt(sock), t.profileId);
  const key = `lobby:${++connSeq}`;
  const old = ctx.hub.lobbyAttach(t.profileId, conn);
  if (old) old.send(envelope('session.moved', { reason: 'session_moved' })).then(() => old.close(4001));
  ctx.matchmaker.lobbyOpened(t.profileId);
  conn.send(envelope('hello', { queue: ctx.matchmaker.status(t.profileId) }));
  ctx.hub.lobbyBroadcast('online.count', { count: ctx.hub.lobby.size });
  sock.on('message', (raw) => {
    const msg = parse(raw);
    if (!msg) return;
    const [ok] = wsLimiter.hit(key, ctx.cfg.rate_limits.ws_msgs);
    if (!ok) return;
    if (msg.type === 'ping') conn.send(envelope('pong', { id: (msg.data || {}).id ?? null }));
  });
  sock.on('close', () => {
    conn.closed = true;
    if (ctx.hub.lobbyDetach(t.profileId, conn)) ctx.matchmaker.lobbyClosed(t.profileId);
    ctx.hub.lobbyBroadcast('online.count', { count: ctx.hub.lobby.size }).catch(() => {});
  });
}

function match(ctx, sock, matchId, params) {
  const t = tickets.consume(params.get('ticket') || '', 'match', matchId);
  const actor = ctx.matches.get(matchId);
  if (!t || !actor) {
    sock.close(t ? 4404 : 4401);
    return;
  }
  const side = actor.sideOf(t.profileId);
  if (side === null) {
    sock.close(4403);
    return;
  }
  const conn = new Connection(adapt(sock), t.profileId);
  const key = `match:${++connSeq}`;
  let joined = false;
  const helloTimer = setTimeout(() => {
    if (!joined) {
      conn.send(envelope('error', { code: 'validation', message: 'send hello first' })).finally(() => conn.close(4400));
    }
  }, 10_000);
  sock.on('message', async (raw) => {
    const msg = parse(raw);
    if (!msg) return;
    const data = msg.data && typeof msg.data === 'object' ? msg.data : {};
    if (!joined) {
      clearTimeout(helloTimer);
      if (msg.type !== 'hello') {
        await conn.send(envelope('error', { code: 'validation', message: 'send hello first' }));
        await conn.close(4400);
        return;
      }
      joined = true;
      try {
        await actor.send('join', side, { conn, last_seq: parseInt(data.last_seq || 0, 10) || 0 });
      } catch {
        await conn.close(4500);
      }
      return;
    }
    const [ok] = wsLimiter.hit(key, ctx.cfg.rate_limits.ws_msgs);
    if (!ok) return;
    if (msg.type === 'ping') {
      conn.send(envelope('pong', { id: data.id ?? null, server_time_ms: ctx.clock.wallMs() }));
    } else if (msg.type === 'activity') {
      actor.enqueueCmd('activity', side, { state: data.state });
    } else if (msg.type === 'emote') {
      actor.send('emote', side, { id: data.id }, String(data.cmd_id || '') || null).catch(() => {});
    }
  });
  sock.on('close', () => {
    clearTimeout(helloTimer);
    conn.closed = true;
    if (joined) actor.enqueueCmd('leave', side, { conn });
  });
}

/** Serve /ws/lobby and /ws/match/:id on an HTTP server's upgrade requests. */
export function attachWebSockets(server, ctx) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    const m = url.pathname.match(/^\/ws\/match\/([\w-]{1,36})$/);
    if (url.pathname !== '/ws/lobby' && !m) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (sock) => {
      sock.on('error', (e) => log.debug('socket error', { error: String(e) }));
      if (m) match(ctx, sock, m[1], url.searchParams);
      else lobby(ctx, sock, url.searchParams);
    });
  });
  return wss;
}
