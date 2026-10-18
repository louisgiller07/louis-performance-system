import { describe, expect, it } from "vitest";
import {
  attachStrengthLoadGuidanceV2,
  buildFinalPrescriptionV2,
  buildFinalPrescriptionWithinTodayTimeV2,
  buildSessionModelV2CatalogManifest,
  generatePlanV2InMemory,
  SESSION_MODEL_V2_AGGREGATE_VERSION,
  toSessionModelV2Input,
  validatePrescriptionV2,
  type BuildFinalPrescriptionV2Input,
  type PlanInputSnapshotV2,
  type PlanV2InMemory,
  type PrescriptionV2,
} from "../../src/sessionModelV2/index.js";
import { SESSION_EXERCISE_CATALOG_V2 } from "../../src/catalog/sessionExerciseCatalogV2.js";
import { COACHING_TEXT_CATALOG } from "../../src/catalog/coachingTextCatalog.js";
import type { PlanInputAvailabilityWindow } from "../../src/types/planInputSnapshot.js";

// PHYS-01.1 — backward compatibility by construction: the plan format is the previous runtime's
// (session-model-v2.6, no component version changed), and the daily Force additions (cool-down,
// shortened session, load guidance) use only ids, roles and block kinds the previous runtime already
// knows, plus one additive key (`loadGuidance`) that it ignores. The previous runtime's own reading of
// these documents is demonstrated on its real code (PHYS-01.1 report, compatibility demonstration).

const ALL_DAY: PlanInputAvailabilityWindow[] = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d as PlanInputAvailabilityWindow["dayOfWeek"], startTime: "08:00", endTime: "20:00" }));
const SNAPSHOT: PlanInputSnapshotV2 = {
  discipline: "Downhill",
  races: [],
  availability: { windows: ALL_DAY, exceptions: [] },
  equipment: ["dumbbells", "bench"],
  terrainAccess: ["any_groomed_trail", "flow_trail", "bermed_trail", "technical_trail"],
  strengthExperienceTier: "intermediate",
  declaredLimitations: [],
  technicalPriorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
  lockedDates: [],
  recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 240 },
  dhTechnicalTier: "intermediate",
};
function counter(prefix: string) {
  let n = 0;
  return () => `00000000-0000-4000-8000-${prefix}${String(++n).padStart(12 - prefix.length, "0")}`;
}
const generated = generatePlanV2InMemory({
  block: { sequenceNumber: 1, name: "Plan", mode: "UNSPECIFIED", primaryFocus: "Test", startDate: "2026-10-05", endDate: "2026-10-18" },
  snapshot: SNAPSHOT,
  mintId: counter("a"),
});
if (generated.status !== "generated") throw new Error("expected a plan");
const PLAN: PlanV2InMemory = generated.plan;
const force = PLAN.weeks.flatMap((w) => w.sessions).find((s) => s.kind === "STRENGTH_LOWER")!;

function input(decision: "KEEP" | "MODIFY", finalSession: BuildFinalPrescriptionV2Input["decision"]["finalSession"], daily = true): BuildFinalPrescriptionV2Input {
  return {
    finalPrescriptionId: "final-1",
    decision: { decisionId: "decision-1", decision, finalSession },
    lineage: {
      plannedSessionSource: "generated",
      sourcePlanVersionId: PLAN.planVersionId,
      sourceGeneratedSessionId: force.generatedPlanSessionId,
      currentPlanVersionId: PLAN.planVersionId,
      generatedSession: { id: force.generatedPlanSessionId, kind: force.kind, loadProfile: force.loadProfile ?? null, durationMin: force.durationMin },
    },
    plannedPrescription: { ...force.plannedPrescription, generatedPlanSessionId: force.generatedPlanSessionId },
    adaptation: { athlete: toSessionModelV2Input(SNAPSHOT), ridingAvailable: true, mintId: counter("b") },
    // V2-PHYS-INTEGRATION-01 — the PHYS-01.1 daily runtime: the PHYS daily switch on.
    ...(daily ? { dailyMintId: counter("c"), phys: { daily: true } } : {}),
  };
}
const created = (r: ReturnType<typeof buildFinalPrescriptionV2>) => {
  if (r.status !== "created") throw new Error(JSON.stringify(r));
  return r.finalPrescription;
};
const withoutCoolDown = (s: PrescriptionV2) => ({ ...s, blocks: s.blocks.filter((b) => b.role !== "cool_down") });
/** Every id a document uses, for the « only known ids » check. */
const idsOf = (s: PrescriptionV2) => ({
  exercises: s.blocks.flatMap((b) => b.items.map((i) => (i.kind === "exercise" ? i.exerciseId : null))).filter((x): x is string => x !== null),
  texts: s.blocks.flatMap((b) => [...b.instructionIds, ...b.items.flatMap((i) => [i.cueId, ...i.vigilanceIds, ...(i.kind === "exercise" && i.rampUp ? [i.rampUp.instructionId] : [])])]),
});

