import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrast, validateAll, validateManifest, type Recipes } from "../src/skins/validate";

// Tests run from frontend/ (npm test), so the shared contracts are one level up.
const shared = join(process.cwd(), "..", "shared");
const dir = join(shared, "skins");
const recipes = JSON.parse(readFileSync(join(shared, "skin-recipes.json"), "utf8")) as Recipes;
const files = readdirSync(dir).map((name) => ({ name, data: JSON.parse(readFileSync(join(dir, name), "utf8")) }));

describe("skin manifests", () => {
  it("the launch catalogue is valid", () => {
    expect(files.length).toBe(37);
    expect(validateAll(files, recipes)).toEqual([]);
  });
  it("rejects low contrast, unknown recipes, external URLs and missing fallbacks", () => {
    const base = files.find((f) => f.name === "card.inferno.json")!.data;
    const bad = { ...base, palette: { ...base.palette, text: "#3b0a05" }, attack: { ...base.attack, impact: "laser-show" }, frame: { style: "https://x.y/z.png" } };
    delete bad.reducedMotion;
    const errs = validateManifest(bad, recipes, "card.inferno.json");
    expect(errs.some((e) => e.includes("contrast"))).toBe(true);
    expect(errs.some((e) => e.includes("attack.impact"))).toBe(true);
    expect(errs.some((e) => e.includes("external URLs"))).toBe(true);
    expect(errs.some((e) => e.includes("reducedMotion"))).toBe(true);
  });
  it("rejects duplicate ids and misnamed files", () => {
    const f = files[0];
    expect(validateAll([f, f], recipes).some((e) => e.includes("duplicate"))).toBe(true);
    expect(validateManifest(f.data, recipes, "wrong.json").length).toBeGreaterThan(0);
  });
  it("computes WCAG contrast", () => {
    expect(Math.round(contrast("#ffffff", "#000000"))).toBe(21);
  });
});
