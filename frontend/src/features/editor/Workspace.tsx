/**
 * The workspace where matches are won. Run is free and checks the samples;
 * Submit is the attack (press and hold 600 ms, or the shortcut twice). Hidden
 * test inputs, outputs and stderr never reach the client.
 */
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sfx } from "../../audio/sfx";
import { t } from "../../i18n";
import { cmdId, fmt, mmss, tierColor } from "../../lib/format";
import { renderMarkdown } from "../../lib/markdown";
import { api, ApiError } from "../../net/api";
import { cardSkin } from "../../skins/registry";
import type { BattleState, Side } from "../../state/battle.reducer";
import { serverNow } from "../../state/battle.store";
import { useSettings } from "../../state/settings";
import { startingCode, templateFor } from "../../lib/templates";
import { CodeEditor } from "./CodeEditor";
import { CompilerOutput } from "./CompilerOutput";
import { LanguagePicker, useLanguages } from "./languages";

interface RunTest {
  index: number;
  code: string;
  time_ms: number;
  memory_kb: number;
  input: string;
  expected: string | null;
  output: string | null;
  stderr: string | null;
}
interface RunResult {
  mode: string;
  verdict: string;
  failed_test: number | null;
  passed: number;
  total: number;
  compile_error: string | null;
  system_error: boolean;
  time_cap_ms: number;
  tests: RunTest[];
}

interface ProblemDetail {
  slug: string;
  title: string;
  tier: number;
  statement_md: string;
  input_md: string;
  output_md: string;
  constraints_md: string;
  samples: { input: string; output: string }[];
  stubs: Record<string, string>;
  tests_total: number;
  time_limit_ms: number;
}

declare global {
  interface Window {
    __algoarena?: { setCode: (code: string) => void; submitNow: () => void };
  }
}

const draftKey = (m: string, slot: number, lang: string) => `aa.draft.${m}.${slot}.${lang}`;

function Diff({ expected, actual }: { expected: string; actual: string }) {
  let i = 0;
  while (i < expected.length && i < actual.length && expected[i] === actual[i]) i++;
  return (
    <pre className="whitespace-pre-wrap break-all">
      {actual.slice(0, i)}
      <span className="bg-red-800 text-red-100">{actual.slice(i) || (i < expected.length ? "⟂" : "")}</span>
    </pre>
  );
}

function Typewriter({ text }: { text: string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    const id = window.setInterval(() => setN((x) => (x >= text.length ? x : x + 2)), 16);
    return () => window.clearInterval(id);
  }, [text]);
  return <span>{text.slice(0, n)}</span>;
}

