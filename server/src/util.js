// Small helpers shared across the server.

/** Round half to even, as Python's round() does (2.5 -> 2, 3.5 -> 4). */
export function pyRound(x, digits = 0) {
  if (digits) {
    const k = 10 ** digits;
    return Number((pyRound(Number((x * k).toPrecision(15))) / k).toFixed(digits));
  }
  const f = Math.floor(x);
  const diff = x - f;
  if (Math.abs(diff - 0.5) < 1e-12) return f % 2 === 0 ? f : f + 1;
  return Math.round(x);
}

/** ISO 8601 in UTC, or null. */
export const iso = (d) => (d ? new Date(d).toISOString() : null);

/** The UTC calendar day of a date as YYYY-MM-DD. */
export const utcDay = (d = new Date()) => new Date(d).toISOString().slice(0, 10);

export const DAY_MS = 86_400_000;

/** Whole days from day a to day b (both YYYY-MM-DD). */
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Python-like sorted object: keys in ascending order. */
export const sortedObject = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
