import { useEffect, useState } from "react";
import { t } from "../i18n";
import { api } from "../net/api";
import { loadRegistry } from "../skins/registry";
import { useAuth } from "../state/auth";
import { Link, navigate, RouterView, usePath } from "./router";
import { SettingsModal } from "./SettingsModal";
import { useFullscreen, useFullscreenShortcut } from "../lib/fullscreen";
import { useNowPlaying } from "../audio/music";
import { useMusicRoute } from "../audio/route";
import { useSettings } from "../state/settings";

function NotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <div className="pixel text-sm text-slate-400">404</div>
      <Link to="/lobby" className="btn btn-ghost">
        {t("result.back")}
      </Link>
    </div>
  );
}

export function SandboxBadge() {
  const judge = useAuth((s) => s.profile?.judge);
  if (!judge || judge.sandboxed) return null;
  const label = judge.backend === "fake" ? t("app.test_judge") : t("app.dev_sandbox");
  return (
    <span className="pixel rounded border border-orange-400 bg-orange-900/60 px-2 py-1 text-[9px] text-orange-200" title={label} role="note">
      {judge.backend === "fake" ? "TEST JUDGE" : "DEV SANDBOX"}
    </span>
  );
}

function Nav() {
  const profile = useAuth((s) => s.profile);
  const path = usePath();
  const [settings, setSettings] = useState(false);
  if (!profile || path.startsWith("/battle/") || path === "/") return null;
  const items: [string, string][] = [
    ["/lobby", "nav.lobby"],
    ["/practice", "nav.practice"],
    ["/locker", "nav.locker"],
    ["/leaderboard", "nav.leaderboard"],
    [`/profile/${profile.display_name}`, "nav.profile"],
  ];
  if (profile.role === "admin") items.push(["/admin", "nav.admin"]);
  return (
    <header className="sticky top-0 z-30 flex flex-wrap items-center gap-x-3 gap-y-1 border-b-2 border-slate-700 bg-slate-900/90 px-4 py-2 backdrop-blur">
      <Link to="/lobby" className="pixel text-xs text-green-400">
        ALGOARENA
      </Link>
      <nav className="order-last flex w-full flex-wrap gap-1 md:order-none md:w-auto md:flex-1" aria-label="Main">
        {items.map(([to, key]) => (
          <Link key={to} to={to} className={`rounded px-3 py-1.5 text-sm ${path === to ? "bg-slate-700 text-white" : "text-slate-300 hover:bg-slate-800"}`}>
            {t(key)}
          </Link>
        ))}
      </nav>
      <SandboxBadge />
      <span className="pixel text-[10px] text-yellow-300">{profile.points ?? 0} AP</span>
      <NowPlaying />
      <FullscreenButton />
      <button className="btn btn-ghost !min-h-8 !px-2 text-xs" onClick={() => setSettings(true)} aria-label={t("settings.title")}>
        ⚙
      </button>
      <button
        className="btn btn-ghost !min-h-8 !px-2 text-xs"
        onClick={async () => {
          await api("/auth/logout", { body: {} }).catch(() => {});
          useAuth.getState().clear();
          navigate("/");
        }}
      >
        {t("nav.logout")}
      </button>
      {settings && <SettingsModal onClose={() => setSettings(false)} />}
    </header>
  );
}

/** Shown instead of an endless splash when the API is missing or something else holds its port. */
export function ServerDown({ kind, onRetry }: { kind: "unreachable" | "foreign"; onRetry: () => void }) {
  return (
    <div className="flex h-full items-center justify-center p-6" data-testid="server-down">
      <div className="panel max-w-lg space-y-3 p-6">
        <div className="pixel text-xs text-green-400">ALGOARENA</div>
        <h1 className="text-lg font-bold text-white">{t(kind === "foreign" ? "server.foreign_title" : "server.down_title")}</h1>
        <p className="text-sm text-slate-300">{t(kind === "foreign" ? "server.foreign_body" : "server.down_body")}</p>
        <p className="text-xs text-slate-500">{t("server.retrying")}</p>
        <button className="btn btn-primary" onClick={onRetry}>
          {t("server.retry")}
        </button>
      </div>
    </div>
  );
}

export function FullscreenButton({ className = "" }: { className?: string }) {
  const fs = useFullscreen();
  if (!fs.supported) return null;
  return (
    <button
      className={`btn btn-ghost !min-h-8 !px-2 text-xs ${className}`}
      onClick={fs.toggle}
      aria-pressed={fs.on}
      aria-label={t(fs.on ? "fullscreen.exit" : "fullscreen.enter")}
      title={`${t(fs.on ? "fullscreen.exit" : "fullscreen.enter")} (F)`}
      data-testid="fullscreen"
    >
      {fs.on ? "🗗" : "⛶"}
    </button>
  );
}

/** The track that is playing, and a one-click music switch. */
export function NowPlaying({ compact = false, testid = "now-playing" }: { compact?: boolean; testid?: string }) {
  const track = useNowPlaying();
  const on = useSettings((s) => s.s.music);
  const set = useSettings((s) => s.set);
  return (
    <button
      className={`group flex max-w-[14rem] items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/70 px-2.5 py-1 text-xs ${on ? "text-slate-200" : "text-slate-500"} hover:border-slate-500`}
      onClick={() => set({ music: !on })}
      aria-pressed={on}
      title={on ? t("music.turn_off") : t("music.turn_on")}
      data-testid={testid}
    >
      <span className={`inline-flex items-end gap-[2px] ${on ? "" : "opacity-40"}`} aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className={`w-[3px] rounded-sm bg-green-400 ${on ? "eq-bar" : ""}`} style={{ height: on ? undefined : 4, animationDelay: `${i * 0.18}s` }} />
        ))}
      </span>
      {!compact && <span className="hidden truncate sm:inline">{on ? track?.name ?? t("music.silence") : t("music.off")}</span>}
    </button>
  );
}

export function App() {
  const ready = useAuth((s) => s.ready);
  const authed = useAuth((s) => !!s.token);
  useFullscreenShortcut();
  useMusicRoute(usePath());
  useEffect(() => {
    void loadRegistry();
  }, []);
  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="pixel animate-pulse text-xs text-green-400">ALGOARENA</div>
      </div>
    );
  }
  return (
    <div className="flex min-h-full flex-col">
      <Nav />
      <main className="flex-1">
        <RouterView authed={authed} NotFound={NotFound} />
      </main>
    </div>
  );
}