export function Workspace({
  matchId,
  state,
  slot,
  onSlot,
  onBack,
  onHint,
  drafts,
  setDraftFlag,
}: {
  matchId: string;
  state: BattleState;
  slot: number;
  onSlot: (s: number) => void;
  onBack: () => void;
  onHint: () => void;
  drafts: Record<number, { code: string; problem: string; language?: string }>;
  setDraftFlag: (slot: number, code: string, problem: string) => void;
}) {
  const card = state.hand[slot];
  const slug = card?.problem?.slug ?? "";
  const you = (state.you ?? 1) as Side;
  const me = state.players?.[you];
  const skin = cardSkin(me?.skins?.card);
  const fontSize = useSettings((s) => s.s.fontSize);
  const { languages, lang, setLanguage, fellBackFrom } = useLanguages();
  const language = lang.id;
  const templates = useSettings((s) => s.s.templates);
  const monacoLang = lang.monaco;
  const { data: problem } = useQuery<ProblemDetail>({ queryKey: ["problem", slug], queryFn: () => api(`/problems/${slug}`), enabled: !!slug, staleTime: 600_000 });
  const [code, setCode] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [run, setRun] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [runErr, setRunErr] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [custom, setCustom] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [hold, setHold] = useState(0);
  const [armed, setArmed] = useState(false);
  const [stamp, setStamp] = useState<{ text: string; ok: boolean; t: number } | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const loadedFor = useRef<string>("");
  const codeRef = useRef("");
  const liveRef = useRef(true);
  liveRef.current = state.status === "live";
  const saveTimer = useRef<number | undefined>(undefined);
  const holdTimer = useRef<number | undefined>(undefined);

  // Load the draft for this card: local first, then the server's, then the stub.
  useEffect(() => {
    if (!slug || !problem || loadedFor.current === `${slot}:${slug}:${language}`) return;
    loadedFor.current = `${slot}:${slug}:${language}`;
    let initial = startingCode(language, problem.stubs?.[language], templates);
    try {
      const raw = localStorage.getItem(draftKey(matchId, slot, language));
      const local = raw ? (JSON.parse(raw) as { code: string; problem: string; savedAt: string }) : null;
      if (local && local.problem === slug) {
        initial = local.code;
        setSavedAt(local.savedAt);
      } else if (drafts[slot]?.problem === slug && (drafts[slot].language ?? "python") === language) initial = drafts[slot].code;
    } catch {
      /* ignore */
    }
    codeRef.current = initial;
    setCode(initial);
    setRun(null);
    setStamp(null);
  }, [slug, problem, slot, matchId, drafts, language, templates]);

  const persist = useCallback(
    (value: string) => {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        const at = new Date().toLocaleTimeString("en-GB");
        try {
          localStorage.setItem(draftKey(matchId, slot, language), JSON.stringify({ code: value, problem: slug, savedAt: at }));
        } catch {
          /* drafts stay local until storage frees up */
        }
        setSavedAt(at);
        setDraftFlag(slot, value, slug);
        if (!liveRef.current) return;
        void api(`/matches/${matchId}/drafts/${slot}`, { method: "PUT", body: { language, code: value, problem: slug } }).catch(() => {});
      }, 2000);
    },
    [matchId, slot, slug, setDraftFlag, language],
  );

  /** Replace the code with the template (yours if set, else the built-in one). */
  const insertTemplate = () => {
    const tpl = templateFor(language, templates);
    const cur = codeRef.current;
    if (cur.trim() && cur !== tpl && cur !== problem?.stubs?.[language] && !window.confirm(t("editor.template_confirm"))) return;
    onChange(tpl);
  };

  // A pending save never outlives the editor; a submit makes it unnecessary
  // because the server already holds the submitted code.
  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  const onChange = (v: string) => {
    codeRef.current = v;
    setCode(v);
    persist(v);
  };

  const doRun = useCallback(async () => {
    if (running || !slug) return;
    setRunning(true);
    setRunErr(null);
    try {
      const r = await api<RunResult>(`/matches/${matchId}/run`, { body: { slot, language, code: codeRef.current, input: useCustom ? custom : undefined } });
      setRun(r);
      setSelected(Math.max(0, (r.failed_test ?? 1) - 1));
      if (r.verdict === "AC" || r.verdict === "OK") sfx.testPass();
      else sfx.testFail();
    } catch (e) {
      setRunErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [running, slug, matchId, slot, useCustom, custom, language]);

  const cooldownLeft = Math.max(0, state.cooldownUntil - serverNow());
  const judging = !!state.inflight;
  const preview = card?.preview;
  const lethal = !!preview && !!me && preview.recoil >= me.hp;

  // The server allows one submission in flight; this ref just stops a double
  // click from sending a second request before the first is acknowledged.
  const sending = useRef(false);
  const doSubmit = useCallback(async () => {
    if (!card || judging || !slug || sending.current) return;
    if (lethal && !window.confirm(t("editor.lethal_confirm"))) return;
    sending.current = true;
    setSubmitErr(null);
    setArmed(false);
    window.clearTimeout(saveTimer.current);
    try {
      await api(`/matches/${matchId}/submit`, { body: { slot, language, code: codeRef.current, cmd_id: cmdId(), problem: slug } });
    } catch (e) {
      setSubmitErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      sending.current = false;
    }
  }, [card, judging, slug, lethal, matchId, slot, language]);

  // Test hooks for end-to-end runs (deterministic with Monaco or the fallback editor).
  useEffect(() => {
    window.__algoarena = { setCode: (c) => onChange(c), submitNow: () => void doSubmit() };
  });

  // Verdict stamp; an ACCEPTED card is spent, so slide back to the hand after 1.2 s.
  const lv = state.lastVerdict;
  useEffect(() => {
    if (!lv || lv.slot !== slot) return;
    if (lv.void) {
      setStamp({ text: t("verdict.SE"), ok: false, t: lv.t });
      return;
    }
    const ok = lv.verdict === "AC";
    setStamp({ text: t(`verdict.${lv.verdict}`), ok, t: lv.t });
    if (ok) {
      const id = window.setTimeout(onBack, 1200);
      return () => window.clearTimeout(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lv?.t]);

  // Keyboard: Ctrl/Cmd+Enter run, Ctrl/Cmd+Shift+Enter submit (press again within 2 s), Alt+1..4, Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        if (armed) void doSubmit();
        else {
          setArmed(true);
          window.setTimeout(() => setArmed(false), 2000);
        }
      } else if (mod && e.key === "Enter") {
        e.preventDefault();
        void doRun();
      } else if (e.altKey && /^[1-4]$/.test(e.key)) {
        e.preventDefault();
        onSlot(Number(e.key) - 1);
      } else if (e.altKey && (e.key === "h" || e.key === "H")) {
        e.preventDefault();
        onHint();
      } else if (e.key === "Escape") onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [armed, doSubmit, doRun, onSlot, onBack, onHint]);

  useEffect(() => {
    const id = window.setInterval(() => setTick((x) => x + 1), 250);
    return () => window.clearInterval(id);
  }, []);

  const startHold = () => {
    if (judging || cooldownLeft > 0) return;
    const t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 600);
      setHold(k);
      if (k >= 1) {
        setHold(0);
        void doSubmit();
        return;
      }
      holdTimer.current = requestAnimationFrame(step);
    };
    holdTimer.current = requestAnimationFrame(step);
  };
  const endHold = () => {
    if (holdTimer.current) cancelAnimationFrame(holdTimer.current);
    setHold(0);
  };

  const hints = state.hints[slug] ?? [];
  const statement = useMemo(() => (problem ? renderMarkdown(problem.statement_md) : ""), [problem]);
  const io = useMemo(
    () => (problem ? { i: renderMarkdown(problem.input_md), o: renderMarkdown(problem.output_md), c: renderMarkdown(problem.constraints_md) } : null),
    [problem],
  );
  const onCard = card ? serverNow() - (state.dealtAt[slot] || serverNow()) : 0;
  const inflight = state.inflight;
  const total = inflight?.total || problem?.tests_total || 0;
  const passed = inflight ? inflight.passed : lv && lv.slot === slot ? (lv.passed ?? 0) : 0;
  const failed = !inflight && lv && lv.slot === slot && !lv.void ? lv.failed_test : null;
  const sel = run?.tests[selected];

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="workspace">
      {/* Top bar: card tabs, stakes, stopwatch, actions */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-700 bg-slate-800 px-3 py-2">
        <button className="btn btn-ghost !min-h-8 !px-2 text-xs" onClick={onBack} aria-label={`${t("editor.back")} (Esc)`}>
          ← {t("editor.back")}
        </button>
        <div className="flex gap-1" role="tablist" aria-label="Cards">
          {state.hand.map((c, i) => (
            <button
              key={i}
              role="tab"
              aria-selected={i === slot}
              disabled={!c.problem}
              onClick={() => onSlot(i)}
              className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${i === slot ? "bg-slate-950 text-white ring-1 ring-[var(--accent)]" : "bg-slate-700 text-slate-300"}`}
              title={`Alt+${i + 1}`}
            >
              <span className="inline-block h-2 w-2 rotate-45" style={{ background: tierColor(c.tier) }} />
              <span className="max-w-[8rem] truncate">{c.problem?.title ?? t("card.dealing")}</span>
              {drafts[i]?.problem && drafts[i].problem === c.problem?.slug && <span>✎</span>}
            </button>
          ))}
        </div>
        {preview && (
          <span className="pixel text-[9px]">
            <span className="text-green-300">{t("card.hit")} {fmt(preview.damage)}</span> · <span className="text-red-300">{t("card.backfire")} {fmt(preview.recoil)}</span>
          </span>
        )}
        <span className="ml-auto font-mono text-xs text-slate-400" title={t("editor.time_on_card")}>
          ⏱ {mmss(onCard)}
        </span>
        <LanguagePicker languages={languages} value={language} onChange={setLanguage} />
        {fellBackFrom && (
          <span className="text-[10px] text-amber-300" role="status">
            {t("editor.lang_fallback", { language: fellBackFrom.name, fallback: lang.name })}
          </span>
        )}
        <button
          className="btn btn-ghost !min-h-8 text-xs"
          onClick={insertTemplate}
          title={t("editor.template_title", { language: lang.name })}
          data-testid="insert-template"
        >
          ⎘ {t("editor.template")}
        </button>
        <button className="btn btn-ghost !min-h-8 text-xs" onClick={() => void doRun()} disabled={running} data-testid="run" title="Ctrl/Cmd+Enter">
          {running ? t("editor.judging") : `▶ ${t("editor.run")}`}
        </button>
        <button className="btn btn-ghost !min-h-8 text-xs" onClick={onHint} disabled={(state.charges.hints === 0)} title="Alt+H">
          💡 {t("powerup.hint")} ({state.charges.hints < 0 ? "∞" : state.charges.hints})
        </button>
        <button
          data-testid="submit"
          className="btn btn-primary relative !min-h-9 overflow-hidden text-xs"
          disabled={judging || cooldownLeft > 0 || !card?.problem}
          onPointerDown={startHold}
          onPointerUp={endHold}
          onPointerLeave={endHold}
          onKeyDown={(e) => {
            if (e.key === " " || e.key === "Enter") {
              e.preventDefault();
              void doSubmit();
            }
          }}
          title={t("editor.hold")}
        >
          <span className="absolute inset-y-0 left-0 bg-[var(--accent)] opacity-60" style={{ width: `${hold * 100}%` }} aria-hidden />
          <span className="relative">
            {judging
              ? t("editor.judging")
              : cooldownLeft > 0
                ? `⟳ ${(cooldownLeft / 1000).toFixed(1)}s`
                : armed
                  ? t("editor.press_again")
                  : preview
                    ? t("editor.submit_stakes", { hit: fmt(preview.damage), bf: fmt(preview.recoil) })
                    : t("editor.submit")}
          </span>
        </button>
      </div>
      {submitErr && <div className="bg-red-950 px-3 py-1 text-xs text-red-300">{submitErr}</div>}

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* Problem panel */}
        <section className="min-h-0 overflow-y-auto border-slate-700 bg-slate-950 p-4 text-sm text-slate-300 md:w-1/3 md:border-r" aria-label="Problem">
          {!problem ? (
            <div className="space-y-2">
              <div className="skeleton h-5 w-2/3 rounded" />
              <div className="skeleton h-24 rounded" />
            </div>
          ) : (
            <>
              <h2 className="mb-1 flex items-center gap-2 text-lg font-bold text-white">
                <span className="inline-block h-3 w-3 rotate-45" style={{ background: tierColor(problem.tier) }} />
                {problem.title}
              </h2>
              {preview && <div className="mb-3 text-xs text-slate-400">{t(`scenario.${preview.scenario}`)} · T{problem.tier}</div>}
              <div className="prose-sm space-y-2 [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-5" dangerouslySetInnerHTML={{ __html: statement }} />
              {io && (
                <>
                  <h3 className="pixel mt-4 mb-1 text-[9px] text-slate-400">INPUT</h3>
                  <div className="[&_p]:mb-1" dangerouslySetInnerHTML={{ __html: io.i }} />
                  <h3 className="pixel mt-3 mb-1 text-[9px] text-slate-400">OUTPUT</h3>
                  <div className="[&_p]:mb-1" dangerouslySetInnerHTML={{ __html: io.o }} />
                  <h3 className="pixel mt-3 mb-1 text-[9px] text-slate-400">CONSTRAINTS</h3>
                  <div className="[&_ul]:list-disc [&_ul]:pl-5" dangerouslySetInnerHTML={{ __html: io.c }} />
                </>
              )}
              {problem.samples.map((s, i) => (
                <div key={i} className="mt-3 grid grid-cols-2 gap-2">
                  {(["input", "output"] as const).map((k) => (
                    <div key={k} className="rounded border border-slate-800 bg-slate-900 p-2">
                      <div className="mb-1 flex items-center justify-between text-[10px] text-slate-500">
                        <span>
                          {k === "input" ? t("editor.input") : t("editor.expected")} #{i + 1}
                        </span>
                        <button className="text-slate-400 hover:text-white" onClick={() => void navigator.clipboard?.writeText(s[k])} aria-label="Copy">
                          ⧉
                        </button>
                      </div>
                      <pre className="max-h-32 overflow-auto font-mono text-xs text-slate-200">{s[k]}</pre>
                    </div>
                  ))}
                </div>
              ))}
              {hints.length > 0 && (
                <details open className="mt-4 rounded border border-yellow-800 bg-yellow-950/40 p-2">
                  <summary className="pixel cursor-pointer text-[9px] text-yellow-300">{t("editor.hints")}</summary>
                  {hints.map((h, i) => (
                    <div key={i} className="mt-2 whitespace-pre-wrap font-mono text-xs text-yellow-100">
                      <span className="text-yellow-500">{i + 1}.</span> {i === hints.length - 1 ? <Typewriter text={h} /> : h}
                    </div>
                  ))}
                </details>
              )}
            </>
          )}
        </section>

        {/* Editor and results drawer */}
        <section className="relative flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-slate-800 bg-slate-900 px-2 py-1 text-[11px] text-slate-500">
            <button className="rounded bg-slate-800 px-2 py-0.5 text-slate-300 hover:bg-slate-700" onClick={() => onChange(code.includes("sys.stdin.readline") ? code : `import sys\ninput = sys.stdin.readline\n${code}`)}>
              {t("editor.fast_input")}
            </button>
            <span>{t("battle.fairplay")}</span>
            <span className="ml-auto">{savedAt ? t("editor.saved", { time: savedAt }) : ""}</span>
          </div>
          <div className="min-h-[200px] flex-1 bg-slate-950">
            <CodeEditor value={code} onChange={onChange} language={monacoLang} fontSize={fontSize} accent={skin.palette.accent} onRun={() => void doRun()} onSubmit={() => (armed ? void doSubmit() : setArmed(true))} />
          </div>
          {stamp && (
            <div key={stamp.t} className={`stamp pointer-events-none absolute right-6 top-12 z-10 rotate-[-8deg] rounded border-4 px-4 py-2 ${stamp.ok ? "border-green-400 text-green-300" : "glitch border-red-500 text-red-400"}`}>
              <span className="pixel text-sm">{stamp.text}</span>
              {failed ? <span className="ml-2 text-xs">{t("verdict.failed_test", { n: failed })}</span> : null}
            </div>
          )}
          {/* Results drawer */}
          <div className="max-h-[40%] min-h-[110px] overflow-y-auto border-t border-slate-700 bg-slate-900 p-2 text-xs" data-testid="results">
            <div className="mb-2 flex flex-wrap items-center gap-1" aria-label="Submit progress">
              {Array.from({ length: total }).map((_, i) => (
                <span
                  key={i}
                  className={`h-3 w-3 rounded-sm ${i < passed ? "bg-green-500" : failed === i + 1 ? "bg-red-500" : inflight ? "animate-pulse bg-slate-600" : "bg-slate-700"}`}
                  title={`test ${i + 1}`}
                />
              ))}
              {lv && lv.slot === slot && !inflight && (
                <span className={`ml-2 font-bold ${lv.verdict === "AC" ? "text-green-400" : "text-red-400"}`} data-testid="submit-verdict">
                  {lv.void ? t("verdict.void", { reason: lv.reason ?? "" }) : `${t(`verdict.${lv.verdict}`)}${lv.failed_test ? ` ${t("verdict.failed_test", { n: lv.failed_test })}` : ""}`}
                </span>
              )}
            </div>
            {lv && lv.slot === slot && !inflight && lv.compile_error && <CompilerOutput text={lv.compile_error} />}
            <div className="mb-2 flex items-center gap-2">
              <label className="flex items-center gap-1 text-slate-400">
                <input type="checkbox" checked={useCustom} onChange={(e) => setUseCustom(e.target.checked)} /> {t("editor.use_custom")}
              </label>
              {run && <span className="text-slate-500">{t("editor.run_limit", { ms: run.time_cap_ms })}</span>}
            </div>
            {useCustom && (
              <textarea className="mb-2 h-16 w-full rounded bg-slate-950 p-1 font-mono" placeholder={t("editor.custom_input")} value={custom} maxLength={65536} onChange={(e) => setCustom(e.target.value)} />
            )}
            {runErr && <div className="text-red-400">{runErr}</div>}
            {!run && !runErr && <div className="text-slate-500">{t("editor.no_results")}</div>}
            {run?.compile_error && (
              <div className="mb-2">
                <div className="font-bold text-red-400">{t("verdict.CE")}</div>
                <CompilerOutput text={run.compile_error} />
              </div>
            )}
            {run && (
              <div className="grid gap-2 md:grid-cols-[minmax(0,14rem)_1fr]">
                <table className="w-full text-left">
                  <tbody>
                    {run.tests.map((tt, i) => (
                      <tr key={i} className={`cursor-pointer ${i === selected ? "bg-slate-800" : ""}`} onClick={() => setSelected(i)} data-testid={`run-row-${i}`}>
                        <td className="px-1">#{tt.index + 1}</td>
                        <td className={`px-1 font-bold ${tt.code === "AC" || tt.code === "OK" ? "text-green-400" : "text-red-400"}`}>{tt.code}</td>
                        <td className="px-1 text-slate-400">{tt.time_ms} ms</td>
                        <td className="px-1 text-slate-400">{(tt.memory_kb / 1024).toFixed(1)} MB</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {sel && (
                  <div className="grid gap-2 font-mono md:grid-cols-3">
                    <div>
                      <div className="text-slate-500">{t("editor.input")}</div>
                      <pre className="max-h-24 overflow-auto whitespace-pre-wrap">{sel.input}</pre>
                    </div>
                    {sel.expected !== null && (
                      <div>
                        <div className="text-slate-500">{t("editor.expected")}</div>
                        <pre className="max-h-24 overflow-auto whitespace-pre-wrap">{sel.expected}</pre>
                      </div>
                    )}
                    <div>
                      <div className="text-slate-500">{t("editor.output")}</div>
                      <div className="max-h-24 overflow-auto">{sel.expected !== null ? <Diff expected={sel.expected} actual={sel.output ?? ""} /> : <pre>{sel.output}</pre>}</div>
                      {sel.stderr && (
                        <>
                          <div className="mt-1 text-slate-500">{t("editor.stderr")}</div>
                          <pre className="max-h-24 overflow-auto whitespace-pre-wrap text-red-300">{sel.stderr}</pre>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
