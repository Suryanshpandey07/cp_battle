import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { navigate } from "../app/router";
import { music } from "../audio/music";
import { trackFor } from "../audio/tracks";
import { synth } from "../audio/synth";
import { ArenaView, type ArenaHandle } from "../features/battle/ArenaView";
import { TopStrip } from "../features/battle/TopStrip";
import { Workspace } from "../features/editor/Workspace";
import { CardView } from "../features/hand/CardView";
import { BattleLog, LiveRegion } from "../features/log/BattleLog";
import { t } from "../i18n";
import { cmdId, fmt } from "../lib/format";
import { api, ApiError } from "../net/api";
import { GameSocket, type ConnState } from "../net/ws";
import type { Side } from "../state/battle.reducer";
import { onBattleEvent, serverNow, useBattle } from "../state/battle.store";
import { useSettings } from "../state/settings";
import { arenaSkin } from "../skins/registry";

function statusLine(s: ReturnType<typeof useBattle.getState>["state"], conn: string): string {
  if (conn === "connecting") return t("battle.status.connecting");
  if (s.status === "starting") return s.countdown ? t("battle.status.countdown") : t("battle.status.waiting");
  if (s.status === "finished" || s.status === "aborted") return t("battle.status.finished");
  const me = s.players?.[(s.you ?? 1) as Side];
  const opp = s.players?.[(s.you === 1 ? 2 : 1) as Side];
  if (me?.judging) return t("battle.status.judging");
  if (opp?.judging) return t("battle.status.opp_judging");
  return t("battle.status.live");
}

