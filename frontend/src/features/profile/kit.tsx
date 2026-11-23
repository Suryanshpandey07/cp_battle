/**
 * Pieces shared by the home page and profiles: stat tiles, the win ring, recent
 * form, the activity heatmap, the rating chart, achievements, the loadout, the
 * collection and the tier ladder. All drawn with SVG, canvas and CSS: no images.
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { trackFor } from "../../audio/tracks";
import { t } from "../../i18n";
import { fmt, mmss, tierColor } from "../../lib/format";
import { api } from "../../net/api";
import { arenaSkin, avatarSkin, cardSkin, RARITY_COLORS, weaponSkin } from "../../skins/registry";
import type { MatchBrief } from "../../state/auth";
import { renderBean } from "../../vfx/fighters";
import { ArenaThumb } from "../battle/ArenaThumb";

export const WEAPON_ICON: Record<string, string> = { fireball: "🔥", spear: "🔱", gun: "🔫", lightning: "⚡", arrows: "🏹", shuriken: "✴️", laser: "🔆", meteor: "☄️" };
export const ACH_ICON: Record<string, string> = { flawless: "💎", comeback: "🔥", one_shot: "🎯", heroic: "🦸", wall: "🧱", crit_machine: "💥", bit_master: "🧮", perfectionist: "✅", marathon: "⏳", hot_streak: "🌶️" };
export const MODE_ICON: Record<string, string> = { ranked: "⚔️", bot: "🤖", practice: "🎯", friendly: "🤝", team: "👥" };
export const MAP_ICON: Record<string, string> = { bit: "🧮", binary: "🔎", prestige: "🏛️", any: "🎲" };

// ------------------------------------------------------------------ data

export interface PlayerStats {
  played: number;
  wins: number;
  losses: number;
  draws: number;
  win_rate: number;
  streak: { kind: "W" | "L" | null; count: number };
  best_win_streak: number;
  form: ("W" | "L" | "D")[];
  ko_wins: number;
  damage_dealt: number;
  damage_taken: number;
  hits_landed: number;
  crits: number;
  backfires: number;
  blocks_absorbed: number;
  hints_used: number;
  biggest_hit: number;
  fastest_solve_ms: number | null;
  avg_match_ms: number;
  by_map: Record<string, { played: number; wins: number; losses: number }>;
  by_mode: Record<string, number>;
  activity: Record<string, number>;
  submissions: { judged: number; accepted: number; by_language: Record<string, number>; by_verdict: Record<string, number> };
  solved: { count: number; of: number; by_biome: Record<string, number>; by_tier: Record<string, number> };
  achievements: { id: string; reward: string; target: number | null; earned: boolean; earned_at: string | null; progress: number | null }[];
  collection: Record<string, { owned: number; total: number }>;
  rank: { position: number; of: number };
  member_since: string;
  since: string;
}

export interface PublicProfile {
  display_name: string;
  rating: number;
  peak_rating: number;
  tier: number;
  tier_title: string;
  max_hp: number;
  next_tier: { tier: number; title: string; min_rating: number; max_hp: number } | null;
  wins: number;
  losses: number;
  draws: number;
  badges: string[];
  avatar_color: string;
  equipped: { card: string; avatar: string; arena: string | null; weapon?: string };
  rating_history: { before: number; after: number; delta: number; at: string; match_id: string }[];
  matches: MatchBrief[];
  accuracy: { accepted: number; judged: number };
  stats: PlayerStats;
}

export function usePlayer(name: string | undefined) {
  return useQuery({ queryKey: ["profile", name], queryFn: () => api<PublicProfile>(`/profiles/${name}`), enabled: !!name, staleTime: 20_000 });
}

export interface PublicConfig {
  tiers: { tier: number; title: string; min_rating: number; max_hp: number }[];
  maps: { id: string; biomes: string[]; default_arena: string; min_tier: number }[];
}

export function usePublicConfig() {
  return useQuery<PublicConfig>({ queryKey: ["public-config"], queryFn: () => api("/config"), staleTime: 60_000 });
}

// ------------------------------------------------------------------ small pieces

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return t("time.now");
  if (s < 3600) return t("time.min", { n: Math.floor(s / 60) });
  if (s < 86400) return t("time.hour", { n: Math.floor(s / 3600) });
  return t("time.day", { n: Math.floor(s / 86400) });
}

export function Section({ title, icon, action, children, className = "", testid }: { title: string; icon?: string; action?: ReactNode; children: ReactNode; className?: string; testid?: string }) {
  return (
    <section className={`glass p-4 ${className}`} data-testid={testid}>
      <header className="mb-3 flex items-center gap-2">
        {icon && <span aria-hidden>{icon}</span>}
        <h2 className="pixel text-[10px] uppercase tracking-wider text-slate-300">{title}</h2>
        <span className="ml-auto">{action}</span>
      </header>
      {children}
    </section>
  );
}

export function StatTile({ icon, label, value, sub, color = "#e2e8f0" }: { icon: string; label: string; value: ReactNode; sub?: ReactNode; color?: string }) {
  return (
    <div className="stat-tile">
      <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
        <span aria-hidden>{icon}</span>
        {label}
      </div>
      <div className="mt-1 text-xl font-black tabular" style={{ color }}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

/** Wins, losses and draws as a ring with the win rate in the middle. */
export function WinRing({ wins, losses, draws, size = 120 }: { wins: number; losses: number; draws: number; size?: number }) {
  const total = wins + losses + draws;
  const r = 42;
  const C = 2 * Math.PI * r;
  const parts = total ? [
    { v: wins, c: "#22c55e" },
    { v: draws, c: "#94a3b8" },
    { v: losses, c: "#ef4444" },
  ] : [{ v: 1, c: "#334155" }];
  const sum = parts.reduce((a, p) => a + p.v, 0);
  let off = 0;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={`${wins} wins, ${losses} losses, ${draws} draws`}>
      <circle cx="50" cy="50" r={r} fill="none" stroke="#0f172a" strokeWidth="12" />
      {parts.map((p, i) => {
        const len = (p.v / sum) * C;
        const el = <circle key={i} cx="50" cy="50" r={r} fill="none" stroke={p.c} strokeWidth="10" strokeDasharray={`${Math.max(0, len - (total > 1 ? 1.5 : 0))} ${C}`} strokeDashoffset={-off} transform="rotate(-90 50 50)" strokeLinecap="butt" />;
        off += len;
        return el;
      })}
      <text x="50" y="49" textAnchor="middle" fontSize="20" fontWeight="900" fill="#f8fafc">
        {total ? `${Math.round((100 * wins) / total)}%` : "–"}
      </text>
      <text x="50" y="64" textAnchor="middle" fontSize="8" fill="#94a3b8">
        {t("stats.win_rate")}
      </text>
    </svg>
  );
}

