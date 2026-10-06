import { describe, expect, it } from "vitest";
import {
  buildFinalPrescriptionV2,
  buildSessionModelV2CatalogManifest,
  buildStrengthPrescriptionV2Content,
  generatePlanV2InMemory,
  toSessionModelV2Input,
  type ExerciseItemV2Content,
  type PlanInputSnapshotV2,
  type PrescriptionV2Content,
} from "../../src/sessionModelV2/index.js";
import { SESSION_EXERCISE_CATALOG_V2 } from "../../src/catalog/sessionExerciseCatalogV2.js";
import { PLAN_ROLE_DOSES_V2 } from "../../src/catalog/planDosePolicyV2.js";
import type { StrengthExperienceTier } from "../../src/types/planInputSnapshot.js";

// A02 — every V2 Force session is complete and unambiguous: real exercises,
// sets / reps / RPE / rest / cue on every work exercise, a ramp-up on the
// principal, nothing the declared equipment cannot do, three clearly
// different doses, a plausible duration, and an adapted Force (MODIFY /
// REPLACE) as complete as a generated one.

const catalog = buildSessionModelV2CatalogManifest();
const KINDS = ["STRENGTH_LOWER", "STRENGTH_UPPER"] as const;
const TIERS: StrengthExperienceTier[] = ["beginner", "intermediate", "advanced"];
const EQUIPMENT: Record<string, string[]> = {
  none: [],
  bands: ["resistance_bands"],
  dumbbells: ["dumbbells"],
  dumbbells_bench: ["dumbbells", "bench"],
  gym: ["dumbbells", "bench", "barbell", "squat_rack", "pull_up_bar", "resistance_bands", "cable_machine"],
};
const STEPS = { LIGHT: ["LIGHT", "LIGHT"], MODERATE: ["MODERATE", "MODERATE"], MODERATE_PLUS: ["MODERATE", "MODERATE_PLUS"] } as const;

const work = (c: PrescriptionV2Content) => c.blocks.filter((b) => b.role === "main" || b.role === "complementary").flatMap((b) => b.items) as ExerciseItemV2Content[];
const all = (c: PrescriptionV2Content) => c.blocks.flatMap((b) => b.items) as ExerciseItemV2Content[];
const workSets = (c: PrescriptionV2Content) => work(c).reduce((n, i) => n + i.sets, 0);

function build(kind: (typeof KINDS)[number], tier: StrengthExperienceTier, equipment: string[], step: keyof typeof STEPS) {
  const [loadProfile, doseStep] = STEPS[step];
  return buildStrengthPrescriptionV2Content({ sessionKind: kind, athleteTier: tier, equipment, loadProfile, doseStep, catalog });
}

/** Coarse plausibility only (no biomechanical model): warm-up 8 min, ramp-up 3 min, each work set ≈ 45 s per side + its mean rest. */
function roughMinutes(c: PrescriptionV2Content): number {
  const seconds = work(c).reduce((n, i) => n + i.sets * (("perSide" in i.measure && i.measure.perSide ? 2 : 1) * 45 + (i.restSeconds ? (i.restSeconds.min + i.restSeconds.max) / 2 : 60)), 0);
  return 8 + 3 + seconds / 60;
}

const CASES = TIERS.flatMap((tier) =>
  KINDS.flatMap((kind) =>
    Object.entries(EQUIPMENT).flatMap(([eq, equipment]) =>
      (Object.keys(STEPS) as (keyof typeof STEPS)[]).filter((s) => !(tier === "beginner" && s === "MODERATE_PLUS")).map((step) => ({ tier, kind, eq, equipment, step }))
    )
  )
);

describe("A02 — every V2 Force session is complete (A, B, G)", () => {
  it.each(CASES)("$tier $kind $eq $step: real exercises with sets, measure, RPE, rest and cue; a ramp-up on the principal; nothing the equipment cannot do", ({ tier, kind, equipment, step }) => {
    const c = build(kind, tier, equipment, step);
    expect(work(c).length).toBeGreaterThanOrEqual(3);
    for (const i of work(c)) {
      expect(i.sets).toBeGreaterThan(0);
      expect(i.measure).toBeDefined();
      expect(i.rpeTarget).toBeDefined();
      expect(i.restSeconds).toBeDefined();
      expect(i.cueId).toBeTruthy();
    }
    expect(work(c).filter((i) => i.role === "principal").map((i) => i.rampUp !== undefined)).toEqual([true]);
    // G — warm-up included: every exercise is doable with the declared equipment.
    for (const i of all(c)) expect(SESSION_EXERCISE_CATALOG_V2[i.exerciseId]!.requiredEquipment.filter((e) => !equipment.includes(e)), `${i.exerciseId}`).toEqual([]);
  });
});

