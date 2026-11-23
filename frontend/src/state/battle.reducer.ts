/**
 * The battle store is reduce(state, event): a pure function over server events.
 * Live play, reconnect (a state.snapshot followed by missed events) and replays
 * all run this same reducer. The client never computes damage, HP or verdicts.
 */
import type {
  Card,
  MatchEnded,
  PlayerView,
  RewardsGranted,
  ServerMessage,
  Stage,
  SubmissionVerdict,
} from "../net/protocol.generated";

export type Side = 1 | 2;
export type Status = "connecting" | "starting" | "live" | "finished" | "aborted";
export type Activity = "arena" | "editor" | "judging";

export interface PlayerState {
  side: Side;
  name: string;
  rating: number;
  tier: number;
  maxHp: number;
  hp: number;
  skins: Record<string, unknown>;
  isBot: boolean;
  connected: boolean;
  hitsLanded: number;
  damageDealt: number;
  shieldUntil: number | null; // server wall-clock ms
  judging: boolean;
  activity: Activity;
  burnUntil: number | null;
  burnClass: string | null;
}

export interface LogLine {
  id: number;
  t: number;
  elapsedMs: number;
  kind: "you" | "opp" | "hit" | "hurt" | "system";
  key: string;
  params: Record<string, string | number>;
}

export interface Inflight {
  submissionId: number | null;
  slot: number;
  problem: string;
  passed: number;
  total: number;
  t: number;
}

export interface VerdictState extends SubmissionVerdict {
  t: number;
}

export interface BattleState {
  matchId: string | null;
  you: Side | null;
  status: Status;
  mode: string;
  map: string;
  stage: Stage | null;
  players: Record<Side, PlayerState> | null;
  hand: Card[];
  dealtAt: number[];
  charges: { blocks: number; hints: number; rerolls: number; nextRerollAt: number };
  hints: Record<string, string[]>;
  cooldownUntil: number;
  inflight: Inflight | null;
  lastVerdict: VerdictState | null;
  countdown: number | null;
  clock: { elapsedMs: number; syncServerMs: number; maxMs: number; bracket: string; running: boolean };
  log: LogLine[];
  result: MatchEnded | null;
  rewards: RewardsGranted | null;
  emotes: { side: Side; id: string; t: number }[];
  disconnected: { side: Side; until: number } | null;
  seq: number;
  nextLogId: number;
}

const BURN_MS: Record<string, number> = { light: 0, heavy: 800, massive: 1600, nuke: 2600 };
const LOG_MAX = 200;

export function initialState(matchId: string | null = null): BattleState {
  return {
    matchId,
    you: null,
    status: "connecting",
    mode: "ranked",
    map: "bit",
    stage: null,
    players: null,
    hand: [],
    dealtAt: [0, 0, 0, 0],
    charges: { blocks: 0, hints: 0, rerolls: 0, nextRerollAt: 0 },
    hints: {},
    cooldownUntil: 0,
    inflight: null,
    lastVerdict: null,
    countdown: null,
    clock: { elapsedMs: 0, syncServerMs: 0, maxMs: 0, bracket: "blitz", running: false },
    log: [],
    result: null,
    rewards: null,
    emotes: [],
    disconnected: null,
    seq: 0,
    nextLogId: 1,
  };
}

function toPlayer(p: PlayerView, t: number, prev?: PlayerState): PlayerState {
  return {
    side: p.side as Side,
    name: p.name,
    rating: p.rating,
    tier: p.tier,
    maxHp: p.max_hp,
    hp: p.hp,
    skins: (p.skins ?? {}) as Record<string, unknown>,
    isBot: p.is_bot,
    connected: p.connected,
    hitsLanded: p.hits_landed,
    damageDealt: p.damage_dealt,
    shieldUntil: p.shield_ms_left > 0 ? t + p.shield_ms_left : null,
    judging: p.judging,
    activity: p.judging ? "judging" : (prev?.activity ?? "arena"),
    burnUntil: prev?.burnUntil ?? null,
    burnClass: prev?.burnClass ?? null,
  };
}

