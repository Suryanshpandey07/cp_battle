import { useEffect, useRef, useState } from "react";
import { navigate } from "../app/router";
import { Modal } from "../app/SettingsModal";
import { t } from "../i18n";
import { mmss } from "../lib/format";
import { api, ApiError } from "../net/api";
import { GameSocket } from "../net/ws";
import { useSettings } from "../state/settings";

interface QueueState {
  state: string;
  wait_s?: number;
  window?: number;
  bot_available?: boolean;
  bot_in_s?: number;
  map?: string;
}

export default function Queue() {
  const [q, setQ] = useState<QueueState>({ state: "queued" });
  const [found, setFound] = useState<{ proposal_id: string; expires_in: number; map: string; opponent: { name: string; rating: number; tier: number }; at: number } | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const autoBot = useSettings((s) => s.s.autoBot);
  const sock = useRef<GameSocket | null>(null);

  const fightBot = async () => {
    try {
      await api("/queue", { method: "DELETE" });
      const r = await api<{ match_id: string }>("/matches/bot", { body: { map: q.map && q.map !== "any" ? q.map : "bit" } });
      navigate(`/battle/${r.match_id}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    }
  };

  useEffect(() => {
    const s = new GameSocket({
      path: "/ws/lobby",
      scope: "lobby",
      onMessage: (m) => {
        // Lobby events are not part of the match protocol union, so compare as strings.
        const type: string = m.type;
        const d = m.data as any;
        if (type === "hello" && d.queue) {
          // A match may have been found before this socket connected.
          if (d.queue.state === "proposal") {
            setFound({ proposal_id: d.queue.proposal_id, expires_in: d.queue.expires_in, map: d.queue.map, opponent: d.queue.opponent, at: Date.now() });
            setAccepted(!!d.queue.accepted);
          } else setQ(d.queue);
        }
        if (type === "queue.tick" || type === "queue.joined") {
          setQ(d);
          if (d.requeued) {
            setFound(null);
            setAccepted(false);
          }
        }
        if (type === "match.found") {
          setFound({ ...d, at: Date.now() });
          setAccepted(false);
        }
        if (type === "match.ready") navigate(`/battle/${d.match_id}`);
        if (type === "queue.cooldown") {
          setFound(null);
          setCooldown(Date.now() + d.seconds * 1000);
        }
      },
    });
    sock.current = s;
    s.start();
    const id = window.setInterval(() => setTick((x) => x + 1), 250);
    return () => {
      s.stop();
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (autoBot && q.bot_available) void fightBot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoBot, q.bot_available]);

  const respond = async (accept: boolean) => {
    if (!found) return;
    try {
      const r = await api<{ state: string; match_id?: string }>("/queue/respond", { body: { proposal_id: found.proposal_id, accept } });
      if (r.match_id) navigate(`/battle/${r.match_id}`);
      if (accept) setAccepted(true);
      else navigate("/lobby");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
      setFound(null);
    }
  };

  const cancel = async () => {
    await api("/queue", { method: "DELETE" }).catch(() => {});
    navigate("/lobby");
  };

  const readyLeft = found ? Math.max(0, found.expires_in - (Date.now() - found.at) / 1000) : 0;
  const cdLeft = Math.max(0, (cooldown - Date.now()) / 1000);
  return (
    <div className="flex min-h-[80vh] flex-col items-center justify-center gap-6 p-6" data-testid="queue">
      <div className="relative h-56 w-56 overflow-hidden rounded-full border-4 border-green-700 bg-slate-950">
        <div className="radar absolute inset-0 rounded-full" />
        <div className="absolute inset-[30%] rounded-full border border-green-800" />
        <div className="absolute inset-[15%] rounded-full border border-green-900" />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="pixel text-[10px] text-green-300">±{q.window ?? 50}</span>
        </div>
      </div>
      <h1 className="pixel text-center text-xs text-green-400">{t("queue.searching")}</h1>
      <div className="text-center text-sm text-slate-300">
        <div>{t("queue.elapsed", { time: mmss((q.wait_s ?? 0) * 1000) })}</div>
        <div>{t("queue.window", { window: q.window ?? 50 })}</div>
        {!q.bot_available && q.bot_in_s !== undefined && <div className="text-slate-400">{t("queue.bot_in", { s: Math.ceil(q.bot_in_s) })}</div>}
      </div>
      {cdLeft > 0 && <div className="text-sm text-orange-300">{t("queue.cooldown", { s: Math.ceil(cdLeft) })}</div>}
      {err && <div className="text-sm text-red-300">{err}</div>}
      <div className="flex gap-3">
        {q.bot_available && (
          <button className="btn btn-primary" onClick={() => void fightBot()} data-testid="fight-bot-now">
            {t("queue.bot_now")}
          </button>
        )}
        <button className="btn btn-ghost" onClick={() => void cancel()}>
          {t("queue.cancel")}
        </button>
      </div>
      {found && (
        <Modal title={t("queue.found")} onClose={() => void respond(false)}>
          <div className="space-y-4 text-center" data-testid="ready-check">
            <div className="text-lg font-bold">{found.opponent.name}</div>
            <div className="text-sm text-slate-400">
              {found.opponent.rating} · {t(`map.${found.map}`)}
            </div>
            <div className="h-2 rounded bg-slate-900">
              <div className="h-2 rounded bg-green-500 transition-all" style={{ width: `${(readyLeft / found.expires_in) * 100}%` }} />
            </div>
            {accepted ? (
              <p className="text-sm text-slate-300">{t("queue.waiting_other")}</p>
            ) : (
              <div className="flex justify-center gap-3">
                <button className="btn btn-primary" onClick={() => void respond(true)} data-testid="accept">
                  {t("queue.accept")}
                </button>
                <button className="btn btn-ghost" onClick={() => void respond(false)}>
                  {t("queue.decline")}
                </button>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
