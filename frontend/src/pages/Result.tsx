import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { navigate } from "../app/router";
import { sfx } from "../audio/sfx";
import { t } from "../i18n";
import { fmt, mmss, tierColor, TIER_TITLES } from "../lib/format";
import { api, ApiError, loadMe } from "../net/api";
import type { MatchEnded, RatingBlock } from "../net/protocol.generated";
import { avatarSkin, cardSkin } from "../skins/registry";
import { useBattle } from "../state/battle.store";

interface MatchSummary {
  id: string;
  mode: string;
  map: string;
  your_side: number | null;
  result: MatchEnded | null;
  players?: { side: number; name: string }[];
  players_detail?: { side: number; name: string; rating: number; tier: number; max_hp: number }[];
}

function Ticker({ to, ms = 600 }: { to: number; ms?: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const t0 = performance.now();
    let raf = 0;
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      setV(Math.round(to * k));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  return <span className="tabular">{v >= 0 ? `+${v}` : v}</span>;
}

/** The rank-up power spike: the HP bar stretches from the old maximum to the new one. */
function PowerSpike({ block }: { block: RatingBlock }) {
  const p = block.promotion!;
  const [w, setW] = useState((p.old_max_hp / p.new_max_hp) * 100);
  useEffect(() => {
    if (p.direction === "up") sfx.rankUp();
    const id = window.setTimeout(() => setW(100), 400);
    return () => window.clearTimeout(id);
  }, [p.direction]);
  const color = tierColor(p.to_tier);
  return (
    <div className="panel relative overflow-hidden p-4 text-center" data-testid="promotion">
      <div className="absolute inset-0 animate-pulse opacity-30" style={{ background: `radial-gradient(circle, ${color}, transparent 70%)` }} />
      <div className="pixel stamp relative text-sm" style={{ color }}>
        {p.direction === "up" ? t("result.promotion") : t("result.demotion")}: {p.title}
      </div>
      <div className="relative mx-auto mt-3 max-w-md">
        <div className="hp-track">
          <div className="hp-fill" style={{ width: `${w}%`, background: color, transition: "width 1.4s cubic-bezier(.2,.9,.3,1)" }} />
        </div>
        <div className="mt-1 font-mono text-xs text-slate-300">
          {fmt(p.old_max_hp)} → {fmt(p.new_max_hp)} HP
        </div>
      </div>
    </div>
  );
}

function shareCard(title: string, delta: number | null, tier: number, rating: number): void {
  const c = document.createElement("canvas");
  c.width = 1200;
  c.height = 630;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 1200, 630);
  grad.addColorStop(0, "#0f172a");
  grad.addColorStop(1, "#052e16");
  g.fillStyle = grad;
  g.fillRect(0, 0, 1200, 630);
  g.fillStyle = "#22c55e";
  g.font = "bold 40px monospace";
  g.fillText("ALGOARENA", 60, 90);
  g.fillStyle = "#ffffff";
  g.font = "bold 96px sans-serif";
  g.fillText(title, 60, 300);
  g.font = "48px monospace";
  g.fillStyle = tierColor(tier);
  g.fillText(`${TIER_TITLES[tier - 1]} · ${rating}${delta !== null ? ` (${delta >= 0 ? "+" : ""}${delta})` : ""}`, 60, 400);
  c.toBlob((b) => {
    if (!b) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    a.download = "algoarena-result.png";
    a.click();
  });
}

