// Match creation and the registry of live match actors.
//
// One process owns all live matches in this prototype. Scaling out needs sticky
// routing by match id or a Redis-backed hub (see README).

import { randomInt, randomUUID } from 'node:crypto';
import { AppError } from '../errors.js';
import { mapCfg, tierRow } from '../domain/gameconfig.js';
import * as H from '../domain/hand.js';
import { getTier, initialCharges } from '../domain/rules.js';
import { PyRandom } from '../pyrandom.js';
import { log } from '../log.js';
import { MatchActor } from './actor.js';
import { newMatchRow } from './side.js';

export const defaultSkins = () => ({ card: 'card.classic', avatar: 'bean.plain' });

export class MatchService {
  /** judge: the judge pool; db: a Prisma client. */
  constructor({ cfg, clock, hub, judge, problems, db }) {
    Object.assign(this, { cfg, clock, hub, judge, problems, db });
    this.registry = new Map();
    this.active = new Map(); // profile id -> live match id
    this.lingerHandles = new Map();
  }

  // ------------------------------------------------------------------ lookup
  get(matchId) {
    return this.registry.get(matchId) || null;
  }

  activeMatchFor(profileId) {
    return this.active.get(profileId) || null;
  }

  liveMatches() {
    return [...this.registry.values()].filter((a) => !a.finished);
  }

  // ------------------------------------------------------------------ lifecycle
  /** On start-up, any match still starting or live is aborted with no rating change. */
  static async abortStale(db) {
    const r = await db.match.updateMany({
      where: { status: { in: ['starting', 'live'] } },
      data: {
        status: 'aborted', end_reason: 'aborted', outcome: 'aborted',
        result: { outcome: 'aborted', end_reason: 'aborted', reason: 'server_restarted', sides: {} },
      },
    });
    return r.count;
  }

  async shutdown() {
    for (const h of this.lingerHandles.values()) clearTimeout(h);
    this.lingerHandles.clear();
    for (const a of [...this.registry.values()]) await a.stop();
    this.registry.clear();
  }

  onFinishedSoon(actor) {
    return () => {
      for (const n of [1, 2]) {
        const pid = actor.side(n).profile_id;
        if (this.active.get(pid) === actor.id) this.active.delete(pid);
      }
      const h = setTimeout(() => this._remove(actor.id), this.cfg.match.registry_linger_s * 1000);
      if (h.unref) h.unref();
      this.lingerHandles.set(actor.id, h);
    };
  }

  async _remove(matchId) {
    const actor = this.registry.get(matchId);
    this.registry.delete(matchId);
    this.lingerHandles.delete(matchId);
    this.hub.dropRoom(matchId);
    if (actor) await actor.stop();
  }

  // ------------------------------------------------------------------ creation
  _snapshot(m, n, prof, rating, mode, isBot, name, skins) {
    const tier = getTier(rating, this.cfg);
    const maxHp = tierRow(this.cfg, tier).max_hp;
    let [blocks, hints] = initialCharges(mode, this.cfg);
    if (isBot) [blocks, hints] = mode === 'practice' ? [0, 0] : [this.cfg.powerups.block.charges, 0];
    Object.assign(m, {
      [`player${n}_profile_id`]: prof ? prof.id : 0,
      [`player${n}_name`]: name,
      [`player${n}_rating`]: rating,
      [`player${n}_tier`]: tier,
      [`player${n}_max_hp`]: maxHp,
      [`player${n}_hp`]: maxHp,
      [`player${n}_skins`]: skins,
      [`player${n}_is_bot`]: isBot,
      [`player${n}_blocks_left`]: blocks,
      [`player${n}_hints_left`]: hints,
      [`player${n}_rerolls_left`]: this.cfg.hand.reroll_max,
      [`player${n}_stats`]: { lowest_hp: maxHp },
    });
  }

  _skinsOf(p) {
    return { card: p.equipped_card, avatar: p.equipped_avatar, arena: p.equipped_arena, weapon: p.equipped_weapon, color: p.avatar_color };
  }

  _botWeapon(personality) {
    const all = this.cfg.bots.personalities;
    return (all[personality || ''] || all[this.cfg.bots.default_personality]).weapon;
  }

  _botSkins(p) {
    return { card: 'card.classic', avatar: 'bean.plain', arena: null, color: p.avatar_color, personality: p.personality, weapon: this._botWeapon(p.personality) };
  }