export function FormDots({ form }: { form: string[] }) {
  if (!form.length) return <span className="text-xs text-slate-500">{t("stats.no_form")}</span>;
  return (
    <div className="flex gap-1" aria-label={t("stats.form")}>
      {form.map((r, i) => (
        <span key={i} className={`flex h-6 w-6 items-center justify-center rounded text-[10px] font-black ${r === "W" ? "bg-green-500/90 text-green-950" : r === "L" ? "bg-red-500/90 text-red-950" : "bg-slate-500 text-slate-950"}`}>
          {r}
        </span>
      ))}
    </div>
  );
}

/** Twelve weeks of battles, a square a day. */
export function Heatmap({ activity, since }: { activity: Record<string, number>; since: string }) {
  const start = new Date(`${since}T00:00:00Z`);
  const days = Array.from({ length: 84 }, (_, i) => {
    const d = new Date(start.getTime() + i * 86400000);
    const key = d.toISOString().slice(0, 10);
    return { key, n: activity[key] ?? 0 };
  });
  const max = Math.max(1, ...days.map((d) => d.n));
  const total = days.reduce((a, d) => a + d.n, 0);
  const shade = (n: number) => (n === 0 ? "#1e293b" : ["#14532d", "#15803d", "#22c55e", "#86efac"][Math.min(3, Math.floor((n / max) * 3.999))]);
  return (
    <div>
      <div className="grid grid-flow-col grid-rows-7 gap-[3px]" style={{ gridAutoColumns: "minmax(0, 1fr)" }} role="img" aria-label={t("stats.activity_total", { n: total })}>
        {days.map((d) => (
          <span key={d.key} className="aspect-square rounded-[3px]" style={{ background: shade(d.n) }} title={`${d.key}: ${d.n}`} />
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
        <span>{t("stats.activity_total", { n: total })}</span>
        <span className="flex items-center gap-1">
          {t("stats.less")}
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className="h-2.5 w-2.5 rounded-[2px]" style={{ background: i === 0 ? "#1e293b" : ["#14532d", "#15803d", "#22c55e", "#86efac"][i - 1] }} />
          ))}
          {t("stats.more")}
        </span>
      </div>
    </div>
  );
}

