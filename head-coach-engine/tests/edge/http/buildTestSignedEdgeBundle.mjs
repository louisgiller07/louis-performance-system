// V2-DH-RELEASE-GATES-01 (HPM 2026-10-26) — LOCAL TEST HARNESS ONLY. Never part of a build, a release or a deploy.
//
// The V2 ON generation path needs signed DH units (V2-DH-UNIT-01, V2-DH-SPORT-GATE-01), and the production sign-off
// tables are empty: no sports decision exists yet. To replay the HTTP generation tests on the real Edge runtime with
// V2 ON, this script rebuilds dist/edge/generateTrainingPlan.bundle.js IN PLACE with TEST sign-offs of the content
// served now (every drill SECTION, one common validation), each reference marked TEST_SIGNOFF_MARK. The source tree and
// the production tables are not touched; the fixture lives in a temporary directory.
//
// Restore with `npm run build:edge` (the real bundle, byte for byte). tests/edge/dailyRunV2Bundle.test.ts fails while a
// test bundle is in dist/edge, so it can never pass a release check unnoticed.
//
// Usage (head-coach-engine, after `npm run build`): node tests/edge/http/buildTestSignedEdgeBundle.mjs
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

export const TEST_SIGNOFF_MARK = "TEST fixture V2-DH-RELEASE-GATES-01 (not a sports decision)";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PLANNING_DIST = fileURLToPath(new URL("../../../../planning-engine/dist/", import.meta.url));
const REAL_CATALOG = join(PLANNING_DIST, "catalog", "dhRepetitionUnitCatalogV2.js");

const gate = await import(pathToFileURL(join(PLANNING_DIST, "sessionModelV2", "dhSportGateV2.js")).href);
const drills = await import(pathToFileURL(join(PLANNING_DIST, "catalog", "sessionDrillCatalogV2.js")).href);

const signoffs = Object.fromEntries(
  drills.SESSION_DRILL_CATALOG_V2_ENTRIES.map(({ drillId }) => {
    const s = gate.dhServedSportContentV2(drillId);
    return [
      drillId,
      {
        unit: { decision: TEST_SIGNOFF_MARK, unit: "SECTION" },
        cue: { decision: TEST_SIGNOFF_MARK, drillName: s.drillName, cueText: s.cueText, criterionText: s.criterionText },
        dose: { decision: TEST_SIGNOFF_MARK, doseTerms: s.doseTerms },
        safety: { decision: TEST_SIGNOFF_MARK, vigilanceTexts: s.vigilanceTexts, regressesTo: s.regressesTo, terrains: s.terrains },
      },
    ];
  })
);
const common = { decision: TEST_SIGNOFF_MARK, ...gate.dhServedCommonContentV2() };

const dir = mkdtempSync(join(tmpdir(), "nalynt-test-signoffs-"));
const fixture = join(dir, "dhRepetitionUnitCatalogV2.testFixture.js");
writeFileSync(
  fixture,
  `// GENERATED LOCAL TEST FIXTURE (${TEST_SIGNOFF_MARK}) — never deployed.\n` +
    `export * from ${JSON.stringify(REAL_CATALOG.replace(/\\/g, "/"))};\n` +
    `export const DH_SPORT_SIGNOFFS_V2 = Object.freeze(${JSON.stringify(signoffs)});\n` +
    `export const DH_SPORT_COMMON_SIGNOFF_V2 = ${JSON.stringify(common)};\n`
);

try {
  await build({
    entryPoints: [join(ROOT, "dist", "edge", "generateTrainingPlanEdgeEntry.js")],
    bundle: true,
    format: "esm",
    platform: "neutral",
    external: ["node:*"],
    outfile: join(ROOT, "dist", "edge", "generateTrainingPlan.bundle.js"),
    logLevel: "warning",
    plugins: [
      {
        name: "test-signoffs",
        setup(b) {
          // Every import of the sign-off catalogue gets the fixture, except the fixture's own re-export of the real one.
          b.onResolve({ filter: /dhRepetitionUnitCatalogV2\.js$/ }, (args) => (args.importer === fixture ? undefined : { path: fixture }));
        },
      },
    ],
  });
  console.log(`dist/edge/generateTrainingPlan.bundle.js rebuilt with ${Object.keys(signoffs).length} TEST sign-offs — restore with \`npm run build:edge\``);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