describe("A02 — LIGHT / MODERATE / MODERATE_PLUS are clearly different (C, D)", () => {
  it.each(TIERS.filter((t) => t !== "beginner").flatMap((tier) => KINDS.map((kind) => ({ tier, kind }))))("$tier $kind: same exercises, more work sets and a higher RPE at each step", ({ tier, kind }) => {
    const [light, moderate, plus] = (["LIGHT", "MODERATE", "MODERATE_PLUS"] as const).map((s) => build(kind, tier, EQUIPMENT.dumbbells_bench!, s));
    const ids = (c: PrescriptionV2Content) => work(c).map((i) => i.exerciseId);
    expect(ids(light!)).toEqual(ids(moderate!));
    expect(ids(plus!)).toEqual(ids(moderate!));
    expect(workSets(light!)).toBeLessThan(workSets(moderate!));
    expect(workSets(moderate!)).toBeLessThan(workSets(plus!));
    const principalRpe = (c: PrescriptionV2Content) => work(c).find((i) => i.role === "principal")!.rpeTarget!;
    expect([principalRpe(light!), principalRpe(moderate!), principalRpe(plus!)]).toEqual([{ min: 5, max: 6 }, { min: 7, max: 8 }, { min: 8, max: 8 }]);
  });

  it("the overload step is visible in the counts of the lower-body session: 7 → 10 → 12 work sets", () => {
    expect((["LIGHT", "MODERATE", "MODERATE_PLUS"] as const).map((s) => workSets(build("STRENGTH_LOWER", "intermediate", EQUIPMENT.dumbbells_bench!, s)))).toEqual([7, 10, 12]);
  });
});

describe("A02 — duration stays plausible with the announced session duration", () => {
  it.each(CASES)("$tier $kind $eq $step: rough content time fits the planned duration (never far above it, never a fraction of it)", ({ tier, kind, equipment, step }) => {
    const planned = step === "LIGHT" ? PLAN_ROLE_DOSES_V2.consolidation.forceDurationMin : PLAN_ROLE_DOSES_V2.build.forceDurationMin;
    const minutes = roughMinutes(build(kind, tier, equipment, step));
    expect(minutes).toBeLessThanOrEqual(planned);
    expect(minutes).toBeGreaterThanOrEqual(planned * 0.5);
  });
});

describe("A02 — an adapted Force is as complete as a generated one (E, F)", () => {
  const SNAPSHOT: PlanInputSnapshotV2 = {
    discipline: "Downhill",
    races: [],
    availability: { windows: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d as 0, startTime: "08:00", endTime: "20:00" })), exceptions: [] },
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
  const plan = (() => {
    const r = generatePlanV2InMemory({ block: { sequenceNumber: 1, name: "Plan", mode: "UNSPECIFIED", primaryFocus: "Test", startDate: "2026-10-05", endDate: "2026-10-18" }, snapshot: SNAPSHOT, mintId: () => `id-${++n}` });
    if (r.status !== "generated") throw new Error("plan");
    return r.plan;
  })();
  const sessionOf = (kind: string) => plan.weeks[0]!.sessions.find((s) => s.kind === kind)!;
  const adapt = (kind: string, decision: "MODIFY" | "REPLACE", finalSession: { kind: string; loadProfile: "LIGHT" | "MODERATE" }) => {
    const s = sessionOf(kind);
    let m = 0;
    const r = buildFinalPrescriptionV2({
      finalPrescriptionId: "f",
      decision: { decisionId: "d", decision, finalSession },
      lineage: { plannedSessionSource: "generated", sourcePlanVersionId: plan.planVersionId, sourceGeneratedSessionId: s.generatedPlanSessionId, currentPlanVersionId: plan.planVersionId, generatedSession: { id: s.generatedPlanSessionId, kind: s.kind, loadProfile: s.loadProfile ?? null, durationMin: s.durationMin } },
      plannedPrescription: { ...s.plannedPrescription, generatedPlanSessionId: s.generatedPlanSessionId },
      adaptation: { athlete: toSessionModelV2Input(SNAPSHOT), ridingAvailable: true, mintId: () => `x-${++m}` },
    });
    if (r.status !== "created") throw new Error(JSON.stringify(r));
    return r.finalPrescription.structure as unknown as PrescriptionV2Content;
  };
  const withoutIds = (c: PrescriptionV2Content) => JSON.parse(JSON.stringify(c, (k, v) => (k === "prescriptionItemId" || k === "blockId" || k === "derivedFromItemId" ? undefined : v)));

  it("E — MODIFY Force → LIGHT: exactly the generated LIGHT Force of the same exercises (sets, reps, RPE, rest)", () => {
    expect(withoutIds(adapt("STRENGTH_LOWER", "MODIFY", { kind: "STRENGTH_LOWER", loadProfile: "LIGHT" }))).toEqual(withoutIds(build("STRENGTH_LOWER", "intermediate", SNAPSHOT.equipment, "LIGHT")));
  });

  it("F — REPLACE DH → Force: exactly the Force the planner generates for this rider (no second-class session)", () => {
    expect(withoutIds(adapt("DH_TECHNICAL", "REPLACE", { kind: "STRENGTH_UPPER", loadProfile: "MODERATE" }))).toEqual(withoutIds(build("STRENGTH_UPPER", "intermediate", SNAPSHOT.equipment, "MODERATE")));
  });
});
