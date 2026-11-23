/**
 * A problem card offered as an attack. HIT and BACKFIRE are the server's exact
 * previews; the client never computes damage. Skins restyle the frame but the
 * safe area (tier gem, scenario, title, HIT and BACKFIRE plates) always shows.
 */
import { useRef, useState } from "react";
import { sfx } from "../../audio/sfx";
import { t } from "../../i18n";
import { fmt, tierColor } from "../../lib/format";
import type { Card } from "../../net/protocol.generated";
import { cardSkin, cardVars, weaponSkin } from "../../skins/registry";
import { prefersReducedMotion } from "../../state/settings";

const BIOME_ICON: Record<string, string> = { bit: "⊕", binary: "⌕", general: "◆" };
export const LEVEL_KEYS = ["easy", "normal", "medium", "tough"] as const;
export const LEVEL_STYLE = ["bg-emerald-500 text-emerald-950", "bg-sky-400 text-sky-950", "bg-amber-400 text-amber-950", "bg-red-500 text-white"];

interface Props {
  card: Card;
  skinId: string;
  playerTier: number;
  myHp: number;
  oppHp: number;
  oppShield: boolean;
  hasDraft: boolean;
  index: number;
  onOpen: () => void;
  disabled?: boolean;
  dealKey?: string | number;
  igniting?: boolean;
  weaponId?: string;
}

export function CardView({ card, skinId, playerTier, myHp, oppHp, oppShield, hasDraft, index, onOpen, disabled, dealKey, igniting, weaponId }: Props) {
  const skin = cardSkin(skinId);
  const ref = useRef<HTMLButtonElement>(null);
  const [tilt, setTilt] = useState<{ x: number; y: number; a: number } | null>(null);
  const reduced = prefersReducedMotion();
  if (card.pending || !card.problem || !card.preview) {
    return (
      <div className="card-tile skeleton flex h-full w-full items-center justify-center opacity-60" style={cardVars(skin) as React.CSSProperties} aria-label={t("card.dealing")}>
        <span className="pixel text-[9px] text-slate-400">{t("card.dealing")}</span>
      </div>
    );
  }
  const pv = card.preview;
  const level = Math.max(0, Math.min(3, card.level ?? 0));
  const levelKey = LEVEL_KEYS[level];
  const weapon = weaponSkin(weaponId);
  const levelTitle = t("card.level_title", { level: t(`level.${levelKey}`), weapon: weapon.name, form: weapon.levels[levelKey] });
  const lethalRisk = pv.recoil >= myHp && myHp > 0;
  const koChance = pv.damage >= oppHp && !oppShield && oppHp > 0;
  const holo = card.tier >= 4;
  const math = t("card.math", {
    pt: playerTier,
    qt: card.problem.tier,
    scenario: t(`scenario.${pv.scenario}`),
    dmg: (pv.dmg_pct / 100).toFixed(1),
    rec: (pv.recoil_pct / 100).toFixed(1),
  });
  const onMove = (e: React.PointerEvent) => {
    if (reduced || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    setTilt({ x: -py * 12 * (skin.hover.tilt / 12), y: px * 12 * (skin.hover.tilt / 12), a: (px + py) * 180 });
  };
  const style: React.CSSProperties = {
    ...(cardVars(skin) as React.CSSProperties),
    animationDelay: `${index * 80}ms`,
    transform: tilt ? `perspective(600px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg) translateY(-4px)` : undefined,
    ["--holo-angle" as string]: `${tilt?.a ?? 0}deg`,
  };
  return (
    <button
      ref={ref}
      key={dealKey}
      type="button"
      disabled={disabled}
      data-testid={`card-${card.slot}`}
      data-tier={card.tier}
      onClick={() => {
        sfx.click();
        onOpen();
      }}
      onPointerEnter={() => sfx.hover()}
      onPointerMove={onMove}
      onPointerLeave={() => setTilt(null)}
      title={math}
      aria-label={`${card.problem.title}, ${t(`level.${levelKey}`)}, ${t(`scenario.${pv.scenario}`)}, ${t("card.hit")} ${fmt(pv.damage)}, ${t("card.backfire")} ${fmt(pv.recoil)}. ${math}`}
      className={`card-tile group flex h-full w-full flex-col p-2.5 text-left ${skin.frame.style === "terminal" ? "card-scanlines" : ""} ${holo ? "card-holo" : ""} ${igniting ? "card-ignite" : "card-deal"}`}
      style={style}
    >
      <div className="relative z-10 flex items-start justify-between gap-1">
        <span className="safe-plate flex items-center gap-1 text-[10px] font-bold">
          <span className="inline-block h-2.5 w-2.5 rotate-45 rounded-[2px]" style={{ background: tierColor(card.tier) }} aria-hidden />
          T{card.tier} · {t(`scenario.${pv.scenario}`)}
        </span>
        <span className="flex gap-1">
          <span className={`pixel rounded px-1 py-0.5 text-[7px] ${LEVEL_STYLE[level]}`} title={levelTitle} data-testid={`card-level-${card.slot}`}>
            {t(`level.${levelKey}`).toUpperCase()}
          </span>
          {pv.crit && <span className="pixel rounded bg-yellow-400 px-1 py-0.5 text-[7px] text-yellow-950">{t("card.crit")}</span>}
          {koChance && (
            <span title={t("card.ko_chance")} aria-label={t("card.ko_chance")} className="text-sm">
              🔥
            </span>
          )}
          {lethalRisk && (
            <span title={t("card.lethal_risk")} aria-label={t("card.lethal_risk")} className="text-sm">
              💀
            </span>
          )}
          {hasDraft && <span title="draft" className="text-sm">✎</span>}
        </span>
      </div>
      <div className="relative z-10 my-auto flex items-center gap-2 py-1">
        <span className="text-lg opacity-70" aria-hidden>
          {BIOME_ICON[card.problem.biome] ?? "◆"}
        </span>
        <span className="safe-plate truncate text-sm font-bold transition-transform group-hover:scale-105 md:text-base">{card.problem.title}</span>
      </div>
      {card.problem.tags.length > 0 && <div className="relative z-10 mb-1 truncate text-[10px] text-slate-300">{card.problem.tags.join(" · ")}</div>}
      <div className="relative z-10 grid grid-cols-2 gap-1.5">
        <span className="safe-plate text-center">
          <span className="block text-[8px] text-green-300">{t("card.hit")}</span>
          <span className="pixel tabular text-[10px] text-green-200">{fmt(pv.damage)}</span>
        </span>
        <span className="safe-plate text-center">
          <span className="block text-[8px] text-red-300">{t("card.backfire")}</span>
          <span className="pixel tabular text-[10px] text-red-200">{fmt(pv.recoil)}</span>
        </span>
      </div>
      <span className="sr-only">{t("card.hit")} {kbd(index)}</span>
    </button>
  );
}

const kbd = (i: number) => `(${i + 1})`;
