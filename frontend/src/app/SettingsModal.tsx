import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LanguagePicker, useLanguages } from "../features/editor/languages";
import { DEFAULT_TEMPLATES, hasCustomTemplate, templateFor } from "../lib/templates";
import { t } from "../i18n";
import { useSettings, type Settings } from "../state/settings";

/** A modal that traps focus. Settings are saved locally and to the profile. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    const prev = document.activeElement as HTMLElement | null;
    el?.querySelector<HTMLElement>("button, input, select")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key !== "Tab" || !el) return;
      const f = Array.from(el.querySelectorAll<HTMLElement>("button, input, select, a[href], textarea"));
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus();
    };
  }, [onClose]);
  // Rendered at the page root: an ancestor with a backdrop blur or transform
  // (like the sticky header) would otherwise trap this fixed overlay in its box.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={ref} className="panel my-auto flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col p-5">
        <div className="mb-4 flex shrink-0 items-center justify-between">
          <h2 className="pixel text-xs text-green-400">{title}</h2>
          <button className="btn btn-ghost !min-h-8 !px-2" onClick={onClose} aria-label={t("common.close")}>
            ✕
          </button>
        </div>
        <div className="-mr-2 min-h-0 overflow-y-auto pr-2">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-4 py-1.5 text-sm text-slate-300">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { s, set } = useSettings();
  const slider = (k: keyof Settings, max = 1, step = 0.05) => (
    <input type="range" min={0} max={max} step={step} value={s[k] as number} onChange={(e) => set({ [k]: Number(e.target.value) } as Partial<Settings>)} />
  );
  return (
    <Modal title={t("settings.title")} onClose={onClose}>
      <Row label={t("settings.volume")}>{slider("master")}</Row>
      <Row label={t("settings.effects")}>{slider("effects")}</Row>
      <Row label={t("settings.music")}>
        <input type="checkbox" checked={s.music} onChange={(e) => set({ music: e.target.checked })} data-testid="music-toggle" />
      </Row>
      <Row label={t("settings.music_volume")}>{slider("musicVolume")}</Row>
      <Row label={t("settings.quality")}>
        <select className="rounded bg-slate-800 px-2 py-1" value={s.quality} onChange={(e) => set({ quality: e.target.value as Settings["quality"] })}>
          <option value="auto">{t("common.auto")}</option>
          <option value="high">{t("common.high")}</option>
          <option value="low">{t("common.low")}</option>
          <option value="off">{t("common.off")}</option>
        </select>
      </Row>
      <Row label={t("settings.reduced_motion")}>
        <select className="rounded bg-slate-800 px-2 py-1" value={s.reducedMotion} onChange={(e) => set({ reducedMotion: e.target.value as Settings["reducedMotion"] })}>
          <option value="auto">{t("common.auto")}</option>
          <option value="on">{t("common.on")}</option>
          <option value="off">{t("common.off")}</option>
        </select>
      </Row>
      <Row label={t("settings.shake")}>{slider("shake")}</Row>
      <Row label={t("settings.flash")}>{slider("flash")}</Row>
      <Row label={t("settings.crt")}>
        <input type="checkbox" checked={s.crt} onChange={(e) => set({ crt: e.target.checked })} />
      </Row>
      <Row label={t("settings.cb")}>
        <input type="checkbox" checked={s.cbPalette} onChange={(e) => set({ cbPalette: e.target.checked })} />
      </Row>
      <Row label={t("settings.font")}>
        <input type="number" min={11} max={24} className="w-16 rounded bg-slate-800 px-2 py-1" value={s.fontSize} onChange={(e) => set({ fontSize: Number(e.target.value) })} />
      </Row>
      <CodeSettings />
    </Modal>
  );
}

/** Default coding language and your own starting template per language. */
function CodeSettings() {
  const { s, set } = useSettings();
  const { languages, lang, setLanguage } = useLanguages();
  const [editing, setEditing] = useState(lang.id);
  const [draft, setDraft] = useState(() => templateFor(lang.id, s.templates));
  const [saved, setSaved] = useState(false);
  const pick = (id: string) => {
    setEditing(id);
    setDraft(templateFor(id, s.templates));
    setSaved(false);
  };
  const save = (code: string) => {
    const next = { ...s.templates };
    if (!code.trim() || code === DEFAULT_TEMPLATES[editing]) delete next[editing];
    else next[editing] = code;
    set({ templates: next });
    setSaved(true);
  };
  const tooBig = new Blob([draft]).size > 16 * 1024;
  return (
    <section className="mt-3 border-t border-slate-700 pt-3" aria-label={t("settings.code")}>
      <h3 className="mb-1 text-sm font-bold text-white">{t("settings.code")}</h3>
      <Row label={t("settings.code_language")}>
        <LanguagePicker languages={languages} value={lang.id} onChange={setLanguage} />
      </Row>
      <div className="mt-2 flex items-center justify-between gap-2 text-sm text-slate-300">
        <span>{t("settings.templates")}</span>
        <span className="flex gap-1" role="tablist">
          {languages.map((l) => (
            <button
              key={l.id}
              role="tab"
              aria-selected={editing === l.id}
              onClick={() => pick(l.id)}
              className={`rounded px-2 py-0.5 text-xs ${editing === l.id ? "bg-slate-600 text-white" : "bg-slate-800 text-slate-400"}`}
              data-testid={`template-tab-${l.id}`}
            >
              {l.name}
            </button>
          ))}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">{t("settings.templates_help")}</p>
      <textarea
        className="mt-2 h-56 w-full resize-y rounded border border-slate-700 bg-slate-950 p-2 font-mono text-xs leading-5 text-slate-200"
        spellCheck={false}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setSaved(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Tab") {
            e.preventDefault();
            const el = e.currentTarget;
            const at = el.selectionStart;
            const next = draft.slice(0, at) + "    " + draft.slice(el.selectionEnd);
            setDraft(next);
            requestAnimationFrame(() => el.setSelectionRange(at + 4, at + 4));
          }
        }}
        aria-label={t("settings.templates")}
        data-testid="template-editor"
      />
      <div className="mt-1 flex items-center gap-2">
        <button className="btn btn-primary !min-h-8 text-xs" disabled={tooBig} onClick={() => save(draft)} data-testid="template-save">
          {t("settings.template_save")}
        </button>
        <button
          className="btn btn-ghost !min-h-8 text-xs"
          onClick={() => {
            setDraft(DEFAULT_TEMPLATES[editing] ?? "");
            save("");
          }}
        >
          {t("settings.template_reset")}
        </button>
        <span className="text-xs text-slate-500">
          {hasCustomTemplate(editing, s.templates) ? t("settings.template_custom") : t("settings.template_builtin")}
          {saved && <span className="ml-2 text-green-400">✓ {t("settings.template_saved")}</span>}
          {tooBig && <span className="ml-2 text-red-400">16 KB max</span>}
        </span>
      </div>
    </section>
  );
}
