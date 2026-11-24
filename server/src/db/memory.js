// An in-memory stand-in for PrismaClient: the tests use it, and so does
// DATABASE_URL=memory (a throwaway database for the demo, nothing survives a
// restart). It reads prisma/schema.prisma, so a misspelt model or field fails
// here just as it would against PostgreSQL: unknown fields throw, defaults and
// autoincrement ids are filled in, unique keys raise P2002 and relations check
// their foreign keys (P2003). It covers the subset of the Prisma API the server
// uses; raw SQL goes to named handlers (src/db/memory-sql.js answers the
// queries in src/db/sql.js).

import { readSchema, clientName } from './prisma-schema.js';

class MemoryDbError extends Error {
  constructor(code, message, meta = {}) {
    super(message);
    this.code = code;
    this.meta = meta;
    this.name = 'PrismaClientKnownRequestError';
  }
}

const clone = (v) => (v instanceof Date ? new Date(v) : v === null || typeof v !== 'object' ? v : structuredClone(v));

function cmp(a, b) {
  if (a instanceof Date) a = a.getTime();
  if (b instanceof Date) b = b.getTime();
  return a < b ? -1 : a > b ? 1 : 0;
}

function matchValue(value, cond, field) {
  if (cond === null) return value === null || value === undefined;
  if (cond instanceof Date || typeof cond !== 'object') return cmp(value, cond) === 0 && value !== null && value !== undefined;
  const insensitive = cond.mode === 'insensitive';
  const norm = (v) => (insensitive && typeof v === 'string' ? v.toLowerCase() : v);
  for (const [op, arg] of Object.entries(cond)) {
    if (op === 'mode') continue;
    const v = norm(value);
    const a = Array.isArray(arg) ? arg.map(norm) : norm(arg);
    switch (op) {
      case 'equals': if (!(a === null ? v == null : v != null && cmp(v, a) === 0)) return false; break;
      case 'not': if (a !== null && typeof a === 'object' && !(a instanceof Date) ? matchValue(value, arg, field) : (a === null ? v == null : v != null && cmp(v, a) === 0)) return false; break;
      case 'in': if (v == null || !a.some((x) => cmp(v, x) === 0)) return false; break;
      case 'notIn': if (v == null || a.some((x) => cmp(v, x) === 0)) return false; break;
      case 'lt': if (!(v != null && cmp(v, a) < 0)) return false; break;
      case 'lte': if (!(v != null && cmp(v, a) <= 0)) return false; break;
      case 'gt': if (!(v != null && cmp(v, a) > 0)) return false; break;
      case 'gte': if (!(v != null && cmp(v, a) >= 0)) return false; break;
      case 'contains': if (!(typeof v === 'string' && v.includes(a))) return false; break;
      case 'startsWith': if (!(typeof v === 'string' && v.startsWith(a))) return false; break;
      default: throw new Error(`fake prisma: unsupported filter ${op} on ${field}`);
    }
  }
  return true;
}

class Delegate {
  constructor(db, model) {
    this.db = db;
    this.model = model;
    this.rows = [];
    this.nextId = 1;
  }

  _check(field) {
    const f = this.model.fields[field];
    if (!f) throw new Error(`fake prisma: ${this.model.name} has no field ${field}`);
    if (!f.scalar) throw new Error(`fake prisma: relation field ${this.model.name}.${field} is not supported here`);
    return f;
  }

  _where(row, where) {
    if (!where) return true;
    for (const [k, cond] of Object.entries(where)) {
      if (k === 'AND') { if (![].concat(cond).every((w) => this._where(row, w))) return false; continue; }
      if (k === 'OR') { if (!cond.some((w) => this._where(row, w))) return false; continue; }
      if (k === 'NOT') { if ([].concat(cond).some((w) => this._where(row, w))) return false; continue; }
      const compound = this.model.uniques.find((u) => u.fields.length > 1 && u.fields.join('_') === k);
      if (compound) { if (!this._where(row, cond)) return false; continue; }
      this._check(k);
      if (!matchValue(row[k], cond, k)) return false;
    }
    return true;
  }

