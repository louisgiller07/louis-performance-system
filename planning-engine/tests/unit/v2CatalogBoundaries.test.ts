import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// UX-11A.5a.1 / UX-11A.5a.2a / UX-11A.5a.3 — import boundary: the Session Model V2 content
// modules are not consumed by any engine yet. Only planning-engine's own
// catalogue index (re-exports) and the V2 modules themselves may reference
// them. Any engine starting to consume V2 content must be a deliberate,
// separately validated change (UX-11A.5b).
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const V2_MODULES = ["sessionExerciseCatalogV2", "sessionDrillCatalogV2", "intentCatalogV2", "sessionFrameV2", "coachingTextCatalog", "protocolCatalogV2"];
const V2_SYMBOLS =
  /\b(SESSION_EXERCISE_CATALOG_V2\w*|SESSION_DRILL_CATALOG_V2\w*|INTENT_CATALOG_V2\w*|DH_SKILL_TO_INTENT_V2|DH_SESSION_FRAME_V2|SESSION_BLOCK_ROLES_V2|COACHING_TEXT_CATALOG\w*|PROTOCOL_CATALOG_V2\w*)\b/;
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

  it("UX-11A.5a.2b — no engine reads the declared DH tier yet (only the profile repository may select the column)", () => {
    const roots = ["planning-engine/src", "prescription-engine/src", "head-coach-engine/src", "longitudinal-engine/src"].map((r) => join(REPO, r));
    // The profile repository reads the column; the V2 catalogue modules (already isolated above) only document it.
    const allowed = new Set([join("head-coach-engine", "src", "supabase", "repositories", "athletePerformanceProfileRepo.ts"), ...ALLOWED]);
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of sourceFiles(root)) {
        const rel = relative(REPO, file);
        if (allowed.has(rel)) continue;
        if (/dhTechnicalTier|dh_technical_tier/.test(readFileSync(file, "utf8"))) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("UX-11A.5a.3 — the protocol catalogue only imports types from sibling V2 catalogue modules (no web, no engine, no runtime dependency)", () => {
    const text = readFileSync(join(REPO, "planning-engine", "src", "catalog", "protocolCatalogV2.ts"), "utf8");
    const imports = [...text.matchAll(/^import\s+(type\s+)?[^;]*?from\s+"([^"]+)";/gm)].map((m) => ({ typeOnly: m[1] !== undefined, from: m[2]! }));
    expect(imports.length).toBeGreaterThan(0);
    for (const i of imports) {
      expect(i.typeOnly, i.from).toBe(true);
      expect(["./coachingTextCatalog.js", "./intentCatalogV2.js", "./sessionExerciseCatalogV2.js", "./sessionFrameV2.js"], i.from).toContain(i.from);
    }
  });
});
