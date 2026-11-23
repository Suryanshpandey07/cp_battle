import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { navigate } from "../app/router";
import { api, ApiError } from "../net/api";
import { useAuth } from "../state/auth";
import { MatchRow } from "./Lobby";

function Calculator() {
  const [a, setA] = useState(2);
  const [p, setP] = useState(3);
  const { data } = useQuery({ queryKey: ["calc", a, p], queryFn: () => api<any>(`/admin/calculator?attacker_tier=${a}&problem_tier=${p}`) });
  return (
    <div className="space-y-2 text-sm">
      <div className="flex gap-2">
        <label>
          Attacker tier{" "}
          <select className="rounded bg-slate-900 px-1" value={a} onChange={(e) => setA(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          Problem tier{" "}
          <select className="rounded bg-slate-900 px-1" value={p} onChange={(e) => setP(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
      </div>
      {data && (
        <pre className="rounded bg-slate-950 p-2 font-mono text-xs">{JSON.stringify(data, null, 2)}</pre>
      )}
    </div>
  );
}

export default function Admin() {
  const role = useAuth((s) => s.profile?.role);
  const [tab, setTab] = useState<"matches" | "flags" | "users" | "calc">("matches");
  const [msg, setMsg] = useState<string | null>(null);
  const matches = useQuery({ queryKey: ["admin", "matches"], queryFn: () => api<{ matches: any[] }>("/admin/matches"), enabled: role === "admin" && tab === "matches" });
  const flags = useQuery({ queryKey: ["admin", "flags"], queryFn: () => api<{ flags: any[] }>("/admin/flags"), enabled: role === "admin" && tab === "flags" });
  const [events, setEvents] = useState<any[] | null>(null);
  const [user, setUser] = useState("");
  if (role !== "admin") return <div className="p-8 text-slate-400">Admins only.</div>;
  const run = async (fn: () => Promise<unknown>) => {
    setMsg(null);
    try {
      await fn();
      setMsg("Done.");
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : String(e));
    }
  };
  return (
    <div className="mx-auto max-w-6xl space-y-3 p-4">
      <div className="flex gap-2">
        {(["matches", "flags", "users", "calc"] as const).map((k) => (
          <button key={k} className={`rounded px-3 py-1 text-sm ${tab === k ? "bg-slate-600" : "bg-slate-800"}`} onClick={() => setTab(k)}>
            {k}
          </button>
        ))}
        <button className="btn btn-ghost !min-h-8 ml-auto text-xs" onClick={() => navigate("/dev/vfx")}>
          VFX Lab
        </button>
      </div>
      {msg && <div className="text-sm text-yellow-300">{msg}</div>}
      <section className="panel p-4">
        {tab === "matches" &&
          (matches.data?.matches ?? []).map((m) => (
            <div key={m.id} className="flex items-center gap-2 border-b border-slate-800 py-1">
              <div className="flex-1">
                <MatchRow m={m} />
              </div>
              <button className="text-xs text-cyan-300" onClick={() => void api<{ events: any[] }>(`/admin/matches/${m.id}/events`).then((d) => setEvents(d.events))}>
                events
              </button>
              <button className="text-xs text-orange-300" onClick={() => void run(() => api(`/admin/matches/${m.id}/void`, { body: { reason: "admin review" } }))}>
                void
              </button>
              {m.status === "live" && (
                <button className="text-xs text-red-300" onClick={() => void run(() => api(`/admin/matches/${m.id}/abort`, { body: {} }))}>
                  abort
                </button>
              )}
            </div>
          ))}
        {tab === "flags" &&
          (flags.data?.flags ?? []).map((f) => (
            <div key={f.id} className="flex items-center gap-2 border-b border-slate-800 py-1 text-sm">
              <span className="flex-1">
                {f.kind} · match {String(f.match_id).slice(0, 8)} · {f.status}
              </span>
              {["dismissed", "warned", "actioned"].map((s) => (
                <button key={s} className="text-xs text-cyan-300" onClick={() => void run(() => api(`/admin/flags/${f.id}`, { body: { status: s } }))}>
                  {s}
                </button>
              ))}
            </div>
          ))}
        {tab === "users" && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <input className="rounded bg-slate-900 px-2 py-1" placeholder="username" value={user} onChange={(e) => setUser(e.target.value)} />
            <button className="btn btn-ghost !min-h-8 text-xs" onClick={() => void run(() => api(`/admin/users/${user}/suspend`, { body: { minutes: 60 } }))}>
              suspend 60 min
            </button>
            <button className="btn btn-ghost !min-h-8 text-xs" onClick={() => void run(() => api(`/admin/users/${user}/suspend`, { body: { minutes: 0 } }))}>
              unsuspend
            </button>
            <button className="btn btn-ghost !min-h-8 text-xs" onClick={() => void run(() => api(`/admin/users/${user}/reset-daily-cap`, { body: {} }))}>
              reset daily cap
            </button>
            <button className="btn btn-ghost !min-h-8 text-xs" onClick={() => void run(() => api(`/admin/users/${user}/grant-skin`, { body: { skin_id: window.prompt("skin id") ?? "" } }))}>
              grant skin
            </button>
          </div>
        )}
        {tab === "calc" && <Calculator />}
      </section>
      {events && (
        <section className="panel max-h-96 overflow-y-auto p-4 font-mono text-xs">
          {events.map((e) => (
            <div key={e.seq}>
              #{e.seq} [{e.visibility}] {e.type} {JSON.stringify(e.data).slice(0, 160)}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
