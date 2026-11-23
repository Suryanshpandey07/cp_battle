import { wsTicket, wsUrl } from "./api";
import type { ServerMessage } from "./protocol.generated";

export type ConnState = "connecting" | "live" | "reconnecting" | "closed" | "moved" | "gone";

interface Opts {
  path: string;
  scope: "lobby" | "match";
  matchId?: string;
  onMessage: (m: ServerMessage) => void;
  onState?: (s: ConnState) => void;
  onPing?: (rttMs: number, serverTimeMs: number | null) => void;
  helloSeq?: () => number;
}

/**
 * A socket that authenticates with a single-use ticket, sends hello {last_seq}
 * on match sockets, measures ping, and reconnects with backoff.
 */
export class GameSocket {
  private ws: WebSocket | null = null;
  private stopped = false;
  private attempts = 0;
  private pingTimer: number | undefined;
  private pings = new Map<number, number>();
  private pingId = 0;
  state: ConnState = "connecting";

  constructor(private o: Opts) {}

  start(): void {
    this.stopped = false;
    void this.open();
  }

  stop(): void {
    this.stopped = true;
    window.clearInterval(this.pingTimer);
    this.ws?.close(1000);
    this.ws = null;
  }

  send(type: string, data: Record<string, unknown> = {}): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ v: 1, type, data }));
  }

  private setState(s: ConnState): void {
    this.state = s;
    this.o.onState?.(s);
  }

  private async open(): Promise<void> {
    if (this.stopped) return;
    this.setState(this.attempts === 0 ? "connecting" : "reconnecting");
    let ticket: string;
    try {
      ticket = await wsTicket(this.o.scope, this.o.matchId);
    } catch (e: any) {
      if (e?.code === "forbidden" || e?.code === "not_found") {
        this.setState("gone");
        return;
      }
      return this.retry();
    }
    if (this.stopped) return;
    const ws = new WebSocket(wsUrl(`${this.o.path}?ticket=${encodeURIComponent(ticket)}`));
    this.ws = ws;
    ws.onopen = () => {
      this.attempts = 0;
      if (this.o.scope === "match") this.send("hello", { last_seq: this.o.helloSeq?.() ?? 0 });
      this.setState("live");
      window.clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.ping(), 5000);
      this.ping();
    };
    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      if (msg.type === "pong") {
        const d = msg.data as { id: number; server_time_ms?: number | null };
        const sent = this.pings.get(Number(d.id));
        if (sent !== undefined) {
          this.pings.delete(Number(d.id));
          this.o.onPing?.(performance.now() - sent, d.server_time_ms ?? null);
        }
        return;
      }
      if (msg.type === "session.moved") {
        this.stopped = true;
        this.setState("moved");
      }
      this.o.onMessage(msg);
    };
    ws.onclose = (ev) => {
      window.clearInterval(this.pingTimer);
      if (this.stopped || this.state === "moved") return;
      if (ev.code === 4404 || ev.code === 4403) {
        this.setState("gone");
        return;
      }
      this.retry();
    };
  }

  private ping(): void {
    const id = ++this.pingId;
    this.pings.set(id, performance.now());
    if (this.pings.size > 10) this.pings.delete(this.pings.keys().next().value as number);
    this.send("ping", { id });
  }

  private retry(): void {
    if (this.stopped) return;
    this.attempts++;
    this.setState("reconnecting");
    const delay = Math.min(8000, 400 * 2 ** Math.min(this.attempts, 5)) * (0.8 + Math.random() * 0.4);
    window.setTimeout(() => void this.open(), delay);
  }
}
