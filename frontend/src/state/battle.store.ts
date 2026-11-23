import { create } from "zustand";
import type { ServerMessage } from "../net/protocol.generated";
import { initialState, reduce, type BattleState } from "./battle.reducer";

type Listener = (msg: ServerMessage, before: BattleState, after: BattleState) => void;

interface BattleStore {
  state: BattleState;
  conn: string;
  pingMs: number | null;
  clockOffsetMs: number; // server wall clock minus local wall clock
  apply: (msg: ServerMessage) => void;
  reset: (matchId: string | null) => void;
  setConn: (c: string) => void;
  setPing: (rtt: number, serverTimeMs: number | null) => void;
}

const listeners = new Set<Listener>();

/** Animations subscribe to events, not to state diffs. */
export function onBattleEvent(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const useBattle = create<BattleStore>((set, get) => ({
  state: initialState(),
  conn: "connecting",
  pingMs: null,
  clockOffsetMs: 0,
  apply: (msg) => {
    const before = get().state;
    const after = reduce(before, msg);
    if (after !== before) set({ state: after });
    for (const l of listeners) l(msg, before, after);
  },
  reset: (matchId) => set({ state: initialState(matchId), conn: "connecting" }),
  setConn: (conn) => set({ conn }),
  setPing: (rtt, serverTimeMs) => {
    const patch: Partial<BattleStore> = { pingMs: Math.round(rtt) };
    if (serverTimeMs) patch.clockOffsetMs = serverTimeMs + rtt / 2 - Date.now();
    set(patch);
  },
}));

/** Current server wall-clock time estimated from the measured offset. */
export function serverNow(): number {
  return Date.now() + useBattle.getState().clockOffsetMs;
}
