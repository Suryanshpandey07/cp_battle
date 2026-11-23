/* The battle screen driven by the stored public events, with a scrubber and speed control. */
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { music } from "../audio/music";
import { trackFor } from "../audio/tracks";
import { arenaSkin } from "../skins/registry";
import { navigate } from "../app/router";
import { ArenaView, type ArenaHandle } from "../features/battle/ArenaView";
import { BattleLog } from "../features/log/BattleLog";
import { t } from "../i18n";
import { mmss } from "../lib/format";
import { api, ApiError } from "../net/api";
import type { ServerMessage } from "../net/protocol.generated";
import { initialState, reduce, type BattleState, type Side } from "../state/battle.reducer";

interface Ev {
  seq: number;
  t_ms: number;
  type: string;
  data: any;
}
interface ReplayData {
  match: { your_side: number | null };
  events: Ev[];
  players: { side: number; name: string; rating: number; tier: number; max_hp: number; skins: any; is_bot: boolean }[];
  stage: { theme: string; owner_side: number | null };
}

function startState(d: ReplayData): BattleState {
  const s = initialState("replay");
  const you = (d.match.your_side ?? 1) as Side;
  const pl = (p: ReplayData["players"][number]) => ({
    side: p.side as Side, name: p.name, rating: p.rating, tier: p.tier, maxHp: p.max_hp, hp: p.max_hp, skins: p.skins ?? {}, isBot: p.is_bot,
    connected: true, hitsLanded: 0, damageDealt: 0, shieldUntil: null, judging: false, activity: "arena" as const, burnUntil: null, burnClass: null,
  });
  return { ...s, you, status: "starting", stage: { theme: d.stage.theme, owner_side: d.stage.owner_side, owner_name: null }, players: { 1: pl(d.players[0]), 2: pl(d.players[1]) } };
}

export default function Replay({ params }: { params: { id: string } }) {
  const { data, error } = useQuery({ queryKey: ["replay", params.id], queryFn: () => api<ReplayData>(`/matches/${params.id}/events?limit=1000`) });
  const [state, setState] = useState<BattleState | null>(null);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const arena = useRef<ArenaHandle | null>(null);
  const listeners = useRef(new Set<(m: ServerMessage, b: BattleState, a: BattleState) => void>());
  const subscribe = useCallback((fn: (m: ServerMessage, b: BattleState, a: BattleState) => void) => {
    listeners.current.add(fn);
    return () => listeners.current.delete(fn);
  }, []);
  const events = useMemo(() => data?.events ?? [], [data]);
  const t0 = events[0]?.t_ms ?? 0;
  const end = events.length ? events[events.length - 1].t_ms - t0 : 0;

  const toMsg = (e: Ev): ServerMessage => ({ v: 1, type: e.type as any, seq: e.seq, t: e.t_ms, data: e.data });

  // Re-apply events up to an index instantly (scrubbing).
  const seek = useCallback(
    (to: number) => {
      if (!data) return;
      let s = startState(data);
      for (let i = 0; i < to; i++) s = reduce(s, toMsg(events[i]));
      arena.current?.director.skipAll();
      setState(s);
      setIdx(to);
    },
    [data, events],
  );

  useEffect(() => {
    if (data) seek(0);
  }, [data, seek]);
  const theme = state?.stage?.theme;
  useEffect(() => {
    music.setIntensity(1);
    if (theme) music.play(trackFor(arenaSkin(theme).music).id);
  }, [theme]);

  // Play events in time order, scaled by speed.
  useEffect(() => {
    if (!playing || !state || idx >= events.length) return;
    const cur = events[idx];
    const prevT = idx > 0 ? events[idx - 1].t_ms : cur.t_ms;
    const wait = Math.min(2500, Math.max(0, cur.t_ms - prevT)) / speed;
    const id = window.setTimeout(() => {
      const msg = toMsg(cur);
      const next = reduce(state, msg);
      for (const l of listeners.current) l(msg, state, next);
      setState(next);
      setIdx(idx + 1);
    }, wait);
    return () => window.clearTimeout(id);
  }, [playing, idx, state, events, speed]);

  if (error) return <div className="p-8 text-red-300">{error instanceof ApiError ? error.message : String(error)}</div>;
  if (!data || !state) return <div className="p-8 text-slate-400">{t("common.loading")}</div>;
  const pos = idx > 0 ? events[idx - 1].t_ms - t0 : 0;
  const nextHit = events.findIndex((e, i) => i >= idx && (e.type === "attack.landed" || e.type === "attack.backfire" || e.type === "attack.blocked"));
  return (
    <div className="mx-auto max-w-6xl space-y-3 p-4">
      <div className="flex items-center gap-2">
        <h1 className="pixel text-xs text-green-400">REPLAY</h1>
        <button className="btn btn-ghost !min-h-8 ml-auto text-xs" onClick={() => navigate(`/result/${params.id}`)}>
          {t("editor.back")}
        </button>
      </div>
      <div className="h-[50vh] overflow-hidden rounded-xl border-2 border-slate-700">
        <ArenaView state={state} subscribe={subscribe} onReady={(h) => (arena.current = h)} />
      </div>
      <div className="panel flex flex-wrap items-center gap-3 p-3 text-sm">
        <button className="btn btn-primary !min-h-8" onClick={() => setPlaying((p) => !p)}>
          {playing ? "❚❚" : "▶"}
        </button>
        <input type="range" min={0} max={events.length} value={idx} onChange={(e) => seek(Number(e.target.value))} className="flex-1" aria-label="Scrubber" />
        <span className="font-mono text-xs">
          {mmss(pos)} / {mmss(end)}
        </span>
        <select className="rounded bg-slate-900 px-2 py-1" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Speed">
          {[0.5, 1, 2, 4].map((s) => (
            <option key={s} value={s}>
              {s}x
            </option>
          ))}
        </select>
        <button className="btn btn-ghost !min-h-8 text-xs" disabled={nextHit < 0} onClick={() => seek(nextHit)}>
          Next hit ⏭
        </button>
      </div>
      <div className="flex h-48 flex-col">
        <BattleLog lines={state.log} />
      </div>
    </div>
  );
}
