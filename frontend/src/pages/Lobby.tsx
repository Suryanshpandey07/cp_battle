/**
 * Home: your arena behind a welcome banner, then the battle picker (modes and
 * maps, each map with its arena and music), your record, quests, the tier
 * ladder, achievements, recent battles, the leaderboard, your loadout and tips.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { NowPlaying } from "../app/App";
import { Link, navigate } from "../app/router";
import { music } from "../audio/music";
import { synth } from "../audio/synth";
import { trackFor } from "../audio/tracks";
import { ArenaThumb } from "../features/battle/ArenaThumb";
import { ArenaView, NO_EVENTS, type ArenaHandle } from "../features/battle/ArenaView";
import { dummyState, fakeAttack } from "../features/locker/fake";
import { AchievementGrid, Collection, FormDots, Loadout, MAP_ICON, MODE_ICON, Section, StatTile, TierLadder, timeAgo, usePlayer, usePublicConfig, WinRing } from "../features/profile/kit";
import { t } from "../i18n";
import { fmt, tierColor } from "../lib/format";
import { api, ApiError, loadMe } from "../net/api";
import { arenaSkin } from "../skins/registry";
import { useAuth, type MatchBrief, type Profile } from "../state/auth";

type Mode = "ranked" | "bot" | "practice";
const FALLBACK_MAPS = [
  { id: "bit", biomes: ["bit"], default_arena: "arena.bit", min_tier: 1 },
  { id: "binary", biomes: ["binary"], default_arena: "arena.circuit", min_tier: 1 },
  { id: "prestige", biomes: ["bit", "binary", "general"], default_arena: "arena.prestige", min_tier: 3 },
];

export function TierBadge({ tier, title }: { tier: number; title?: string }) {
  return (
    <span className="pixel rounded px-1.5 py-1 text-[9px] text-slate-950" style={{ background: tierColor(tier) }}>
      {title ?? `T${tier}`}
    </span>
  );
}

export function MatchRow({ m, showReplay = false }: { m: MatchBrief; showReplay?: boolean }) {
  const me = m.your_side;
  const opp = m.players.find((p) => p.side !== me);
  const label = me ? m.labels?.[String(me)] : null;
  const win = label === "victory" || label === "hollow_victory";
  const tone = win ? "bg-green-500/15 text-green-300 border-green-500/40" : label === "draw" ? "bg-slate-500/15 text-slate-300 border-slate-500/40" : m.status === "aborted" ? "bg-slate-700/20 text-slate-500 border-slate-600/40" : "bg-red-500/15 text-red-300 border-red-500/40";
  return (
    <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-800/70" data-testid="match-row">
      <Link to={`/result/${m.id}`} className="flex min-w-0 flex-1 items-center gap-2">
        <span className={`w-20 shrink-0 rounded border px-1.5 py-0.5 text-center text-[10px] font-bold uppercase ${tone}`}>{label ? t(`result.${label}`) : m.status === "aborted" ? t("result.aborted") : m.status}</span>
        <span className="truncate">
          {t("home.vs")} <b>{opp?.name}</b>
          {opp?.is_bot && <span className="ml-1 text-[10px] text-slate-400">BOT</span>}
        </span>
        {opp && <span className="hidden sm:inline"><TierBadge tier={opp.tier} /></span>}
      </Link>
      <span className="hidden text-xs text-slate-400 sm:inline" title={t(`map.${m.map}`)}>
        {MODE_ICON[m.mode] ?? ""} {MAP_ICON[m.map] ?? ""}
      </span>
      <span className={`w-10 text-right text-xs font-bold tabular ${m.rating_delta && m.rating_delta > 0 ? "text-green-400" : m.rating_delta && m.rating_delta < 0 ? "text-red-400" : "text-slate-500"}`}>
        {m.rating_delta !== null && m.rating_delta !== undefined ? (m.rating_delta >= 0 ? `+${m.rating_delta}` : m.rating_delta) : "–"}
      </span>
      <span className="hidden w-12 text-right text-[11px] text-slate-500 md:inline">{timeAgo(m.created_at)}</span>
      {showReplay && m.status === "finished" && (
        <Link to={`/replay/${m.id}`} className="text-xs text-cyan-300" aria-label={t("result.replay")}>
          ▶
        </Link>
      )}
    </div>
  );
}

/** Your fighter and a sparring partner on your arena; now and then a silent practice swing. */
function Hero({ p, arena, rank, onQuick, busy }: { p: Profile; arena: string; rank?: { position: number; of: number }; onQuick: () => void; busy: boolean }) {
  const handle = useRef<ArenaHandle | null>(null);
  const full = useMemo(() => {
    const d = dummyState({ cardSkin: p.equipped.card, avatar: p.equipped.avatar, arena, weapon: p.equipped.weapon });
    d.players![1] = { ...d.players![1], name: p.display_name, skins: { ...d.players![1].skins, color: p.avatar_color } };
    d.players![2] = { ...d.players![2], name: "Sparring Bot" };
    return d;
  }, [p, arena]);
  useEffect(() => {
    let n = 0;
    const id = window.setInterval(() => {
      const h = handle.current;
      if (!h || document.hidden) return;
      synth.silence(2600);
      n++;
      h.director.play(fakeAttack({ attacker: 1, damage: 1500, cls: "light", crit: false, defenderHp: 28000, level: n % 3 }));
    }, 7000);
    return () => window.clearInterval(id);
  }, []);
  const streak = p.counters?.ranked_win_streak ?? 0;
  return (
    <section className="relative min-h-[18rem] overflow-hidden rounded-2xl border border-slate-700 shadow-2xl md:min-h-[20rem]" data-testid="hero">
      <div className="absolute inset-0">
        <ArenaView state={full} subscribe={NO_EVENTS} showHud={false} stageShift={0.3} onReady={(h) => (handle.current = h)} />
      </div>
      <div className="hero-shade pointer-events-none absolute inset-0" />
      <div className="relative z-10 flex min-h-[18rem] flex-col justify-between gap-4 p-5 md:min-h-[20rem] md:p-7">
        <div>
          <div className="pixel text-[10px] text-green-300/90">{t("home.welcome")}</div>
          <h1 className="shine-text mt-2 text-3xl font-black md:text-4xl">{p.display_name}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <TierBadge tier={p.tier} title={p.tier_title} />
            <span className="pixel text-[11px] text-yellow-300" data-testid="my-rating">
              {p.rating}
            </span>
            <span className="text-xs text-slate-400">{t("home.peak", { n: p.peak_rating })}</span>
            {rank && <span className="rounded-full bg-slate-900/70 px-2 py-0.5 text-xs text-cyan-200">{t("home.rank", { n: rank.position, of: rank.of })}</span>}
            <span className="rounded-full bg-yellow-900/50 px-2 py-0.5 text-xs text-yellow-200">⭐ {fmt(p.points ?? 0)} AP</span>
            {streak >= 2 && <span className="rounded-full bg-orange-900/60 px-2 py-0.5 text-xs text-orange-200">🔥 {t("home.streak", { n: streak })}</span>}
          </div>
          <div className="mt-3 max-w-sm text-xs text-slate-300">
            HP {fmt(p.max_hp)}
            {p.next_tier && <span className="text-slate-400"> · {t("lobby.next_tier_hp", { hp: fmt(p.next_tier.max_hp) })}</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {p.active_match ? (
            <button className="btn cta !min-h-11 px-6" onClick={() => navigate(`/battle/${p.active_match}`)}>
              ⚔️ {t("lobby.resume")}
            </button>
          ) : (
            <button className="btn cta !min-h-11 px-6" onClick={onQuick} disabled={busy} data-testid="quick-battle">
              ⚔️ {t("home.quick")}
            </button>
          )}
          <Link to="/practice" className="btn btn-ghost !min-h-11 bg-slate-950/50">
            🥋 {t("home.dojo")}
          </Link>
          <Link to="/locker" className="btn btn-ghost !min-h-11 bg-slate-950/50">
            🎒 {t("nav.locker")}
          </Link>
          <span className="ml-auto hidden md:inline-flex">
            <NowPlaying testid="hero-now-playing" />
          </span>
        </div>
      </div>
    </section>
  );
}

function untilUtcMidnight(): string {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const m = Math.floor((next - now.getTime()) / 60000);
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

const TIPS = 8;

export default function Lobby() {
  const qc = useQueryClient();
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: loadMe, refetchInterval: 15000 });
  const { data: lb } = useQuery({ queryKey: ["lb", "all"], queryFn: () => api<{ rows: { rank: number; name: string; rating: number; tier: number }[]; me: { rank: number } | null }>("/leaderboard") });
  const cfg = usePublicConfig().data;
  const profile = me ?? useAuth.getState().profile;
  const { data: pub } = usePlayer(profile?.display_name);
  const stats = pub?.stats;
  const [mode, setMode] = useState<Mode>("ranked");
  const [map, setMap] = useState("bit");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [tip, setTip] = useState(() => Math.floor(Math.random() * TIPS));
  useEffect(() => {
    const id = window.setInterval(() => setTip((x) => (x + 1) % TIPS), 9000);
    return () => window.clearInterval(id);
  }, []);
  if (!profile) return <div className="p-8 text-slate-400">{t("common.loading")}</div>;
  const maps = cfg?.maps ?? FALLBACK_MAPS;
  const mapInfo = maps.find((m) => m.id === map) ?? maps[0];
  const heroArena = profile.equipped.arena ?? mapInfo?.default_arena ?? "arena.bit";

  const start = async (m: Mode = mode, mp: string = map) => {
    setErr(null);
    setBusy(true);
    try {
      if (m === "ranked") {
        await api("/queue/join", { body: { mode: "ranked", map: mp } });
        navigate("/queue");
      } else {
        const r = await api<{ match_id: string }>(m === "bot" ? "/matches/bot" : "/matches/practice", { body: { map: mp === "any" ? "bit" : mp } });
        navigate(`/battle/${r.match_id}`);
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === "conflict" && e.details.match_id) navigate(`/battle/${e.details.match_id}`);
      else setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const claim = async (id: string) => {
    await api(`/quests/${id}/claim`, { body: {} }).catch(() => {});
    void qc.invalidateQueries({ queryKey: ["me"] });
  };

  const togglePreview = (arenaId: string) => {
    const id = trackFor(arenaSkin(arenaId).music).id;
    if (preview === arenaId) {
      setPreview(null);
      music.play("menu");
    } else {
      setPreview(arenaId);
      music.play(id);
    }
  };

  const tiles: { id: Mode | "team"; label: string; note: string; icon: string }[] = [
    { id: "ranked", label: t("lobby.ranked"), note: t("home.ranked_note"), icon: "⚔️" },
    { id: "bot", label: t("lobby.bot"), note: t("home.bot_note"), icon: "🤖" },
    { id: "practice", label: t("lobby.practice"), note: t("lobby.practice_note"), icon: "🎯" },
    { id: "team", label: t("lobby.team"), note: t("lobby.soon"), icon: "👥" },
  ];
  const earned = stats?.achievements.filter((a) => a.earned).length ?? 0;
  const nextAch = stats?.achievements.filter((a) => !a.earned && a.target && a.progress !== null).sort((a, b) => (b.progress ?? 0) / (b.target ?? 1) - (a.progress ?? 0) / (a.target ?? 1))[0];

  return (
    <div className="page-bg min-h-full">
      <div className="mx-auto max-w-7xl space-y-4 p-4" data-testid="home">
        <Hero p={profile} arena={heroArena} rank={stats?.rank} onQuick={() => void start("ranked", "any")} busy={busy} />

        <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
          {/* the battle picker */}
          <Section title={t("home.choose")} icon="🗺️" testid="battle-picker">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {tiles.map((tile) => (
                <button key={tile.id} disabled={tile.id === "team"} onClick={() => tile.id !== "team" && setMode(tile.id)} className="mode-tile disabled:opacity-40" aria-pressed={mode === tile.id} data-testid={`mode-${tile.id}`}>
                  <div className="text-2xl" aria-hidden>
                    {tile.icon}
                  </div>
                  <div className="mt-1 font-bold">{tile.label}</div>
                  <div className="mt-1 text-[11px] leading-snug text-slate-400">{tile.note}</div>
                </button>
              ))}
            </div>
            <h3 className="pixel mb-2 mt-5 text-[10px] text-slate-400">{t("lobby.map")}</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              {maps.map((m) => {
                const locked = profile.tier < m.min_tier;
                const arena = arenaSkin(m.default_arena);
                const rec = stats?.by_map[m.id];
                const track = trackFor(arena.music);
                return (
                  <div key={m.id} className="relative">
                    <button disabled={locked} onClick={() => setMap(m.id)} className="map-card block w-full disabled:opacity-50" aria-pressed={map === m.id} title={locked ? t("map.locked", { tier: m.min_tier }) : ""} data-testid={`map-${m.id}`}>
                      <div className="h-28">
                        <ArenaThumb arena={arena} w={320} h={112} />
                      </div>
                      <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-t from-slate-950/90 via-slate-950/20 to-transparent" />
                      <div className="absolute left-3 top-[4.6rem] text-sm font-bold text-white drop-shadow">
                        {MAP_ICON[m.id]} {t(`map.${m.id}`)} {locked && "🔒"}
                      </div>
                      <div className="space-y-1 bg-slate-950/70 p-2.5 text-[11px] text-slate-400">
                        <div className="flex flex-wrap gap-1">
                          {m.biomes.map((b) => (
                            <span key={b} className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">
                              {t(`biome.${b}`)}
                            </span>
                          ))}
                          {m.min_tier > 1 && <span className="rounded bg-slate-800 px-1.5 py-0.5">T{m.min_tier}+</span>}
                        </div>
                        <div className="flex justify-between">
                          <span>{arena.name}</span>
                          <span>{rec ? `${rec.wins}W ${rec.losses}L` : t("home.unplayed")}</span>
                        </div>
                      </div>
                    </button>
                    <button className="absolute right-2 top-2 rounded-full bg-slate-950/80 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800" onClick={() => togglePreview(m.default_arena)} title={t("home.preview_music", { name: track.name })} data-testid={`preview-${m.id}`}>
                      {preview === m.default_arena ? "■" : "▶"} ♪ {track.name}
                    </button>
                  </div>
                );
              })}
            </div>
            {mode === "ranked" && (
              <button onClick={() => setMap("any")} className={`mt-2 rounded-lg border-2 px-3 py-1.5 text-xs ${map === "any" ? "border-cyan-400 bg-cyan-900/30" : "border-slate-600"}`} data-testid="map-any">
                🎲 {t("map.any")}
              </button>
            )}
            {err && <div className="mt-3 rounded bg-red-950 px-3 py-2 text-sm text-red-300">{err}</div>}
            <button className="btn btn-primary mt-4 w-full !min-h-12 text-base" disabled={busy} onClick={() => void start()} data-testid="start">
              {mode === "ranked" ? t("lobby.queue") : mode === "bot" ? t("lobby.fight_bot") : t("lobby.start_practice")}
            </button>
          </Section>

          {/* your record */}
          <Section title={t("home.record")} icon="📊" testid="record">
            <div className="flex items-center gap-4">
              <div className="shrink-0">
                <WinRing wins={profile.wins} losses={profile.losses} draws={profile.draws} size={110} />
              </div>
              <div className="min-w-0 space-y-2 text-sm">
                <div>
                  <span className="font-black text-green-400">{profile.wins}</span> W · <span className="font-black text-red-400">{profile.losses}</span> L · <span className="font-black text-slate-300">{profile.draws}</span> D
                </div>
                <FormDots form={(stats?.form ?? []).slice(-6)} />
                {stats?.streak.kind && <div className="text-xs text-slate-400">{t(stats.streak.kind === "W" ? "home.win_run" : "home.loss_run", { n: stats.streak.count })}</div>}
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <StatTile icon="🎮" label={t("stats.played")} value={stats?.played ?? 0} />
              <StatTile icon="🔥" label={t("stats.best_streak")} value={stats?.best_win_streak ?? 0} color="#fdba74" />
              <StatTile icon="💀" label={t("stats.ko_wins")} value={stats?.ko_wins ?? 0} color="#fca5a5" />
              <StatTile icon="💥" label={t("stat.damage_dealt")} value={fmt(stats?.damage_dealt ?? 0)} color="#fde047" />
            </div>
            <Link to={`/profile/${profile.display_name}`} className="mt-3 block text-right text-xs text-cyan-300">
              {t("home.full_profile")} →
            </Link>
          </Section>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Section title={t("lobby.quests")} icon="📜" action={<span className="text-[10px] text-slate-500">{t("home.resets", { t: untilUtcMidnight() })}</span>}>
            {(profile.quests ?? []).length === 0 && <p className="text-sm text-slate-500">{t("home.no_quests")}</p>}
            {(profile.quests ?? []).map((q) => (
              <div key={q.id} className="mb-3 text-sm">
                <div className="flex justify-between gap-2">
                  <span>{t(`quest.${q.id}`)}</span>
                  <span className="text-yellow-300">{q.ap} AP</span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-2 flex-1 rounded bg-slate-900">
                    <div className="h-2 rounded bg-gradient-to-r from-yellow-500 to-amber-300" style={{ width: `${Math.min(100, (q.progress / q.target) * 100)}%` }} />
                  </div>
                  <span className="w-10 text-right text-[11px] tabular text-slate-400">
                    {Math.min(q.progress, q.target)}/{q.target}
                  </span>
                  {q.complete && !q.claimed && (
                    <button className="rounded bg-yellow-500 px-2 text-xs font-bold text-yellow-950" onClick={() => void claim(q.id)}>
                      {t("lobby.claim")}
                    </button>
                  )}
                  {q.claimed && <span className="text-xs text-slate-500">✓</span>}
                </div>
              </div>
            ))}
          </Section>
          <Section title={t("home.ladder")} icon="🪜">
            <TierLadder rating={profile.rating} tiers={cfg?.tiers ?? []} />
          </Section>
          <Section title={t("home.achievements")} icon="🏅" action={<span className="text-xs text-amber-300">{earned}/{stats?.achievements.length ?? 10}</span>}>
            {stats && <AchievementGrid items={stats.achievements} compact />}
            {nextAch && (
              <p className="mt-3 text-xs text-slate-400">
                {t("home.next_ach", { name: t(`ach.${nextAch.id}`), n: nextAch.progress ?? 0, of: nextAch.target ?? 0 })}
              </p>
            )}
          </Section>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
          <Section title={t("lobby.recent")} icon="⚔️" testid="recent">
            {(profile.recent_matches ?? []).length === 0 ? <p className="text-sm text-slate-500">{t("lobby.no_recent")}</p> : profile.recent_matches!.map((m) => <MatchRow key={m.id} m={m} showReplay />)}
          </Section>
          <Section title={t("lobby.top5")} icon="🏆" action={<Link to="/leaderboard" className="text-xs text-cyan-300">{t("nav.leaderboard")} →</Link>}>
            {(lb?.rows ?? []).slice(0, 5).map((r) => (
              <div key={r.rank} className={`flex items-center justify-between rounded-lg px-2 py-1.5 text-sm ${r.name === profile.display_name ? "bg-green-900/30" : ""}`}>
                <span className="flex items-center gap-2">
                  <span className="w-6 text-center">{["🥇", "🥈", "🥉"][r.rank - 1] ?? `#${r.rank}`}</span>
                  <Link to={`/profile/${r.name}`} className="hover:underline">
                    {r.name}
                  </Link>
                </span>
                <span className="flex items-center gap-1">
                  <TierBadge tier={r.tier} /> <span className="text-yellow-300">{r.rating}</span>
                </span>
              </div>
            ))}
            {lb?.me && lb.me.rank > 5 && <div className="mt-2 border-t border-slate-700 pt-2 text-xs text-slate-400">{t("home.you_are", { n: lb.me.rank })}</div>}
          </Section>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
          <Section title={t("home.loadout")} icon="🎒" action={<Link to="/locker" className="text-xs text-cyan-300">{t("home.change")} →</Link>}>
            <Loadout equipped={profile.equipped} color={profile.avatar_color} />
            {stats && (
              <div className="mt-4">
                <Collection collection={stats.collection} />
              </div>
            )}
          </Section>
          <div className="space-y-4">
            <Section title={t("home.tip")} icon="💡">
              <p className="min-h-[3.5rem] text-sm text-slate-300" data-testid="tip">
                {t(`tip.${tip}`)}
              </p>
            </Section>
            <Section title={t("home.whats_new")} icon="✨">
              <ul className="space-y-1.5 text-sm text-slate-300">
                {["music", "arenas", "misfire", "moves", "cpp"].map((k) => (
                  <li key={k} className="flex gap-2">
                    <span className="text-green-400">▸</span>
                    {t(`new.${k}`)}
                  </li>
                ))}
              </ul>
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}
