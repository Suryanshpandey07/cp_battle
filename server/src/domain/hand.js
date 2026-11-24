// Dealing hands of four cards. Each player holds four cards of four consecutive
// problem tiers. Each tier's problems are shuffled with a generator seeded from
// (match seed, tier) into one deck both players draw from independently, so both
// see the same problems for a tier in the same order. Pure: the only randomness
// is a seeded PyRandom built from the inputs.
//
// A hand is plain data: {tiers: [..4], slots: [slug|null x4], pointers: {tier: next index}, solved: [slugs]}.

import { PyRandom } from '../pyrandom.js';

export function handToJson(h) {
  const pointers = {};
  for (const [k, v] of Object.entries(h.pointers)) pointers[String(k)] = v;
  return { tiers: [...h.tiers], slots: [...h.slots], pointers, solved: [...h.solved] };
}

export function handFromJson(d) {
  const pointers = {};
  for (const [k, v] of Object.entries(d.pointers || {})) pointers[Number(k)] = Number(v);
  return { tiers: d.tiers.map(Number), slots: [...d.slots], pointers, solved: [...(d.solved || [])] };
}

/** lo = clamp(player_tier + window_offset, lo_min, lo_max); tiers lo..lo+3. */
export function handWindow(playerTier, cfg) {
  const h = cfg.hand;
  const lo = Math.max(h.window_lo_min, Math.min(h.window_lo_max, playerTier + h.window_offset));
  return Array.from({ length: h.size }, (_, i) => lo + i);
}

/** A card's place in the hand window: 0 easy .. 3 tough. Animation only. */
export function difficultyLevel(playerTier, problemTier, cfg) {
  const lo = handWindow(playerTier, cfg)[0];
  return Math.max(0, Math.min(cfg.hand.size - 1, problemTier - lo));
}

const byCodepoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * One deck per tier plus warnings for thin tiers: the map's own problems for the
 * tier (shuffled), then every other biome's problems for the tier (shuffled).
 * pool: [{slug, tier, biome}]
 */
export function buildDecks(pool, seed, map, cfg) {
  const decks = {};
  const warnings = [];
  for (const row of cfg.tiers) {
    const tier = row.tier;
    const primary = pool.filter((p) => p.tier === tier && map.biomes.includes(p.biome)).map((p) => p.slug).sort(byCodepoint);
    const rest = pool.filter((p) => p.tier === tier && !map.biomes.includes(p.biome)).map((p) => p.slug).sort(byCodepoint);
    const rng = new PyRandom(`${seed}:${tier}`);
    rng.shuffle(primary);
    rng.shuffle(rest);
    if (primary.length < cfg.hand.min_deck_per_tier) {
      warnings.push(`map ${map.id} has ${primary.length} tier-${tier} problem(s); falling back to all biomes`);
    }
    decks[tier] = [...primary, ...rest];
  }
  return { decks, warnings };
}

/** Next problem for a tier, skipping ones solved or held; repeats once all are used. */
function draw(hand, decks, tier) {
  const deck = decks[tier] || [];
  const start = hand.pointers[tier] ?? 0;
  if (!deck.length) return [null, start];
  const held = new Set(hand.slots.filter((s) => s !== null));
  for (let step = 0; step < deck.length; step++) {
    const idx = start + step;
    const slug = deck[idx % deck.length];
    if (!hand.solved.includes(slug) && !held.has(slug)) return [slug, idx + 1];
  }
  for (let step = 0; step < deck.length; step++) {
    const idx = start + step;
    const slug = deck[idx % deck.length];
    if (!held.has(slug)) return [slug, idx + 1];
  }
  return [deck[start % deck.length], start + 1];
}

export function fillSlot(hand, decks, slot) {
  const tier = hand.tiers[slot];
  const [slug, ptr] = draw(hand, decks, tier);
  const slots = [...hand.slots];
  slots[slot] = slug;
  return { ...hand, slots, pointers: { ...hand.pointers, [tier]: ptr } };
}

export function dealHand(decks, playerTier, cfg) {
  const tiers = handWindow(playerTier, cfg);
  let hand = { tiers, slots: tiers.map(() => null), pointers: {}, solved: [] };
  for (let slot = 0; slot < tiers.length; slot++) hand = fillSlot(hand, decks, slot);
  return hand;
}

/** A correct attempt spends the card; the slot waits for a re-deal. */
export function consumeSlot(hand, slot) {
  const slug = hand.slots[slot];
  const slots = [...hand.slots];
  slots[slot] = null;
  return { ...hand, slots, solved: slug ? [...hand.solved, slug] : [...hand.solved] };
}

/** Swap one card for the next problem of the same tier. */
export function rerollSlot(hand, decks, slot) {
  const current = hand.slots[slot];
  const slots = [...hand.slots];
  slots[slot] = null;
  const refilled = fillSlot({ ...hand, slots }, decks, slot);
  if (refilled.slots[slot] === null && current !== null) return hand;
  return refilled;
}

export function slotOf(hand, slug) {
  const i = hand.slots.indexOf(slug);
  return i < 0 ? null : i;
}

export const mapAllowed = (map, playerTier) => playerTier >= map.min_tier;
