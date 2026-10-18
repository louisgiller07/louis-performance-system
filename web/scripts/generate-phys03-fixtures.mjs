// PHYS-03 — regenerates the web test fixtures of the power path: genuine power prescriptions produced by
// the engine itself (in-memory V2 plan with the power option → pure final builders), never hand-made
// shapes. session-model-v2.6 documents (no version change): the previous web reads them too.
//
// Usage (from web/): node scripts/generate-phys03-fixtures.mjs
// Requires planning-engine to be built (cd ../planning-engine && npm run build).
import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const v2 = await import(pathToFileURL(join(here, "..", "..", "planning-engine", "dist", "sessionModelV2", "index.js")).href);

const snapshot = (tier, equipment) => ({
  discipline: "Downhill",
  races: [],
  availability: { windows: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startTime: "08:00", endTime: "20:00" })), exceptions: [] },
  equipment,
  terrainAccess: ["flow_trail", "bermed_trail"],
  strengthExperienceTier: tier,
  declaredLimitations: [],
  technicalPriorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
  lockedDates: [],
  recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 0 },
  dhTechnicalTier: "intermediate",
});
let n = 0;
const mintId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
function planFor(snap) {
  const r = v2.generatePlanV2InMemory({ block: { sequenceNumber: 1, name: "Plan", mode: "UNSPECIFIED", primaryFocus: "Test", startDate: "2026-10-05", endDate: "2026-11-15" }, snapshot: snap, mintId, powerSessions: true });
  if (r.status !== "generated") throw new Error("plan not generated");
  return r.plan;
}
const snapI = snapshot("intermediate", ["dumbbells", "bench"]);
const snapA = snapshot("advanced", []);
const planI = planFor(snapI);
const planA = planFor(snapA);
const powerOf = (plan) => plan.weeks.flatMap((w) => w.sessions).find((s) => s.kind === "POWER");

const input = (plan, snap, s, decision, finalSession, i, extra = {}) => ({
  finalPrescriptionId: `f9300000-0000-4000-8000-00000000000${i}`,
  decision: { decisionId: `d9300000-0000-4000-8000-00000000000${i}`, decision, finalSession },
  lineage: {
    plannedSessionSource: "generated",
    sourcePlanVersionId: plan.planVersionId,
    sourceGeneratedSessionId: s.generatedPlanSessionId,
    currentPlanVersionId: plan.planVersionId,
    generatedSession: { id: s.generatedPlanSessionId, kind: s.kind, loadProfile: s.loadProfile ?? null, durationMin: s.durationMin },
  },
  plannedPrescription: { ...s.plannedPrescription, generatedPlanSessionId: s.generatedPlanSessionId },
  adaptation: { athlete: v2.toSessionModelV2Input(snap), ridingAvailable: true, mintId },
  dailyMintId: mintId,
  ...extra,
});
const created = (r) => {
  if (r.status !== "created") throw new Error(`not created: ${JSON.stringify(r)}`);
  return { ...r.finalPrescription, ...(r.effectiveDurationMin !== undefined ? { effectiveDurationMin: r.effectiveDurationMin } : {}) };
};
const keep = { kind: "POWER", loadProfile: "MODERATE", durationMin: 60 };
const pI = powerOf(planI);
const pA = powerOf(planA);

const out = { generatedFrom: v2.SESSION_MODEL_V2_AGGREGATE_VERSION, finalPrescriptions: {}, plannedPrescriptions: {} };
out.plannedPrescriptions.PLANNED_POWER_INTERMEDIATE = { ...pI.plannedPrescription, generatedPlanSessionId: pI.generatedPlanSessionId };
out.finalPrescriptions.KEEP_POWER_INTERMEDIATE = created(v2.buildFinalPrescriptionV2(input(planI, snapI, pI, "KEEP", keep, 1)));
out.finalPrescriptions.KEEP_POWER_ADVANCED_NO_EQUIPMENT = created(v2.buildFinalPrescriptionV2(input(planA, snapA, pA, "KEEP", keep, 2)));
// A10 — 55 minutes: the same session without its last explosive exercise.
out.finalPrescriptions.A10_POWER_SHORTENED = created(v2.buildFinalPrescriptionWithinTodayTimeV2({ ...input(planI, snapI, pI, "KEEP", keep, 3), availableMinutes: 55 }));
// Safe states, as the engine returns them.
out.blockedPowerLight = v2.buildFinalPrescriptionV2(input(planI, snapI, pI, "MODIFY", { kind: "POWER", loadProfile: "LIGHT" }, 4));
out.blockedPowerFatigue = v2.buildFinalPrescriptionV2(input(planI, snapI, pI, "KEEP", keep, 5, { powerFatigue: { cleared: false, rules: ["C3.6"] } }));
if (out.blockedPowerLight.status !== "blocked" || out.blockedPowerFatigue.status !== "blocked") throw new Error("power safe states must be blocked");

writeFileSync(join(here, "..", "src", "test", "fixtures", "phys03FinalPrescriptionV2.json"), `${JSON.stringify(out, null, 2)}\n`);
console.log("phys03 fixtures written");
