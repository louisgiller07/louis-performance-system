// PHYS-01.1 — regenerates the web test fixtures of the physical coaching path:
// genuine Force final prescriptions produced by the engine itself (in-memory
// V2 plan → pure final builders with the daily additions → pure load
// guidance from a recorded history), never hand-made shapes. They stay
// session-model-v2.6 documents (no version change): the previous web reads
// them too. Deterministic ids.
//
// Usage (from web/): node scripts/generate-phys01-fixtures.mjs
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
  recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 240 },
  dhTechnicalTier: "intermediate",
};
let n = 0;
const mintId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const generated = v2.generatePlanV2InMemory({
  block: { sequenceNumber: 1, name: "Plan", mode: "UNSPECIFIED", primaryFocus: "Test", startDate: "2026-10-05", endDate: "2026-10-18" },
  snapshot,
  mintId,
});
if (generated.status !== "generated") throw new Error("plan not generated");
const plan = generated.plan;
const upper = plan.weeks.flatMap((w) => w.sessions).find((x) => x.kind === "STRENGTH_UPPER");

const base = (decision, finalSession, i) => ({
  finalPrescriptionId: `f9000000-0000-4000-8000-00000000000${i}`,
  decision: { decisionId: `d9000000-0000-4000-8000-00000000000${i}`, decision, finalSession },
  lineage: {
    plannedSessionSource: "generated",
    sourcePlanVersionId: plan.planVersionId,
    sourceGeneratedSessionId: upper.generatedPlanSessionId,
    currentPlanVersionId: plan.planVersionId,
    generatedSession: { id: upper.generatedPlanSessionId, kind: upper.kind, loadProfile: upper.loadProfile ?? null, durationMin: upper.durationMin },
  },
  plannedPrescription: { ...upper.plannedPrescription, generatedPlanSessionId: upper.generatedPlanSessionId },
  adaptation: { athlete: v2.toSessionModelV2Input(snapshot), ridingAvailable: true, mintId },
  dailyMintId: mintId,
});

const TODAY = "2026-10-20";
const sets = (count, reps, loadKg, rpe) => Array.from({ length: count }, (_, i) => ({ setNumber: i + 1, done: true, reps, loadKg, rpe }));
const HISTORY = {
  // Every prescribed set at the top of the range, effort within the target → +1 step.
  dumbbell_bench_press: [{ sessionDate: "2026-10-13", prescribed: { sets: 4, reps: { min: 6, max: 8 }, rpeTarget: { min: 7, max: 8 } }, sets: sets(4, 8, 20, 7.5) }],
  // Nothing recorded for the row: calibration.
};

const out = { generatedFrom: v2.SESSION_MODEL_V2_AGGREGATE_VERSION, today: TODAY, finalPrescriptions: {} };

const keepSession = { kind: upper.kind, loadProfile: upper.loadProfile, durationMin: upper.durationMin };
const guided = (r, todayHold) => {
  if (r.status !== "created") throw new Error(`not created: ${JSON.stringify(r)}`);
  const structure = v2.attachStrengthLoadGuidanceV2(r.finalPrescription.structure, TODAY, HISTORY, todayHold);
  if (!v2.validatePrescriptionV2(structure, { stage: "final" }).ok) throw new Error("guided final invalid");
  return { ...r.finalPrescription, structure, ...(r.effectiveDurationMin !== undefined ? { effectiveDurationMin: r.effectiveDurationMin } : {}) };
};
// KEEP upper body (MODERATE): the planned content + its daily cool-down, and the load guidance (+1 step per dumbbell).
out.finalPrescriptions.GUIDED_KEEP_UPPER = guided(v2.buildFinalPrescriptionV2(base("KEEP", keepSession, 1)));
// The same day with a pain reported: the increase is held.
out.finalPrescriptions.GUIDED_KEEP_UPPER_PAIN = guided(v2.buildFinalPrescriptionV2(base("KEEP", keepSession, 2)), "pain");
// A10 — 30 minutes today: the same session at the same dose, the principal alone, the cool-down's mobility.
{
  const r = v2.buildFinalPrescriptionWithinTodayTimeV2({ ...base("KEEP", keepSession, 3), availableMinutes: 30 });
  if (r.status !== "created" || !r.finalPrescription.adaptationRuleIds.includes("v2.time.strength_shortened")) throw new Error("shortened Force not created");
  out.finalPrescriptions.SHORTENED_UPPER_30 = guided(r);
}
// M1 MODIFY (LIGHT): another repetition range → the last load is shown, never converted.
out.finalPrescriptions.GUIDED_MODIFY_UPPER_LIGHT = guided(v2.buildFinalPrescriptionV2(base("MODIFY", { kind: upper.kind, loadProfile: "LIGHT" }, 4)));

writeFileSync(join(here, "..", "src", "test", "fixtures", "phys01FinalPrescriptionV2.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`written: ${Object.keys(out.finalPrescriptions).join(", ")} (${out.generatedFrom})`);