  async _register(m) {
    await this.db.match.create({ data: m });
    const actor = new MatchActor(this, m);
    this.registry.set(m.id, actor);
    for (const n of [1, 2]) if (!m[`player${n}_is_bot`]) this.active.set(m[`player${n}_profile_id`], m.id);
    actor.start();
    return actor;
  }

  /** Create the shared match row with both snapshots, deal both hands, start the actor. */
  async createMatch(mode, mapId, p1, p2, { opponentKind = null, seed = null } = {}) {
    if (!this.problems.bySlug.size) throw new AppError('server_error', 'No problems are loaded; run the seed first');
    const cfg = this.cfg;
    const map = mapCfg(cfg, mapId);
    seed = seed ?? randomInt(2 ** 31);
    const rng = new PyRandom(seed);
    const { decks, warnings } = H.buildDecks(this.problems.pool, seed, map, cfg);
    for (const w of warnings) log.warn(w);
    const m = newMatchRow({
      id: randomUUID(), mode, map: mapId, seed, decks: Object.fromEntries(Object.entries(decks).map(([k, v]) => [String(k), v])),
      player1_profile_id: p1.id, player2_profile_id: 0,
    });
    this._snapshot(m, 1, p1, p1.rating, mode, false, p1.display_name, this._skinsOf(p1));
    if (p2 && !p2.is_bot) {
      this._snapshot(m, 2, p2, p2.rating, mode, false, p2.display_name, this._skinsOf(p2));
    } else {
      if (!p2) throw new Error('a bot or dummy profile is required');
      let rating;
      let name;
      if (opponentKind === 'dummy') {
        rating = p1.rating;
        name = 'Training Dummy';
      } else {
        const spread = cfg.bots.rating_spread;
        rating = Math.max(0, p1.rating + rng.randint(-spread, spread));
        name = p2.display_name;
      }
      this._snapshot(m, 2, p2, rating, mode, true, name, this._botSkins(p2));
    }
    for (const n of [1, 2]) m[`player${n}_hand`] = H.handToJson(H.dealHand(decks, m[`player${n}_tier`], cfg));
    this._applyStage(m, map.default_arena);
    return this._register(m);
  }

  /** Two simulated bots (load testing and demos). Mode 'bot'; no human ratings change. */
  async createBotVsBot(mapId, a, b, seed = null) {
    const cfg = this.cfg;
    seed = seed ?? randomInt(2 ** 31);
    const { decks } = H.buildDecks(this.problems.pool, seed, mapCfg(cfg, mapId), cfg);
    const m = newMatchRow({
      id: randomUUID(), mode: 'bot', map: mapId, seed, decks: Object.fromEntries(Object.entries(decks).map(([k, v]) => [String(k), v])),
      player1_profile_id: a.id, player2_profile_id: b.id,
    });
    for (const [n, p] of [[1, a], [2, b]]) {
      this._snapshot(m, n, p, p.rating, 'bot', true, p.display_name, this._botSkins(p));
      m[`player${n}_hand`] = H.handToJson(H.dealHand(decks, m[`player${n}_tier`], cfg));
    }
    this._applyStage(m, mapCfg(cfg, mapId).default_arena);
    return this._register(m);
  }

  /** Both on the map default -> show it; otherwise the higher-rated player's theme (player 1 wins a tie). */
  _applyStage(m, defaultTheme) {
    const t1 = (m.player1_skins || {}).arena || defaultTheme;
    const t2 = (m.player2_skins || {}).arena || defaultTheme;
    if (t1 === defaultTheme && t2 === defaultTheme) {
      m.stage_theme = defaultTheme;
      m.stage_owner_side = null;
      return;
    }
    const owner = m.player1_rating >= m.player2_rating ? 1 : 2;
    const theme = owner === 1 ? t1 : t2;
    m.stage_theme = theme;
    m.stage_owner_side = theme !== defaultTheme ? owner : null;
  }

  async botProfile(personality) {
    const want = personality || this.cfg.bots.default_personality;
    const p = await this.db.profile.findFirst({ where: { is_bot: true, personality: want }, orderBy: { id: 'asc' } });
    if (!p) throw new AppError('server_error', 'Bot profiles are missing; run the seed first');
    return p;
  }
}
