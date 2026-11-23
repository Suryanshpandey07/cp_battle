import { useState } from "react";
import { Link, navigate, usePath } from "../app/router";
import { t } from "../i18n";
import { api, ApiError } from "../net/api";
import { useAuth, type Profile } from "../state/auth";
import { useSettings } from "../state/settings";

const COLORS = ["#3b82f6", "#22c55e", "#f97316", "#ef4444", "#a855f7", "#eab308", "#06b6d4", "#ec4899"];

export default function Auth() {
  const signup = usePath() === "/signup";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [err, setErr] = useState<{ msg: string; field?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const userOk = /^[A-Za-z0-9_]{3,20}$/.test(username);
  const passOk = password.length >= 8;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (signup && (!userOk || !passOk)) {
      setErr({ msg: !userOk ? t("auth.username_rule") : t("auth.password_rule"), field: !userOk ? "username" : "password" });
      return;
    }
    setBusy(true);
    try {
      const d = await api<{ access_token: string; profile: Profile }>(signup ? "/auth/signup" : "/auth/login", {
        body: signup ? { username, password, avatar_color: color } : { username, password },
      });
      useAuth.getState().setSession(d.access_token, d.profile);
      if (d.profile.settings) useSettings.getState().hydrate(d.profile.settings as never);
      const next = new URLSearchParams(location.search).get("next");
      navigate(next && next.startsWith("/") ? next : "/lobby", true);
    } catch (e) {
      if (e instanceof ApiError) {
        const retry = e.code === "rate_limited" ? ` (${Math.ceil(Number(e.details.retry_after ?? 1))} s)` : "";
        setErr({ msg: e.message + retry, field: e.details.field as string | undefined });
      } else setErr({ msg: t("common.error") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="panel w-full max-w-sm space-y-4 p-6" aria-label={signup ? t("auth.signup") : t("auth.login")}>
        <h1 className="pixel text-center text-sm text-green-400">{signup ? t("auth.signup") : t("auth.login")}</h1>
        <label className="block text-sm">
          <span className="text-slate-300">{t("auth.username")}</span>
          <input
            className={`mt-1 w-full rounded border bg-slate-900 px-3 py-2 ${err?.field === "username" ? "border-red-500" : "border-slate-600"}`}
            value={username}
            autoComplete="username"
            onChange={(e) => setUsername(e.target.value)}
            name="username"
            aria-invalid={err?.field === "username"}
          />
          {signup && username && !userOk && <span className="text-xs text-red-400">{t("auth.username_rule")}</span>}
        </label>
        <label className="block text-sm">
          <span className="text-slate-300">{t("auth.password")}</span>
          <input
            type="password"
            className={`mt-1 w-full rounded border bg-slate-900 px-3 py-2 ${err?.field === "password" ? "border-red-500" : "border-slate-600"}`}
            value={password}
            autoComplete={signup ? "new-password" : "current-password"}
            onChange={(e) => setPassword(e.target.value)}
            name="password"
          />
          {signup && password && !passOk && <span className="text-xs text-red-400">{t("auth.password_rule")}</span>}
        </label>
        {signup && (
          <fieldset>
            <legend className="text-sm text-slate-300">{t("auth.color")}</legend>
            <div className="mt-1 flex gap-2">
              {COLORS.map((c) => (
                <button type="button" key={c} onClick={() => setColor(c)} aria-label={c} className={`h-7 w-7 rounded-full ${color === c ? "ring-2 ring-white ring-offset-2 ring-offset-slate-800" : ""}`} style={{ background: c }} />
              ))}
            </div>
          </fieldset>
        )}
        {err && (
          <div className="rounded bg-red-950 px-3 py-2 text-sm text-red-300" role="alert">
            {err.msg}
          </div>
        )}
        <button className="btn btn-primary w-full" disabled={busy} type="submit">
          {busy ? t("common.loading") : signup ? t("auth.signup") : t("auth.login")}
        </button>
        <Link to={signup ? "/login" : "/signup"} className="block text-center text-sm text-slate-400 hover:text-white">
          {signup ? t("auth.have_account") : t("auth.no_account")}
        </Link>
      </form>
    </div>
  );
}
