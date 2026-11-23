/* Fake server events for previews (Locker "Test fire" and the VFX Lab). Labelled: never sent to a server. */
import type { ServerMessage } from "../../net/protocol.generated";
import { initialState, type BattleState, type PlayerState } from "../../state/battle.reducer";

export function dummyState(opts: { cardSkin?: string; avatar?: string; arena?: string; weapon?: string; weapon2?: string; hp1?: number; hp2?: number; max?: number } = {}): BattleState {
  const max = opts.max ?? 28000;
  const base = (side: 1 | 2, name: string, color: string, hp: number): PlayerState => ({
    side, name, rating: 1300, tier: 2, maxHp: max, hp, isBot: true, connected: true, hitsLanded: 0, damageDealt: 0,
    skins: { card: side === 1 ? opts.cardSkin ?? "card.classic" : "card.classic", avatar: side === 1 ? opts.avatar ?? "bean.plain" : "bean.plain", weapon: side === 1 ? opts.weapon ?? "weapon.fireball" : opts.weapon2 ?? opts.weapon ?? "weapon.fireball", color },
    shieldUntil: null, judging: false, activity: "arena", burnUntil: null, burnClass: null,
  });
  return {
    ...initialState("preview"),
    you: 1,
    status: "live",
    stage: { theme: opts.arena ?? "arena.bit", owner_side: null, owner_name: null },
    players: { 1: base(1, "You", "#3b82f6", opts.hp1 ?? max), 2: base(2, "Training Dummy", "#94a3b8", opts.hp2 ?? max) },
  };
}

export function fakeAttack(o: { attacker: 1 | 2; damage: number; cls: string; crit: boolean; defenderHp: number; blocked?: boolean; level?: number }): ServerMessage {
  const t = Date.now();
  if (o.blocked)
    return { v: 1, type: "attack.blocked", t, data: { attacker: o.attacker, defender: o.attacker === 1 ? 2 : 1, prevented_damage: o.damage, damage_class: o.cls, crit: o.crit, scenario: "stretching", problem: "preview", hits_landed: 1, level: o.level } } as any;
  return { v: 1, type: "attack.landed", t, data: { attacker: o.attacker, defender: o.attacker === 1 ? 2 : 1, damage: o.damage, damage_class: o.cls, crit: o.crit, scenario: o.crit ? "ambitious" : "stretching", tier_diff: o.crit ? -2 : -1, problem: "preview", defender_hp: o.defenderHp, attacker_damage_dealt: o.damage, hits_landed: 1, level: o.level } } as any;
}

export function fakeBackfire(side: 1 | 2, recoil: number, cls: string, hpAfter: number, level?: number): ServerMessage {
  return { v: 1, type: "attack.backfire", t: Date.now(), data: { attacker: side, recoil, recoil_class: cls, verdict: "WA", problem: "preview", attacker_hp: hpAfter, crit: false, scenario: "on_level", level } } as any;
}

export function fakeShield(side: 1 | 2): ServerMessage {
  return { v: 1, type: "powerup.used", t: Date.now(), data: { side, kind: "block", charges_left: 0, shield_ms: 20000 } } as any;
}

export function fakeEnded(reason: "timer" | "forfeit", winner: 1 | 2): ServerMessage {
  return { v: 1, type: "match.ended", t: Date.now(), data: { outcome: "win", winner_side: winner, end_reason: reason, labels: {}, final_hp: {}, sides: {}, elapsed_ms: 0 } } as any;
}
