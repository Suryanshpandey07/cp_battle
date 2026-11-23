/** Compiler messages keep their line breaks and the ^~~~ marker under the mistake. */
export function CompilerOutput({ text }: { text: string }) {
  return (
    <pre className="mt-1 max-h-48 overflow-auto whitespace-pre rounded border border-red-900/60 bg-slate-950 p-2 font-mono text-[11px] leading-4 text-red-200" data-testid="compiler-output">
      {text}
    </pre>
  );
}
