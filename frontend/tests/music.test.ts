import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { barEvents, FORM, melody, noteOf, sectionAt, trackFor, TRACKS, type Intensity } from "../src/audio/tracks";

const shared = join(process.cwd(), "..", "shared");
const arenas = readdirSync(join(shared, "skins"))
  .filter((f) => f.startsWith("arena."))
  .map((f) => JSON.parse(readFileSync(join(shared, "skins", f), "utf8")));
const recipes = JSON.parse(readFileSync(join(shared, "skin-recipes.json"), "utf8"));

describe("soundtrack", () => {
  it("every arena names a track that exists, and every track is in the recipes", () => {
    expect(arenas.length).toBe(10);
    for (const a of arenas) {
      expect(TRACKS[a.music]).toBeTruthy();
      expect(trackFor(a.music).id).toBe(a.music);
    }
    expect(Object.keys(TRACKS).sort()).toEqual([...recipes.music].sort());
    expect(new Set(arenas.map((a) => a.music)).size).toBe(10); // a different track per arena
  });

  it("the form opens with an intro once, then loops from the first A", () => {
    expect(sectionAt(0)).toEqual({ name: "intro", barIn: 0, first: true });
    expect(sectionAt(4).name).toBe("A");
    expect(sectionAt(12).name).toBe("B");
    const total = FORM.reduce((a, s) => a + s.bars, 0);
    expect(sectionAt(total)).toEqual(sectionAt(4)); // round again, without the intro
    expect(sectionAt(total + 9)).toEqual(sectionAt(13));
  });

  it("bars are deterministic, in range and on the 16th grid", () => {
    for (const t of Object.values(TRACKS)) {
      for (const intensity of [0, 1, 2] as Intensity[]) {
        for (let bar = 0; bar < 48; bar++) {
          const ev = barEvents(t, bar, intensity);
          expect(barEvents(t, bar, intensity)).toEqual(ev);
          for (const e of ev) {
            expect(e.step >= 0 && e.step < 16).toBe(true);
            expect(e.len >= 1).toBe(true);
            expect(e.vel > 0 && e.vel <= 1).toBe(true);
            for (const n of e.notes ?? []) expect(n >= 20 && n <= 100).toBe(true);
          }
        }
      }
    }
  });

  it("intensity shapes the arrangement: calm has no drums, tense never breaks and lifts the melody", () => {
    for (const t of Object.values(TRACKS)) {
      const has = (bar: number, i: Intensity, inst: string) => barEvents(t, bar, i).some((e) => e.inst === inst);
      expect(has(0, 1, "kick")).toBe(false); // the intro is calm
      expect(has(6, 0, "kick")).toBe(false); // menus and the countdown stay calm
      if (t.drums.kick.includes("x")) expect(has(6, 1, "kick")).toBe(true);
      // the break (bars 36-39) becomes a B section when tense: drums and the melody keep going
      const breakBar = 4 + 8 + 8 + 8 + 8;
      expect(sectionAt(breakBar).name).toBe("break");
      if (t.drums.kick.includes("x")) expect(has(breakBar, 2, "kick")).toBe(true);
      const leadNotes = (i: Intensity) => barEvents(t, 12, i).filter((e) => e.inst === "lead").flatMap((e) => e.notes ?? []);
      const calm = leadNotes(1);
      const tense = leadNotes(2);
      if (calm.length && tense.length && t.lead.octave <= 4) expect(Math.min(...tense)).toBeGreaterThan(Math.min(...calm));
    }
  });

  it("each melody is an 8-bar phrase that ends on the tonic", () => {
    for (const t of Object.values(TRACKS)) {
      const ph = melody(t, "B");
      expect(ph.length).toBe(8);
      expect(melody(t, "B")).toBe(ph); // cached: the same tune every time
      const last = ph[7][ph[7].length - 1];
      expect(last.degree).toBe(0);
    }
  });

  it("scale degrees map to MIDI in the track's key, wrapping octaves", () => {
    const t = TRACKS.bit; // A minor, key 45
    expect(noteOf(t, 0, 3) % 12).toBe(45 % 12);
    expect(noteOf(t, 7, 3) - noteOf(t, 0, 3)).toBe(12);
    expect(noteOf(t, -1, 3)).toBe(noteOf(t, 6, 2));
    const s = TRACKS.sakura; // five-note scale
    expect(noteOf(s, 5, 3) - noteOf(s, 0, 3)).toBe(12);
  });
});
