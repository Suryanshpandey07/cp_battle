/**
 * The VFX director: every attack event becomes a show, a list of timed steps.
 * Shows play one at a time from a FIFO queue; the next may start when the
 * current explosion ends. If more than 3 are queued (after a reconnect, say)
 * the older ones fast-forward: their HP is applied and one combined number
 * shows. The server decides, the client performs: HP is already final in the
 * store, the show only animates the bar to it at the impact step.
 * Test hooks: director.play(event), director.skipAll() and an injectable clock.
 */
import { sfx } from "../audio/sfx";
import type { ServerMessage } from "../net/protocol.generated";
import type { CardSkin } from "../skins/registry";
import type { Engine } from "./engine";
import { Kind } from "./particles";
import { BACKFIRE_EXPLOSION, blockingLength, BURN_DELAY_MS, CRIT, INTENSITY, KO, nextClass, TIMING, type DamageClass } from "./timings";
import { MISFIRE_TRAVEL, MISFIRES, STYLE_OF, TURN, type MisfireStrike } from "./misfire";
import { DEFAULT_LOOK, LEVEL_EXTRA, levelOf, WEAPONS, type Strike, type WeaponLook } from "./weapons";

export interface Step {
  at: number;
  label: string;
  run: () => void;
  done?: boolean;
}

export interface Show {
  name: string;
  steps: Step[];
  length: number;
  finalize: () => void;
  t0?: number;
  combined?: number;
}

export interface ShowContext {
  fx: Engine;
  you: 1 | 2;
  skin: (side: 1 | 2) => CardSkin;
  setHp: (side: 1 | 2, hp: number, animate: boolean) => void;
  maxHp: (side: 1 | 2) => number;
  reduced: () => boolean;
  /** The attacker's equipped weapon. Optional: tests and old callers get the fireball. */
  weapon?: (side: 1 | 2) => WeaponLook;
}

export interface DebugEntry {
  show: string;
  step: string;
  t: number;
}

declare global {
  interface Window {
    __vfx?: { events: DebugEntry[]; director?: Director };
  }
}

const sideOf = (n: number): 1 | 2 => (n === 1 ? 1 : 2);
const other = (n: number): 1 | 2 => (n === 1 ? 2 : 1);

export class Director {
  queue: Show[] = [];
  current: Show | null = null;
  debug: DebugEntry[] = [];
  onIdle: (() => void) | null = null;

  constructor(
    public ctx: ShowContext,
    public clock: () => number = () => ctx.fx.now(),
  ) {
    if (typeof window !== "undefined") {
      window.__vfx = window.__vfx ?? { events: [] };
      window.__vfx.director = this;
      this.debug = window.__vfx.events;
    }
  }

  get busy(): boolean {
    return !!this.current || this.queue.length > 0;
  }

  enqueue(show: Show): void {
    this.queue.push(show);
    while (this.queue.length > 3) {
      const old = this.queue.shift()!;
      this.mark(old.name, "fast-forward");
      old.finalize();
    }
  }

  private mark(show: string, step: string): void {
    this.debug.push({ show, step, t: Math.round(this.clock()) });
    if (this.debug.length > 500) this.debug.splice(0, 100);
  }

  tick(): void {
    const now = this.clock();
    if (!this.current) {
      const next = this.queue.shift();
      if (!next) return;
      next.t0 = now;
      this.current = next;
    }
    const s = this.current;
    const elapsed = now - (s.t0 ?? now);
    for (const st of s.steps) {
      if (!st.done && elapsed >= st.at) {
        st.done = true;
        this.mark(s.name, st.label);
        try {
          st.run();
        } catch (e) {
          console.warn("vfx step failed", e);
        }
      }
    }
    if (elapsed >= s.length) {
      this.mark(s.name, "end");
      this.current = null;
      if (!this.queue.length) this.onIdle?.();
    }
  }

  skipAll(): void {
    if (this.current) {
      for (const st of this.current.steps) st.done = true;
      this.current.finalize();
      this.current = null;
    }
    for (const s of this.queue) s.finalize();
    this.queue = [];
    this.mark("all", "skip");
  }

