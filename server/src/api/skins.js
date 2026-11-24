// Skins: the registry (public), ownership, purchases with an idempotency key, equip.

import { Router } from 'express';
import { inTx } from '../db.js';
import { loadRegistry, registryVersion } from '../skins/registry.js';
import * as service from '../skins/service.js';
import { ah, body, current } from './http.js';

export function skinsRouter(ctx) {
  const r = Router();
  const db = ctx.db;
  const auth = current(ctx);

  r.get('/skins/registry', (req, res) => res.json({ version: registryVersion(), skins: Object.values(loadRegistry()) }));

  r.get('/skins', auth, ah(async (req, res) => {
    const out = await inTx(db, async (tx) => {
      const p = await tx.profile.findUnique({ where: { id: req.caller.profileId } });
      await service.evaluateUnlocks(tx, p, ctx.cfg);
      return {
        points: p.points, equipped: service.equippedOf(p),
        skins: await service.skinList(tx, p, ctx.cfg),
      };
    });
    res.json(out);
  }));

  r.post('/skins/:skinId/buy', auth, ah(async (req, res) => {
    const b = body(req, { idempotency_key: { type: 'str', min: 4, max: 64 } });
    const out = await inTx(db, async (tx) => {
      const p = await tx.profile.findUnique({ where: { id: req.caller.profileId } });
      return service.buy(tx, p, req.params.skinId, b.idempotency_key);
    });
    res.json(out);
  }));

  r.post('/skins/equip', auth, ah(async (req, res) => {
    const b = body(req, { kind: { type: 'str', enum: ['card', 'avatar', 'arena', 'weapon'] }, skin_id: { type: 'str', max: 48, nullable: true, default: null } });
    const out = await inTx(db, async (tx) => {
      const p = await tx.profile.findUnique({ where: { id: req.caller.profileId } });
      return service.equip(tx, p, b.kind, b.skin_id);
    });
    res.json({ equipped: out });
  }));

  return r;
}
