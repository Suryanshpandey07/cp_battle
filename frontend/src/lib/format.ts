export const fmt = (n: number): string => Math.round(n).toLocaleString("en-US");

export function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function cmdId(): string {
  const c = globalThis.crypto;
  return c && "randomUUID" in c ? c.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const TIER_COLORS = ["#9ca3af", "#22c55e", "#06b6d4", "#3b82f6", "#a855f7"];
export const tierColor = (tier: number): string => TIER_COLORS[Math.min(5, Math.max(1, tier)) - 1];
export const TIER_TITLES = ["Newbie", "Pupil", "Specialist", "Expert", "Candidate Master"];

export function hpColor(hp: number, max: number): string {
  const share = max > 0 ? hp / max : 0;
  return share > 0.5 ? "var(--hp-high)" : share >= 0.2 ? "var(--hp-mid)" : "var(--hp-low)";
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