  /** Turn one server event into effects. Non-show events apply instantly. */
  play(msg: ServerMessage): void {
    const d = msg.data as any;
    const { fx } = this.ctx;
    switch (msg.type) {
      case "submission.accepted": {
        const me = this.ctx.you;
        fx.charge[me] = { size: 4, target: 10, mine: true, ramp: fx.ramp(this.ctx.skin(me).attack.ramp), unstable: 0 };
        break;
      }
      case "submission.progress": {
        const ch = fx.charge[this.ctx.you];
        if (ch && d.total) ch.target = 10 + (18 * d.passed) / d.total;
        if (d.code === "AC") sfx.testTick();
        break;
      }
      case "opponent.activity": {
        const s = sideOf(d.side);
        if (d.state === "judging") fx.charge[s] = { size: 14, target: 14, mine: false, ramp: fx.ramp(this.ctx.skin(s).attack.ramp), unstable: 0 };
        else if (fx.charge[s] && !fx.charge[s]!.mine && !this.busy) delete fx.charge[s];
        break;
      }
      case "submission.verdict":
        if (d.void) delete fx.charge[this.ctx.you];
        break;
      case "attack.landed":
      case "attack.blocked":
        this.enqueue(this.attackShow(msg.type === "attack.blocked", d));
        break;
      case "attack.backfire":
        this.enqueue(this.backfireShow(d));
        break;
      case "powerup.used":
        if (d.kind === "block") {
          const s = sideOf(d.side);
          fx.shields[s] = { until: fx.now() + (d.shield_ms ?? 20000), color: this.ctx.skin(s).block.dome, crackUntil: 0, shattered: false };
          fx.fighters[s].setPose("block", 400);
          sfx.shieldUp();
        }
        break;
      case "shield.expired": {
        const s = sideOf(d.side);
        const f = fx.fighters[s];
        delete fx.shields[s];
        fx.burst(Kind.Spark, f.baseX, f.baseY, 20, 120, 500, [5, 1], fx.ramp(["#ffffff", "#a5f3fc", "#67e8f9", "#0891b2", "#083344"]));
        break;
      }
      case "emote": {
        const f = fx.fighters[sideOf(d.side)];
        fx.text({ text: d.id.toUpperCase(), x: f.anchors.head[0], y: f.anchors.head[1] - 30, size: 12, fill: "#f8fafc", stroke: "#0f172a", dur: 2000 });
        break;
      }
      case "match.ended":
        this.enqueue(this.endingShow(d));
        break;
      case "match.countdown":
        if (d.n > 0) sfx.countdown();
        break;
      case "state.snapshot":
        this.skipAll();
        break;
    }
  }