function patchPlayer(s: BattleState, side: number, patch: Partial<PlayerState>): BattleState {
  if (!s.players) return s;
  const k = side as Side;
  return { ...s, players: { ...s.players, [k]: { ...s.players[k], ...patch } } };
}

function addLog(s: BattleState, t: number, kind: LogLine["kind"], key: string, params: LogLine["params"] = {}): BattleState {
  const elapsed = clockAt(s, t);
  const line: LogLine = { id: s.nextLogId, t, elapsedMs: elapsed, kind, key, params };
  const log = s.log.length >= LOG_MAX ? [...s.log.slice(-LOG_MAX + 1), line] : [...s.log, line];
  return { ...s, log, nextLogId: s.nextLogId + 1 };
}

/** Match-clock milliseconds at a given server wall-clock time. */
export function clockAt(s: BattleState, serverMs: number): number {
  if (!s.clock.running) return s.clock.elapsedMs;
  return Math.max(0, s.clock.elapsedMs + (serverMs - s.clock.syncServerMs));
}

const name = (s: BattleState, side: number): string => s.players?.[side as Side]?.name ?? `P${side}`;
const isMe = (s: BattleState, side: number): boolean => s.you === side;

function upsertCard(hand: Card[], card: Card): Card[] {
  const out = hand.slice();
  out[card.slot] = card;
  return out;
}

