/** Section 7 tables. Timings in ms; sizes in px at an arena scale of 1. Visual only:
 * these never change a game number. */

export type DamageClass = "light" | "heavy" | "massive" | "nuke";
export const CLASSES: DamageClass[] = ["light", "heavy", "massive", "nuke"];

export const TIMING: Record<DamageClass, { windup: number; travel: number; hitStop: number; explosion: number; burn: number }> = {
  light: { windup: 200, travel: 250, hitStop: 40, explosion: 360, burn: 0 },
  heavy: { windup: 250, travel: 350, hitStop: 70, explosion: 530, burn: 800 },
  massive: { windup: 350, travel: 450, hitStop: 110, explosion: 790, burn: 1600 },
  nuke: { windup: 500, travel: 600, hitStop: 160, explosion: 1240, burn: 2600 },
};

/** Windup + travel + hit-stop + explosion: how long a show blocks the next one. */
export function blockingLength(c: DamageClass): number {
  const t = TIMING[c];
  return t.windup + t.travel + t.hitStop + t.explosion;
}

export const BURN_DELAY_MS = 300;

export const INTENSITY: Record<
  DamageClass,
  {
    core: number;
    trail: number;
    shake: [number, number];
    flash: number;
    sparks: number;
    burst: number;
    smoke: number;
    shockwave: number;
    knockback: number;
    numberSize: number;
    numberColor: string;
    slowmo: [number, number] | null;
    scorch: number;
    vignette: number;
  }
> = {
  light: { core: 14, trail: 3, shake: [3, 180], flash: 0.1, sparks: 20, burst: 40, smoke: 4, shockwave: 70, knockback: 10, numberSize: 28, numberColor: "#ffffff", slowmo: null, scorch: 0, vignette: 0.15 },
  heavy: { core: 24, trail: 6, shake: [8, 300], flash: 0.25, sparks: 50, burst: 100, smoke: 10, shockwave: 120, knockback: 24, numberSize: 40, numberColor: "#facc15", slowmo: null, scorch: 1, vignette: 0.25 },
  massive: { core: 38, trail: 10, shake: [14, 450], flash: 0.4, sparks: 90, burst: 200, smoke: 18, shockwave: 180, knockback: 40, numberSize: 56, numberColor: "#fb923c", slowmo: [0.6, 200], scorch: 2, vignette: 0.4 },
  nuke: { core: 60, trail: 16, shake: [24, 700], flash: 0.6, sparks: 150, burst: 380, smoke: 30, shockwave: 300, knockback: 64, numberSize: 80, numberColor: "#ef4444", slowmo: [0.3, 450], scorch: 3, vignette: 0.5 },
};

export const BACKFIRE_EXPLOSION: Record<DamageClass, number> = { light: 300, heavy: 450, massive: 650, nuke: 900 };

export const CRIT = { slowmo: [0.5, 150] as [number, number], color: "#fde047" };
export const KO = { hitStop: 200, slowmo: [0.25, 900] as [number, number], zoom: 1.25, zoomMs: 400, speedLines: 24, speedLinesMs: 300, aberration: 4, aberrationMs: 300, spinDeg: 540, spinMs: 600, shards: 32, confetti: 120, textMs: 350, holdMs: 1200, wipeAfterMs: 2800 };

export const NUMBER = { popMs: 80, settleMs: 80, rise: 70, riseMs: 900, fadeMs: 300, stackGapMs: 400, stackPx: 28, jitter: 12 };
export const HPBAR = { fillMs: 120, ghostWaitMs: 450, ghostDrainMs: 700, counterMs: 500 };

export function nextClass(c: DamageClass): DamageClass {
  return CLASSES[Math.min(3, CLASSES.indexOf(c) + 1)];
}

export const LOW_QUALITY_PARTICLE_FACTOR = 0.35;
