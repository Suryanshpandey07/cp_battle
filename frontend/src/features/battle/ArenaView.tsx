/**
 * The arena: theme background, fighters, effects and screen canvases under a
 * DOM HUD. The canvases and HP bars live outside React state: the engine owns
 * them through refs, and React only renders the HUD frame and the chips.
 */
import { useEffect, useRef, useState } from "react";
import { sfx } from "../../audio/sfx";
import { t } from "../../i18n";
import type { ServerMessage } from "../../net/protocol.generated";
import { arenaSkin, avatarSkin, cardSkin, onRegistry, weaponLook } from "../../skins/registry";
import type { BattleState, PlayerState, Side } from "../../state/battle.reducer";
import { serverNow } from "../../state/battle.store";
import { prefersReducedMotion, useSettings } from "../../state/settings";
import { Director } from "../../vfx/director";
import { Engine, HpBarController, type Quality } from "../../vfx/engine";
import { renderBean } from "../../vfx/fighters";
import { STYLE_OF } from "../../vfx/misfire";
import { tierColor } from "../../lib/format";

/** Each player's battle cry has its own pitch, from their name (0.8..1.25). */
export function voicePitch(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 0.8 + (h % 1000) / 2222;
}

/** For previews that receive no server events. */
export const NO_EVENTS = (): (() => void) => () => undefined;

export interface ArenaHandle {
  engine: Engine;
  director: Director;
}

interface Props {
  state: BattleState;
  compact?: boolean;
  subscribe: (fn: (msg: ServerMessage, before: BattleState, after: BattleState) => void) => () => void;
  onReady?: (h: ArenaHandle) => void;
  showHud?: boolean;
  /** Move the fighters right (0..0.4) to leave room for text on the left. */
  stageShift?: number;
}

function useTick(ms: number): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setN((x) => x + 1), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return n;
}

function Chips({ p, isMe }: { p: PlayerState; isMe: boolean }) {
  useTick(250);
  const now = serverNow();
  const shieldLeft = p.shieldUntil ? Math.max(0, p.shieldUntil - now) : 0;
  const burning = p.burnUntil !== null && p.burnUntil > now;
  const chips: React.ReactNode[] = [];
  if (shieldLeft > 0) {
    const frac = shieldLeft / 20000;
    chips.push(
      <span key="sh" className="flex items-center gap-1 rounded bg-cyan-900/70 px-1.5 py-0.5 text-[10px] font-bold text-cyan-200" data-testid={`chip-shield-${p.side}`}>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
          <circle cx="6" cy="6" r="5" fill="none" stroke="#164e63" strokeWidth="2" />
          <circle cx="6" cy="6" r="5" fill="none" stroke="#67e8f9" strokeWidth="2" strokeDasharray={`${frac * 31.4} 31.4`} transform="rotate(-90 6 6)" />
        </svg>
        {t("chip.shield")} {Math.ceil(shieldLeft / 1000)}s
      </span>,
    );
  }
  if (burning) chips.push(<span key="b" className="rounded bg-orange-900/70 px-1.5 py-0.5 text-[10px] font-bold text-orange-200">🔥 {t("chip.burning")}</span>);
  if (p.judging)
    chips.push(
      <span key="j" className="flex items-center gap-1 rounded bg-blue-900/70 px-1.5 py-0.5 text-[10px] font-bold text-blue-200" data-testid={`chip-judging-${p.side}`}>
        <span className="inline-block h-2 w-2 animate-spin rounded-full border border-blue-200 border-t-transparent" />
        {t("chip.judging")}
      </span>,
    );
  else if (!isMe && p.activity === "editor") chips.push(<span key="ty" className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] font-bold text-slate-200">⌨ {t("chip.typing")}</span>);
  if (!p.connected && !p.isBot) chips.push(<span key="off" className="rounded bg-red-900/70 px-1.5 py-0.5 text-[10px] font-bold text-red-200">{t("chip.offline")}</span>);
  return <div className="flex min-h-[20px] flex-wrap gap-1">{chips}</div>;
}

