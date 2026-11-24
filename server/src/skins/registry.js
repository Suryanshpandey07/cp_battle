// Skin manifest registry: one JSON file per skin in shared/skins/, read by the
// server (ownership, unlocks) and the client (rendering). Validated at start-up
// and by `npm run seed`; the client-side validator is `npm run skins:validate`.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { SHARED_DIR } from '../config.js';

export const SKINS_DIR = path.join(SHARED_DIR, 'skins');
const RECIPES = path.join(SHARED_DIR, 'skin-recipes.json');
const HEX = /^#[0-9a-fA-F]{6}$/;
export const DEFAULTS = { card: 'card.classic', avatar: 'bean.plain', weapon: 'weapon.fireball' };
export const KINDS = ['card', 'avatar', 'arena', 'weapon'];
const PREFIX = { card: 'card.', avatar: 'bean.', arena: 'arena.', weapon: 'weapon.' };
const LEVEL_KEYS = ['easy', 'normal', 'medium', 'tough'];

function lum(hex) {
  const ch = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

export function contrast(a, b) {
  const [la, lb] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (la + 0.05) / (lb + 0.05);
}

const repr = (v) => (v === undefined || v === null ? 'None' : typeof v === 'string' ? `'${v}'` : JSON.stringify(v));

export function validate(m, recipes, filename = null) {
  const errs = [];
  const sid = m.id ?? '?';
  if (filename && filename !== `${sid}.json`) errs.push(`${filename}: file must be named after its id`);
  const kind = m.kind;
  if (!KINDS.includes(kind)) errs.push(`${sid}: kind must be card, avatar, arena or weapon`);
  if (!String(sid).startsWith(PREFIX[kind] ?? '?')) errs.push(`${sid}: id prefix does not match kind`);
  if (!recipes.rarity.includes(m.rarity)) errs.push(`${sid}: unknown rarity`);
  const u = m.unlock || {};
  if (!['default', 'tier', 'ap', 'achievement', 'admin'].includes(u.type)) errs.push(`${sid}: unknown unlock type`);
  if (u.type === 'tier' && !(Number(u.tier ?? 0) >= 1 && Number(u.tier ?? 0) <= 5)) errs.push(`${sid}: tier unlock needs a tier 1-5`);
  if (u.type === 'ap' && Number(u.price ?? 0) <= 0) errs.push(`${sid}: ap unlock needs a price`);
  if (m.rarity === 'legendary' && u.type === 'ap') errs.push(`${sid}: legendary skins are not for sale`);
  if (!('reducedMotion' in m)) errs.push(`${sid}: missing reducedMotion fallback`);
  const text = JSON.stringify(m);
  if (text.includes('http://') || text.includes('https://')) errs.push(`${sid}: external URLs are not allowed`);
  const pal = m.palette || {};
  for (const [k, v] of Object.entries(pal)) {
    for (const c of Array.isArray(v) ? v : [v]) {
      if (c !== '$player' && !HEX.test(String(c))) errs.push(`${sid}: palette.${k} is not a #rrggbb colour`);
    }
  }
  if (kind === 'card') {
    if (!recipes.frame.includes((m.frame || {}).style)) errs.push(`${sid}: unknown frame style`);
    const a = m.attack || {};
    for (const field of ['element', 'projectile', 'trail', 'impact', 'status', 'sfx']) {
      if (!recipes[field].includes(a[field])) errs.push(`${sid}: unknown attack.${field} ${repr(a[field])}`);
    }
    if ((a.ramp || []).length !== 5) errs.push(`${sid}: attack.ramp needs 5 colours`);
    for (const part of ['idle', 'hover']) {
      const p = (m[part] || {}).particles;
      if (p !== undefined && p !== null && !recipes.particles.includes(p)) errs.push(`${sid}: unknown ${part}.particles`);
    }
    if (Number((m.idle || {}).rate ?? 0) > recipes.max_particle_rate) errs.push(`${sid}: idle particle rate over the limit`);
    for (const bg of pal.bg || []) {
      if (HEX.test(String(pal.text ?? '')) && HEX.test(String(bg)) && contrast(pal.text, bg) < 4.5) {
        errs.push(`${sid}: text contrast ${contrast(pal.text, bg).toFixed(2)} on ${bg} is under 4.5`);
      }
    }
  } else if (kind === 'weapon') {
    if (!recipes.weapon_style.includes(m.style)) errs.push(`${sid}: unknown weapon style ${repr(m.style)}`);
    if (!recipes.weapon_status.includes(m.status)) errs.push(`${sid}: unknown weapon status ${repr(m.status)}`);
    const levels = m.levels || {};
    if (Object.keys(levels).join() !== LEVEL_KEYS.join() || !Object.values(levels).every((v) => typeof v === 'string' && v)) {
      errs.push(`${sid}: levels must name easy, normal, medium and tough in that order`);
    }
    if ((pal.ramp || []).length !== 5) errs.push(`${sid}: palette.ramp needs 5 colours`);
    for (const k of ['metal', 'accent']) if (!(k in pal)) errs.push(`${sid}: palette.${k} is required`);
    if (typeof m.card_colors !== 'boolean') errs.push(`${sid}: card_colors must be true or false`);
  } else if (kind === 'avatar') {
    for (const o of m.overlays || []) {
      if (!recipes.overlay.includes(o.sprite) || !['head', 'back', 'hand'].includes(o.anchor)) errs.push(`${sid}: bad overlay ${JSON.stringify(o)}`);
    }
  } else if (kind === 'arena') {
    for (const layer of m.layers || []) if (!recipes.layer.includes(layer)) errs.push(`${sid}: unknown layer ${layer}`);
    if (Number((m.ambient || {}).rate ?? 0) > recipes.max_particle_rate) errs.push(`${sid}: ambient particle rate over the limit`);
    const amb = (m.ambient || {}).particles;
    if (amb !== undefined && amb !== null && !recipes.particles.includes(amb)) errs.push(`${sid}: unknown ambient.particles ${repr(amb)}`);
    if ('music' in m && !(recipes.music || []).includes(m.music)) errs.push(`${sid}: unknown music track ${repr(m.music)}`);
    for (const sky of pal.sky || []) if (contrast(pal.text, sky) < 4.5) errs.push(`${sid}: text contrast on ${sky} is under 4.5`);
  }
  return errs;
}

let cache = null;

/** {skin id: manifest}, validated; throws on any invalid manifest. */
export function loadRegistry() {
  if (cache) return cache;
  const recipes = JSON.parse(fs.readFileSync(RECIPES, 'utf8'));
  const reg = {};
  const errors = [];
  for (const f of fs.readdirSync(SKINS_DIR).filter((x) => x.endsWith('.json')).sort()) {
    const m = JSON.parse(fs.readFileSync(path.join(SKINS_DIR, f), 'utf8'));
    errors.push(...validate(m, recipes, f));
    if (m.id in reg) errors.push(`duplicate id ${m.id}`);
    reg[m.id] = m;
  }
  if (errors.length) throw new Error(`invalid skin manifests:\n${errors.join('\n')}`);
  cache = reg;
  return reg;
}

function sortedJson(v) {
  if (Array.isArray(v)) return `[${v.map(sortedJson).join(', ')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}: ${sortedJson(v[k])}`).join(', ')}}`;
  return JSON.stringify(v);
}

export function registryVersion() {
  const raw = Object.values(loadRegistry()).map(sortedJson).join('');
  return createHash('sha256').update(raw).digest('hex').slice(0, 12);
}

export const defaultSkinIds = () => Object.entries(loadRegistry()).filter(([, m]) => (m.unlock || {}).type === 'default').map(([id]) => id).sort();
export const getSkin = (id) => loadRegistry()[id] || null;
