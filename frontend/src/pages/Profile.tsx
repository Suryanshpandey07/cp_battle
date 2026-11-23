/**
 * A player's profile: their arena as a banner with their fighter, the numbers
 * that matter, the rating chart, activity, maps, problems solved, achievements,
 * loadout, collection and match history.
 */
import { useMemo } from "react";
import { trackFor } from "../audio/tracks";
import { ArenaView, NO_EVENTS } from "../features/battle/ArenaView";
import { dummyState } from "../features/locker/fake";
import { AchievementGrid, BeanPreview, Collection, fmtSolve, FormDots, Heatmap, Loadout, MapRecord, MODE_ICON, RatingChart, Section, StatTile, usePlayer, usePublicConfig, WinRing } from "../features/profile/kit";
import { t } from "../i18n";
import { fmt, mmss, tierColor } from "../lib/format";
import { ApiError } from "../net/api";
import { arenaSkin } from "../skins/registry";
import { MatchRow, TierBadge } from "./Lobby";

function Bars({ data, color }: { data: [string, number][]; color: string }) {
  const max = Math.max(1, ...data.map(([, v]) => v));
  if (!data.length) return <p className="text-xs text-slate-500">{t("stats.nothing_yet")}</p>;
  return (
    <div className="space-y-1.5">
      {data.map(([k, v]) => (
        <div key={k} className="flex items-center gap-2 text-xs">
          <span className="w-24 truncate text-slate-400">{k}</span>
          <div className="h-2 flex-1 rounded bg-slate-900">
            <div className="h-2 rounded" style={{ width: `${(100 * v) / max}%`, background: color }} />
          </div>
          <span className="w-8 text-right tabular text-slate-300">{v}</span>
        </div>
      ))}
    </div>
  );
}