  // ------------------------------------------------------------------ shows
  attackShow(blocked: boolean, d: any): Show {
    const { fx } = this.ctx;
    const att = sideOf(d.attacker);
    const def = sideOf(d.defender);
    const lethal = !blocked && d.defender_hp === 0;
    let cls: DamageClass = d.damage_class;
    if (lethal) cls = nextClass(cls);
    const crit: boolean = d.crit;
    const amount: number = blocked ? d.prevented_damage : d.damage;
    const skin = this.ctx.skin(att);
    let ramp = fx.ramp(crit ? ["#ffffff", "#e0f2fe", ...skin.attack.ramp.slice(1, 4)] : skin.attack.ramp);
    const I = INTENSITY[cls];
    const reduced = this.ctx.reduced();
    const A = fx.fighters[att];
    const D = fx.fighters[def];
    const defenderIsMe = def === this.ctx.you;
    // The card's difficulty picks the weapon choreography and adds time for the
    // bigger forms. Events without a level (old replays) keep the class timeline.
    const level = levelOf(d.level, cls);
    const extra = typeof d.level === "number" ? LEVEL_EXTRA[level] : LEVEL_EXTRA[0];
    const T = { ...TIMING[cls], windup: TIMING[cls].windup + extra.windup, travel: TIMING[cls].travel + extra.travel };
    const look = this.ctx.weapon?.(att) ?? { ...DEFAULT_LOOK, colors: skin.attack.ramp };
    const weapon = WEAPONS[look.style] ?? WEAPONS.fireball;
    const hitPoint = (): [number, number] => (blocked ? [D.anchors.chest[0] - D.facing * D.size * 0.5, D.anchors.chest[1]] : [D.anchors.chest[0], D.anchors.chest[1]]);
    const strike: Strike = {
      fx,
      A,
      D,
      att,
      def,
      level,
      cls,
      look,
      ramp: fx.ramp(crit ? ["#ffffff", "#e0f2fe", ...look.colors.slice(1, 4)] : look.colors),
      windup: T.windup,
      travel: T.travel,
      blocked,
      warn: defenderIsMe,
      hit: hitPoint,
    };
    ramp = strike.ramp; // the weapon's colours drive the charge, sparks and trails
    const impactAt = reduced ? 200 : T.windup + T.travel;
    const steps: Step[] = [];
    let hpApplied = false;
    const applyHp = () => {
      if (!hpApplied && !blocked) {
        hpApplied = true;
        this.ctx.setHp(def, d.defender_hp, true);
      }
    };

    if (reduced) {
      steps.push({ at: 0, label: "launch", run: () => fx.launch({ from: A.anchors.muzzle, to: () => D.anchors.chest, dur: 200, size: 8, ramp, style: "orb", trail: 0, trailStyle: "flame" }) });
      steps.push({
        at: 200,
        label: "impact",
        run: () => {
          delete fx.charge[att];
          fx.ring(D.anchors.chest[0], D.anchors.chest[1], 50, 400, "#fde047", 4, 20);
          applyHp();
          this.number(def, amount, cls, crit, blocked, skin);
        },
      });
      return { name: blocked ? "block" : lethal ? "ko-hit" : "hit", steps, length: 600, finalize: applyHp };
    }

    steps.push({
      at: 0,
      label: "windup",
      run: () => {
        A.style = STYLE_OF[look.style] ?? "throw";
        A.setPose("windup", T.windup);
        const ch = fx.charge[att] ?? { size: 6, target: I.core, mine: att === this.ctx.you, ramp, unstable: 0 };
        ch.target = I.core;
        ch.ramp = ramp;
        fx.charge[att] = ch;
        const [mx, my] = A.anchors.muzzle;
        fx.burst(Kind.Spark, mx, my, 14, -90, T.windup, [4, 1], ramp, { drag: 0 });
        sfx.windup(T.windup, skin.attack.element);
        weapon.windup(strike);
      },
    });
    steps.push({
      at: T.windup,
      label: "launch",
      run: () => {
        delete fx.charge[att];
        A.setPose("cast", 300);
        fx.zoomTo(1, 1);
        sfx.cry(A.style, A.voicePitch, level);
        if (A.style === "throw") sfx.swish(level);
        if (A.style !== "shoot") setTimeout(() => sfx.step(), 110);
        weapon.launch(strike);
      },
    });
    steps.push({
      at: impactAt,
      label: "impact",
      run: () => {
        const [x, y] = blocked ? [D.anchors.chest[0] - D.facing * D.size * 0.5, D.anchors.chest[1]] : D.anchors.chest;
        const shakeK = blocked ? 0.4 : 1;
        fx.hitStop(lethal ? KO.hitStop : T.hitStop);
        fx.flashWhite(I.flash);
        fx.shake(I.shake[0] * shakeK, I.shake[1], cls === "massive" || cls === "nuke");
        if (blocked) {
          const sh = fx.shields[def];
          if (sh) {
            sh.crackUntil = fx.now() + 150;
            sh.until = fx.now() + 150;
          }
          for (let r = 0; r < 3; r++) fx.ring(x, y, 40 + r * 25, 200 + r * 80, skin.block.dome, 3, 6);
          fx.burst(Kind.Shard, D.baseX, D.baseY - D.size * 0.2, 24, 260, 500, [8, 6], fx.ramp([skin.block.dome, skin.block.dome, "#ffffff", "#94a3b8", "#334155"]), { ay: 700, drag: 0.5 });
          A.setPose("hurt", 300, 12);
          sfx.block();
          fx.text({ text: "BLOCKED!", x: D.anchors.head[0], y: D.anchors.head[1] - 34, size: 18, fill: "#e0f7ff", stroke: "#0c4a6e", dur: 1100 });
          fx.text({ text: `-${amount.toLocaleString("en-US")}`, x: D.anchors.head[0], y: D.anchors.head[1] - 4, size: 20, fill: "#94a3b8", stroke: "#1e293b", strike: true, dur: 1100 });
          return;
        }
        fx.ring(x, y, crit ? INTENSITY[nextClass(cls)].shockwave : I.shockwave, 450, "#fff7d6", 8);
        fx.burst(Kind.Spark, x, y, I.sparks, 520, 380, [4, 1], ramp, { drag: 3 });
        weapon.impact(strike);
        D.setPose("hurt", 490, I.knockback);
        D.tint = "#ffffff";
        D.tintUntil = fx.now() + 80;
        if (!lethal) sfx.ouch(D.voicePitch, cls === "massive" || cls === "nuke");
        fx.pulse?.(["light", "heavy", "massive", "nuke"].indexOf(cls) + 1);
        applyHp();
        this.number(def, amount, cls, crit, false, skin);
        if (defenderIsMe) fx.damageVignette(I.vignette, 300 + 100 * ["light", "heavy", "massive", "nuke"].indexOf(cls));
        sfx.impact(cls);
        if (crit) {
          sfx.crit();
          fx.slowmo(CRIT.slowmo[0], CRIT.slowmo[1]);
          fx.speedLines = { until: fx.now() + 300, t0: fx.now() };
          fx.text({ text: "CRITICAL!", x: D.anchors.head[0], y: D.anchors.head[1] - 60, size: 16, fill: CRIT.color, stroke: "#713f12", dur: 1000 });
        }
      },
    });
    if (!blocked) {
      steps.push({
        at: impactAt + T.hitStop,
        label: "explosion",
        run: () => {
          const [x, y] = D.anchors.chest;
          weapon.explode(strike);
          if (I.slowmo) fx.slowmo(I.slowmo[0], I.slowmo[1]);
          if (cls === "nuke") {
            fx.ring(x, y, Math.max(fx.width, fx.height), 700, "#fde68a", 10, 30);
            fx.aberration = { until: fx.now() + 300, px: 4 };
          }
          const burn = T.burn;
          const status = look.status;
          if (burn && status) setTimeout(() => fx.setStatus(def, status, burn), BURN_DELAY_MS);
        },
      });
    }
    let length = blockingLength(cls) + extra.windup + extra.travel;
    if (lethal) {
      steps.push(...this.koSteps(def, att, impactAt + T.hitStop + 50, false));
      length = Math.max(length, impactAt + KO.wipeAfterMs);
    } else {
      steps.push({ at: length - 1, label: "recover", run: () => undefined });
    }
    return { name: blocked ? "block" : lethal ? "ko-hit" : crit ? "crit-hit" : "hit", steps, length, finalize: applyHp };
  }