export function reduce(s: BattleState, msg: ServerMessage): BattleState {
  if (msg.seq !== undefined && msg.type !== "state.snapshot" && msg.seq <= s.seq) return s; // already applied
  if (msg.type === "state.snapshot" && msg.seq !== undefined && msg.seq < s.seq) return s; // stale snapshot
  const t = msg.t;
  const d = msg.data as any;
  let n: BattleState = msg.seq !== undefined ? { ...s, seq: Math.max(s.seq, msg.seq) } : s;

  switch (msg.type) {
    case "state.snapshot": {
      const prev = s.players;
      const status = (d.result ? (d.result.outcome === "aborted" ? "aborted" : "finished") : d.match.status) as Status;
      n = {
        ...n,
        matchId: d.match.id,
        you: d.you,
        status,
        mode: d.match.mode,
        map: d.match.map,
        stage: d.match.stage,
        players: {
          1: toPlayer(d.players[0], t, prev?.[1]),
          2: toPlayer(d.players[1], t, prev?.[2]),
        },
        hand: d.hand,
        dealtAt: d.hand.map((_: Card, i: number) => s.dealtAt[i] || t),
        charges: {
          blocks: d.charges.blocks_left,
          hints: d.charges.hints_left,
          rerolls: d.charges.rerolls_left,
          nextRerollAt: t + d.charges.next_reroll_ms,
        },
        hints: d.hints,
        cooldownUntil: t + d.cooldown_ms,
        inflight: d.inflight
          ? { submissionId: d.inflight.submission_id, slot: d.inflight.slot, problem: "", passed: 0, total: 0, t }
          : null,
        clock: {
          elapsedMs: d.clock.elapsed_ms,
          syncServerMs: d.clock.server_time_ms,
          maxMs: d.clock.max_ms,
          bracket: d.clock.bracket,
          running: d.clock.status === "live",
        },
        result: d.result ?? s.result,
        seq: d.seq,
      };
      if (!s.players) n = addLog(n, t, "system", "log.appeared", { name: name(n, n.you === 1 ? 2 : 1) });
      return n;
    }
    case "match.countdown":
      n = { ...n, countdown: d.n, status: d.n > 0 ? "starting" : n.status };
      return addLog(n, t, "system", d.n > 0 ? "log.countdown" : "log.fight", { n: d.n });
    case "match.started":
      return {
        ...n,
        status: "live",
        countdown: 0,
        mode: d.mode,
        map: d.map,
        stage: d.stage,
        players: { 1: toPlayer(d.players[0], t, n.players?.[1]), 2: toPlayer(d.players[1], t, n.players?.[2]) },
        clock: { elapsedMs: d.clock.elapsed_ms, syncServerMs: d.clock.server_time_ms, maxMs: d.clock.max_ms, bracket: d.clock.bracket, running: true },
      };
    case "match.timer":
      return { ...n, clock: { elapsedMs: d.elapsed_ms, syncServerMs: d.server_time_ms, maxMs: d.max_ms, bracket: d.bracket, running: d.status === "live" } };
    case "hand.updated": {
      const dealtAt = d.cards.map((c: Card, i: number) => (n.hand[i]?.problem?.slug === c.problem?.slug ? n.dealtAt[i] : t));
      n = { ...n, hand: d.cards, dealtAt };
      if (d.rerolls_left !== undefined && d.rerolls_left !== null) {
        n = { ...n, charges: { ...n.charges, rerolls: d.rerolls_left, nextRerollAt: t + 60_000 } };
        n = addLog(n, t, "you", "log.rerolled");
      }
      return n;
    }
    case "card.dealt": {
      const dealtAt = n.dealtAt.slice();
      dealtAt[d.card.slot] = t;
      n = { ...n, hand: upsertCard(n.hand, d.card), dealtAt };
      return addLog(n, t, "system", "log.redealt", { problem: d.card.problem?.title ?? "?" });
    }
    case "opponent.activity":
      return patchPlayer(n, d.side, { activity: d.state, judging: d.state === "judging" });
    case "submission.accepted":
      n = { ...n, inflight: { submissionId: d.submission_id, slot: d.slot, problem: d.problem, passed: 0, total: d.total, t }, lastVerdict: null };
      if (n.you) n = patchPlayer(n, n.you, { judging: true, activity: "judging" });
      return addLog(n, t, "you", "log.you_submit", { problem: n.hand[d.slot]?.problem?.title ?? d.problem });
    case "submission.progress":
      if (!n.inflight || n.inflight.submissionId !== d.submission_id) return n;
      return { ...n, inflight: { ...n.inflight, passed: Math.max(n.inflight.passed, d.passed), total: d.total } };
    case "submission.verdict": {
      n = { ...n, inflight: null, lastVerdict: { ...(d as SubmissionVerdict), t } };
      if (n.you) n = patchPlayer(n, n.you, { judging: false, activity: "editor" });
      if (d.cooldown_ms) n = { ...n, cooldownUntil: t + d.cooldown_ms };
      if (d.void) n = addLog(n, t, "system", "log.void", { reason: d.reason ?? "void" });
      return n;
    }
    case "attack.landed": {
      const burn = BURN_MS[d.damage_class] ?? 0;
      n = patchPlayer(n, d.defender, { hp: d.defender_hp, burnUntil: burn ? t + 300 + burn : null, burnClass: d.damage_class });
      n = patchPlayer(n, d.attacker, { hitsLanded: d.hits_landed, damageDealt: d.attacker_damage_dealt, judging: false, activity: isMe(n, d.attacker) ? "editor" : "arena" });
      const params = { name: name(n, isMe(n, d.attacker) ? d.defender : d.attacker), dmg: d.damage.toLocaleString("en-US"), cls: `class.${d.damage_class}`, scenario: `scenario.${d.scenario}` };
      n = addLog(n, t, isMe(n, d.attacker) ? "hit" : "hurt", isMe(n, d.attacker) ? "log.you_hit" : "log.opp_hit", params);
      return d.crit ? addLog(n, t, isMe(n, d.attacker) ? "hit" : "hurt", "log.crit") : n;
    }
    case "attack.blocked":
      n = patchPlayer(n, d.defender, { shieldUntil: null });
      n = patchPlayer(n, d.attacker, { hitsLanded: d.hits_landed, judging: false });
      return addLog(n, t, isMe(n, d.attacker) ? "opp" : "you", isMe(n, d.attacker) ? "log.you_blocked" : "log.opp_blocked", {
        name: name(n, isMe(n, d.attacker) ? d.defender : d.attacker),
        dmg: d.prevented_damage.toLocaleString("en-US"),
      });
    case "attack.backfire":
      n = patchPlayer(n, d.attacker, { hp: d.attacker_hp, judging: false });
      return isMe(n, d.attacker)
        ? addLog(n, t, "hurt", "log.you_backfire", { problem: d.problem, recoil: d.recoil.toLocaleString("en-US"), verdict: `verdict.${d.verdict}` })
        : addLog(n, t, "opp", "log.opp_backfire", { name: name(n, d.attacker), recoil: d.recoil.toLocaleString("en-US") });
    case "powerup.used":
      if (d.kind === "block") {
        n = patchPlayer(n, d.side, { shieldUntil: t + (d.shield_ms ?? 20000) });
        if (isMe(n, d.side)) n = { ...n, charges: { ...n.charges, blocks: d.charges_left } };
        return addLog(n, t, isMe(n, d.side) ? "you" : "opp", isMe(n, d.side) ? "log.you_block" : "log.opp_block", { name: name(n, d.side) });
      }
      if (isMe(n, d.side)) return { ...n, charges: { ...n.charges, hints: d.charges_left } };
      return addLog(n, t, "opp", "log.opp_hint", { name: name(n, d.side) });
    case "hint.revealed": {
      const list = (n.hints[d.problem] ?? []).slice(0, d.level - 1);
      list[d.level - 1] = d.text;
      n = { ...n, hints: { ...n.hints, [d.problem]: list } };
      if (d.tags) n = { ...n, hand: n.hand.map((c) => (c.problem && c.problem.slug === d.problem ? { ...c, hints_revealed: d.level, problem: { ...c.problem, tags: d.tags as string[] } } : c)) };
      else n = { ...n, hand: n.hand.map((c) => (c.problem?.slug === d.problem ? { ...c, hints_revealed: d.level } : c)) };
      return addLog(n, t, "you", "log.you_hint", { level: d.level });
    }
    case "shield.expired":
      n = patchPlayer(n, d.side, { shieldUntil: null });
      return addLog(n, t, "system", "log.shield_expired", { name: name(n, d.side) });
    case "player.disconnected":
      n = patchPlayer(n, d.side, { connected: false });
      n = { ...n, disconnected: { side: d.side, until: t + d.grace_s * 1000 } };
      return addLog(n, t, "system", "log.disconnected", { name: name(n, d.side) });
    case "player.reconnected":
      n = patchPlayer(n, d.side, { connected: true });
      n = { ...n, disconnected: null };
      return addLog(n, t, "system", "log.reconnected", { name: name(n, d.side) });
    case "emote":
      n = { ...n, emotes: [...n.emotes.slice(-4), { side: d.side, id: d.id, t }] };
      return addLog(n, t, isMe(n, d.side) ? "you" : "opp", "log.emote", { name: name(n, d.side), emote: `emote.${d.id}` });
    case "match.ended": {
      const ended = d as MatchEnded;
      n = { ...n, result: ended, status: ended.outcome === "aborted" ? "aborted" : "finished", inflight: null, clock: { ...n.clock, elapsedMs: ended.elapsed_ms, running: false } };
      if (n.players) {
        for (const side of [1, 2] as Side[]) {
          const hp = ended.final_hp?.[String(side)];
          if (hp !== undefined) n = patchPlayer(n, side, { hp, shieldUntil: null });
        }
      }
      const label = n.you ? ended.labels?.[String(n.you)] : undefined;
      return addLog(n, t, "system", "log.ended", { outcome: `result.${label ?? (ended.outcome === "aborted" ? "aborted" : "draw")}` });
    }
    case "rewards.granted":
      return { ...n, rewards: d as RewardsGranted };
    default:
      return n; // clients ignore unknown types
  }
}

export function reduceAll(events: ServerMessage[], start: BattleState = initialState()): BattleState {
  return events.reduce(reduce, start);
}