function HpBox({ p, isMe, refs, compact }: { p: PlayerState; isMe: boolean; refs: React.MutableRefObject<Record<number, any>>; compact?: boolean }) {
  const set = (k: string) => (el: HTMLElement | null) => {
    refs.current[p.side] = { ...refs.current[p.side], [k]: el };
  };
  return (
    <div
      ref={set("box")}
      className={`panel ${compact ? "p-1.5" : "p-3"} ${isMe ? "rounded-bl-none" : "rounded-br-none"} w-full`}
      data-testid={isMe ? "hp-box-me" : "hp-box-opp"}
      aria-label={`${isMe ? t("battle.you") : p.name} HP`}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className={`truncate font-bold text-white ${compact ? "text-xs" : "text-base"}`}>
          {isMe ? `${p.name} (${t("battle.you")})` : p.name}
          {p.isBot && <span className="ml-2 rounded bg-slate-600 px-1 text-[9px] text-slate-100">{t("lobby.bot_label")}</span>}
        </span>
        <span className="flex items-center gap-1">
          <span className="pixel rounded px-1 py-0.5 text-[8px] text-slate-950" style={{ background: tierColor(p.tier) }}>
            T{p.tier}
          </span>
          <span className="pixel text-[9px] text-yellow-400">{p.rating}</span>
        </span>
      </div>
      <div className="hp-track">
        <div ref={set("ghost")} className="hp-ghost" />
        <div ref={set("fill")} className="hp-fill" />
        <div className="hp-ticks" />
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        {!compact ? <Chips p={p} isMe={isMe} /> : <span />}
        <span ref={set("text")} className="tabular font-mono text-xs text-slate-300" data-testid={isMe ? "hp-text-me" : "hp-text-opp"} />
      </div>
    </div>
  );
}

