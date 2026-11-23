/**
 * Starting code for the editor. Order of preference for a fresh card:
 * your own template for the language, then the problem's stub, then the
 * built-in template below.
 */

export const DEFAULT_TEMPLATES: Record<string, string> = {
  cpp: `#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    return 0;
}
`,
  python: `import sys
input = sys.stdin.readline


def main():
    pass


main()
`,
};

export function templateFor(language: string, templates: Record<string, string> | undefined): string {
  const mine = templates?.[language];
  return mine && mine.trim() ? mine : (DEFAULT_TEMPLATES[language] ?? "");
}

export function hasCustomTemplate(language: string, templates: Record<string, string> | undefined): boolean {
  return !!templates?.[language]?.trim();
}

export function startingCode(language: string, stub: string | undefined, templates: Record<string, string> | undefined): string {
  if (hasCustomTemplate(language, templates)) return templates![language];
  if (stub && stub.trim()) return stub;
  return DEFAULT_TEMPLATES[language] ?? "";
}
