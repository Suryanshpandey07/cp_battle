import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { navigate } from "../app/router";
import { CodeEditor } from "../features/editor/CodeEditor";
import { LanguagePicker, useLanguages } from "../features/editor/languages";
import { CompilerOutput } from "../features/editor/CompilerOutput";
import { startingCode, templateFor } from "../lib/templates";
import { t } from "../i18n";
import { tierColor } from "../lib/format";
import { renderMarkdown } from "../lib/markdown";
import { api, ApiError } from "../net/api";
import { useSettings } from "../state/settings";

interface ProblemRow {
  slug: string;
  title: string;
  biome: string;
  tier: number;
  solved: boolean;
}

function Dojo({ slug, onClose }: { slug: string; onClose: () => void }) {
  const { data: p } = useQuery({ queryKey: ["problem", slug], queryFn: () => api<any>(`/problems/${slug}`) });
  const { languages, lang, setLanguage } = useLanguages();
  const templates = useSettings((s) => s.s.templates);
  const [codes, setCodes] = useState<Record<string, string>>({}); // one buffer per language
  const setCode = (v: string) => setCodes((c) => ({ ...c, [lang.id]: v }));
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const fontSize = useSettings((s) => s.s.fontSize);
  const html = useMemo(() => (p ? renderMarkdown(`${p.statement_md}\n\n**Input.** ${p.input_md}\n\n**Output.** ${p.output_md}\n\n${p.constraints_md}`) : ""), [p]);
  if (!p) return <div className="p-4 text-slate-400">{t("common.loading")}</div>;
  const value = codes[lang.id] ?? startingCode(lang.id, p.stubs?.[lang.id], templates);
  const run = async () => {
    setErr(null);
    try {
      setRes(await api(`/problems/${slug}/run`, { body: { language: lang.id, code: value } }));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    }
  };
  return (
    <div className="panel grid gap-3 p-3 md:grid-cols-[1fr_1.4fr]">
      <div className="max-h-[70vh] overflow-y-auto text-sm text-slate-300">
        <button className="btn btn-ghost !min-h-8 mb-2 text-xs" onClick={onClose}>
          ← {t("editor.back")}
        </button>
        <h2 className="mb-2 text-lg font-bold text-white">{p.title}</h2>
        <div className="[&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-5" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
      <div className="flex flex-col gap-2">
        <div className="h-80 rounded border border-slate-700 bg-slate-950">
          <CodeEditor key={lang.id} value={value} onChange={setCode} language={lang.monaco} fontSize={fontSize} accent="#22c55e" onRun={() => void run()} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-primary" onClick={() => void run()} data-testid="dojo-run">
            ▶ {t("editor.run")}
          </button>
          <LanguagePicker languages={languages} value={lang.id} onChange={setLanguage} />
          <button
            className="btn btn-ghost !min-h-8 text-xs"
            onClick={() => {
              if (!value.trim() || value === p.stubs?.[lang.id] || window.confirm(t("editor.template_confirm"))) setCode(templateFor(lang.id, templates));
            }}
            title={t("editor.template_title", { language: lang.name })}
          >
            ⎘ {t("editor.template")}
          </button>
        </div>
        {err && <div className="text-sm text-red-300">{err}</div>}
        {res && (
          <div className="text-sm">
            <div className={res.verdict === "AC" ? "text-green-400" : "text-red-400"}>
              {t(`verdict.${res.verdict}`)}
            </div>
            {res.compile_error && <CompilerOutput text={res.compile_error} />}
            {res.tests.map((x: any) => (
              <div key={x.index} className="font-mono text-xs text-slate-400">
                #{x.index + 1} {x.code} {x.time_ms} ms
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Practice() {
  const { data } = useQuery({ queryKey: ["problems"], queryFn: () => api<{ problems: ProblemRow[] }>("/problems") });
  const [biome, setBiome] = useState("");
  const [tier, setTier] = useState(0);
  const [map, setMap] = useState("bit");
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const rows = (data?.problems ?? []).filter((p) => (!biome || p.biome === biome) && (!tier || p.tier === tier));
  const start = async () => {
    try {
      const r = await api<{ match_id: string }>("/matches/practice", { body: { map } });
      navigate(`/battle/${r.match_id}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    }
  };
  if (open) return <div className="mx-auto max-w-6xl p-4"><Dojo slug={open} onClose={() => setOpen(null)} /></div>;
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <section className="panel flex flex-wrap items-center gap-3 p-4">
        <h1 className="pixel text-xs text-green-400">{t("practice.title")}</h1>
        <span className="text-sm text-slate-400">{t("lobby.practice_note")}</span>
        <select className="ml-auto rounded bg-slate-900 px-2 py-1 text-sm" value={map} onChange={(e) => setMap(e.target.value)}>
          {["bit", "binary", "prestige"].map((m) => (
            <option key={m} value={m}>
              {t(`map.${m}`)}
            </option>
          ))}
        </select>
        <button className="btn btn-primary" onClick={() => void start()}>
          {t("practice.start")}
        </button>
        {err && <span className="text-sm text-red-300">{err}</span>}
      </section>
      <section className="panel p-4">
        <div className="mb-3 flex gap-2">
          <select className="rounded bg-slate-900 px-2 py-1 text-sm" value={biome} onChange={(e) => setBiome(e.target.value)} aria-label={t("practice.filter_biome")}>
            <option value="">All biomes</option>
            <option value="bit">Bit Manipulation</option>
            <option value="binary">Binary</option>
            <option value="general">General</option>
          </select>
          <select className="rounded bg-slate-900 px-2 py-1 text-sm" value={tier} onChange={(e) => setTier(Number(e.target.value))} aria-label={t("practice.filter_tier")}>
            <option value={0}>All tiers</option>
            {[1, 2, 3, 4, 5].map((x) => (
              <option key={x} value={x}>
                Tier {x}
              </option>
            ))}
          </select>
        </div>
        <table className="w-full text-left text-sm">
          <tbody>
            {rows.map((p) => (
              <tr key={p.slug} className="odd:bg-slate-800/40">
                <td className="px-2 py-1.5">
                  <span className="mr-2 inline-block h-2.5 w-2.5 rotate-45" style={{ background: tierColor(p.tier) }} />
                  {p.title}
                </td>
                <td className="px-2 py-1.5 text-slate-400">{p.biome}</td>
                <td className="px-2 py-1.5">T{p.tier}</td>
                <td className="px-2 py-1.5 text-green-400">{p.solved ? `✓ ${t("practice.solved")}` : ""}</td>
                <td className="px-2 py-1.5 text-right">
                  <button className="btn btn-ghost !min-h-7 text-xs" onClick={() => setOpen(p.slug)} data-testid={`try-${p.slug}`}>
                    {t("practice.try")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
