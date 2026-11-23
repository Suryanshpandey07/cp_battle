import { Component, lazy, Suspense, type ReactNode } from "react";

export interface CodeEditorProps {
  value: string;
  onChange: (v: string) => void;
  language: string;
  fontSize: number;
  accent: string;
  onPaste?: (chars: number) => void;
  onRun?: () => void;
  onSubmit?: () => void;
}

const Monaco = lazy(() => import("./MonacoEditor"));

/** Plain fallback: used while Monaco loads, or if it cannot load at all. */
export function TextEditor(p: CodeEditorProps) {
  return (
    <textarea
      aria-label="Code editor"
      data-testid="code-editor"
      className="h-full w-full resize-none bg-transparent p-3 font-mono text-slate-200 outline-none"
      style={{ fontSize: p.fontSize, tabSize: 4 }}
      spellCheck={false}
      value={p.value}
      onChange={(e) => p.onChange(e.target.value)}
      onPaste={(e) => p.onPaste?.(e.clipboardData.getData("text").length)}
      onKeyDown={(e) => {
        if (e.key === "Tab") {
          e.preventDefault();
          const el = e.currentTarget;
          const s = el.selectionStart;
          const v = el.value;
          p.onChange(v.slice(0, s) + "    " + v.slice(el.selectionEnd));
          requestAnimationFrame(() => el.setSelectionRange(s + 4, s + 4));
        }
      }}
    />
  );
}

class Boundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function CodeEditor(p: CodeEditorProps) {
  return (
    <Boundary fallback={<TextEditor {...p} />}>
      <Suspense fallback={<TextEditor {...p} />}>
        <Monaco {...p} />
      </Suspense>
    </Boundary>
  );
}
