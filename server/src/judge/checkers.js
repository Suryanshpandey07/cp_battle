// Output checkers. Comparison always follows the problem's checker, never a raw string match.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CHECKERS = ['exact', 'tokens', 'float', 'unordered_lines', 'custom'];

function lines(text) {
  const out = text.replaceAll('\r\n', '\n').split('\n').map((ln) => ln.trimEnd());
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

const split = (text) => text.split(/\s+/).filter(Boolean);
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Line by line after trimming trailing spaces and ignoring trailing blank lines. */
export const exact = (expected, actual) => same(lines(expected), lines(actual));
export const tokens = (expected, actual) => same(split(expected), split(actual));

const NUM_RE = /^[+-]?(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?$/;

function num(tok) {
  if (!NUM_RE.test(tok)) return null;
  const v = Number(tok.replaceAll('_', ''));
  return Number.isFinite(v) ? v : null;
}

export function floatTokens(expected, actual, eps = 1e-6) {
  const e = split(expected);
  const a = split(actual);
  if (e.length !== a.length) return false;
  for (let i = 0; i < e.length; i++) {
    const fx = num(e[i]);
    const fy = num(a[i]);
    if (fx === null || fy === null) {
      if (e[i] !== a[i]) return false;
      continue;
    }
    const d = Math.abs(fx - fy);
    if (d > eps && d > eps * Math.max(Math.abs(fx), Math.abs(fy))) return false;
  }
  return true;
}

export const unorderedLines = (expected, actual) => same(lines(expected).sort(), lines(actual).sort());

/**
 * Run a problem's checker script (JavaScript, run with this Node): argv input
 * expected actual; exit 0 means pass. Dev-grade: no sandbox beyond a timeout.
 * No seed problem needs it.
 */
export function custom(script, input, expected, actual, timeoutS = 5) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-chk-'));
  try {
    const paths = [['checker.mjs', script], ['in.txt', input], ['exp.txt', expected], ['out.txt', actual]].map(([name, content]) => {
      const p = path.join(d, name);
      fs.writeFileSync(p, content);
      return p;
    });
    const r = spawnSync(process.execPath, paths, { cwd: d, env: { PATH: process.env.PATH || '' }, timeout: timeoutS * 1000 });
    return r.status === 0;
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
}

export function check(name, expected, actual, input = '', script = null) {
  switch (name) {
    case 'exact': return exact(expected, actual);
    case 'tokens': return tokens(expected, actual);
    case 'float': return floatTokens(expected, actual);
    case 'unordered_lines': return unorderedLines(expected, actual);
    case 'custom':
      if (!script) throw new Error('custom checker needs a script');
      return custom(script, input, expected, actual);
    default: throw new Error(`unknown checker '${name}'`);
  }
}
