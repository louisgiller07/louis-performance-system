import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// UX-11A.5a.1 / UX-11A.5a.2a / UX-11A.5a.3 — import boundary: the Session Model V2 content
// modules are not consumed by any engine yet. Only planning-engine's own
// catalogue index (re-exports) and the V2 modules themselves may reference
// them. Any engine starting to consume V2 content must be a deliberate,
// separately validated change (UX-11A.5b).
// UX-11A.5b.2 — the Session Model V2 module (planning-engine/src/sessionModelV2/)
// is the only business module allowed to read the V2 catalogues and the DH
// tier; no other engine source may import that module.
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const V2_MODULES = [
  "sessionExerciseCatalogV2",
  "sessionDrillCatalogV2",
  "intentCatalogV2",
  "sessionFrameV2",
  "coachingTextCatalog",
  "protocolCatalogV2",
  "strengthTemplateCatalogV2",
  "strengthDoseCatalogV2",
  "planDosePolicyV2",
];
const V2_SYMBOLS =
  /\b(SESSION_EXERCISE_CATALOG_V2\w*|SESSION_DRILL_CATALOG_V2\w*|INTENT_CATALOG_V2\w*|DH_SKILL_TO_INTENT_V2|DH_SESSION_FRAME_V2|SESSION_BLOCK_ROLES_V2|COACHING_TEXT_CATALOG\w*|PROTOCOL_CATALOG_V2\w*|STRENGTH_TEMPLATE_CATALOG_V2\w*|STRENGTH_DOSE_CATALOG_V2\w*|PLAN_DOSE_POLICY_V2\w*)\b/;