export default function Profile({ params }: { params: { username: string } }) {
  const { data, error } = usePlayer(params.username);
  const cfg = usePublicConfig().data;
  const banner = useMemo(() => {
    if (!data) return null;
    const d = dummyState({ cardSkin: data.equipped.card, avatar: data.equipped.avatar, arena: data.equipped.arena ?? "arena.bit", weapon: data.equipped.weapon });
    d.players![1] = { ...d.players![1], name: data.display_name, skins: { ...d.players![1].skins, color: data.avatar_color } };
    return d;
  }, [data]);
  if (error) return <div className="p-8 text-red-300">{error instanceof ApiError ? error.message : String(error)}</div>;
  if (!data || !banner) return <div className="p-8 text-slate-400">{t("common.loading")}</div>;
  const s = data.stats;
  const acc = data.accuracy.judged ? Math.round((100 * data.accuracy.accepted) / data.accuracy.judged) : 0;
  const arena = arenaSkin(data.equipped.arena ?? "arena.bit");
  const since = new Date(s.member_since).toLocaleDateString("en-US", { month: "short", year: "numeric" });
  const langs = Object.entries(s.submissions.by_language).map(([k, v]) => [k === "cpp" ? "C++" : k === "python" ? "Python" : k, v] as [string, number]);
  const biomes = Object.entries(s.solved.by_biome).map(([k, v]) => [t(`biome.${k}`), v] as [string, number]);
  const modes = Object.entries(s.by_mode).map(([k, v]) => [`${MODE_ICON[k] ?? ""} ${t(`mode.${k}`)}`, v] as [string, number]);

  return (
    <div className="page-bg min-h-full">
      <div className="mx-auto max-w-6xl space-y-4 p-4" data-testid="profile">
        {/* banner */}
        <section className="relative min-h-[16rem] overflow-hidden rounded-2xl border border-slate-700 shadow-2xl">
          <div className="absolute inset-0 opacity-90">
            <ArenaView state={banner} subscribe={NO_EVENTS} showHud={false} stageShift={0.32} />
          </div>
          <div className="hero-shade pointer-events-none absolute inset-0" />
          <div className="relative z-10 flex min-h-[16rem] flex-wrap items-end gap-5 p-6">
            <div className="rounded-2xl border-4 bg-slate-950/70 p-2" style={{ borderColor: tierColor(data.tier), boxShadow: `0 0 30px ${tierColor(data.tier)}66` }}>
              <BeanPreview id={data.equipped.avatar} color={data.avatar_color} size={96} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="pixel text-[10px]" style={{ color: tierColor(data.tier) }}>
                {data.tier_title}
              </div>
              <h1 className="shine-text truncate text-3xl font-black md:text-4xl">{data.display_name}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <TierBadge tier={data.tier} title={`T${data.tier}`} />
                <span className="pixel text-[11px] text-yellow-300">{data.rating}</span>
                <span className="text-xs text-slate-400">{t("home.peak", { n: data.peak_rating })}</span>
                <span className="rounded-full bg-slate-900/70 px-2 py-0.5 text-xs text-cyan-200">{t("home.rank", { n: s.rank.position, of: s.rank.of })}</span>
                <span className="rounded-full bg-slate-900/70 px-2 py-0.5 text-xs text-slate-300">{t("profile.since", { d: since })}</span>
                <span className="rounded-full bg-slate-900/70 px-2 py-0.5 text-xs text-slate-300">
                  🏟️ {arena.name} · ♪ {trackFor(arena.music).name}
                </span>
              </div>
              {data.badges.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {data.badges.map((b) => (
                    <span key={b} className="rounded-full border border-amber-500/40 bg-amber-900/40 px-2 py-0.5 text-[11px] text-amber-200">
                      🏅 {t(`ach.${b}`)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* the numbers */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6" data-testid="profile-stats">
          <StatTile icon="🎮" label={t("stats.played")} value={s.played} sub={t("stats.wld", { w: data.wins, l: data.losses, d: data.draws })} />
          <StatTile icon="📈" label={t("stats.win_rate")} value={`${s.win_rate}%`} color="#86efac" />
          <StatTile icon="🔥" label={t("stats.best_streak")} value={s.best_win_streak} sub={s.streak.kind ? t(s.streak.kind === "W" ? "home.win_run" : "home.loss_run", { n: s.streak.count }) : undefined} color="#fdba74" />
          <StatTile icon="💀" label={t("stats.ko_wins")} value={s.ko_wins} color="#fca5a5" />
          <StatTile icon="💥" label={t("stat.damage_dealt")} value={fmt(s.damage_dealt)} sub={t("stats.hits", { n: s.hits_landed })} color="#fde047" />
          <StatTile icon="☄️" label={t("stat.biggest")} value={fmt(s.biggest_hit)} color="#fb923c" />
          <StatTile icon="⚡" label={t("stat.fastest")} value={fmtSolve(s.fastest_solve_ms)} color="#67e8f9" />
          <StatTile icon="🎯" label={t("stat.accuracy")} value={`${acc}%`} sub={t("stats.judged", { n: data.accuracy.judged })} color="#a5b4fc" />
          <StatTile icon="✨" label={t("stats.crits")} value={s.crits} color="#fde68a" />
          <StatTile icon="🛡️" label={t("stats.blocks")} value={s.blocks_absorbed} color="#5eead4" />
          <StatTile icon="💫" label={t("stats.backfires")} value={s.backfires} color="#f0abfc" />
          <StatTile icon="🧩" label={t("stats.solved")} value={`${s.solved.count}/${s.solved.of}`} sub={s.avg_match_ms ? t("stats.avg_match", { t: mmss(s.avg_match_ms) }) : undefined} color="#c4b5fd" />
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
          <Section title={t("stats.rating")} icon="📈">
            <RatingChart history={data.rating_history} tiers={cfg?.tiers} />
          </Section>
          <Section title={t("stats.results")} icon="🥊">
            <div className="flex items-center gap-4">
              <div className="shrink-0">
                <WinRing wins={data.wins} losses={data.losses} draws={data.draws} size={110} />
              </div>
              <div className="space-y-2">
                <div className="text-xs text-slate-400">{t("stats.form")}</div>
                <FormDots form={s.form.slice(-6)} />
              </div>
            </div>
            <div className="mt-4">
              <Bars data={modes} color="#38bdf8" />
            </div>
          </Section>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Section title={t("stats.activity")} icon="🗓️">
            <Heatmap activity={s.activity} since={s.since} />
          </Section>
          <Section title={t("stats.maps")} icon="🗺️">
            <MapRecord byMap={s.by_map} />
          </Section>
          <Section title={t("stats.problems")} icon="🧩">
            <Bars data={biomes} color="#a78bfa" />
            <div className="mt-4 text-[11px] uppercase tracking-wide text-slate-500">{t("stats.languages")}</div>
            <div className="mt-1.5">
              <Bars data={langs} color="#34d399" />
            </div>
          </Section>
        </div>

        <Section title={t("home.achievements")} icon="🏅" action={<span className="text-xs text-amber-300">{s.achievements.filter((a) => a.earned).length}/{s.achievements.length}</span>} testid="profile-achievements">
          <AchievementGrid items={s.achievements} />
        </Section>

        <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
          <Section title={t("home.loadout")} icon="🎒">
            <Loadout equipped={data.equipped} color={data.avatar_color} />
          </Section>
          <Section title={t("stats.collection")} icon="🗃️">
            <Collection collection={s.collection} />
          </Section>
        </div>

        <Section title={t("stats.history")} icon="📜">
          {data.matches.length === 0 ? <p className="text-sm text-slate-500">{t("lobby.no_recent")}</p> : data.matches.map((m) => <MatchRow key={m.id} m={m} showReplay />)}
        </Section>
      </div>
    </div>
  );
}
