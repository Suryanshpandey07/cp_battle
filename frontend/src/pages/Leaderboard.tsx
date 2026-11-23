import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "../app/router";
import { t } from "../i18n";
import { api } from "../net/api";
import { TierBadge } from "./Lobby";

interface Row {
  rank: number;
  profile_id: number;
  name: string;
  rating: number;
  tier: number;
  score: number;
  wins: number;
  losses: number;
}

export default function Leaderboard() {
  const [scope, setScope] = useState<"all" | "week">("all");
  const [map, setMap] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["lb", scope, map],
    queryFn: () => api<{ rows: Row[]; me: Row | null; metric: string }>(`/leaderboard?scope=${scope}${map ? `&map=${map}` : ""}`),
  });
  const RowView = ({ r, mine }: { r: Row; mine?: boolean }) => (
    <tr className={mine ? "bg-green-900/30" : "odd:bg-slate-800/40"}>
      <td className="px-3 py-1.5">#{r.rank}</td>
      <td className="px-3 py-1.5">
        <Link to={`/profile/${r.name}`} className="hover:underline">
          {r.name}
        </Link>
        {mine && <span className="ml-2 text-xs text-green-300">({t("leaderboard.you")})</span>}
      </td>
      <td className="px-3 py-1.5">
        <TierBadge tier={r.tier} />
      </td>
      <td className="px-3 py-1.5 text-yellow-300">{r.rating}</td>
      <td className="px-3 py-1.5">{data?.metric === "rating" ? `${r.wins}-${r.losses}` : r.score}</td>
    </tr>
  );
  return (
    <div className="mx-auto max-w-4xl p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="pixel mr-4 text-xs text-green-400">{t("leaderboard.title")}</h1>
        {(["all", "week"] as const).map((s) => (
          <button key={s} onClick={() => setScope(s)} className={`rounded px-3 py-1 text-sm ${scope === s ? "bg-slate-600" : "bg-slate-800 text-slate-400"}`}>
            {t(`leaderboard.${s}`)}
          </button>
        ))}
        <select className="rounded bg-slate-800 px-2 py-1 text-sm" value={map} onChange={(e) => setMap(e.target.value)} aria-label={t("lobby.map")}>
          <option value="">{t("map.any")}</option>
          {["bit", "binary", "prestige"].map((m) => (
            <option key={m} value={m}>
              {t(`map.${m}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="panel overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-900 text-xs text-slate-400">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Player</th>
              <th className="px-3 py-2">Tier</th>
              <th className="px-3 py-2">Rating</th>
              <th className="px-3 py-2">{data?.metric === "rating" ? "W-L" : data?.metric === "wins" ? "Wins" : "Gained"}</th>
            </tr>
          </thead>
          <tbody>
            {data?.me && <RowView r={data.me} mine />}
            {isLoading && (
              <tr>
                <td colSpan={5} className="p-4">
                  <div className="skeleton h-6 rounded" />
                </td>
              </tr>
            )}
            {data?.rows.map((r) => <RowView key={r.profile_id} r={r} mine={r.profile_id === data.me?.profile_id} />)}
          </tbody>
        </table>
        {data && data.rows.length === 0 && <p className="p-4 text-sm text-slate-500">No ranked results yet.</p>}
      </div>
    </div>
  );
}