/** Rating over time: an area chart over the tier bands, with the value under the pointer. */
export function RatingChart({ history, tiers }: { history: PublicProfile["rating_history"]; tiers?: PublicConfig["tiers"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const points = history.length ? [history[0].before, ...history.map((h) => h.after)] : [];
  if (points.length < 2) return <p className="py-10 text-center text-sm text-slate-500">{t("stats.chart_empty")}</p>;
  const W = 600;
  const H = 180;
  const lo = Math.min(...points) - 40;
  const hi = Math.max(...points) + 40;
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const xy = points.map((p, i) => [(i / (points.length - 1)) * W, y(p)] as const);
  const line = xy.map((p) => p.join(",")).join(" ");
  const bands = (tiers ?? []).map((tr, i, arr) => ({ tier: tr.tier, title: tr.title, from: tr.min_rating, to: arr[i + 1]?.min_rating ?? 99999 }));
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-44 w-full" role="img" aria-label={t("stats.rating_chart")} onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          setHover(Math.round(((e.clientX - r.left) / r.width) * (points.length - 1)));
        }}>
        <defs>
          <linearGradient id="rc-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#22c55e" stopOpacity="0.45" />
            <stop offset="1" stopColor="#22c55e" stopOpacity="0" />
          </linearGradient>
        </defs>
        {bands.filter((b) => b.to > lo && b.from < hi).map((b) => (
          <g key={b.tier}>
            <rect x={0} width={W} y={y(Math.min(hi, b.to))} height={Math.max(0, y(Math.max(lo, b.from)) - y(Math.min(hi, b.to)))} fill={tierColor(b.tier)} opacity={0.07} />
            {b.from > lo && <line x1={0} x2={W} y1={y(b.from)} y2={y(b.from)} stroke={tierColor(b.tier)} strokeDasharray="4 4" opacity={0.6} />}
            {b.from > lo && (
              <text x={W - 4} y={y(b.from) - 4} textAnchor="end" fontSize="10" fill={tierColor(b.tier)} opacity={0.9}>
                {b.title} {b.from}
              </text>
            )}
          </g>
        ))}
        <polygon points={`0,${H} ${line} ${W},${H}`} fill="url(#rc-fill)" />
        <polyline fill="none" stroke="#22c55e" strokeWidth={2.5} points={line} strokeLinejoin="round" />
        {xy.map(([x, yy], i) => (
          <circle key={i} cx={x} cy={yy} r={hover === i ? 5 : 2.5} fill={hover === i ? "#f8fafc" : "#bbf7d0"} />
        ))}
      </svg>
      {hover !== null && hover > 0 && history[hover - 1] && (
        <div className="pointer-events-none absolute right-2 top-1 rounded bg-slate-950/90 px-2 py-1 text-xs">
          <span className="font-bold">{history[hover - 1].after}</span>{" "}
          <span className={history[hover - 1].delta >= 0 ? "text-green-400" : "text-red-400"}>
            ({history[hover - 1].delta >= 0 ? "+" : ""}
            {history[hover - 1].delta})
          </span>{" "}
          <span className="text-slate-400">{timeAgo(history[hover - 1].at)}</span>
        </div>
      )}
    </div>
  );
}

