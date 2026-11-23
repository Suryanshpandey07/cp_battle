import { describe, expect, it } from "vitest";
import golden from "../../shared/golden/reducer.json";
import type { ServerMessage } from "../src/net/protocol.generated";
import { initialState, reduce, reduceAll } from "../src/state/battle.reducer";

const events = golden.events as unknown as ServerMessage[];

describe("battle reducer against the server's own state (shared/golden/reducer.json)", () => {
  for (const cp of golden.checkpoints) {
    it(`matches the server after: ${cp.label}`, () => {
      const s = reduceAll(events.slice(0, cp.after), initialState());
      expect(s.you).toBe(cp.expect.you);
      expect(s.status).toBe(cp.expect.status);
      expect({ "1": s.players![1].hp, "2": s.players![2].hp }).toEqual(cp.expect.hp);
      expect(s.hand.map((c) => c.problem?.slug ?? null)).toEqual(cp.expect.hand);
      expect({ blocks: s.charges.blocks, hints: s.charges.hints, rerolls: s.charges.rerolls }).toEqual(cp.expect.charges);
      expect(!!s.inflight).toBe(cp.expect.inflight);
    });
  }

  it("ignores events it has already applied (reconnect replays)", () => {
    const once = reduceAll(events, initialState());
    const twice = events.reduce(reduce, once);
    expect(twice.players![2].hp).toBe(once.players![2].hp);
    expect(twice.log.length).toBe(once.log.length);
  });

  it("writes every log line from a server event, and ends with the result", () => {
    const s = reduceAll(events, initialState());
    expect(s.result?.outcome).toBe("win");
    expect(s.rewards).toBeTruthy();
    expect(s.log.map((l) => l.key)).toContain("log.you_hit");
    expect(s.log.map((l) => l.key)).toContain("log.you_backfire");
    expect(s.log.map((l) => l.key)).toContain("log.opp_blocked");
  });

  it("ignores unknown event types", () => {
    const s = reduceAll(events.slice(0, 6), initialState());
    const after = reduce(s, { v: 1, type: "future.thing", t: 0, data: {} } as unknown as ServerMessage);
    expect(after).toBe(s);
  });
});
