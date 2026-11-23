import en from "./en.json";

type Dict = Record<string, string>;
const tables: Record<string, Dict> = { en };
let current: Dict = en;

export function setLanguage(lang: string): void {
  current = tables[lang] ?? en;
}

/** Every visible string comes from a translation table; English is the default. */
export function t(key: string, params?: Record<string, string | number>): string {
  const raw = current[key] ?? en[key as keyof typeof en] ?? key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => (params[k] !== undefined ? String(params[k]) : `{${k}}`));
}

export function has(key: string): boolean {
  return key in current;
}
