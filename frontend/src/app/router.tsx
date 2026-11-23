/* A small history router with route params and route-level code splitting. */
import { lazy, Suspense, useEffect, useState, type ComponentType, type LazyExoticComponent, type ReactNode } from "react";

type Page = LazyExoticComponent<ComponentType<{ params: Record<string, string> }>>;

interface Route {
  pattern: string;
  page: Page;
  auth?: boolean;
}

const page = (loader: () => Promise<{ default: ComponentType<any> }>): Page => lazy(loader);

export const ROUTES: Route[] = [
  { pattern: "/", page: page(() => import("../pages/Landing")) },
  { pattern: "/login", page: page(() => import("../pages/Auth")) },
  { pattern: "/signup", page: page(() => import("../pages/Auth")) },
  { pattern: "/lobby", page: page(() => import("../pages/Lobby")), auth: true },
  { pattern: "/queue", page: page(() => import("../pages/Queue")), auth: true },
  { pattern: "/battle/:id", page: page(() => import("../pages/Battle")), auth: true },
  { pattern: "/result/:id", page: page(() => import("../pages/Result")), auth: true },
  { pattern: "/locker", page: page(() => import("../pages/Locker")), auth: true },
  { pattern: "/leaderboard", page: page(() => import("../pages/Leaderboard")), auth: true },
  { pattern: "/profile/:username", page: page(() => import("../pages/Profile")), auth: true },
  { pattern: "/practice", page: page(() => import("../pages/Practice")), auth: true },
  { pattern: "/replay/:id", page: page(() => import("../pages/Replay")), auth: true },
  { pattern: "/admin", page: page(() => import("../pages/Admin")), auth: true },
  { pattern: "/dev/vfx", page: page(() => import("../pages/VfxLab")), auth: true },
];

export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split("/").filter(Boolean);
  const b = path.split("/").filter(Boolean);
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(":")) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

const EVT = "aa:navigate";

export function navigate(to: string, replace = false): void {
  if (replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  window.dispatchEvent(new Event(EVT));
}

export function usePath(): string {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    window.addEventListener("popstate", on);
    window.addEventListener(EVT, on);
    return () => {
      window.removeEventListener("popstate", on);
      window.removeEventListener(EVT, on);
    };
  }, []);
  return path;
}

export function Link({ to, children, className, ...rest }: { to: string; children: ReactNode; className?: string; [k: string]: unknown }) {
  return (
    <a
      href={to}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}

export function Fallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="pixel animate-pulse text-xs text-green-400">LOADING…</div>
    </div>
  );
}

export function RouterView({ authed, NotFound }: { authed: boolean; NotFound: ComponentType }) {
  const path = usePath();
  for (const r of ROUTES) {
    const params = matchPath(r.pattern, path);
    if (!params) continue;
    if (r.auth && !authed) {
      queueMicrotask(() => navigate(`/login?next=${encodeURIComponent(path)}`, true));
      return <Fallback />;
    }
    const P = r.page;
    return (
      <Suspense fallback={<Fallback />}>
        <P key={path} params={params} />
      </Suspense>
    );
  }
  return <NotFound />;
}