  private number(def: 1 | 2, amount: number, cls: DamageClass, crit: boolean, _blocked: boolean, skin: CardSkin): void {
    const { fx } = this.ctx;
    const D = fx.fighters[def];
    const I = INTENSITY[cls];
    fx.text({
      text: `-${amount.toLocaleString("en-US")}${crit ? "!" : ""}`,
      x: D.anchors.head[0] + (Math.random() - 0.5) * 24,
      y: D.anchors.head[1],
      size: I.numberSize * Math.min(1, fx.height / 420 + 0.3),
      fill: crit ? CRIT.color : skin.id === "card.classic" ? I.numberColor : skin.attack.number.fill,
      stroke: skin.attack.number.stroke === "#7a1d08" ? "#111827" : skin.attack.number.stroke,
      tag: cls === "nuke" ? "NUKE" : undefined,
      tagColor: "#ef4444",
    });
  }

  /**
   * A wrong answer: the attack goes out, turns round and hits its owner. The
   * weapon winds up as usual, falters ("destabilise"), leaves the hand
   * ("misfire"), turns ("turn": uh-oh, a red reticle on the attacker) and lands
   * on the attacker ("explosion", where the recoil is applied).
   */
  backfireShow(d: any): Show {
    const { fx } = this.ctx;
    const s = sideOf(d.attacker);
    const o = other(s);
    const mine = s === this.ctx.you;
    const lethal = d.attacker_hp === 0;
    const cls: DamageClass = lethal ? "nuke" : d.recoil_class;
    const k = mine ? 1 : 0.6;
    const F = fx.fighters[s];
    const O = fx.fighters[o];
    const skin = this.ctx.skin(s);
    const look = this.ctx.weapon?.(s) ?? { ...DEFAULT_LOOK, colors: skin.attack.ramp };
    const weapon = WEAPONS[look.style] ?? WEAPONS.fireball;
    const misfire = MISFIRES[look.style] ?? MISFIRES.fireball;
    const ramp = fx.ramp(look.colors);
    const explode = BACKFIRE_EXPLOSION[cls];
    const reduced = this.ctx.reduced();
    const level = levelOf(d.level, cls);
    const extra = typeof d.level === "number" ? LEVEL_EXTRA[level] : LEVEL_EXTRA[0];
    const windup = TIMING[cls].windup + extra.windup;
    const travel = MISFIRE_TRAVEL[level];
    let hpApplied = false;
    const applyHp = () => {
      if (!hpApplied) {
        hpApplied = true;
        this.ctx.setHp(s, d.attacker_hp, true);
      }
    };
    const verdictText = String(d.verdict === "WA" ? "WRONG ANSWER" : d.verdict === "TLE" ? "TIME LIMIT" : d.verdict === "RE" ? "RUNTIME ERROR" : d.verdict === "CE" ? "COMPILE ERROR" : d.verdict === "MLE" ? "MEMORY LIMIT" : d.verdict);
    const number = () => fx.text({ text: `-${d.recoil.toLocaleString("en-US")}`, x: F.anchors.head[0], y: F.anchors.head[1], size: 26 * k + 6, fill: "#ef4444", stroke: "#450a0a", tag: mine ? "BACKFIRE!" : "MISFIRE!", tagColor: mine ? "#fca5a5" : "#cbd5e1" });

    if (reduced) {
      const steps: Step[] = [
        { at: 0, label: "destabilise", run: () => mine && fx.text({ text: verdictText, x: F.anchors.head[0] + 40, y: F.anchors.head[1] - 40, size: 13, fill: "#f0abfc", stroke: "#4a044e", dur: 1000 }) },
        { at: 200, label: "explosion", run: () => (applyHp(), number(), sfx.backfire()) },
      ];
      let length = 200 + explode;
      if (lethal) {
        steps.push(...this.koSteps(s, o, 300, true));
        length = 200 + KO.wipeAfterMs;
      }
      return { name: lethal ? "self-destruct" : "backfire", steps, length, finalize: applyHp };
    }

    // The strike as it was meant (for the windup) and as it goes (back at its owner).
    const base = { fx, level, cls, look, ramp, windup, blocked: false };
    const meant: Strike = { ...base, A: F, D: O, att: s, def: o, travel: TIMING[cls].travel + extra.travel, warn: !mine, hit: () => [O.anchors.chest[0], O.anchors.chest[1]] };
    const back: MisfireStrike = { ...base, A: F, D: F, O, att: s, def: s, travel, warn: mine, hit: () => [F.anchors.chest[0], F.anchors.chest[1]] };
    const turnAt = windup + travel * (TURN[look.style] ?? 0.5);
    const impactAt = windup + travel;
    const steps: Step[] = [
      {
        at: 0,
        label: "windup",
        run: () => {
          F.style = STYLE_OF[look.style] ?? "throw";
          F.setPose("windup", windup);
          const ch = fx.charge[s] ?? { size: 6, target: 14, mine, ramp, unstable: 0 };
          ch.ramp = ramp;
          fx.charge[s] = ch;
          sfx.windup(windup, skin.attack.element);
          weapon.windup(meant);
        },
      },
      {
        at: Math.round(windup * 0.55),
        label: "destabilise",
        run: () => {
          const ch = fx.charge[s];
          if (ch) ch.unstable = 1;
          sfx.crackle();
          fx.aberration = { until: fx.now() + 140, px: 2 };
          if (mine) fx.text({ text: verdictText, x: F.anchors.head[0] + 40, y: F.anchors.head[1] - 40, size: 13, fill: "#f0abfc", stroke: "#4a044e", dur: 1400 });
        },
      },
      {
        at: windup,
        label: "misfire",
        run: () => {
          delete fx.charge[s];
          F.setPose("cast", 320);
          sfx.cry(F.style, F.voicePitch, level);
          sfx.misfire();
          const [mx, my] = F.anchors.muzzle;
          fx.burst(Kind.Square, mx, my, 12, 150, 450, [5, 2], fx.ramp(["#ffffff", "#f0abfc", "#d946ef", "#701a75", "#2e1065"]), { drag: 2 });
          misfire(back);
        },
      },
      {
        at: Math.round(turnAt),
        label: "turn",
        run: () => {
          F.setPose("panic", impactAt - turnAt);
          sfx.uhOh(F.voicePitch);
          sfx.whistle((impactAt - turnAt) / 1000);
          if (mine) sfx.lockOn(Math.min(0.5, (impactAt - turnAt) / 1000));
          fx.text({ text: "!", x: F.anchors.head[0], y: F.anchors.head[1] - 46, size: 34, fill: "#fde047", stroke: "#7c2d12", dur: impactAt - turnAt + 200 });
          fx.reticle({ x: F.anchors.feet[0], y: F.anchors.feet[1], r: 60, dur: impactAt - turnAt + 120, color: "#ef4444", follow: () => [F.anchors.feet[0], F.anchors.feet[1]] });
        },
      },
      {
        at: impactAt,
        label: "explosion",
        run: () => {
          const I = INTENSITY[cls];
          const [x, y] = F.anchors.chest;
          fx.hitStop(lethal ? KO.hitStop : TIMING[cls].hitStop);
          fx.flashWhite(I.flash * k);
          fx.shake(I.shake[0] * k, I.shake[1], cls === "massive" || cls === "nuke");
          fx.ring(x, y, I.shockwave * 0.8, 450, "#fecaca", 7);
          fx.burst(Kind.Spark, x, y, Math.round(I.sparks * k), 480, 360, [4, 1], ramp, { drag: 3 });
          weapon.impact(back);
          weapon.explode(back);
          F.setPose("hurt", 490, I.knockback * 0.9);
          F.tint = "#ffffff";
          F.tintUntil = fx.now() + 90;
          F.soot = 1;
          setTimeout(() => (F.soot = 0), 1800);
          if (cls !== "light") F.dizzyUntil = fx.gameTime + 1800;
          applyHp();
          sfx.backfire();
          sfx.impact(cls);
          if (!lethal) sfx.ouch(F.voicePitch, cls !== "light");
          number();
          fx.pulse?.(["light", "heavy", "massive", "nuke"].indexOf(cls) + 1);
          if (mine) fx.damageVignette(I.vignette);
          const status = look.status;
          if (status && TIMING[cls].burn) setTimeout(() => fx.setStatus(s, status, TIMING[cls].burn), BURN_DELAY_MS);
        },
      },
    ];
    let length = impactAt + explode;
    if (lethal) {
      steps.push(...this.koSteps(s, o, impactAt + 100, true));
      length = impactAt + KO.wipeAfterMs;
    }
    return { name: lethal ? "self-destruct" : "backfire", steps, length, finalize: applyHp };
  }

