import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArenaView, NO_EVENTS, type ArenaHandle } from "../features/battle/ArenaView";
import { CardView } from "../features/hand/CardView";
import { dummyState, fakeAttack, fakeBackfire } from "../features/locker/fake";
import { ArenaThumb } from "../features/battle/ArenaThumb";
import { BeanPreview, WEAPON_ICON } from "../features/profile/kit";
import { music } from "../audio/music";
import { trackFor } from "../audio/tracks";
import { t } from "../i18n";
import { cmdId, TIER_TITLES } from "../lib/format";
import { api, ApiError, loadMe } from "../net/api";
import { allSkins, onRegistry, RARITY_COLORS, type Skin, type WeaponSkin } from "../skins/registry";
import { LEVEL_KEYS, LEVEL_STYLE } from "../features/hand/CardView";
import { useAuth } from "../state/auth";

interface Owned {
  id: string;
  kind: string;
  owned: boolean;
  unlock: { type: string; tier?: number; price?: number; id?: string; label?: string; map?: string };
  progress: { value: number; target: number } | null;
}

function unlockHint(o: Owned): string {
  const u = o.unlock;
  if (u.type === "tier") return t("locker.unlock.tier", { title: TIER_TITLES[(u.tier ?? 1) - 1] });
  if (u.type === "ap") return t("locker.unlock.ap", { price: (u.price ?? 0).toLocaleString("en-US") });
  if (u.type === "achievement") return t("locker.unlock.achievement", { name: u.label ?? u.id ?? "", progress: o.progress ? `${o.progress.value} of ${o.progress.target}` : "" });
  if (u.type === "admin") return t("locker.unlock.admin");
  return u.map ? t("locker.default_for_map", { map: t(`map.${u.map}`) }) : t("locker.unlock.default");
}

