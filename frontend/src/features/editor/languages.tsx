/** Coding languages: the list comes from game-config.json via /api/config, the choice from settings. */
import { useQuery } from "@tanstack/react-query";
import { t } from "../../i18n";
import { api } from "../../net/api";
import { useSettings } from "../../state/settings";

export interface LangInfo {
  id: string;
  name: string;
  monaco: string;
  comment?: string;
  available?: boolean; // false when the server has no compiler for it
}

const PYTHON: LangInfo = { id: "python", name: "Python 3", monaco: "python", comment: "#", available: true };

export function useLanguages(): { languages: LangInfo[]; lang: LangInfo; setLanguage: (id: string) => void; fellBackFrom: LangInfo | null } {
  const { data } = useQuery<{ languages?: LangInfo[] }>({ queryKey: ["public-config"], queryFn: () => api("/config"), staleTime: 60_000 });
  const languages = data?.languages?.length ? data.languages : [PYTHON];
  const pref = useSettings((s) => s.s.codeLanguage) || "python";
  const set = useSettings((s) => s.set);
  const usable = languages.filter((l) => l.available !== false);
  const wanted = languages.find((l) => l.id === pref);
  const lang = wanted && wanted.available !== false ? wanted : (usable[0] ?? PYTHON);
  return {
    languages,
    lang,
    setLanguage: (id: string) => set({ codeLanguage: id }),
    fellBackFrom: wanted && wanted.id !== lang.id ? wanted : null,
  };
}

export function LanguagePicker({ languages, value, onChange }: { languages: LangInfo[]; value: string; onChange: (id: string) => void }) {
  return (
    <select className="rounded bg-slate-900 px-2 py-1 text-xs" value={value} aria-label="Language" data-testid="language" onChange={(e) => onChange(e.target.value)}>
      {languages.map((l) => (
        <option key={l.id} value={l.id} disabled={l.available === false}>
          {l.available === false ? t("editor.lang_unavailable", { language: l.name }) : l.name}
        </option>
      ))}
    </select>
  );
}
