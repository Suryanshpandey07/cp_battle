import { useEffect } from "react";
import { Link, navigate } from "../app/router";
import { ArenaView, NO_EVENTS } from "../features/battle/ArenaView";
import { t } from "../i18n";
import { initialState, type BattleState } from "../state/battle.reducer";
import { useAuth } from "../state/auth";

const demo: BattleState = {
  ...initialState("demo"),
  you: 1,
  status: "live",
  stage: { theme: "arena.bit", owner_side: null, owner_name: null },
  players: {
    1: { side: 1, name: "You", rating: 1200, tier: 2, maxHp: 28000, hp: 28000, skins: { color: "#3b82f6", card: "card.classic" }, isBot: false, connected: true, hitsLanded: 0, damageDealt: 0, shieldUntil: null, judging: false, activity: "arena", burnUntil: null, burnClass: null },
    2: { side: 2, name: "xX_AlgoGod_Xx", rating: 1250, tier: 2, maxHp: 28000, hp: 28000, skins: { color: "#a855f7", card: "card.inferno" }, isBot: true, connected: true, hitsLanded: 0, damageDealt: 0, shieldUntil: null, judging: false, activity: "arena", burnUntil: null, burnClass: null },
  },
};

export default function Landing() {
  const authed = useAuth((s) => !!s.token);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") navigate(authed ? "/lobby" : "/signup");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [authed]);
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 p-6">
      <h1 className="pixel text-center text-2xl text-green-400 drop-shadow-[0_0_12px_rgba(34,197,94,0.6)] md:text-4xl">ALGOARENA</h1>
      <p className="text-center text-slate-300">{t("app.tagline")}</p>
      <div className="h-64 w-full max-w-3xl overflow-hidden rounded-2xl border-4 border-slate-700 shadow-[0_0_50px_rgba(34,197,94,0.3)]">
        <ArenaView state={demo} subscribe={NO_EVENTS} showHud={false} />
      </div>
      <button className="pixel animate-pulse text-sm text-yellow-300" onClick={() => navigate(authed ? "/lobby" : "/signup")}>
        {t("app.press_start")}
      </button>
      {!authed && (
        <div className="flex gap-3">
          <Link to="/signup" className="btn btn-primary">
            {t("auth.signup")}
          </Link>
          <Link to="/login" className="btn btn-ghost">
            {t("auth.login")}
          </Link>
        </div>
      )}
    </div>
  );
}