  koSteps(loser: 1 | 2, winner: 1 | 2, at: number, selfDestruct: boolean): Step[] {
    const { fx } = this.ctx;
    const L = fx.fighters[loser];
    const W = fx.fighters[winner];
    return [
      {
        at,
        label: "ko",
        run: () => {
          fx.slowmo(KO.slowmo[0], KO.slowmo[1]);
          fx.zoomTo(KO.zoom, KO.zoomMs, L.baseX / fx.width, L.baseY / fx.height);
          fx.speedLines = { until: fx.now() + KO.speedLinesMs, t0: fx.now() };
          fx.aberration = { until: fx.now() + KO.aberrationMs, px: KO.aberration };
          L.setPose("ko", 1200);
          sfx.koCry(L.voicePitch);
          fx.burst(Kind.Square, L.baseX, L.baseY, KO.shards, 340, 1400, [8, 6], fx.ramp(["#ffffff", "#e2e8f0", "#94a3b8", "#475569", "#1e293b"]), { ay: 900, drag: 0.3, bounceY: L.anchors.feet[1] + 10 });
        },
      },
      {
        at: at + 300,
        label: "ko-text",
        run: () => {
          fx.zoomTo(1, 600);
          W.setPose("victory", 1500);
          sfx.cheer(W.voicePitch);
          fx.burst(Kind.Square, W.baseX, W.baseY - W.size * 0.6, KO.confetti, 360, 1800, [6, 5], fx.ramp(["#facc15", "#22c55e", "#3b82f6", "#a855f7", "#ef4444"]), { ay: 500, drag: 0.6 });
          fx.text({ text: "K.O.", x: 0, y: 0, size: Math.min(120, fx.width / 6), fill: "#fde047", stroke: "#7c2d12", big: true, dur: KO.textMs + KO.holdMs + 600, tag: selfDestruct ? "SELF DESTRUCT" : undefined, tagColor: "#fca5a5" });
          fx.shake(10, 300);
        },
      },
    ];
  }

