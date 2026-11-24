// Profile payloads. Tier and max HP are derived from rating, never stored.

import { tierRow } from '../domain/gameconfig.js';
import { getTier } from '../domain/rules.js';
import { iso } from '../util.js';

export function profilePublic(p, cfg) {
  const tier = getTier(p.rating, cfg);
  const nxt = tier < cfg.tiers.length ? tierRow(cfg, tier + 1) : null;
  return {
    id: p.id, display_name: p.display_name, rating: p.rating, peak_rating: p.peak_rating,
    tier, tier_title: tierRow(cfg, tier).title, max_hp: tierRow(cfg, tier).max_hp,
    next_tier: nxt ? { tier: nxt.tier, title: nxt.title, min_rating: nxt.min_rating, max_hp: nxt.max_hp } : null,
    wins: p.wins, losses: p.losses, draws: p.draws, avatar_color: p.avatar_color,
    equipped: { card: p.equipped_card, avatar: p.equipped_avatar, arena: p.equipped_arena, weapon: p.equipped_weapon },
    badges: [...(p.badges || [])], is_bot: p.is_bot,
  };
}

export async function profilePrivate(db, p, cfg) {
  const d = profilePublic(p, cfg);
  const inv = await db.inventory.findMany({ where: { profile_id: p.id }, select: { skin_id: true } });
  const user = p.user_id ? await db.user.findUnique({ where: { id: p.user_id } }) : null;
  return {
    ...d,
    points: p.points,
    settings: p.settings || {},
    inventory: inv.map((r) => r.skin_id).sort(),
    role: user ? user.role : 'player',
    counters: p.counters || {},
    queue_ban_until: iso(p.queue_ban_until),
  };
}

/** Default skins every profile owns. tx: a Prisma client or transaction. */
export async function grantDefaults(tx, prof) {
  const { defaultSkinIds } = await import('../skins/registry.js');
  let ids;
  try {
    ids = defaultSkinIds();
  } catch {
    ids = ['card.classic', 'bean.plain'];
  }
  for (const sid of ids) {
    const have = await tx.inventory.findFirst({ where: { profile_id: prof.id, skin_id: sid } });
    if (!have) await tx.inventory.create({ data: { profile_id: prof.id, skin_id: sid, source: 'default' } });
  }
}