function WeaponPanel({ w, shown, onPreview }: { w: WeaponSkin; shown: number | null; onPreview: (level: number) => void }) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-300">{w.description}</p>
      <p className="text-xs text-slate-500">{t("locker.weapon_help")}</p>
      <div className="grid grid-cols-2 gap-2">
        {LEVEL_KEYS.map((k, i) => (
          <button
            key={k}
            onClick={() => onPreview(i)}
            className={`flex flex-col items-start rounded-lg border-2 px-2 py-1.5 text-left ${shown === i ? "border-white bg-slate-700" : "border-slate-700 bg-slate-800 hover:border-slate-500"}`}
            data-testid={`preview-level-${i}`}
            aria-label={t("locker.preview_level", { level: t(`level.${k}`) })}
          >
            <span className={`pixel rounded px-1 py-0.5 text-[7px] ${LEVEL_STYLE[i]}`}>{t(`level.${k}`).toUpperCase()}</span>
            <span className="mt-1 text-sm font-bold">{w.levels[k]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Locker() {
  const qc = useQueryClient();
  const profile = useAuth((s) => s.profile);
  const [, setReg] = useState(0);
  useEffect(() => onRegistry(() => setReg((x) => x + 1)), []);
  const { data } = useQuery({ queryKey: ["skins"], queryFn: () => api<{ points: number; equipped: Record<string, string | null>; skins: Owned[] }>("/skins") });
  const [tab, setTab] = useState<"card" | "avatar" | "arena" | "weapon">("card");
  const [shown, setShown] = useState<number | null>(null);
  const [sel, setSel] = useState<string>("card.classic");
  const [err, setErr] = useState<string | null>(null);
  const arena = useRef<ArenaHandle | null>(null);
  const manifests = useMemo(() => new Map(allSkins().map((s) => [s.id, s])), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = (data?.skins ?? []).filter((s) => s.kind === tab);
  const selected = data?.skins.find((s) => s.id === sel) ?? list[0];
  const manifest = selected ? (manifests.get(selected.id) as Skin | undefined) : undefined;
  const equipped = data?.equipped ?? {};
  const previewState = useMemo(
    () =>
      dummyState({
        cardSkin: tab === "card" ? selected?.id : (equipped.card ?? undefined),
        avatar: tab === "avatar" ? selected?.id : (equipped.avatar ?? undefined),
        arena: tab === "arena" ? selected?.id : undefined,
        weapon: tab === "weapon" ? selected?.id : (equipped.weapon ?? undefined),
      }),
    [tab, selected?.id, equipped.card, equipped.avatar, equipped.weapon],
  );

  const equip = async () => {
    setErr(null);
    try {
      await api("/skins/equip", { body: { kind: tab, skin_id: selected!.id } });
      await qc.invalidateQueries({ queryKey: ["skins"] });
      await loadMe();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    }
  };
  const buy = async () => {
    setErr(null);
    try {
      await api(`/skins/${selected!.id}/buy`, { body: { idempotency_key: cmdId() } });
      await qc.invalidateQueries({ queryKey: ["skins"] });
      await loadMe();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    }
  };
  // Arenas play their own track while you browse them; everything else gets the lounge.
  useEffect(() => {
    music.setIntensity(1);
    music.play(tab === "arena" && manifest?.kind === "arena" ? trackFor(manifest.music).id : "menu");
  }, [tab, manifest]);
  /** The selected weapon's misfire on the dummy: it turns round and hits its owner. */
  const previewMisfire = () => {
    const h = arena.current;
    if (!h) return;
    h.director.skipAll();
    h.engine.clearEffects();
    const level = shown ?? 1;
    h.director.play(fakeBackfire(1, [1200, 3500, 6000, 12000][level], ["light", "heavy", "massive", "nuke"][level], 28000 - [1200, 3500, 6000, 12000][level], level));
  };
  const testFire = () => arena.current?.director.play(fakeAttack({ attacker: 1, damage: 18000, cls: "heavy", crit: false, defenderHp: 10000 }));
  /** Play one difficulty form of the selected weapon on the dummy (never sent anywhere). */
  const previewLevel = (level: number) => {
    const h = arena.current;
    if (!h) return;
    h.director.skipAll();
    h.engine.clearEffects();
    const dmg = [2400, 7000, 12500, 24000][level];
    setShown(level);
    h.director.play(fakeAttack({ attacker: 1, damage: dmg, cls: ["light", "heavy", "massive", "nuke"][level], crit: false, defenderHp: 28000 - dmg, level }));
  };

  return (
    <div className="mx-auto grid max-w-6xl gap-4 p-4 lg:grid-cols-[1fr_24rem]">
      <section className="panel p-4">
        <div className="mb-3 flex items-center gap-2">
          {(["card", "weapon", "avatar", "arena"] as const).map((k) => (
            <button
              key={k}
              onClick={() => {
                setTab(k);
                setShown(null);
                const first = (data?.skins ?? []).find((x) => x.kind === k);
                if (first) setSel(k === "weapon" ? (equipped.weapon ?? first.id) : first.id);
              }}
              className={`rounded px-3 py-1.5 text-sm ${tab === k ? "bg-slate-600" : "bg-slate-800 text-slate-400"}`}
              data-testid={`tab-${k}`}
            >
              {t(`locker.${k === "card" ? "cards" : k === "avatar" ? "avatars" : k === "weapon" ? "weapons" : "arenas"}`)}
            </button>
          ))}
          <span className="pixel ml-auto text-[10px] text-yellow-300">{data?.points ?? profile?.points ?? 0} AP</span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {list.map((o) => {
            const m = manifests.get(o.id) as Skin | undefined;
            const isEq = Object.values(equipped).includes(o.id) || (tab === "arena" && !equipped.arena && o.unlock.type === "default" && false);
            return (
              <button
                key={o.id}
                onClick={() => setSel(o.id)}
                className={`relative rounded-xl border-2 p-3 text-left ${sel === o.id ? "ring-2 ring-white" : ""} ${o.owned ? "" : "opacity-70"}`}
                style={{ borderColor: RARITY_COLORS[m?.rarity ?? "common"] }}
                data-testid={`skin-${o.id}`}
              >
                {m?.kind === "weapon" ? (
                  <div className="flex h-12 w-full items-center justify-center rounded text-2xl" style={{ background: `linear-gradient(120deg, ${m.palette.ramp[3]}, ${m.palette.ramp[1]})` }} aria-hidden>
                    {WEAPON_ICON[m.style] ?? "✦"}
                  </div>
                ) : m?.kind === "arena" ? (
                  <div className="h-16 w-full overflow-hidden rounded">
                    <ArenaThumb arena={m} w={192} h={108} />
                  </div>
                ) : (
                  <div className="h-12 w-full rounded" style={{ background: m?.kind === "card" ? `linear-gradient(160deg, ${m.palette.bg[0]}, ${m.palette.bg[1]})` : profile?.avatar_color }} />
                )}
                <div className="mt-2 truncate text-sm font-bold">{m?.name ?? o.id}</div>
                <div className="text-[10px] uppercase" style={{ color: RARITY_COLORS[m?.rarity ?? "common"] }}>
                  {m?.rarity}
                </div>
                {!o.owned && <div className="mt-1 text-[10px] text-slate-400">🔒 {unlockHint(o)}</div>}
                {isEq && <span className="absolute right-2 top-2 rounded bg-green-600 px-1 text-[9px]">{t("locker.equipped")}</span>}
              </button>
            );
          })}
        </div>
      </section>
      <section className="panel space-y-3 p-4">
        <h2 className="text-lg font-bold">{manifest?.name}</h2>
        <div className="relative h-56 overflow-hidden rounded-xl border border-slate-700">
          <ArenaView
            key={`${tab}:${selected?.id}`}
            state={previewState}
            subscribe={NO_EVENTS}
            onReady={(h) => {
              arena.current = h;
              if (tab === "weapon") window.setTimeout(() => !h.director.busy && previewLevel(1), 500); // unless you already asked for something
            }}
            showHud={false}
          />
          {selected && !selected.owned && <div className="pixel pointer-events-none absolute inset-0 flex items-center justify-center text-lg text-white/40">{t("locker.locked")}</div>}
        </div>
        {tab === "card" && selected && (
          <div className="flex h-36">
            <CardView card={{ slot: 0, tier: 4, pending: false, problem: { slug: "max-xor-pair", title: "Max XOR Pair", tier: 4, biome: "bit", tags: [] }, preview: { damage: 39200, recoil: 8400, tier_diff: -2, scenario: "ambitious", crit: true, dmg_pct: 140, recoil_pct: 60 } }} skinId={selected.id} playerTier={2} myHp={28000} oppHp={28000} oppShield={false} hasDraft={false} index={0} onOpen={() => {}} />
          </div>
        )}
        {tab === "weapon" && manifest?.kind === "weapon" && (
          <>
            <WeaponPanel w={manifest} shown={shown} onPreview={previewLevel} />
            <button className="btn btn-ghost w-full !min-h-9 text-xs" onClick={previewMisfire} data-testid="preview-misfire">
              {t("locker.misfire_preview")}
            </button>
          </>
        )}
        {tab === "arena" && manifest?.kind === "arena" && (
          <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm" data-testid="arena-track">
            <span aria-hidden>♪</span>
            <span className="flex-1">
              <span className="font-bold">{trackFor(manifest.music).name}</span>
              <span className="ml-2 text-xs text-slate-400">{trackFor(manifest.music).mood}</span>
            </span>
          </div>
        )}
        {tab === "avatar" && selected && (
          <div className="flex justify-center">
            <BeanPreview id={selected.id} color={profile?.avatar_color ?? "#3b82f6"} />
          </div>
        )}
        {selected && !selected.owned && <p className="text-sm text-slate-400">{unlockHint(selected)}</p>}
        {err && <p className="text-sm text-red-300">{err}</p>}
        <div className="flex flex-wrap gap-2">
          {tab !== "weapon" && (
            <button className="btn btn-ghost" onClick={testFire} data-testid="test-fire">
              {t("locker.test_fire")}
            </button>
          )}
          {selected?.owned ? (
            <button className="btn btn-primary" onClick={() => void equip()} data-testid="equip">
              {t("locker.equip")}
            </button>
          ) : selected?.unlock.type === "ap" ? (
            <button className="btn btn-primary" onClick={() => void buy()} disabled={(data?.points ?? 0) < (selected.unlock.price ?? 0)}>
              {t("locker.buy", { price: (selected.unlock.price ?? 0).toLocaleString("en-US") })}
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