  endingShow(d: any): Show {
    const { fx } = this.ctx;
    const reason: string = d.end_reason;
    const steps: Step[] = [];
    let length = 400;
    if (d.outcome === "aborted") return { name: "aborted", steps, length: 1, finalize: () => undefined };
    if (reason === "ko") return { name: "ended-ko", steps, length: 1, finalize: () => undefined };
    const winner = d.winner_side ? sideOf(d.winner_side) : null;
    if (reason === "timer") {
      steps.push({
        at: 0,
        label: "time",
        run: () => {
          sfx.bell();
          fx.text({ text: d.outcome === "draw" ? "DRAW" : "TIME!", x: 0, y: 0, size: Math.min(96, fx.width / 7), fill: d.outcome === "draw" ? "#cbd5e1" : "#fde047", stroke: "#1e293b", big: true, dur: 2200 });
          if (winner) fx.fighters[winner].setPose("victory", 1500);
        },
      });
      length = 2400;
    } else if (reason === "forfeit" || reason === "disconnect") {
      const loser = winner ? other(winner) : null;
      steps.push({
        at: 0,
        label: "fled",
        run: () => {
          if (loser) {
            const F = fx.fighters[loser];
            F.setPose("flee", 700);
            fx.burst(Kind.Smoke, F.anchors.feet[0], F.anchors.feet[1], 10, 80, 700, [6, 18], 0);
          }
          fx.text({ text: "FLED!", x: 0, y: 0, size: Math.min(96, fx.width / 7), fill: "#fde047", stroke: "#1e293b", big: true, dur: 2000 });
          if (winner) fx.fighters[winner].setPose("victory", 1500);
        },
      });
      length = 2200;
    }
    return { name: `ended-${reason}`, steps, length, finalize: () => undefined };
  }
}
