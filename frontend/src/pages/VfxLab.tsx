/* /dev/vfx: trigger any show on dummy fighters. On in dev, behind the vfx_lab flag otherwise. */
import { useEffect, useMemo, useRef, useState } from "react";
import { ArenaView, NO_EVENTS, type ArenaHandle } from "../features/battle/ArenaView";
import { dummyState, fakeAttack, fakeBackfire, fakeEnded, fakeShield } from "../features/locker/fake";
import { allSkins, onRegistry } from "../skins/registry";
import { useSettings } from "../state/settings";
import { CLASSES, type DamageClass } from "../vfx/timings";

const AMOUNTS: Record<DamageClass, number> = { light: 2000, heavy: 6000, massive: 12000, nuke: 39200 };

export default function VfxLab() {
  const [, setReg] = useState(0);
  useEffect(() => onRegistry(() => setReg((x) => x + 1)), []);
  const cards = allSkins().filter((s) => s.kind === "card");
  const weapons = allSkins().filter((s) => s.kind === "weapon");
  const arenas = allSkins().filter((s) => s.kind === "arena");
  const [stage, setStage] = useState("arena.bit");
  const [skin, setSkin] = useState("card.classic");
  const [weapon, setWeapon] = useState("weapon.fireball");
  const [level, setLevel] = useState<number | "class">("class");
  const [cls, setCls] = useState<DamageClass>("heavy");
  const [crit, setCrit] = useState(false);
  const [side, setSide] = useState<1 | 2>(1);
  const [hp1, setHp1] = useState(28000);
  const [hp2, setHp2] = useState(28000);
  const [scale, setScale] = useState(1);
  const [paused, setPaused] = useState(false);
  const [stats, setStats] = useState({ fps: 0, particles: 0, quality: "high" });
  const { s, set } = useSettings();
  const arena = useRef<ArenaHandle | null>(null);
  const state = useMemo(() => dummyState({ cardSkin: skin, weapon, hp1, hp2, arena: stage }), [skin, weapon, hp1, hp2, stage]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const e = arena.current?.engine;
      if (e) setStats({ fps: Math.round(e.fps), particles: e.particles.count, quality: e.quality });
    }, 300);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    const e = arena.current?.engine;
    if (e) {
      e.timeScale = scale;
      e.paused = paused;
    }
  }, [scale, paused]);

  const play = (outcome: string) => {
    const d = arena.current?.director;
    if (!d) return;
    const def = side === 1 ? 2 : 1;
    const defHp = def === 1 ? hp1 : hp2;
    const dmg = AMOUNTS[cls];
    const lv = level === "class" ? undefined : level;
    if (outcome === "hit") d.play(fakeAttack({ attacker: side, damage: dmg, cls, crit, defenderHp: Math.max(1, defHp - dmg), level: lv }));
    if (outcome === "ko") d.play(fakeAttack({ attacker: side, damage: dmg, cls, crit, defenderHp: 0, level: lv }));
    if (outcome === "blocked") {
      d.play(fakeShield(def));
      window.setTimeout(() => d.play(fakeAttack({ attacker: side, damage: dmg, cls, crit, defenderHp: defHp, blocked: true, level: lv })), 400);
    }
    if (outcome === "backfire") d.play(fakeBackfire(side, dmg / 2, cls, Math.max(1, (side === 1 ? hp1 : hp2) - dmg / 2), lv));
    if (outcome === "selfdestruct") d.play(fakeBackfire(side, dmg / 2, cls, 0, lv));
    if (outcome === "timer") d.play(fakeEnded("timer", side));
    if (outcome === "forfeit") d.play(fakeEnded("forfeit", side));
  };

  return (
    <div className="mx-auto max-w-6xl space-y-3 p-4" data-testid="vfx-lab">
      <h1 className="pixel text-xs text-green-400">VFX LAB (dummy fighters, fake events)</h1>
      <div className="h-[55vh] overflow-hidden rounded-xl border-2 border-slate-700">
        <ArenaView key={`${skin}:${weapon}`} state={state} subscribe={NO_EVENTS} onReady={(h) => (arena.current = h)} />
      </div>
      <div className="panel grid gap-3 p-3 text-sm md:grid-cols-4">
        <label className="flex flex-col gap-1">
          Attacker skin
          <select className="rounded bg-slate-900 p-1" value={skin} onChange={(e) => setSkin(e.target.value)}>
            {cards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Weapon
          <select className="rounded bg-slate-900 p-1" value={weapon} onChange={(e) => setWeapon(e.target.value)} data-testid="lab-weapon">
            {weapons.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Arena
          <select className="rounded bg-slate-900 p-1" value={stage} onChange={(e) => setStage(e.target.value)} data-testid="lab-arena">
            {arenas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Card difficulty
          <select className="rounded bg-slate-900 p-1" value={String(level)} onChange={(e) => setLevel(e.target.value === "class" ? "class" : Number(e.target.value))} data-testid="lab-level">
            <option value="class">From damage class</option>
            {["Easy", "Normal", "Medium", "Tough"].map((n, i) => (
              <option key={n} value={i}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Damage class
          <select className="rounded bg-slate-900 p-1" value={cls} onChange={(e) => setCls(e.target.value as DamageClass)}>
            {CLASSES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={crit} onChange={(e) => setCrit(e.target.checked)} /> Crit
        </label>
        <label className="flex flex-col gap-1">
          Attacker side
          <select className="rounded bg-slate-900 p-1" value={side} onChange={(e) => setSide(Number(e.target.value) as 1 | 2)}>
            <option value={1}>You (1)</option>
            <option value={2}>Opponent (2)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          HP you: {hp1}
          <input type="range" min={1} max={28000} value={hp1} onChange={(e) => setHp1(Number(e.target.value))} />
        </label>
        <label className="flex flex-col gap-1">
          HP opponent: {hp2}
          <input type="range" min={1} max={28000} value={hp2} onChange={(e) => setHp2(Number(e.target.value))} />
        </label>
        <label className="flex flex-col gap-1">
          Time scale {scale.toFixed(1)}x
          <input type="range" min={0.1} max={2} step={0.1} value={scale} onChange={(e) => setScale(Number(e.target.value))} />
        </label>
        <div className="flex flex-col gap-1">
          Quality
          <select className="rounded bg-slate-900 p-1" value={s.quality} onChange={(e) => set({ quality: e.target.value as never })}>
            {["auto", "high", "low", "off"].map((q) => (
              <option key={q}>{q}</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={s.reducedMotion === "on"} onChange={(e) => set({ reducedMotion: e.target.checked ? "on" : "off" })} /> Reduced motion
        </label>
        <div className="flex items-center gap-2">
          <button className="btn btn-ghost !min-h-8" onClick={() => setPaused((p) => !p)}>
            {paused ? "Resume" : "Pause"}
          </button>
          <button className="btn btn-ghost !min-h-8" onClick={() => arena.current?.engine.stepOnce()} disabled={!paused}>
            Step
          </button>
        </div>
        <div className="font-mono text-xs text-slate-400" data-testid="vfx-stats">
          FPS {stats.fps} · particles {stats.particles} · {stats.quality}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {["hit", "blocked", "backfire", "ko", "selfdestruct", "timer", "forfeit"].map((o) => (
          <button key={o} className="btn btn-primary !min-h-9 text-xs" onClick={() => play(o)} data-testid={`lab-${o}`}>
            {o}
          </button>
        ))}
        <button className="btn btn-ghost !min-h-9 text-xs" onClick={() => arena.current?.director.skipAll()}>
          skip all
        </button>
      </div>
    </div>
  );
}