export default function Battle({ params }: { params: { id: string } }) {
  const matchId = params.id;
  const state = useBattle((s) => s.state);
  const conn = useBattle((s) => s.conn);
  const [openSlot, setOpenSlot] = useState<number | null>(null);
  const [lastSlot, setLastSlot] = useState(0);
  const [toast, setToast] = useState<{ text: string; t: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(t("battle.fairplay"));
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<number, { code: string; problem: string; language?: string }>>({});
  const [help, setHelp] = useState(false);
  const [blocked, setBlocked] = useState<"other-tab" | null>(null);
  const [igniting, setIgniting] = useState<number | null>(null);
  const socket = useRef<GameSocket | null>(null);
  const arena = useRef<ArenaHandle | null>(null);
  const settings = useSettings();
  const you = (state.you ?? 1) as Side;
  const oppSide = (you === 1 ? 2 : 1) as Side;
  const me = state.players?.[you];
  const opp = state.players?.[oppSide];
  const ended = state.status === "finished" || state.status === "aborted";
  const [fightBanner, setFightBanner] = useState(false);
  useEffect(() => {
    if (state.status !== "live" || state.countdown !== 0) return;
    setFightBanner(true);
    const id = window.setTimeout(() => setFightBanner(false), 1200);
    return () => window.clearTimeout(id);
  }, [state.status, state.countdown]);
  // Music: the arena's own track; calm in the countdown, driving when someone is low or time is short.
  const theme = state.stage?.theme;
  const tense = !!me && !!opp && (me.hp / me.maxHp < 0.3 || opp.hp / opp.maxHp < 0.3 || (state.clock.maxMs > 0 && state.clock.maxMs - state.clock.elapsedMs < 60_000));
  useEffect(() => {
    if (ended) {
      music.play(null);
      return;
    }
    music.setIntensity(state.status !== "live" ? 0 : tense ? 2 : 1);
    music.play(trackFor(arenaSkin(theme).music).id);
  }, [theme, state.status, tense, ended]);
  // Drafts are deleted when the match ends.
  useEffect(() => {
    if (!ended) return;
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith(`aa.draft.${matchId}.`)) localStorage.removeItem(k);
    } catch {
      /* storage unavailable */
    }
  }, [ended, matchId]);

  // One live socket per match per user; a second tab asks before taking over.
  useEffect(() => {
    useBattle.getState().reset(matchId);
    let cancelled = false;
    const bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(`aa-match-${matchId}`) : null;
    let otherTab = false;
    if (bc) {
      bc.onmessage = (e) => {
        if (e.data === "who") bc.postMessage("here");
        if (e.data === "here") otherTab = true;
      };
      bc.postMessage("who");
    }
    const start = () => {
      if (cancelled) return;
      const s = new GameSocket({
        path: `/ws/match/${matchId}`,
        scope: "match",
        matchId,
        helloSeq: () => useBattle.getState().state.seq,
        onMessage: (m) => useBattle.getState().apply(m),
        onState: (c: ConnState) => useBattle.getState().setConn(c),
        onPing: (rtt, st) => useBattle.getState().setPing(rtt, st),
      });
      socket.current = s;
      s.start();
    };
    const timer = window.setTimeout(() => {
      if (otherTab && !window.confirm(t("battle.session_moved") + " Continue here?")) {
        setBlocked("other-tab");
        return;
      }
      start();
    }, 150);
    void api<{ drafts: { slot: number; code: string; problem: string; language: string }[] }>(`/matches/${matchId}/drafts`)
      .then((d) => setDrafts(Object.fromEntries(d.drafts.map((x) => [x.slot, { code: x.code, problem: x.problem, language: x.language }]))))
      .catch(() => {});
    const noticeTimer = window.setTimeout(() => setNotice(null), 6000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearTimeout(noticeTimer);
      socket.current?.stop();
      bc?.close();
    };
  }, [matchId]);

  // When you are hit while coding: a toast with the damage and the attacker.
  useEffect(
    () =>
      onBattleEvent((msg, _b, after) => {
        const d = msg.data as any;
        if (msg.type === "attack.landed" && d.defender === after.you) {
          setToast({ text: `-${fmt(d.damage)} · ${after.players?.[d.attacker as Side]?.name ?? ""}`, t: Date.now() });
          window.setTimeout(() => setToast((x) => (x && Date.now() - x.t >= 1900 ? null : x)), 2000);
        }
        if (msg.type === "hand.updated" && after.lastVerdict?.verdict === "AC") {
          setIgniting(after.lastVerdict.slot ?? null);
          window.setTimeout(() => setIgniting(null), 520);
        }
      }),
    [],
  );

  // Tell the opponent (coarsely) whether we are in the arena or the editor.
  useEffect(() => {
    socket.current?.send("activity", { state: openSlot === null ? "arena" : "editor" });
  }, [openSlot, conn]);

  // After the match ends, wipe to the result screen once the show is over (KO: 2.8 s).
  useEffect(() => {
    if (!ended) return;
    const go = () => navigate(`/result/${matchId}`);
    const d = arena.current?.director;
    const id = window.setTimeout(go, state.result?.end_reason === "ko" ? 3200 : 2600);
    if (d) d.onIdle = () => window.setTimeout(go, 400);
    return () => window.clearTimeout(id);
  }, [ended, matchId, state.result?.end_reason]);

  const act = useCallback(
    async (kind: "block" | "hint" | "reroll" | "forfeit" | "emote", extra: Record<string, unknown> = {}) => {
      setActionErr(null);
      try {
        await api(`/matches/${matchId}/${kind}`, { body: { cmd_id: cmdId(), ...extra } });
      } catch (e) {
        setActionErr(e instanceof ApiError ? e.message : String(e));
        window.setTimeout(() => setActionErr(null), 2500);
      }
    },
    [matchId],
  );

  const open = (slot: number) => {
    const c = state.hand[slot];
    if (!c?.problem || state.status !== "live") return;
    setOpenSlot(slot);
    setLastSlot(slot);
  };
  const flee = () => {
    if (window.confirm(t("battle.flee_confirm"))) void act("forfeit");
  };
  const hint = () => void act("hint", { slot: openSlot ?? lastSlot });

  // Arena keyboard: 1-4 open a card, B block, H hint, M mute, ? help.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (openSlot !== null) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (/^[1-4]$/.test(e.key)) open(Number(e.key) - 1);
      else if (e.key === "b" || e.key === "B") void act("block");
      else if (e.key === "h" || e.key === "H") hint();
      else if (e.key === "m" || e.key === "M") settings.set({ muted: !settings.s.muted });
      else if (e.key === "?") setHelp((x) => !x);
    };
    const onAltKey = (e: KeyboardEvent) => {
      if (openSlot !== null && e.altKey && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        void act("block");
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keydown", onAltKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keydown", onAltKey);
    };
  });

  useEffect(() => synth.applyVolumes(), [settings.s.muted]);

  const subscribe = useMemo(() => onBattleEvent, []);
  const reconnecting = conn === "reconnecting";
  const graceLeft = state.disconnected && state.disconnected.side !== you ? Math.max(0, state.disconnected.until - serverNow()) : 0;

  if (blocked === "other-tab" || conn === "moved") {
    return (
      <Screen>
        <p>{t("battle.session_moved")}</p>
        <button className="btn btn-ghost" onClick={() => navigate("/lobby")}>
          {t("result.back")}
        </button>
      </Screen>
    );
  }
  if (conn === "gone" && !state.players) {
    return (
      <Screen>
        <p>{t("battle.not_found")}</p>
        <button className="btn btn-primary" onClick={() => navigate(`/result/${matchId}`)}>
          {t("result.replay")}
        </button>
      </Screen>
    );
  }

  const editing = openSlot !== null && state.status === "live";
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-900" data-testid="battle" data-status={state.status}>
      <TopStrip state={state} onFlee={flee} />
      {(reconnecting || conn === "connecting") && (
        <div className="bg-yellow-900/80 px-3 py-1 text-center text-xs text-yellow-100" role="status">
          {reconnecting ? t("battle.reconnecting", { s: 60 }) : t("battle.status.connecting")}
        </div>
      )}
      {graceLeft > 0 && (
        <div className="bg-orange-900/80 px-3 py-1 text-center text-xs text-orange-100" role="status">
          {t("battle.opp_disconnected", { s: Math.ceil(graceLeft / 1000) })}
        </div>
      )}
      {state.result?.reason === "server_restarted" && <div className="bg-red-900 px-3 py-1 text-center text-xs">{t("battle.restarted")}</div>}

      {/* Arena: full stage, or a battle strip across the top while coding */}
      <div className={`relative shrink-0 transition-[height] duration-300 ${editing ? "h-[28vh] min-h-[150px]" : "h-[40vh] min-h-[220px] md:h-[52vh]"} ${toast ? "shake-x" : ""}`}>
        <ArenaView state={state} compact={editing} subscribe={subscribe} onReady={(h) => (arena.current = h)} />
        {state.status === "starting" && state.countdown !== null && state.countdown > 0 && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/50">
            <div className="mb-4 flex items-center gap-6 text-lg font-bold">
              <span className="text-blue-300">{me?.name}</span>
              <span className="pixel text-xs text-slate-400">VS</span>
              <span className="text-purple-300">{opp?.name}</span>
            </div>
            <span key={state.countdown} className="pixel stamp text-6xl text-yellow-300">
              {state.countdown}
            </span>
          </div>
        )}
        {fightBanner && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
            <span className="pixel stamp text-5xl text-red-400">{t("battle.fight")}</span>
          </div>
        )}
        {toast && editing && (
          <div className="absolute left-1/2 top-2 z-30 -translate-x-1/2 rounded bg-red-700 px-4 py-1 text-sm font-bold shadow-lg" role="alert">
            {toast.text}
          </div>
        )}
        {notice && (
          <div className="absolute bottom-2 left-1/2 z-30 -translate-x-1/2 rounded bg-slate-800/90 px-3 py-1 text-[11px] text-slate-300">{notice}</div>
        )}
      </div>

      <div className="border-y border-slate-800 bg-slate-950 px-3 py-1 font-mono text-xs text-green-300" data-testid="status-line">
        {statusLine(state, conn)} {actionErr && <span className="ml-2 text-red-400">{actionErr}</span>}
      </div>

      {editing ? (
        <Workspace
          matchId={matchId}
          state={state}
          slot={openSlot!}
          onSlot={(s) => state.hand[s]?.problem && setOpenSlot(s)}
          onBack={() => setOpenSlot(null)}
          onHint={hint}
          drafts={drafts}
          setDraftFlag={(slot, code, problem) => setDrafts((d) => ({ ...d, [slot]: { code, problem } }))}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="flex min-h-[160px] flex-col border-slate-700 p-3 md:w-1/3 md:border-r">
            <h3 className="pixel mb-2 text-[10px] text-slate-400">{t("battle.log")}</h3>
            <BattleLog lines={state.log} />
            <LiveRegion lines={state.log} />
            <div className="mt-2 flex gap-2">
              <button className="pixel flex-1 rounded border border-purple-500 bg-purple-900/50 py-2 text-[10px] text-purple-200 hover:bg-purple-800 disabled:opacity-40" disabled={state.charges.blocks <= 0 || state.status !== "live"} onClick={() => void act("block")} data-testid="block" title="B">
                {t("powerup.block")} (x{Math.max(0, state.charges.blocks)})
              </button>
              <button className="pixel flex-1 rounded border border-yellow-500 bg-yellow-900/50 py-2 text-[10px] text-yellow-200 hover:bg-yellow-800 disabled:opacity-40" disabled={state.charges.hints === 0 || state.status !== "live"} onClick={hint} data-testid="hint" title="H">
                {t("powerup.hint")} (x{state.charges.hints < 0 ? "∞" : state.charges.hints})
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {["gg", "nice", "oops", "block", "hurry", "wow", "thanks", "rematch"].map((e) => (
                <button key={e} className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-slate-700" onClick={() => void act("emote", { id: e })}>
                  {t(`emote.${e}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col bg-slate-800 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="pixel text-[10px] text-slate-300">{t("battle.select_attack")}</h3>
              <span className="text-[10px] text-slate-500">
                {t("powerup.reroll")} x{state.charges.rerolls} · {help ? t("battle.shortcuts") : "?"}
              </span>
            </div>
            <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
              {state.hand.map((c, i) => (
                <div key={i} className="relative flex min-h-[110px]">
                  <div className="flex flex-1 [&>*]:flex-1">
                    <CardView
                      card={c}
                      index={i}
                      skinId={String(me?.skins?.card ?? "card.classic")}
                      weaponId={me?.skins?.weapon as string | undefined}
                      playerTier={me?.tier ?? 1}
                      myHp={me?.hp ?? 0}
                      oppHp={opp?.hp ?? 0}
                      oppShield={!!opp?.shieldUntil && opp.shieldUntil > serverNow()}
                      hasDraft={drafts[i]?.problem === c.problem?.slug}
                      onOpen={() => open(i)}
                      disabled={state.status !== "live"}
                      dealKey={c.problem?.slug}
                      igniting={igniting === i}
                    />
                  </div>
                  {c.problem && state.charges.rerolls > 0 && state.status === "live" && (
                    <button
                      className="absolute -right-1 -top-1 z-20 rounded-full bg-slate-900 px-1.5 text-xs text-slate-300 ring-1 ring-slate-600 hover:text-white"
                      title={t("powerup.reroll")}
                      aria-label={`${t("powerup.reroll")} ${c.problem.title}`}
                      onClick={() => void act("reroll", { slot: i })}
                    >
                      ⟳
                    </button>
                  )}
                </div>
              ))}
              {!state.hand.length && [0, 1, 2, 3].map((i) => <div key={i} className="skeleton min-h-[110px] rounded-xl" />)}
            </div>
          </div>
        </div>
      )}
      {ended && (
        <button className="fixed inset-0 z-40 cursor-pointer bg-transparent" aria-label="Continue to results" onClick={() => navigate(`/result/${matchId}`)} />
      )}
    </div>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-4 text-slate-300">{children}</div>;
}
