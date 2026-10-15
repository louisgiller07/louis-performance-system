// PHYS-02 — regenerates the web test fixtures of the endurance path: genuine
// endurance prescriptions produced by the engine itself (in-memory V2 plan
// with the intervals option → pure final builders → pure endurance guidance
// from a recorded history), never hand-made shapes. They stay
// session-model-v2.6 documents (no version change): the previous web reads
// them too. Deterministic ids.
//
// Usage (from web/): node scripts/generate-phys02-fixtures.mjs
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
const mintId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const generated = v2.generatePlanV2InMemory({
  block: { sequenceNumber: 1, name: "Plan", mode: "UNSPECIFIED", primaryFocus: "Test", startDate: "2026-10-05", endDate: "2026-11-15" },
  snapshot,
  mintId,
  enduranceIntervals: true,
});
if (generated.status !== "generated") throw new Error("plan not generated");
const plan = generated.plan;
const sessions = plan.weeks.flatMap((w) => w.sessions);
const intervals = sessions.find((x) => x.kind === "AEROBIC_INTERVALS");
const base60 = plan.weeks[4].sessions.find((x) => x.kind === "AEROBIC_BASE");
if (!intervals || !base60 || base60.durationMin !== 60) throw new Error("unexpected plan");

const input = (s, decision, finalSession, i) => ({
  finalPrescriptionId: `f9200000-0000-4000-8000-00000000000${i}`,
  decision: { decisionId: `d9200000-0000-4000-8000-00000000000${i}`, decision, finalSession },
  lineage: {
    plannedSessionSource: "generated",
    sourcePlanVersionId: plan.planVersionId,
    sourceGeneratedSessionId: s.generatedPlanSessionId,
    currentPlanVersionId: plan.planVersionId,
    generatedSession: { id: s.generatedPlanSessionId, kind: s.kind, loadProfile: s.loadProfile ?? null, durationMin: s.durationMin },
  },
  plannedPrescription: { ...s.plannedPrescription, generatedPlanSessionId: s.generatedPlanSessionId },
  adaptation: { athlete: v2.toSessionModelV2Input(snapshot), ridingAvailable: true, mintId },
  dailyMintId: mintId,
});

const TODAY = "2026-11-12";
const HISTORY = [
  { sessionDate: "2026-10-21", protocolId: "endurance_intervals_3min", activityId: "home_trainer", durationSeconds: 3240, distanceM: null, rpeActual: 7 },
  { sessionDate: "2026-11-05", protocolId: "endurance_base_continuous", activityId: "mtb_rolling", durationSeconds: 3600, distanceM: 21500, rpeActual: 6 },
];
const created = (r) => {
  if (r.status !== "created") throw new Error(`not created: ${JSON.stringify(r)}`);
  return r;
};
const guided = (r) => {
  const structure = v2.attachEnduranceGuidanceV2(r.finalPrescription.structure, v2.enduranceGuidanceV2({ date: TODAY, prescription: r.finalPrescription.structure }, HISTORY));
  if (!v2.validatePrescriptionV2(structure, { stage: "final" }).ok) throw new Error("guided final invalid");
  return { ...r.finalPrescription, structure, ...(r.effectiveDurationMin !== undefined ? { effectiveDurationMin: r.effectiveDurationMin } : {}) };
};

const out = { generatedFrom: v2.SESSION_MODEL_V2_AGGREGATE_VERSION, today: TODAY, finalPrescriptions: {}, plannedPrescriptions: {} };
// The planned intervals session (Program reads it as is).
out.plannedPrescriptions.PLANNED_INTERVALS = { ...intervals.plannedPrescription, generatedPlanSessionId: intervals.generatedPlanSessionId };
// KEEP intervals with the last intervals session as reference.
out.finalPrescriptions.KEEP_INTERVALS_GUIDED = guided(created(v2.buildFinalPrescriptionV2(input(intervals, "KEEP", { kind: "AEROBIC_INTERVALS", loadProfile: "MODERATE", durationMin: 53 }, 1))));
// KEEP base 60 min, the last base session noted RPE 6 for a 3–4 target: the effort reminder.
out.finalPrescriptions.KEEP_BASE_EFFORT = guided(created(v2.buildFinalPrescriptionV2(input(base60, "KEEP", { kind: "AEROBIC_BASE", loadProfile: "MODERATE", durationMin: 60 }, 2))));
// MENTAL_RED: intervals → the base endurance session at the planned 53 min.
out.finalPrescriptions.MODIFY_INTERVALS_TO_BASE = guided(created(v2.buildFinalPrescriptionV2(input(intervals, "MODIFY", { kind: "AEROBIC_BASE", loadProfile: "MODERATE" }, 3))));
// A10 — 50 minutes today: intervals are never cut, the base endurance session at 45 min instead.
out.finalPrescriptions.A10_INTERVALS_TO_BASE_45 = guided(created(v2.buildFinalPrescriptionWithinTodayTimeV2({ ...input(intervals, "KEEP", { kind: "AEROBIC_INTERVALS", loadProfile: "MODERATE", durationMin: 53 }, 4), availableMinutes: 50 })));
// PHYS-02.1 — MODIFY LIGHT (C3.3 / C3.6 / pain): no lighter intervals — the base endurance LIGHT fallback.
{
  const r = created(v2.buildFinalPrescriptionV2(input(intervals, "MODIFY", { kind: "AEROBIC_INTERVALS", loadProfile: "LIGHT", durationMin: 53 }, 5)));
  if (!r.finalPrescription.adaptationRuleIds.includes("v2.modify.intervals_light_to_base")) throw new Error("LIGHT intervals must fall back to base endurance");
  out.finalPrescriptions.MODIFY_LIGHT_INTERVALS_FALLBACK = guided(r);
}
// PHYS-02.1 — a manual intervals session the rider set to LIGHT (M1 KEEP): refused, as the engine returns it.
{
  const manual = {
    finalPrescriptionId: "f9200000-0000-4000-8000-000000000006",
    decision: { decisionId: "d9200000-0000-4000-8000-000000000006", decision: "KEEP", finalSession: { kind: "AEROBIC_INTERVALS", loadProfile: "LIGHT" } },
    lineage: { plannedSessionSource: "manual", sourcePlanVersionId: null, sourceGeneratedSessionId: null, currentPlanVersionId: plan.planVersionId, generatedSession: null, currentPlanCoversDate: true },
    plannedPrescription: null,
    adaptation: { athlete: v2.toSessionModelV2Input(snapshot), ridingAvailable: true, mintId },
  };
  out.blockedManualLightIntervals = v2.buildFinalPrescriptionV2(manual);
  if (out.blockedManualLightIntervals.status !== "blocked") throw new Error("a manual LIGHT intervals session must be refused");
}

writeFileSync(join(here, "..", "src", "test", "fixtures", "phys02FinalPrescriptionV2.json"), `${JSON.stringify(out, null, 2)}\n`);
console.log("phys02 fixtures written");
