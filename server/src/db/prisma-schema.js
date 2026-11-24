// A small reader for prisma/schema.prisma: models, fields, types, defaults,
// keys and indexes. Used by the in-memory Prisma stand-in the tests run on
// (test/fake-prisma.js) and by scripts/migration-sql.js, so both follow the
// schema file instead of a copy of it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCHEMA_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'prisma', 'schema.prisma');

const SCALARS = new Set(['Int', 'String', 'Boolean', 'DateTime', 'Json', 'Float', 'Decimal', 'BigInt']);

function parseArgs(s) {
  // "fields: [a, b], references: [id], map: "x"" -> {fields: [...], references: [...], map: 'x'}
  const out = {};
  const re = /(\w+)\s*:\s*(\[[^\]]*\]|"[^"]*"|\w+)/g;
  let m;
  while ((m = re.exec(s))) {
    const v = m[2];
    if (v.startsWith('[')) out[m[1]] = v.slice(1, -1).split(',').map((x) => x.trim()).filter(Boolean);
    else if (v.startsWith('"')) out[m[1]] = v.slice(1, -1);
    else out[m[1]] = v;
  }
  return out;
}

export function readSchema(file = SCHEMA_FILE) {
  const text = fs.readFileSync(file, 'utf8');
  const models = {};
  const blocks = text.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm);
  for (const [, name, body] of blocks) {
    const model = { name, table: name, fields: {}, order: [], uniques: [], indexes: [], id: null };
    for (const raw of body.split('\n')) {
      const line = raw.replace(/\/\/.*$/, '').trim();
      if (!line) continue;
      if (line.startsWith('@@')) {
        const m = line.match(/^@@(\w+)\((.*)\)$/);
        const kind = m[1];
        const inner = m[2];
        if (kind === 'map') { model.table = inner.replace(/"/g, ''); continue; }
        const cols = inner.match(/^\[([^\]]*)\]/)[1].split(',').map((c) => c.trim().replace(/\(.*\)$/, ''));
        const args = parseArgs(inner.slice(inner.indexOf(']') + 1));
        if (kind === 'unique') model.uniques.push({ fields: cols, map: args.map || null });
        if (kind === 'index') model.indexes.push({ fields: cols, map: args.map || null });
        continue;
      }
      const m = line.match(/^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/);
      if (!m) continue;
      const [, fname, type, isList, optional, attrs] = m;
      const f = { name: fname, type, list: Boolean(isList), optional: Boolean(optional), scalar: SCALARS.has(type), attrs };
      if (!f.scalar) {
        const rel = attrs.match(/@relation\(([^)]*)\)/);
        f.relation = rel ? parseArgs(rel[1]) : null;
      }
      if (/@id\b/.test(attrs)) { f.id = true; model.id = fname; }
      if (/@unique\b/.test(attrs)) {
        const um = attrs.match(/@unique\(map:\s*"([^"]+)"\)/);
        f.unique = true;
        model.uniques.push({ fields: [fname], map: um ? um[1] : null });
      }
      const dm = attrs.match(/@default\((.*?)\)(?=\s|$)/);
      if (dm) {
        let d = dm[1];
        if (d === 'autoincrement(') d = 'autoincrement()';
        if (d.startsWith('autoincrement')) f.default = { auto: true };
        else if (d.startsWith('now')) f.default = { now: true };
        else if (d.startsWith('"')) f.default = { value: JSON.parse(d) };
        else if (d === 'true' || d === 'false') f.default = { value: d === 'true' };
        else f.default = { value: Number(d) };
      }
      const db = attrs.match(/@db\.(\w+)(?:\((\d+)\))?/);
      if (db) f.db = { type: db[1], arg: db[2] ? Number(db[2]) : null };
      model.fields[fname] = f;
      model.order.push(fname);
    }
    models[name] = model;
  }
  return models;
}

/** Prisma client property names: model User -> prisma.user, RefreshToken -> prisma.refreshToken. */
export const clientName = (model) => model[0].toLowerCase() + model.slice(1);