export function AchievementGrid({ items, compact = false }: { items: PlayerStats["achievements"]; compact?: boolean }) {
  return (
    <div className={`grid gap-2 ${compact ? "grid-cols-5" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"}`}>
      {items.map((a) => {
        const pct = a.target && a.progress !== null ? Math.min(100, (100 * a.progress) / a.target) : a.earned ? 100 : 0;
        return (
          <div key={a.id} className={`ach ${a.earned ? "ach-on" : ""}`} title={`${t(`ach.${a.id}`)}: ${t(`achd.${a.id}`)}`} data-testid={`ach-${a.id}`}>
            <div className={`text-2xl ${a.earned ? "" : "opacity-40 grayscale"}`} aria-hidden>
              {ACH_ICON[a.id] ?? "🏅"}
            </div>
            {!compact && (
              <>
                <div className="mt-1 text-xs font-bold">{t(`ach.${a.id}`)}</div>
                <div className="text-[10px] leading-tight text-slate-400">{t(`achd.${a.id}`)}</div>
                {!a.earned && a.target && a.progress !== null && (
                  <div className="mt-1.5 h-1.5 rounded bg-slate-900">
                    <div className="h-1.5 rounded bg-amber-400" style={{ width: `${pct}%` }} />
                  </div>
                )}
                {a.earned && <div className="mt-1 text-[10px] font-bold text-amber-300">{t("stats.earned")}</div>}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function BeanPreview({ id, color, size = 128 }: { id: string; color: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const g = c.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(renderBean(avatarSkin(id), color), 0, 0, c.width, c.height);
  }, [id, color]);
  return <canvas ref={ref} width={128} height={128} className="sprite" style={{ width: size, height: size }} aria-label={avatarSkin(id).name} />;
}

/** What a player has equipped: card, weapon, fighter and arena. */
export function Loadout({ equipped, color }: { equipped: PublicProfile["equipped"]; color: string }) {
  const card = cardSkin(equipped.card);
  const weapon = weaponSkin(equipped.weapon);
  const arena = arenaSkin(equipped.arena ?? "arena.bit");
  const items = [
    { k: "card", label: t("locker.cards"), name: card.name, rarity: card.rarity, art: <div className="h-full w-full rounded" style={{ background: `linear-gradient(160deg, ${card.palette.bg[0]}, ${card.palette.bg[1]})`, boxShadow: `inset 0 0 0 2px ${card.palette.border}` }} /> },
    { k: "weapon", label: t("locker.weapons"), name: weapon.name, rarity: weapon.rarity, art: <div className="flex h-full w-full items-center justify-center rounded text-3xl" style={{ background: `radial-gradient(circle, ${weapon.palette.ramp[2]}55, ${weapon.palette.ramp[4]})` }}>{WEAPON_ICON[weapon.style] ?? "✦"}</div> },
    { k: "avatar", label: t("locker.avatars"), name: avatarSkin(equipped.avatar).name, rarity: avatarSkin(equipped.avatar).rarity, art: <div className="flex h-full w-full items-center justify-center rounded bg-slate-900"><BeanPreview id={equipped.avatar} color={color} size={56} /></div> },
    { k: "arena", label: t("locker.arenas"), name: arena.name, rarity: arena.rarity, art: <div className="h-full w-full overflow-hidden rounded"><ArenaThumb arena={arena} w={160} h={90} /></div> },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((it) => (
        <div key={it.k} className="loadout-item" style={{ borderColor: RARITY_COLORS[it.rarity] ?? "#475569" }}>
          <div className="h-16">{it.art}</div>
          <div className="mt-1.5 text-[10px] uppercase tracking-wide text-slate-500">{it.label}</div>
          <div className="truncate text-xs font-bold">{it.name}</div>
          {it.k === "arena" && <div className="truncate text-[10px] text-slate-400">♪ {trackFor(arena.music).name}</div>}
        </div>
      ))}
    </div>
  );
}

export function Collection({ collection }: { collection: PlayerStats["collection"] }) {
  const kinds: [string, string][] = [
    ["card", "🃏"],
    ["weapon", "⚔️"],
    ["avatar", "🫘"],
    ["arena", "🏟️"],
  ];
  return (
    <div className="space-y-2">
      {kinds.map(([k, icon]) => {
        const c = collection[k] ?? { owned: 0, total: 0 };
        return (
          <div key={k} className="flex items-center gap-2 text-xs">
            <span className="w-5" aria-hidden>
              {icon}
            </span>
            <span className="w-16 text-slate-400">{t(`locker.${k === "card" ? "cards" : `${k}s`}`)}</span>
            <div className="h-2 flex-1 rounded bg-slate-900">
              <div className="h-2 rounded bg-gradient-to-r from-cyan-500 to-fuchsia-500" style={{ width: `${c.total ? (100 * c.owned) / c.total : 0}%` }} />
            </div>
            <span className="w-10 text-right tabular text-slate-300">
              {c.owned}/{c.total}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function MapRecord({ byMap }: { byMap: PlayerStats["by_map"] }) {
  const maps = ["bit", "binary", "prestige"];
  return (
    <div className="space-y-2">
      {maps.map((m) => {
        const r = byMap[m] ?? { played: 0, wins: 0, losses: 0 };
        const rate = r.played ? Math.round((100 * r.wins) / r.played) : 0;
        return (
          <div key={m} className="text-xs">
            <div className="mb-1 flex justify-between">
              <span>
                {MAP_ICON[m]} {t(`map.${m}`)}
              </span>
              <span className="text-slate-400">
                {r.wins}W {r.losses}L {r.played ? `· ${rate}%` : ""}
              </span>
            </div>
            <div className="flex h-2 overflow-hidden rounded bg-slate-900">
              <div className="bg-green-500" style={{ width: `${r.played ? (100 * r.wins) / r.played : 0}%` }} />
              <div className="bg-red-500" style={{ width: `${r.played ? (100 * r.losses) / r.played : 0}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The five tiers, where you are, and how far to the next. */
export function TierLadder({ rating, tiers }: { rating: number; tiers: PublicConfig["tiers"] }) {
  if (!tiers.length) return null;
  const cur = [...tiers].reverse().find((tr) => rating >= tr.min_rating) ?? tiers[0];
  const next = tiers.find((tr) => tr.tier === cur.tier + 1);
  const pct = next ? Math.max(0, Math.min(100, ((rating - cur.min_rating) / (next.min_rating - cur.min_rating)) * 100)) : 100;
  return (
    <div>
      <div className="flex items-end gap-1.5">
        {tiers.map((tr) => {
          const on = tr.tier <= cur.tier;
          return (
            <div key={tr.tier} className="flex flex-1 flex-col items-center gap-1">
              <div className="w-full rounded-t" style={{ height: 14 + tr.tier * 10, background: on ? tierColor(tr.tier) : "#1e293b", boxShadow: tr.tier === cur.tier ? `0 0 14px ${tierColor(tr.tier)}` : undefined }} />
              <span className={`text-[9px] ${tr.tier === cur.tier ? "font-bold text-white" : "text-slate-500"}`}>{tr.title.split(" ")[0]}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 text-xs text-slate-300">
        {next ? t("stats.to_next", { n: next.min_rating - rating, tier: next.title, hp: fmt(next.max_hp) }) : t("stats.top_tier")}
      </div>
      <div className="mt-1.5 h-2 rounded bg-slate-900">
        <div className="h-2 rounded" style={{ width: `${pct}%`, background: tierColor(next?.tier ?? cur.tier) }} />
      </div>
    </div>
  );
}

export function fmtSolve(ms: number | null): string {
  return ms ? mmss(ms) : "–";
}