  _select(row, select) {
    if (!row) return null;
    if (!select) return clone(row);
    const out = {};
    for (const [k, on] of Object.entries(select)) {
      if (!on) continue;
      this._check(k);
      out[k] = clone(row[k]);
    }
    return out;
  }

  _order(rows, orderBy) {
    if (!orderBy) return rows;
    const keys = [].concat(orderBy).flatMap((o) => Object.entries(o));
    for (const [k] of keys) this._check(k);
    return [...rows].sort((a, b) => {
      for (const [k, dir] of keys) {
        const d = typeof dir === 'object' ? dir.sort : dir;
        const av = a[k];
        const bv = b[k];
        if (av == null && bv == null) continue;
        if (av == null) return d === 'desc' ? -1 : 1; // PostgreSQL: NULLS LAST ascending, FIRST descending
        if (bv == null) return d === 'desc' ? 1 : -1;
        const c = cmp(av, bv);
        if (c) return d === 'desc' ? -c : c;
      }
      return 0;
    });
  }

  _uniqueClash(row, skipRow) {
    for (const u of [{ fields: [this.model.id] }, ...this.model.uniques]) {
      if (u.fields.some((f) => row[f] === null || row[f] === undefined)) continue;
      const other = this.rows.find((r) => r !== skipRow && u.fields.every((f) => cmp(r[f], row[f]) === 0));
      if (other) return u.fields;
    }
    return null;
  }

  _checkRelations(row) {
    for (const f of Object.values(this.model.fields)) {
      if (!f.relation || !f.relation.fields) continue;
      const [col] = f.relation.fields;
      if (row[col] === null || row[col] === undefined) continue;
      const target = this.db[clientName(f.type)];
      if (!target.rows.some((r) => cmp(r[f.relation.references[0]], row[col]) === 0)) {
        throw new MemoryDbError('P2003', `Foreign key constraint failed on the field: ${this.model.table}_${col}_fkey`, { field_name: col });
      }
    }
  }

  _apply(row, data) {
    for (const [k, v] of Object.entries(data)) {
      const f = this._check(k);
      if (v !== null && typeof v === 'object' && !(v instanceof Date) && f.type !== 'Json') {
        if ('increment' in v) row[k] += v.increment;
        else if ('decrement' in v) row[k] -= v.decrement;
        else if ('set' in v) row[k] = clone(v.set);
        else throw new Error(`fake prisma: unsupported update op on ${k}`);
      } else {
        if (v === null && !f.optional) throw new Error(`fake prisma: ${this.model.name}.${k} cannot be null`);
        row[k] = f.type === 'DateTime' && v !== null ? new Date(v) : clone(v);
      }
    }
  }

  _build(data) {
    const row = {};
    for (const [name, f] of Object.entries(this.model.fields)) {
      if (!f.scalar) continue;
      if (f.default && f.default.auto) row[name] = undefined;
      else if (f.default && f.default.now) row[name] = new Date();
      else if (f.default) row[name] = f.type === 'Json' ? JSON.parse(f.default.value) : f.default.value;
      else row[name] = null;
    }
    this._apply(row, data);
    const idField = this.model.fields[this.model.id];
    if (idField.default && idField.default.auto) {
      if (row[this.model.id] === undefined || row[this.model.id] === null) row[this.model.id] = this.nextId++;
      else this.nextId = Math.max(this.nextId, row[this.model.id] + 1);
    }
    for (const [name, f] of Object.entries(this.model.fields)) {
      if (f.scalar && !f.optional && (row[name] === null || row[name] === undefined)) {
        throw new Error(`fake prisma: ${this.model.name}.${name} is required`);
      }
    }
    return row;
  }

  async create({ data, select }) {
    const row = this._build(data);
    const clash = this._uniqueClash(row, null);
    if (clash) throw new MemoryDbError('P2002', `Unique constraint failed on the fields: (${clash.join(',')})`, { target: clash });
    this._checkRelations(row);
    this.rows.push(row);
    return this._select(row, select);
  }

