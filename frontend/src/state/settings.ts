import { create } from "zustand";
import { api } from "../net/api";

export interface Settings {
  master: number;
  effects: number;
  music: boolean;
  musicVolume: number;
  v?: number; // settings format; 2 turned music on by default
  quality: "auto" | "high" | "low" | "off";
  reducedMotion: "auto" | "on" | "off";
  shake: number;
  flash: number;
  crt: boolean;
  cbPalette: boolean;
  fontSize: number;
  muted: boolean;
  autoBot: boolean;
  language: string; // interface language
  codeLanguage: string; // the editor's starting language (python, cpp, ...)
  templates: Record<string, string>; // your own starting code per language; empty = built-in
}

export const DEFAULT_SETTINGS: Settings = {
  master: 0.7,
  effects: 0.8,
  music: true,
  musicVolume: 0.6,
  v: 2,
  quality: "auto",
  reducedMotion: "auto",
  shake: 1,
  flash: 1,
  crt: false,
  cbPalette: false,
  fontSize: 14,
  muted: false,
  autoBot: false,
  language: "en",
  codeLanguage: "python",
  templates: {},
};

const KEY = "algoarena.settings";

/** Earlier builds had no music, so a saved "music: off" was only the old default: turn it on once. */
export function migrate(raw: Partial<Settings>): Settings {
  const s = { ...DEFAULT_SETTINGS, ...raw } as Settings;
  if ((raw.v ?? 1) < 2) {
    s.music = true;
    s.v = 2;
  }
  return s;
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? migrate(JSON.parse(raw)) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

let saveTimer: number | undefined;

interface SettingsStore {
  s: Settings;
  set: (patch: Partial<Settings>) => void;
  hydrate: (server: Partial<Settings> | undefined) => void;
}

export const useSettings = create<SettingsStore>((set, get) => ({
  s: load(),
  set: (patch) => {
    const next = { ...get().s, ...patch };
    set({ s: next });
    applyDocumentSettings(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* storage can be unavailable; settings stay in memory */
    }
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void api("/me/settings", { method: "PATCH", body: { settings: next } }).catch(() => {}), 1200);
  },
  hydrate: (server) => {
    if (!server || Object.keys(server).length === 0) return;
    const next = migrate(server);
    set({ s: next });
    applyDocumentSettings(next);
  },
}));

export function prefersReducedMotion(s: Settings = useSettings.getState().s): boolean {
  if (s.reducedMotion === "on") return true;
  if (s.reducedMotion === "off") return false;
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function applyDocumentSettings(s: Settings): void {
  const root = document.documentElement;
  root.dataset.palette = s.cbPalette ? "cb" : "default";
  root.dataset.reducedMotion = s.reducedMotion;
  document.body.classList.toggle("crt", s.crt);
}
