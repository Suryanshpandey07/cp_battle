import { useEffect, useRef, useState } from "react";
import { t } from "../../i18n";
import { mmss } from "../../lib/format";
import type { LogLine } from "../../state/battle.reducer";

const COLORS: Record<LogLine["kind"], string> = {
  you: "text-yellow-300",
  opp: "text-cyan-300",
  hurt: "text-red-400",
  hit: "text-green-400",
  system: "text-slate-400",
};

function render(line: LogLine): string {
  const params: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(line.params)) params[k] = typeof v === "string" && /^(class|scenario|verdict|result|emote)\./.test(v) ? t(v) : v;
  return t(line.key, params);
}

/** Every line comes from a server event. Auto-scrolls, with a jump-to-latest pill. */
export function BattleLog({ lines }: { lines: LogLine[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (el && stuck) el.scrollTop = el.scrollHeight;
  }, [lines, stuck]);
  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={ref}
        data-testid="battle-log"
        onScroll={(e) => {
          const el = e.currentTarget;
          setStuck(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
        }}
        className="h-full overflow-y-auto rounded border border-slate-800 bg-slate-950 p-2 font-mono text-xs leading-relaxed"
      >
        {lines.map((l) => (
          <div key={l.id} className={`${COLORS[l.kind]} slide-in`}>
            <span className="mr-2 text-slate-600">{mmss(l.elapsedMs)}</span>
            {render(l)}
          </div>
        ))}
      </div>
      {!stuck && (
        <button className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-green-700 px-3 py-0.5 text-[10px] font-bold" onClick={() => setStuck(true)}>
          ↓ latest
        </button>
      )}
    </div>
  );
}

/** A polite live region that announces battle events for screen readers. */
export function LiveRegion({ lines }: { lines: LogLine[] }) {
  const last = lines[lines.length - 1];
  return (
    <div className="sr-only" aria-live="polite" role="status">
      {last ? render(last) : ""}
    </div>
  );
}