  async createMany({ data, skipDuplicates = false }) {
    let count = 0;
    for (const d of data) {
      try {
        await this.create({ data: d });
        count++;
      } catch (e) {
        if (!(skipDuplicates && e.code === 'P2002')) throw e;
      }
    }
    return { count };
  }

  async findUnique({ where, select }) {
    const keys = Object.keys(where);
    const ok = keys.length === 1 && (keys[0] === this.model.id
      || this.model.uniques.some((u) => u.fields.join('_') === keys[0]));
    if (!ok) throw new Error(`fake prisma: findUnique on ${this.model.name} needs a unique key, got ${keys}`);
    return this._select(this.rows.find((r) => this._where(r, where)) || null, select);
  }

  async findFirst(args = {}) {
    const [row] = await this.findMany({ ...args, take: 1 });
    return row || null;
  }

  async findMany({ where, orderBy, take, skip, select } = {}) {
    let rows = this._order(this.rows.filter((r) => this._where(r, where)), orderBy);
    if (skip) rows = rows.slice(skip);
    if (take !== undefined) rows = rows.slice(0, take);
    return rows.map((r) => this._select(r, select));
  }

  async count({ where } = {}) {
    return this.rows.filter((r) => this._where(r, where)).length;
  }

  async update({ where, data, select }) {
    const row = this.rows.find((r) => this._where(r, where));
    if (!row) throw new MemoryDbError('P2025', `${this.model.name} to update not found`);
    const before = { ...row };
    this._apply(row, data);
    const clash = this._uniqueClash(row, row);
    if (clash) { Object.assign(row, before); throw new MemoryDbError('P2002', 'Unique constraint failed', { target: clash }); }
    return this._select(row, select);
  }

  async updateMany({ where, data }) {
    const rows = this.rows.filter((r) => this._where(r, where));
    for (const r of rows) this._apply(r, data);
    return { count: rows.length };
  }

  async upsert({ where, create, update, select }) {
    const row = this.rows.find((r) => this._where(r, where));
    if (row) return this.update({ where, data: update, select });
    return this.create({ data: create, select });
  }

  async delete({ where }) {
    const i = this.rows.findIndex((r) => this._where(r, where));
    if (i < 0) throw new MemoryDbError('P2025', `${this.model.name} to delete not found`);
    return this.rows.splice(i, 1)[0];
  }

  async deleteMany({ where } = {}) {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !this._where(r, where));
    return { count: before - this.rows.length };
  }
}

export class MemoryDb {
  constructor(rawHandlers = {}) {
    this.models = readSchema();
    this.rawHandlers = rawHandlers;
    this.fake = true;
    for (const m of Object.values(this.models)) this[clientName(m.name)] = new Delegate(this, m);
  }

  _snapshot() {
    return Object.values(this.models).map((m) => {
      const d = this[clientName(m.name)];
      return [d, d.rows.map((r) => ({ ...r, ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, clone(v)])) })), d.nextId];
    });
  }

  async $transaction(arg) {
    const snap = this._snapshot();
    try {
      if (typeof arg === 'function') return await arg(this);
      return await Promise.all(arg);
    } catch (e) {
      for (const [d, rows, nextId] of snap) { d.rows = rows; d.nextId = nextId; }
      throw e;
    }
  }

  /** Raw SQL goes to a handler named by the query's leading comment, e.g. "/* ladder_top *\/". */
  async $queryRaw(strings, ...values) {
    const sql = Array.isArray(strings) ? strings.join('?') : String(strings.sql || strings);
    const name = (sql.match(/\/\*\s*([\w.]+)\s*\*\//) || [])[1];
    if (sql.trim().toUpperCase() === 'SELECT 1' || name === 'ping') return [{ '?column?': 1 }];
    const fn = this.rawHandlers[name];
    if (!fn) throw new Error(`fake prisma: no handler for raw query ${name || sql.slice(0, 60)}`);
    return fn(this, ...values);
  }

  async $executeRaw(strings, ...values) {
    return this.$queryRaw(strings, ...values);
  }

  async $connect() {}

  async $disconnect() {}
}
