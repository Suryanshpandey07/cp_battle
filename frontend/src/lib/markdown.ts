import katex from "katex";
import "katex/dist/katex.min.css";
import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: false });

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Markdown with KaTeX maths ($...$ inline, $$...$$ display). Problem text is
 * escaped before rendering, so it cannot inject HTML. */
export function renderMarkdown(md: string): string {
  const math: string[] = [];
  const stash = (tex: string, display: boolean) => {
    math.push(katex.renderToString(tex, { displayMode: display, throwOnError: false, output: "html" }));
    return `\uE000${math.length - 1}\uE000`;
  };
  let src = escapeHtml(md)
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, t: string) => stash(unescape(t), true))
    .replace(/\$([^$\n]+?)\$/g, (_, t: string) => stash(unescape(t), false));
  let html = marked.parse(src, { async: false }) as string;
  html = html.replace(/\uE000(\d+)\uE000/g, (_, i: string) => math[Number(i)]);
  src = "";
  return html;
}

function unescape(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
