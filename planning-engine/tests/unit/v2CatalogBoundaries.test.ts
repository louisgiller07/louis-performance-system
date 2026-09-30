import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// UX-11A.5a.1 / UX-11A.5a.2a — import boundary: the Session Model V2 content
// modules are not consumed by any engine yet. Only planning-engine's own
// catalogue index (re-exports) and the V2 modules themselves may reference
// them. Any engine starting to consume V2 content must be a deliberate,
// separately validated change (UX-11A.5b).
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const V2_MODULES = ["sessionExerciseCatalogV2", "sessionDrillCatalogV2", "intentCatalogV2", "sessionFrameV2", "coachingTextCatalog"];
const V2_SYMBOLS =
  /\b(SESSION_EXERCISE_CATALOG_V2\w*|SESSION_DRILL_CATALOG_V2\w*|INTENT_CATALOG_V2\w*|DH_SKILL_TO_INTENT_V2|DH_SESSION_FRAME_V2|SESSION_BLOCK_ROLES_V2|COACHING_TEXT_CATALOG\w*)\b/;
const ALLOWED = new Set(
  ["planning-engine/src/catalog/index.ts", ...V2_MODULES.map((m) => `planning-engine/src/catalog/${m}.ts`)].map((p) => p.split("/").join(sep))
);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

describe("V2 content — import boundary", () => {
  it("no engine source (planning, prescription, head coach, longitudinal) imports or references V2 content", () => {
    const roots = ["planning-engine/src", "prescription-engine/src", "head-coach-engine/src", "longitudinal-engine/src"].map((r) => join(REPO, r));
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of sourceFiles(root)) {
        const rel = relative(REPO, file);
        if (ALLOWED.has(rel)) continue;
        const text = readFileSync(file, "utf8");
        if (V2_MODULES.some((m) => text.includes(`/${m}`)) || V2_SYMBOLS.test(text)) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