export function ArenaView({ state, compact, subscribe, onReady, showHud = true, stageShift = 0 }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const bg = useRef<HTMLCanvasElement>(null);
  const fx = useRef<HTMLCanvasElement>(null);
  const screen = useRef<HTMLCanvasElement>(null);
  const hpRefs = useRef<Record<number, any>>({});
  const engineRef = useRef<Engine | null>(null);
  const directorRef = useRef<Director | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const settings = useSettings((s) => s.s);
  const you = (state.you ?? 1) as Side;
  const opp = (you === 1 ? 2 : 1) as Side;

  // Create the engine once.
  useEffect(() => {
    if (!root.current || !bg.current || !fx.current || !screen.current) return;
    const e = new Engine(root.current, bg.current, fx.current, screen.current);
    engineRef.current = e;
    const ctx = {
      fx: e,
      get you() {
        return (stateRef.current.you ?? 1) as Side;
      },
      skin: (side: 1 | 2) => cardSkin(stateRef.current.players?.[side]?.skins?.card),
      weapon: (side: 1 | 2) => {
        const sk = stateRef.current.players?.[side]?.skins;
        return weaponLook(sk?.weapon, sk?.card);
      },
      setHp: (side: 1 | 2, hp: number, animate: boolean) => {
        const max = stateRef.current.players?.[side]?.maxHp ?? 1;
        e.hp[side]?.set(hp, max, performance.now(), animate && !prefersReducedMotion());
      },
      maxHp: (side: 1 | 2) => stateRef.current.players?.[side]?.maxHp ?? 1,
      reduced: () => prefersReducedMotion(),
    };
    const d = new Director(ctx as any);
    directorRef.current = d;
    let lastBeat = 0;
    e.onFrame = () => {
      d.tick();
      const st = stateRef.current;
      const me = st.players?.[(st.you ?? 1) as Side];
      const low = !!me && me.hp > 0 && me.hp / me.maxHp < 0.2 && st.status === "live";
      e.lowHpPulse = low && !prefersReducedMotion();
      if (low && performance.now() - lastBeat > 833) {
        lastBeat = performance.now();
        sfx.heartbeat();
      }
    };
    e.start();
    const ro = new ResizeObserver(() => e.resize());
    ro.observe(root.current);
    const onVis = () => {
      e.paused = document.hidden;
      if (!document.hidden) {
        d.skipAll();
        syncHp(false);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    onReady?.({ engine: e, director: d });
    return () => {
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      e.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function syncHp(animate: boolean) {
    const e = engineRef.current;
    const st = stateRef.current;
    if (!e || !st.players) return;
    for (const side of [1, 2] as Side[]) {
      const p = st.players[side];
      const els = hpRefs.current[side];
      if (!els?.fill) continue;
      if (!e.hp[side] || e.hp[side]!.els.fill !== els.fill) e.hp[side] = new HpBarController(els, p.hp, p.maxHp);
      else if (!directorRefBusy()) e.hp[side]!.set(p.hp, p.maxHp, performance.now(), animate);
    }
  }
  const directorRefBusy = () => !!directorRef.current?.busy;

  // Feed server events to the director; snap HP when nothing is animating.
  useEffect(() => {
    const off = subscribe((msg) => {
      try {
        directorRef.current?.play(msg);
      } catch (err) {
        console.warn("vfx failed", err);
      }
      if (["state.snapshot", "match.started", "match.ended"].includes(msg.type)) queueMicrotask(() => syncHp(false));
    });
    const id = window.setInterval(() => syncHp(true), 1000);
    return () => {
      off();
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe]);

  // Skins, theme, sides and settings.
  const p1 = state.players?.[1];
  const p2 = state.players?.[2];
  const [regTick, setRegTick] = useState(0);
  useEffect(() => onRegistry(() => setRegTick((x) => x + 1)), []);
  useEffect(() => {
    const e = engineRef.current;
    if (!e || !state.players) return;
    e.you = you;
    for (const side of [1, 2] as Side[]) {
      const p = state.players[side];
      const f = e.fighters[side];
      f.sprite = renderBean(avatarSkin(p.skins?.avatar), String(p.skins?.color ?? "#3b82f6"));
      f.voicePitch = voicePitch(p.name ?? String(side));
      f.style = STYLE_OF[weaponLook(p.skins?.weapon, p.skins?.card).style] ?? "throw";
      if (p.hp === 0 && state.status !== "live") f.grayscale = true;
    }
    e.setTheme(arenaSkin(state.stage?.theme));
    e.stageShift = stageShift;
    e.layout();
    e.resize();
    syncHp(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [you, p1?.skins?.avatar, p2?.skins?.avatar, p1?.skins?.weapon, p2?.skins?.weapon, p1?.name, p2?.name, state.stage?.theme, regTick, !!state.players, compact, stageShift]);

  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    const reduced = prefersReducedMotion(settings);
    e.reduced = reduced;
    e.shakeScale = settings.shake;
    e.flashScale = settings.flash;
    const q: Quality = settings.quality === "auto" ? (window.innerWidth < 700 ? "low" : e.quality) : (settings.quality as Quality);
    if (q !== e.quality || (settings.quality === "auto") !== e.autoQuality) e.setQuality(q, settings.quality === "auto");
  }, [settings]);

  const players = state.players;
  const stage = arenaSkin(state.stage?.theme);
  return (
    <div className={`relative w-full overflow-hidden ${compact ? "h-full" : "h-full min-h-[260px]"}`} style={{ background: stage.palette.sky[0] }}>
      <div ref={root} className="absolute inset-0">
        <canvas ref={bg} className="absolute inset-0" aria-hidden />
        <canvas ref={fx} className="sprite absolute inset-0" aria-hidden data-testid="vfx-canvas" />
        <canvas ref={screen} className="pointer-events-none absolute inset-0" aria-hidden />
      </div>
      {showHud && players && (
        <>
          <div className={`absolute z-10 ${compact ? "right-2 top-1 w-56" : "right-4 top-3 w-72 max-w-[45%]"}`}>
            <HpBox p={players[opp]} isMe={false} refs={hpRefs} compact={compact} />
          </div>
          <div className={`absolute z-10 ${compact ? "bottom-1 left-2 w-56" : "bottom-3 left-4 w-72 max-w-[45%]"}`}>
            <HpBox p={players[you]} isMe refs={hpRefs} compact={compact} />
          </div>
          {state.stage?.owner_name && !compact && (
            <div className="absolute bottom-2 right-3 z-10 rounded bg-black/50 px-2 py-0.5 text-[10px] text-slate-300">
              Stage: {stage.name} ({state.stage.owner_name})
            </div>
          )}
        </>
      )}
    </div>
  );
}