describe("PHYS-01.1 — compatibility with the previous runtime", () => {
  it("no Session Model version change: plans and finals keep session-model-v2.6 and its exact manifest", () => {
    expect(SESSION_MODEL_V2_AGGREGATE_VERSION).toBe("session-model-v2.6");
    expect(force.plannedPrescription.structure.catalog).toEqual(buildSessionModelV2CatalogManifest());
    expect(buildSessionModelV2CatalogManifest()).toMatchObject({ templates: "strength-templates-v2.1", strengthDoses: "strength-doses-v2.2", planDosePolicy: "plan-dose-policy-v2.4" });
  });

  it("a planned Force has no cool-down (the plan is the previous runtime's); without the daily mint a KEEP is still the verbatim copy", () => {
    expect(force.plannedPrescription.structure.blocks.map((b) => b.role)).toEqual(["warm_up", "main", "complementary", "complementary"]);
    expect(created(buildFinalPrescriptionV2(input("KEEP", { kind: force.kind, loadProfile: force.loadProfile!, durationMin: force.durationMin }, false))).structure).toEqual(force.plannedPrescription.structure);
  });

  it("the daily KEEP = the planned content verbatim + the cool-down block appended (nothing else changes, no adaptation rule)", () => {
    const final = created(buildFinalPrescriptionV2(input("KEEP", { kind: force.kind, loadProfile: force.loadProfile!, durationMin: force.durationMin })));
    expect(withoutCoolDown(final.structure)).toEqual(force.plannedPrescription.structure);
    expect(final.structure.blocks.at(-1)).toMatchObject({ role: "cool_down", instructionIds: ["instruction.recovery.light_mobility"] });
    expect(final.adaptationRuleIds).toEqual([]);
    expect(final.catalogVersion).toBe("session-model-v2.6");
  });

  it("a daily MODIFY works as before on the plan (same composition check), then gets its cool-down", () => {
    const final = created(buildFinalPrescriptionV2(input("MODIFY", { kind: force.kind, loadProfile: "LIGHT" })));
    expect(final.reconciliationAction).toBe("modify");
    expect(final.structure.blocks.map((b) => b.role)).toEqual(["warm_up", "main", "complementary", "complementary", "cool_down"]);
  });

  it("every daily Force document — KEEP, MODIFY, shortened, with load guidance — uses only catalogue ids and roles that already existed, and validates", () => {
    const docs = [
      created(buildFinalPrescriptionV2(input("KEEP", { kind: force.kind, loadProfile: force.loadProfile!, durationMin: force.durationMin }))),
      created(buildFinalPrescriptionV2(input("MODIFY", { kind: force.kind, loadProfile: "LIGHT" }))),
      created(buildFinalPrescriptionWithinTodayTimeV2({ ...input("KEEP", { kind: force.kind, loadProfile: force.loadProfile!, durationMin: force.durationMin }), availableMinutes: 30 })),
    ].map((f) => attachStrengthLoadGuidanceV2(f.structure, "2026-10-20", {}));
    expect(docs[2]!.blocks.map((b) => b.role)).toEqual(["warm_up", "main", "cool_down"]);
    for (const s of docs) {
      expect(validatePrescriptionV2(s, { stage: "final" })).toMatchObject({ ok: true });
      const ids = idsOf(s);
      expect(ids.exercises.every((id) => SESSION_EXERCISE_CATALOG_V2[id] !== undefined)).toBe(true);
      expect(ids.texts.every((id) => COACHING_TEXT_CATALOG[id] !== undefined)).toBe(true);
      expect(s.blocks.every((b) => ["warm_up", "main", "complementary", "cool_down"].includes(b.role))).toBe(true);
      expect(s.catalog.aggregate).toBe("session-model-v2.6");
    }
  });
});
