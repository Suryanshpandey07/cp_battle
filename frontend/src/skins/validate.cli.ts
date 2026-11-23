/* npm run skins:validate — fails the build on any invalid skin manifest. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateAll, type Recipes } from "./validate";

const shared = fileURLToPath(new URL("../../../shared", import.meta.url));
const dir = join(shared, "skins");
const recipes = JSON.parse(readFileSync(join(shared, "skin-recipes.json"), "utf8")) as Recipes;
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((name) => ({ name, data: JSON.parse(readFileSync(join(dir, name), "utf8")) }));
const errors = validateAll(files, recipes);
if (errors.length) {
  console.error(`skins:validate found ${errors.length} problem(s):\n` + errors.join("\n"));
  process.exit(1);
}
console.log(`skins:validate OK (${files.length} manifests)`);
