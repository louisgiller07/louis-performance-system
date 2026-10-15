// PHYS-04 — regenerates the web test fixtures of the mobility and bodyweight paths: genuine documents
// produced by the engine itself (in-memory V2 plan with the mobility option → pure final builders; the
// bodyweight repetitions guidance attached exactly as the daily integration does), never hand-made shapes.
// session-model-v2.6 documents (no version change): the previous web reads them too.
//
// Usage (from web/): node scripts/generate-phys04-fixtures.mjs
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
function planFor(snap, extra = {}) {
  const r = v2.generatePlanV2InMemory({ block: { sequenceNumber: 1, name: "Plan", mode: "UNSPECIFIED", primaryFocus: "Test", startDate: "2026-10-05", endDate: "2026-11-15" }, snapshot: snap, mintId, ...extra });
  if (r.status !== "generated") throw new Error("plan not generated");
  return r.plan;
}
const sessionOf = (plan, kind) => plan.weeks.flatMap((w) => w.sessions).find((s) => s.kind === kind);

const input = (plan, snap, s, decision, finalSession, i, extra = {}) => ({
  finalPrescriptionId: `f9400000-0000-4000-8000-00000000000${i}`,
  decision: { decisionId: `d9400000-0000-4000-8000-00000000000${i}`, decision, finalSession },
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
const out = { generatedFrom: v2.SESSION_MODEL_V2_AGGREGATE_VERSION, finalPrescriptions: {}, plannedPrescriptions: {} };

// Mobility — a consolidation week of a plan generated with the mobility option.
const snapM = snapshot("intermediate", ["dumbbells", "bench"]);
const planM = planFor(snapM, { mobilitySessions: true });
const mob = sessionOf(planM, "MOBILITY");
const keepMob = { kind: "MOBILITY", loadProfile: mob.loadProfile, durationMin: mob.durationMin };
out.plannedPrescriptions.PLANNED_MOBILITY = { ...mob.plannedPrescription, generatedPlanSessionId: mob.generatedPlanSessionId };
out.finalPrescriptions.KEEP_MOBILITY = created(v2.buildFinalPrescriptionV2(input(planM, snapM, mob, "KEEP", keepMob, 1)));
// A10 — 25 minutes: the same routine at its protocol minimum (22 min).
out.finalPrescriptions.A10_MOBILITY_MINIMUM = created(v2.buildFinalPrescriptionWithinTodayTimeV2({ ...input(planM, snapM, mob, "KEEP", keepMob, 2), availableMinutes: 25 }));
// Safe state, as the engine returns it: below the routine minimum.
out.blockedMobilityTooShort = v2.buildFinalPrescriptionV2({ ...input(planM, snapM, mob, "MODIFY", { ...keepMob, durationMin: 20 }, 3), timeLimitMin: 20 });
if (out.blockedMobilityTooShort.status !== "blocked") throw new Error("mobility below its minimum must be blocked");

// Bodyweight Force — a rider without equipment; the guidance from the rider's own recorded repetitions.
const snapB = snapshot("beginner", []);
const planB = planFor(snapB);
const lower = sessionOf(planB, "STRENGTH_LOWER");
const keepLower = { kind: "STRENGTH_LOWER", loadProfile: lower.loadProfile, durationMin: lower.durationMin };
const base = created(v2.buildFinalPrescriptionV2(input(planB, snapB, lower, "KEEP", keepLower, 4)));
const today = "2026-10-21";
const WORK_ROLES = ["main", "complementary"];
const workItems = (structure) => structure.blocks.filter((b) => WORK_ROLES.includes(b.role)).flatMap((b) => b.items).filter((i) => i.kind === "exercise" && v2.isBodyweightRepsExerciseV2(i.exerciseId));
const record = (item, reps, rpe) => ({
  sessionDate: "2026-10-14",
  prescribed: { sets: item.sets, reps: { min: item.measure.min, max: item.measure.max }, rpeTarget: item.rpeTarget ?? null },
  sets: reps.map((r, k) => ({ setNumber: k + 1, done: true, reps: r, loadKg: null, rpe })),
});
// The recorded effort: the top of the exercise's own RPE target (on target, never above).
const guided = (key, repsOf) => {
  const history = Object.fromEntries(repsOf ? workItems(base.structure).map((i) => [i.exerciseId, [record(i, repsOf(i), i.rpeTarget?.max ?? null)]]) : []);
  const structure = v2.attachBodyweightRepsGuidanceV2(base.structure, today, history);
  const valid = v2.validatePrescriptionV2(structure, { stage: "final" });
  if (!valid.ok) throw new Error(`${key}: ${JSON.stringify(valid.issues)}`);
  out.finalPrescriptions[key] = { ...base, structure };
};
guided("BODYWEIGHT_CALIBRATE", null);
// Every set at the bottom of the range, effort on target → one more repetition next time.
guided("BODYWEIGHT_PROGRESS", (i) => Array.from({ length: i.sets }, () => i.measure.min));
// Every set at the top of the range → keep the top; no harder variant without equipment in the catalogue.
guided("BODYWEIGHT_TOP_OF_RANGE", (i) => Array.from({ length: i.sets }, () => i.measure.max));

writeFileSync(join(here, "..", "src", "test", "fixtures", "phys04FinalPrescriptionV2.json"), `${JSON.stringify(out, null, 2)}\n`);
console.log("phys04 fixtures written");
