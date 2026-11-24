// A small stand-in for Express 5 covering what server/src uses: apps and routers
// with use/get/post/put/patch/delete, ":param" paths, async handlers, error
// middleware, express.json and express.static, and the req/res helpers below.
// Only for environments where `npm install` cannot reach the registry.

import fs from 'node:fs';
import path from 'node:path';
import { STATUS_CODES } from 'node:http';

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'];

function compile(pattern, end) {
  const keys = [];
  const src = pattern.replace(/\/+$/, '').replace(/[.+*?^${}()|[\]\\]/g, '\\$&').replace(/:(\w+)/g, (_, k) => {
    keys.push(k);
    return '([^/]+)';
  });
  return { re: new RegExp(`^${src}${end ? '/?$' : '(?=/|$)'}`), keys };
}

function decorate(req, res, app) {
  if (req._decorated) return;
  req._decorated = true;
  const url = new URL(req.url, 'http://localhost');
  req.originalUrl = req.url;
  req.path = url.pathname;
  req.query = {};
  for (const [k, v] of url.searchParams) req.query[k] = k in req.query ? [].concat(req.query[k], v) : v;
  req.params = {};
  req.get = (h) => req.headers[h.toLowerCase()];
  req.ip = req.socket.remoteAddress;
  req.app = app;
  res.status = (code) => { res.statusCode = code; return res; };
  res.set = (k, v) => {
    if (typeof k === 'object') for (const [a, b] of Object.entries(k)) res.setHeader(a, b);
    else res.setHeader(k, v);
    return res;
  };
  res.get = (k) => res.getHeader(k);
  res.json = (obj) => {
    if (!res.getHeader('content-type')) res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
    return res;
  };
  res.send = (body) => {
    if (typeof body === 'object' && !Buffer.isBuffer(body)) return res.json(body);
    if (!res.getHeader('content-type')) res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(body);
    return res;
  };
  res.sendStatus = (code) => res.status(code).send(STATUS_CODES[code] || String(code));
  res.cookie = (name, value, o = {}) => {
    let c = `${name}=${encodeURIComponent(value)}`;
    if (o.maxAge !== undefined) c += `; Max-Age=${Math.floor(o.maxAge / 1000)}; Expires=${new Date(Date.now() + o.maxAge).toUTCString()}`;
    if (o.expires) c += `; Expires=${o.expires.toUTCString()}`;
    c += `; Path=${o.path || '/'}`;
    if (o.httpOnly) c += '; HttpOnly';
    if (o.secure) c += '; Secure';
    if (o.sameSite) c += `; SameSite=${o.sameSite[0].toUpperCase()}${o.sameSite.slice(1).toLowerCase()}`;
    const prev = res.getHeader('set-cookie');
    res.setHeader('set-cookie', [...(prev ? [].concat(prev) : []), c]);
    return res;
  };
  res.clearCookie = (name, o = {}) => res.cookie(name, '', { ...o, maxAge: undefined, expires: new Date(1) });
  res.sendFile = (file) => {
    const ext = path.extname(file);
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
    res.setHeader('content-type', types[ext] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  };
}

function makeRouter() {
  const stack = [];
  function router(req, res, out) {
    let i = 0;
    const base = req._base || '';
    const next = (err) => {
      if (res.writableEnded) return;
      const layer = stack[i++];
      if (!layer) {
        req._base = base;
        out(err);
        return;
      }
      if (layer.method && layer.method !== req.method.toLowerCase() && !(layer.method === 'get' && req.method === 'HEAD')) {
        next(err);
        return;
      }
      const rel = req.path.slice(base.length) || '/';
      const m = layer.match.re.exec(rel);
      if (!m) {
        next(err);
        return;
      }
      const params = {};
      layer.match.keys.forEach((k, j) => { params[k] = decodeURIComponent(m[j + 1]); });
      const isErr = layer.fn.length === 4;
      if (Boolean(err) !== isErr) {
        next(err);
        return;
      }
      req.params = { ...req.params, ...params };
      const restore = () => { req._base = base; };
      try {
        let r;
        if (layer.method) {
          r = isErr ? layer.fn(err, req, res, next) : layer.fn(req, res, next);
        } else {
          req._base = base + m[0].replace(/\/$/, '');
          const sub = (e) => { restore(); next(e); };
          r = isErr ? layer.fn(err, req, res, sub) : layer.fn(req, res, sub);
        }
        if (r && typeof r.then === 'function') r.then(undefined, (e) => { restore(); next(e || new Error('rejected')); });
      } catch (e) {
        restore();
        next(e);
      }
    };
    next();
  }
  router.use = (...args) => {
    const p = typeof args[0] === 'string' ? args.shift() : '/';
    for (const fn of args.flat()) stack.push({ method: null, match: compile(p === '/' ? '' : p, false), fn });
    return router;
  };
  for (const method of METHODS) {
    router[method] = (p, ...fns) => {
      if (method === 'get' && fns.length === 0) return undefined; // app.get(setting)
      for (const fn of fns.flat()) stack.push({ method, match: compile(p, true), fn });
      return router;
    };
  }
  return router;
}

export default function express() {
  const router = makeRouter();
  const settings = {};
  const app = (req, res) => {
    decorate(req, res, app);
    req._base = '';
    router(req, res, (err) => {
      if (res.writableEnded) return;
      res.statusCode = err ? (err.status || 500) : 404;
      res.end(err ? 'Internal Server Error' : 'Not Found');
    });
  };
  Object.assign(app, router);
  app.handle = router;
  app.set = (k, v) => { settings[k] = v; return app; };
  app.disable = (k) => { settings[k] = false; return app; };
  app.get = (p, ...fns) => (fns.length ? router.get(p, ...fns) && app : settings[p]);
  return app;
}

export function Router() {
  return makeRouter();
}

express.Router = Router;

function sizeLimit(limit) {
  if (typeof limit === 'number') return limit;
  const m = String(limit || '100kb').match(/^(\d+)(kb|mb)?$/i);
  return Number(m[1]) * (m[2] ? (m[2].toLowerCase() === 'kb' ? 1024 : 1024 * 1024) : 1);
}

express.json = ({ limit, strict = true } = {}) => (req, res, next) => {
  const type = req.headers['content-type'] || '';
  if (!type.includes('json') || req.method === 'GET' || req.method === 'HEAD') {
    next();
    return;
  }
  const max = sizeLimit(limit);
  const chunks = [];
  let size = 0;
  let failed = false;
  req.on('data', (c) => {
    size += c.length;
    if (size > max && !failed) {
      failed = true;
      next(Object.assign(new Error('request entity too large'), { type: 'entity.too.large', status: 413 }));
    }
    chunks.push(c);
  });
  req.on('end', () => {
    if (failed) return;
    const text = Buffer.concat(chunks).toString('utf8');
    if (!text) {
      req.body = undefined;
      next();
      return;
    }
    try {
      req.body = JSON.parse(text);
      if (strict && (typeof req.body !== 'object' || req.body === null)) throw new SyntaxError('strict');
      next();
    } catch {
      next(Object.assign(new SyntaxError('invalid json'), { type: 'entity.parse.failed', status: 400 }));
    }
  });
};

express.static = (root) => (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    next();
    return;
  }
  const file = path.resolve(root, `.${decodeURIComponent(req.path)}`);
  if (!file.startsWith(path.resolve(root)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    next();
    return;
  }
  res.sendFile(file);
};
