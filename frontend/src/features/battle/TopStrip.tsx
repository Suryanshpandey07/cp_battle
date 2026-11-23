import { useEffect, useState } from "react";
import { t } from "../../i18n";
import { mmss } from "../../lib/format";
import { clockAt, type BattleState } from "../../state/battle.reducer";
import { serverNow, useBattle } from "../../state/battle.store";
import { useSettings } from "../../state/settings";
import { sfx } from "../../audio/sfx";
import { SandboxBadge } from "../../app/App";

const BRACKETS: [string, number][] = [
  ["blitz", 900_000],
  ["fast", 1_800_000],
  ["standard", 3_600_000],
];

export function useMatchClock(state: BattleState): number {
  const [, setN] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setN((x) => x + 1), 250);
    return () => window.clearInterval(id);
  }, []);
  return clockAt(state, serverNow());
}

export function TopStrip({ state, onFlee }: { state: BattleState; onFlee: () => void }) {
  const elapsed = useMatchClock(state);
  const ping = useBattle((s) => s.pingMs);
  const { s, set } = useSettings();
  const next = BRACKETS.find(([, max]) => elapsed <= max);
  const bracket = next ? next[0] : "methodical";
  const toNext = next ? next[1] - elapsed : 0;
  const lastTen = next && toNext <= 10_000 && toNext > 0;
  useEffect(() => {
    if (lastTen && state.status === "live") sfx.countdown();
  }, [lastTen, Math.ceil(toNext / 1000), state.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const mapKey = `map.${state.map}`;
  return (
    <div className="z-20 flex flex-wrap items-center justify-between gap-2 border-b border-slate-700 bg-slate-800/90 px-3 py-2 backdrop-blur">
      <div className="flex items-center gap-2">
        <span className="pixel text-[10px] text-green-400" data-testid="mode-chip">
          {t(`battle.mode.${state.mode}`)}
        </span>
        <span className="rounded bg-slate-700 px-2 py-1 text-[10px] font-bold tracking-wider text-slate-300">BIOME: {t(mapKey).toUpperCase()}</span>
        <SandboxBadge />
      </div>
      <div className="flex items-center gap-2" aria-label="Match clock">
        <span className="tabular font-mono text-sm text-white" data-testid="match-clock">
          {mmss(elapsed)}
        </span>
        <span className={`pixel rounded px-2 py-1 text-[8px] ${lastTen ? "animate-pulse bg-yellow-500 text-yellow-950" : "bg-slate-700 text-yellow-300"}`}>
          {next ? t("battle.bracket_ends", { bracket: t(`bracket.${bracket}`), time: mmss(toNext) }) : t("bracket.methodical")}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-slate-400" title="WebSocket round trip">
          Ping: {ping ?? "–"}ms
        </span>
        <button className="btn btn-ghost !min-h-8 !px-2 text-xs" onClick={() => set({ muted: !s.muted })} aria-label="Mute (M)">
          {s.muted ? "🔇" : "🔊"}
        </button>
        <button
          className="btn btn-ghost !min-h-8 !px-2 text-[10px]"
          onClick={() => set({ quality: s.quality === "high" ? "low" : s.quality === "low" ? "off" : s.quality === "off" ? "auto" : "high" })}
          aria-label="Effects quality"
        >
          FX {s.quality.toUpperCase()}
        </button>
        {(state.status === "live" || state.status === "starting") && (
          <button className="btn btn-danger !min-h-8 !px-3 text-xs" onClick={onFlee} data-testid="flee">
            {t("battle.flee")}
          </button>
        )}
      </div>
    </div>
  );
}
