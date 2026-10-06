// UX-11A.5c.4 — regenerates the test fixtures of the web V2 final
// prescription decoder / renderer: genuine KEEP final prescriptions produced
// by the engine itself (in-memory V2 plan → pure KEEP builder), never
// hand-made shapes. Deterministic ids.
//
// Usage (from web/): node scripts/generate-final-prescription-v2-fixtures.mjs
// Requires planning-engine to be built (cd ../planning-engine && npm run build).
import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const v2 = await import(pathToFileURL(join(here, "..", "..", "planning-engine", "dist", "sessionModelV2", "index.js")).href);

const snapshot = {
  discipline: "Downhill",
  races: [],
  availability: { windows: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startTime: "08:00", endTime: "20:00" })), exceptions: [] },
  equipment: ["dumbbells", "bench"],
  terrainAccess: ["flow_trail", "bermed_trail"],
  strengthExperienceTier: "intermediate",
  declaredLimitations: [],
  technicalPriorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
  lockedDates: [],
  // BUG-V2-2 — a rider already training: the block starts at build (MODERATE doses).
  recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 240 },
  dhTechnicalTier: "intermediate",
};
let n = 0;
const generated = v2.generatePlanV2InMemory({
  block: { sequenceNumber: 1, name: "Plan", mode: "UNSPECIFIED", primaryFocus: "Test", startDate: "2026-10-05", endDate: "2026-10-18" },
  snapshot,
  mintId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
});
if (generated.status !== "generated") throw new Error("plan not generated");
const plan = generated.plan;

const out = { generatedFrom: v2.SESSION_MODEL_V2_AGGREGATE_VERSION, finalPrescriptions: {} };
["STRENGTH_LOWER", "STRENGTH_UPPER", "DH_TECHNICAL", "AEROBIC_BASE"].forEach((kind, i) => {
  const s = plan.weeks.flatMap((w) => w.sessions).find((x) => x.kind === kind);
  const decisionId = `d0000000-0000-4000-8000-00000000000${i + 1}`;
  const r = v2.buildKeepFinalPrescriptionV2({
    finalPrescriptionId: `f0000000-0000-4000-8000-00000000000${i + 1}`,
    decision: { decisionId, decision: "KEEP", finalSession: { kind: s.kind, ...(s.loadProfile ? { loadProfile: s.loadProfile } : {}), durationMin: s.durationMin } },
    lineage: {
      plannedSessionSource: "generated",
      sourcePlanVersionId: plan.planVersionId,
      sourceGeneratedSessionId: s.generatedPlanSessionId,
      currentPlanVersionId: plan.planVersionId,
      generatedSession: { id: s.generatedPlanSessionId, kind: s.kind, loadProfile: s.loadProfile ?? null, durationMin: s.durationMin },
    },
    plannedPrescription: { ...s.plannedPrescription, generatedPlanSessionId: s.generatedPlanSessionId },
  });
  if (r.status !== "created") throw new Error(`${kind}: KEEP not created`);
  out.finalPrescriptions[kind] = r.finalPrescription;
});
// A02 — the overload week's Force (build+, MODERATE_PLUS dose), KEEP copy of week 2.
{
  const s = plan.weeks[1].sessions.find((x) => x.kind === "STRENGTH_LOWER");
  const r = v2.buildKeepFinalPrescriptionV2({
    finalPrescriptionId: "f2000000-0000-4000-8000-000000000001",
    decision: { decisionId: "d2000000-0000-4000-8000-000000000001", decision: "KEEP", finalSession: { kind: s.kind, loadProfile: s.loadProfile, durationMin: s.durationMin } },
    lineage: {
      plannedSessionSource: "generated",
      sourcePlanVersionId: plan.planVersionId,
      sourceGeneratedSessionId: s.generatedPlanSessionId,
      currentPlanVersionId: plan.planVersionId,
      generatedSession: { id: s.generatedPlanSessionId, kind: s.kind, loadProfile: s.loadProfile ?? null, durationMin: s.durationMin },
    },
    plannedPrescription: { ...s.plannedPrescription, generatedPlanSessionId: s.generatedPlanSessionId },
  });
  if (r.status !== "created") throw new Error("build+ KEEP not created");
  out.finalPrescriptions.STRENGTH_LOWER_BUILD_PLUS = r.finalPrescription;
}
// A04 — genuine MODIFY / REPLACE final prescriptions (deterministic ids).
const ADAPTED = {
  MODIFY_STRENGTH_LOWER: { from: "STRENGTH_LOWER", decision: "MODIFY", finalSession: { kind: "STRENGTH_LOWER", loadProfile: "LIGHT" } },
  MODIFY_DH_TECHNICAL: { from: "DH_TECHNICAL", decision: "MODIFY", finalSession: { kind: "DH_TECHNICAL", loadProfile: "LIGHT", durationMin: 90 } },
  REPLACE_DH_TO_STRENGTH: { from: "DH_TECHNICAL", decision: "REPLACE", finalSession: { kind: "STRENGTH_UPPER", loadProfile: "LIGHT" } },
  REPLACE_TO_RECOVERY: { from: "STRENGTH_LOWER", decision: "REPLACE", finalSession: { kind: "RECOVERY_ACTIVE" } },
};
Object.entries(ADAPTED).forEach(([name, c], i) => {
  const s = plan.weeks.flatMap((w) => w.sessions).find((x) => x.kind === c.from);
  let m = 0;
  const r = v2.buildFinalPrescriptionV2({
    finalPrescriptionId: `f1000000-0000-4000-8000-00000000000${i + 1}`,
    decision: { decisionId: `d1000000-0000-4000-8000-00000000000${i + 1}`, decision: c.decision, finalSession: c.finalSession },
    lineage: {
      plannedSessionSource: "generated",
      sourcePlanVersionId: plan.planVersionId,
      sourceGeneratedSessionId: s.generatedPlanSessionId,
      currentPlanVersionId: plan.planVersionId,
      generatedSession: { id: s.generatedPlanSessionId, kind: s.kind, loadProfile: s.loadProfile ?? null, durationMin: s.durationMin },
    },
    plannedPrescription: { ...s.plannedPrescription, generatedPlanSessionId: s.generatedPlanSessionId },
    adaptation: { athlete: v2.toSessionModelV2Input(snapshot), ridingAvailable: true, mintId: () => `a${i}000000-0000-4000-8000-${String(++m).padStart(12, "0")}` },
  });
  if (r.status !== "created") throw new Error(`${name}: not created (${JSON.stringify(r)})`);
  out.finalPrescriptions[name] = r.finalPrescription;
});
writeFileSync(join(here, "..", "src", "test", "fixtures", "finalPrescriptionV2.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${Object.keys(out.finalPrescriptions).length} final prescriptions (${out.generatedFrom})`);