const ALLOWED = new Set(
  ["planning-engine/src/catalog/index.ts", ...V2_MODULES.map((m) => `planning-engine/src/catalog/${m}.ts`)].map((p) => p.split("/").join(sep))
);
const SESSION_MODEL_V2_DIR = ["planning-engine", "src", "sessionModelV2"].join(sep) + sep;
const isSessionModelV2 = (rel: string) => rel.startsWith(SESSION_MODEL_V2_DIR);

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
        if (ALLOWED.has(rel) || isSessionModelV2(rel)) continue;
        const text = readFileSync(file, "utf8");
        if (V2_MODULES.some((m) => text.includes(`/${m}`)) || V2_SYMBOLS.test(text)) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("UX-11A.5a.2b / 5b.5a — only the profile repository and the explicit PlanInputSnapshotV2 builder read the declared DH tier", () => {
    const roots = ["planning-engine/src", "prescription-engine/src", "head-coach-engine/src", "longitudinal-engine/src"].map((r) => join(REPO, r));
    // The profile repository reads the column; the V2 catalogue modules (already isolated above) only document it.
    const allowed = new Set([
      join("head-coach-engine", "src", "supabase", "repositories", "athletePerformanceProfileRepo.ts"),
      join("head-coach-engine", "src", "supabase", "buildPlanInputSnapshotV2.ts"),
      ...ALLOWED,
    ]);
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of sourceFiles(root)) {
        const rel = relative(REPO, file);
        if (allowed.has(rel) || isSessionModelV2(rel)) continue;
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

  it("UX-11A.5b.2 — no engine source outside sessionModelV2 imports the Session Model V2 module, and planning-engine's public index does not expose it", () => {
    const roots = ["planning-engine/src", "prescription-engine/src", "head-coach-engine/src", "longitudinal-engine/src"].map((r) => join(REPO, r));
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of sourceFiles(root)) {
        const rel = relative(REPO, file);
        if (isSessionModelV2(rel)) continue;
        if (/sessionModelV2/.test(readFileSync(file, "utf8"))) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
    expect(sourceFiles(join(REPO, "planning-engine", "src", "sessionModelV2")).length).toBeGreaterThan(0);
  });

  it("UX-11A.5b.4 — the V2 builders are DH, aerobic base and Force; only the Force builder reads the strength templates and doses; none reads the plan dose policy yet", () => {
    const dir = join(REPO, "planning-engine", "src", "sessionModelV2", "builders");
    // A04 — recovery content (REPLACE → RECOVERY_ACTIVE), from the recovery protocol only.
    expect(readdirSync(dir).sort()).toEqual(["aerobicBasePrescriptionV2.ts", "dhPrescriptionV2.ts", "dhSessionOrdinals.ts", "recoveryActivePrescriptionV2.ts", "strengthPrescriptionV2.ts"]);
    for (const file of sourceFiles(dir)) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/planDosePolicyV2|PLAN_DOSE_POLICY/);
      if (!file.endsWith("strengthPrescriptionV2.ts")) expect(text, file).not.toMatch(/strengthTemplateCatalogV2|strengthDoseCatalogV2|STRENGTH_TEMPLATE|STRENGTH_DOSE/);
    }
  });

  it("UX-11A.5b.5a — only the explicit V2 head-coach files import planning-engine/session-model-v2; M1, generationEngine, persistence and prescription-engine never do", () => {
    const allowed = new Set([
      join("head-coach-engine", "src", "supabase", "buildPlanInputSnapshotV2.ts"),
      join("head-coach-engine", "src", "generation", "v2", "runInMemoryPlanGenerationV2.ts"),
      // UX-11A.5b.5b — explicit local V2 persistence (no public entry point).
      join("head-coach-engine", "src", "generation", "v2", "planV2PersistencePayload.ts"),
      join("head-coach-engine", "src", "generation", "v2", "generateAndPersistTrainingPlanV2.ts"),
      // UX-11A.5c.3 — V2 daily reconciliation (runtime import, loaded lazily) and its outcome mapping (type-only).
      join("head-coach-engine", "src", "supabase", "dailyV2", "reconcileFinalPrescriptionV2.ts"),
      join("head-coach-engine", "src", "supabase", "dailyV2", "finalPrescriptionOutcome.ts"),
      // UX-11A.5c.3.1 — the daily-run V2 Deno bundle entry (same source, bundled by esbuild).
      join("head-coach-engine", "src", "edge", "dailyRunV2EdgeEntry.ts"),
    ]);
    const importers: string[] = [];
    for (const root of ["head-coach-engine/src", "prescription-engine/src", "longitudinal-engine/src", "planning-engine/src"].map((r) => join(REPO, r))) {
      for (const file of sourceFiles(root)) {
        if (readFileSync(file, "utf8").includes("planning-engine/session-model-v2")) importers.push(relative(REPO, file));
      }
    }
    expect(importers.sort()).toEqual([...allowed].sort());
    // The public planning-engine index still does not expose the module.
    expect(readFileSync(join(REPO, "planning-engine", "src", "index.ts"), "utf8")).not.toMatch(/sessionModelV2|session-model-v2/);
  });

  it("UX-11A.5a.4.3 — the V2 dose model never reads the legacy LoadDerivation durations", () => {
    const text = readFileSync(join(REPO, "planning-engine", "src", "sessionModelV2", "orchestration", "planDoseModelV2.ts"), "utf8");
    expect(text).not.toMatch(/referenceDurationMinFor|BASE_DURATION_MIN|TAPER_DURATION_MIN/);
    // Load authority lock: the final V2 load never comes from the baseline.
    expect(text).not.toMatch(/baseline\.loadProfile|BASE_LOAD_PROFILE|TAPER_LOAD_PROFILE/);
  });

  it("UX-11A.5c.1 / 5c.3 — KEEP final prescription is a copy: the final module calls no sport builder, catalogue, dose policy or legacy dose; outside the V2 module only the head-coach V2 daily integration references it", () => {
    const dir = join(REPO, "planning-engine", "src", "sessionModelV2", "final");
    // A04 — buildFinalPrescriptionV2 (MODIFY / REPLACE) builds real content with the V2 builders and the
    // plan dose policy; the KEEP copy itself stays pure. No module of final/ ever reads a legacy dose field.
    expect(readdirSync(dir).sort()).toEqual(["buildFinalPrescriptionV2.ts", "buildKeepFinalPrescriptionV2.ts", "finalPrescriptionV2.ts", "validateKeepFinalPrescriptionV2.ts"]);
    for (const file of sourceFiles(dir)) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/setVolume|targetRpeOrRir|intensityZone/);
      if (file.endsWith("buildFinalPrescriptionV2.ts") && !file.endsWith("buildKeepFinalPrescriptionV2.ts")) continue;
      expect(text, file).not.toMatch(/\/builders\/|\/catalog\/|\/orchestration\/|planDosePolicyV2|strengthDoseCatalogV2|strengthTemplateCatalogV2|protocolCatalogV2/);
    }
    const offenders: string[] = [];
    for (const root of ["planning-engine/src", "prescription-engine/src", "head-coach-engine/src", "longitudinal-engine/src"].map((r) => join(REPO, r))) {
      for (const file of sourceFiles(root)) {
        const rel = relative(REPO, file);
        if (isSessionModelV2(rel) || rel.startsWith(join("head-coach-engine", "src", "supabase", "dailyV2") + sep) || rel === join("head-coach-engine", "src", "supabase", "runDailyFor.ts") || rel === join("head-coach-engine", "src", "edge", "dailyRunV2EdgeEntry.ts")) continue;
        if (/buildKeepFinalPrescriptionV2|buildFinalPrescriptionV2|validateKeepFinalPrescriptionV2|FinalPrescriptionV2/.test(readFileSync(file, "utf8"))) offenders.push(rel);
      }
    }
    // UX-11A.5c.4 — the web has its own read-only V2 contract (its own types named
    // FinalPrescriptionV2*), but never calls the engine's builder or validator.
    for (const file of sourceFiles(join(REPO, "web", "src"))) {
      if (/buildKeepFinalPrescriptionV2|buildFinalPrescriptionV2|validateKeepFinalPrescriptionV2/.test(readFileSync(file, "utf8"))) offenders.push(relative(REPO, file));
    }
    expect(offenders).toEqual([]);
  });

  it("UX-11A.5b.5b — V2 builders and the in-memory orchestrator never read the legacy doseTarget fields (setVolume, targetRpeOrRir, intensityZone)", () => {
    const files = [
      ...sourceFiles(join(REPO, "planning-engine", "src", "sessionModelV2", "builders")),
      join(REPO, "planning-engine", "src", "sessionModelV2", "orchestration", "generatePlanV2InMemory.ts"),
    ];
    for (const file of files) expect(readFileSync(file, "utf8"), file).not.toMatch(/setVolume|targetRpeOrRir|intensityZone/);
  });
});
