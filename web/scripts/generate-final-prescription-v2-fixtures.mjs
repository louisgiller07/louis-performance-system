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
  recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 0 },
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
writeFileSync(join(here, "..", "src", "test", "fixtures", "finalPrescriptionV2.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${Object.keys(out.finalPrescriptions).length} final prescriptions (${out.generatedFrom})`);