export default function Result({ params }: { params: { id: string } }) {
  const { data, error } = useQuery<MatchSummary>({ queryKey: ["match", params.id], queryFn: () => api(`/matches/${params.id}`), refetchInterval: (q) => (q.state.data?.result ? false : 1500) });
  const live = useBattle((s) => (s.state.matchId === params.id ? s.state : null));
  const result = data?.result ?? live?.result ?? null;
  const side = String(data?.your_side ?? live?.you ?? 1);
  const played = useRef(false);
  const [rematchErr, setRematchErr] = useState<string | null>(null);

  useEffect(() => {
    void loadMe().catch(() => {});
  }, []);
  const label = result?.labels?.[side] ?? (result?.outcome === "aborted" ? "aborted" : result?.outcome === "draw" ? "draw" : null);
  useEffect(() => {
    if (!label || played.current) return;
    played.current = true;
    if (label === "victory" || label === "hollow_victory") sfx.victory();
    else if (label !== "draw" && label !== "aborted") sfx.defeat();
  }, [label]);

  if (error) return <div className="p-8 text-red-300">{error instanceof ApiError ? error.message : String(error)}</div>;
  if (!result) return <div className="p-8 text-slate-400">{t("common.loading")}</div>;

  const block = result.sides?.[side] as RatingBlock | undefined;
  const stats = (result.stats?.[side] ?? {}) as Record<string, number>;
  const otherSide = side === "1" ? "2" : "1";
  const oppStats = (result.stats?.[otherSide] ?? {}) as Record<string, number>;
  const rewards = (result.rewards?.[side] ?? live?.rewards ?? null) as { ap: number; lines: { key: string; ap: number }[]; quests: { id: string; progress: number; target: number; complete: boolean }[]; achievements: string[]; unlocked: string[] } | null;
  const win = label === "victory" || label === "hollow_victory";
  const accuracy = stats.submissions ? Math.round(((stats.accepted ?? 0) * 100) / stats.submissions) : 0;
  const mode = data?.mode ?? live?.mode ?? "ranked";
  const map = data?.map ?? live?.map ?? "bit";

  const rematch = async () => {
    setRematchErr(null);
    try {
      if (mode === "ranked") {
        await api("/queue/join", { body: { mode: "ranked", map } });
        navigate("/queue");
      } else {
        const r = await api<{ match_id: string }>(mode === "bot" ? "/matches/bot" : "/matches/practice", { body: { map } });
        navigate(`/battle/${r.match_id}`);
      }
    } catch (e) {
      setRematchErr(e instanceof ApiError ? e.message : String(e));
    }
  };

  const statRows: [string, string][] = [
    ["stat.damage_dealt", fmt(result.damage_dealt?.[side] ?? 0)],
    ["stat.damage_taken", fmt(stats.damage_taken ?? 0)],
    ["stat.hits", String(result.hits_landed?.[side] ?? 0)],
    ["stat.accuracy", `${accuracy}%`],
    ["stat.recoil", fmt(stats.recoil_taken ?? 0)],
    ["stat.biggest", fmt(stats.biggest_hit ?? 0)],
    ["stat.fastest", stats.fastest_solve_ms ? mmss(stats.fastest_solve_ms) : "–"],
    ["stat.hints", String(stats.hints_used ?? 0)],
    ["stat.blocks", String(stats.blocks_used ?? 0)],
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4" data-testid="result">
      <section className={`panel relative overflow-hidden p-6 text-center ${win ? "" : ""}`}>
        {win && (
          <div className="pointer-events-none absolute inset-0" aria-hidden>
            {Array.from({ length: 40 }).map((_, i) => (
              <span key={i} className="absolute h-2 w-2 animate-bounce" style={{ left: `${(i * 37) % 100}%`, top: `${(i * 53) % 80}%`, background: ["#facc15", "#22c55e", "#3b82f6", "#a855f7", "#ef4444"][i % 5], animationDelay: `${(i % 7) * 120}ms` }} />
            ))}
          </div>
        )}
        <h1 className={`pixel relative text-2xl md:text-4xl ${win ? "stamp text-yellow-300" : label === "draw" || label === "aborted" ? "text-slate-300" : "glitch text-red-400"}`} data-testid="outcome">
          {t(`result.${label}`)}
        </h1>
        <p className="relative mt-2 text-slate-300">
          {t(`result.reason.${result.end_reason}`)} · {mmss(result.elapsed_ms)}
          {result.reason === "server_restarted" && ` · ${t("battle.restarted")}`}
        </p>
      </section>

      {block?.promotion && <PowerSpike block={block} />}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="panel p-4" data-testid="rating-breakdown">
          <h2 className="pixel mb-3 text-[10px] text-slate-400">{t("result.rating")}</h2>
          {block?.practice ? (
            <p className="text-sm text-slate-400">{t("result.practice")}</p>
          ) : block ? (
            <>
              {block.steps.map((s, i) => (
                <div key={i} className="slide-in flex justify-between py-0.5 text-sm" style={{ animationDelay: `${i * 220}ms` }}>
                  <span>{t(`result.step.${s.key}`)}</span>
                  <span className={s.delta >= 0 ? "text-green-400" : "text-red-400"}>
                    <Ticker to={s.delta} />
                  </span>
                </div>
              ))}
              {block.multiplier !== 100 && <div className="text-xs text-slate-500">{t("result.multiplier", { pct: block.multiplier })}</div>}
              <div className="mt-2 flex items-center justify-between border-t border-slate-700 pt-2 font-bold">
                <span>{t("result.new_rating")}</span>
                <span className="flex items-center gap-2">
                  <span className={block.delta >= 0 ? "text-green-400" : "text-red-400"} data-testid="rating-delta">
                    {block.delta >= 0 ? `+${block.delta}` : block.delta}
                  </span>
                  <span className="pixel rounded px-1 text-[9px] text-slate-950" style={{ background: tierColor(block.profile_after.tier) }}>
                    T{block.profile_after.tier}
                  </span>
                  <span className="text-yellow-300">{block.profile_after.rating}</span>
                </span>
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-400">{t("result.reason.aborted")}</p>
          )}
        </section>

        <section className="panel p-4">
          <h2 className="pixel mb-3 text-[10px] text-slate-400">{t("result.stats")}</h2>
          <div className="grid grid-cols-3 gap-2 text-center">
            {statRows.map(([k, v]) => (
              <div key={k} className="rounded bg-slate-900 p-2">
                <div className="pixel text-[10px] text-white">{v}</div>
                <div className="mt-1 text-[10px] text-slate-400">{t(k)}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-1 text-xs">
            {[["stat.damage_dealt", result.damage_dealt?.[side] ?? 0, result.damage_dealt?.[otherSide] ?? 0], ["stat.hits", result.hits_landed?.[side] ?? 0, result.hits_landed?.[otherSide] ?? 0], ["stat.hints", stats.hints_used ?? 0, oppStats.hints_used ?? 0]].map(([k, a, b]) => {
              const tot = Number(a) + Number(b) || 1;
              return (
                <div key={String(k)} className="flex items-center gap-2">
                  <span className="w-24 text-slate-400">{t(String(k))}</span>
                  <div className="flex h-2 flex-1 overflow-hidden rounded bg-slate-900">
                    <div className="bg-blue-500" style={{ width: `${(Number(a) / tot) * 100}%` }} />
                    <div className="bg-purple-500" style={{ width: `${(Number(b) / tot) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {rewards && (rewards.ap > 0 || rewards.unlocked.length > 0 || rewards.achievements.length > 0) && (
        <section className="panel p-4" data-testid="rewards">
          <h2 className="pixel mb-3 text-[10px] text-slate-400">{t("result.rewards")}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              {rewards.lines.map((l) => (
                <div key={l.key} className="flex justify-between text-sm">
                  <span>{t(`ap.${l.key}`)}</span>
                  <span className="text-yellow-300">+{l.ap}</span>
                </div>
              ))}
              <div className="mt-1 flex justify-between border-t border-slate-700 pt-1 font-bold">
                <span>{t("result.ap")}</span>
                <span className="text-yellow-300">+{rewards.ap}</span>
              </div>
            </div>
            <div className="space-y-2">
              {rewards.achievements.map((a) => (
                <div key={a} className="stamp rounded bg-purple-900/50 px-2 py-1 text-sm">
                  🏅 {t(`ach.${a}`)}
                </div>
              ))}
              {rewards.unlocked.map((id) => {
                const s = id.startsWith("card.") ? cardSkin(id) : avatarSkin(id);
                return (
                  <div key={id} className="stamp flex items-center gap-2 rounded bg-yellow-900/40 px-2 py-1 text-sm">
                    ✨ {t("result.unlocked")} <strong>{s.name}</strong>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      <div className="flex flex-wrap justify-center gap-2">
        <button className="btn btn-primary" onClick={() => void rematch()} title={t("result.rematch_decay")}>
          {t("result.rematch")}
        </button>
        <button className="btn btn-ghost" onClick={() => navigate("/lobby")} data-testid="back-to-lobby">
          {t("result.back")}
        </button>
        <button className="btn btn-ghost" onClick={() => navigate(`/replay/${params.id}`)}>
          {t("result.replay")}
        </button>
        <button className="btn btn-ghost" onClick={() => shareCard(t(`result.${label}`), block?.delta ?? null, block?.profile_after.tier ?? 1, block?.profile_after.rating ?? 0)}>
          {t("result.share")}
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => {
            const reason = window.prompt("What happened?");
            if (reason && reason.length >= 3) void api("/reports", { body: { match_id: params.id, reason } }).catch(() => {});
          }}
        >
          {t("result.report")}
        </button>
      </div>
      {mode === "ranked" && <p className="text-center text-xs text-slate-500">{t("result.rematch_decay")}</p>}
      {rematchErr && <p className="text-center text-sm text-red-300">{rematchErr}</p>}
    </div>
  );
}
