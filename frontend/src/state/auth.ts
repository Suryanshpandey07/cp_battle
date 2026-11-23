import { create } from "zustand";

export interface Profile {
  id: number;
  display_name: string;
  rating: number;
  peak_rating: number;
  tier: number;
  tier_title: string;
  max_hp: number;
  next_tier: { tier: number; title: string; min_rating: number; max_hp: number } | null;
  wins: number;
  losses: number;
  draws: number;
  avatar_color: string;
  equipped: { card: string; avatar: string; arena: string | null; weapon?: string };
  counters?: Record<string, number>;
  badges: string[];
  points?: number;
  settings?: Record<string, unknown>;
  inventory?: string[];
  role?: string;
  quests?: Quest[];
  recent_matches?: MatchBrief[];
  active_match?: string | null;
  judge?: { backend: string; sandboxed: boolean };
  queue?: { state: string };
}

export interface Quest {
  id: string;
  target: number;
  ap: number;
  progress: number;
  complete: boolean;
  claimed: boolean;
}

export interface MatchBrief {
  id: string;
  mode: string;
  map: string;
  status: string;
  end_reason: string | null;
  outcome: string | null;
  winner_side: number | null;
  labels: Record<string, string>;
  created_at: string;
  elapsed_ms: number;
  your_side: number | null;
  players: { side: number; name: string; tier: number; is_bot: boolean }[];
  rating_delta: number | null;
}

interface AuthState {
  token: string | null;
  profile: Profile | null;
  ready: boolean;
  setSession: (token: string, profile: Profile) => void;
  setProfile: (profile: Profile) => void;
  setToken: (token: string | null) => void;
  clear: () => void;
  markReady: () => void;
}

/** The access token lives in memory only; the refresh token is an httpOnly cookie. */
export const useAuth = create<AuthState>((set) => ({
  token: null,
  profile: null,
  ready: false,
  setSession: (token, profile) => {
    sessionHint(true);
    set({ token, profile });
  },
  setProfile: (profile) => set({ profile }),
  setToken: (token) => set({ token }),
  clear: () => {
    sessionHint(false);
    set({ token: null, profile: null });
  },
  markReady: () => set({ ready: true }),
}));

/** Remembers whether a refresh cookie probably exists, so a signed-out visit skips a doomed refresh call. */
export function sessionHint(value?: boolean): boolean {
  try {
    if (value === true) localStorage.setItem("aa.session", "1");
    else if (value === false) localStorage.removeItem("aa.session");
    return localStorage.getItem("aa.session") === "1";
  } catch {
    return true;
  }
}
