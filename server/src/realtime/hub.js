// In-process WebSocket hub, behind a small interface so a Redis-backed hub can
// replace it when the server scales past one process.

export function envelope(type, data, seq = null) {
  const msg = { v: 1, type, t: Date.now(), data };
  if (seq !== null && seq !== undefined) msg.seq = seq;
  return msg;
}

/** Wraps a socket (anything with send(text) and close(code)) so a dead peer never throws. */
export class Connection {
  constructor(ws, profileId) {
    this.ws = ws;
    this.profileId = profileId;
    this.closed = false;
  }

  async send(msg) {
    if (this.closed) return false;
    try {
      await this.ws.send(JSON.stringify(msg));
      return true;
    } catch {
      this.closed = true;
      return false;
    }
  }

  async close(code = 1000) {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.ws.close(code);
    } catch { /* already gone */ }
  }
}

export class Hub {
  constructor() {
    this.matchConns = new Map(); // match id -> Map(side -> Connection)
    this.lobby = new Map(); // profile id -> Connection
  }

  // Match rooms -------------------------------------------------------------------
  attach(matchId, side, conn) {
    if (!this.matchConns.has(matchId)) this.matchConns.set(matchId, new Map());
    const room = this.matchConns.get(matchId);
    const old = room.get(side) || null;
    room.set(side, conn);
    return old !== conn ? old : null;
  }

  detach(matchId, side, conn) {
    const room = this.matchConns.get(matchId);
    if (room && room.get(side) === conn) {
      room.delete(side);
      return true;
    }
    return false;
  }

  current(matchId, side) {
    const room = this.matchConns.get(matchId);
    return (room && room.get(side)) || null;
  }

  async sendSide(matchId, side, msg) {
    const c = this.current(matchId, side);
    if (c) await c.send(msg);
  }

  async broadcast(matchId, visibility, msg) {
    const room = this.matchConns.get(matchId);
    if (!room) return;
    for (const [side, c] of [...room.entries()]) {
      if (visibility === 'both' || visibility === `p${side}`) await c.send(msg);
    }
  }

  dropRoom(matchId) {
    this.matchConns.delete(matchId);
  }

  // Lobby ---------------------------------------------------------------------------
  lobbyAttach(profileId, conn) {
    const old = this.lobby.get(profileId) || null;
    this.lobby.set(profileId, conn);
    return old !== conn ? old : null;
  }

  lobbyDetach(profileId, conn) {
    if (this.lobby.get(profileId) === conn) {
      this.lobby.delete(profileId);
      return true;
    }
    return false;
  }

  async lobbySend(profileId, type, data) {
    const c = this.lobby.get(profileId);
    if (c) await c.send(envelope(type, data));
  }

  async lobbyBroadcast(type, data) {
    for (const c of [...this.lobby.values()]) await c.send(envelope(type, data));
  }
}
