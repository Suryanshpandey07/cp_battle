// Inventory, purchases, equipping and unlock checks. Skins never change a number.
// Every function takes a Prisma client or transaction (db).

import { AppError } from '../errors.js';
import { getTier } from '../domain/rules.js';
import { DEFAULTS, KINDS, loadRegistry } from './registry.js';

export async function owned(db, profileId) {
  const rows = await db.inventory.findMany({ where: { profile_id: profileId }, select: { skin_id: true } });
  return new Set(rows.map((r) => r.skin_id));
}

/** Grant every skin whose unlock now holds; returns the new non-default ones. A
 * tier unlock counts the peak tier, so a demotion never re-locks a skin. */
export async function evaluateUnlocks(db, prof, cfg, earnedAchievements = []) {
  const have = await owned(db, prof.id);
  const peakTier = getTier(Math.max(prof.peak_rating, prof.rating), cfg);
  const achieved = new Set((await db.achievement.findMany({ where: { profile_id: prof.id }, select: { key: true } })).map((a) => a.key));
  for (const a of earnedAchievements) achieved.add(a);
  const fresh = [];
  for (const [sid, m] of Object.entries(loadRegistry())) {
    if (have.has(sid)) continue;
    const u = m.unlock || {};
    const ok = u.type === 'default' || (u.type === 'tier' && peakTier >= Number(u.tier)) || (u.type === 'achievement' && achieved.has(u.id));
    if (ok) {
      await db.inventory.create({ data: { profile_id: prof.id, skin_id: sid, source: u.type || 'default', acquired_at: new Date() } });
      fresh.push(sid);
    }
  }
  return fresh.filter((sid) => (loadRegistry()[sid].unlock || {}).type !== 'default');
}

export async function skinList(db, prof, cfg) {
  const have = await owned(db, prof.id);
  const counters = prof.counters || {};
  const peakTier = getTier(Math.max(prof.peak_rating, prof.rating), cfg);
  return Object.entries(loadRegistry()).sort(([a], [b]) => (a < b ? -1 : 1)).map(([sid, m]) => {
    const u = m.unlock || {};
    let progress = null;
    if (u.type === 'achievement' && u.id === 'bit_master') progress = { value: counters.bit_wins ?? 0, target: 25 };
    if (u.type === 'tier') progress = { value: peakTier, target: Number(u.tier) };
    return { id: sid, kind: m.kind, owned: have.has(sid), unlock: u, progress };
  });
}

export async function buy(db, prof, skinId, idemKey) {
  const prior = await db.purchase.findFirst({ where: { profile_id: prof.id, idem_key: idemKey } });
  if (prior) return { skin_id: prior.skin_id, points: prof.points, repeat: true };
  const m = loadRegistry()[skinId];
  if (!m) throw new AppError('not_found', 'No such skin');
  const u = m.unlock || {};
  if (u.type !== 'ap') throw new AppError('forbidden', 'This skin is not for sale');
  if ((await owned(db, prof.id)).has(skinId)) throw new AppError('conflict', 'You already own this skin');
  const price = Number(u.price);
  if (prof.points < price) throw new AppError('conflict', 'Not enough Arena Points', { need: price, have: prof.points });
  prof.points -= price;
  await db.profile.update({ where: { id: prof.id }, data: { points: prof.points } });
  await db.inventory.create({ data: { profile_id: prof.id, skin_id: skinId, source: 'ap', acquired_at: new Date() } });
  await db.purchase.create({ data: { profile_id: prof.id, skin_id: skinId, idem_key: idemKey, price, created_at: new Date() } });
  return { skin_id: skinId, points: prof.points, repeat: false };
}

export async function equip(db, prof, kind, skinId) {
  if (!KINDS.includes(kind)) throw new AppError('validation', 'kind must be card, avatar, arena or weapon');
  if (skinId !== null && skinId !== undefined) {
    const m = loadRegistry()[skinId];
    if (!m || m.kind !== kind) throw new AppError('validation', 'That skin does not fit this slot');
    if (!(await owned(db, prof.id)).has(skinId)) throw new AppError('forbidden', 'You do not own this skin');
  }
  const data = {};
  if (kind === 'card') data.equipped_card = skinId || DEFAULTS.card;
  else if (kind === 'avatar') data.equipped_avatar = skinId || DEFAULTS.avatar;
  else if (kind === 'weapon') data.equipped_weapon = skinId || DEFAULTS.weapon;
  else data.equipped_arena = skinId ?? null;
  Object.assign(prof, data);
  await db.profile.update({ where: { id: prof.id }, data });
  return equippedOf(prof);
}

export const equippedOf = (prof) => ({ card: prof.equipped_card, avatar: prof.equipped_avatar, arena: prof.equipped_arena, weapon: prof.equipped_weapon });
