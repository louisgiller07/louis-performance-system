import { describe, expect, it } from "vitest";
import {
  buildFinalPrescriptionV2,
  buildFinalPrescriptionWithinTodayTimeV2,
  generatePlanV2InMemory,
  toSessionModelV2Input,
  type BuildFinalPrescriptionV2Input,
  type PlanInputSnapshotV2,
  type PlanSessionV2InMemory,
  type PlanV2InMemory,
} from "../../src/sessionModelV2/index.js";
import type { PlanInputAvailabilityWindow } from "../../src/types/planInputSnapshot.js";

// PHYS-01 — a V2 plan stored under session-model-v2.6 (no Force cool-down), read by the v2.7 runtime.
// KEEP still serves it verbatim; MODIFY is a §9 catalogue mismatch (never adapted with the new tables);
// under the rider's time, the Force steps are refused the same way and active recovery is offered.

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

/** The same session as stored by the v2.6 runtime: no cool-down block, v2.6 manifest. */
function asStoredV26(s: PlanSessionV2InMemory) {
  const structure = JSON.parse(JSON.stringify(s.plannedPrescription.structure));
  structure.blocks = structure.blocks.filter((b: { role: string }) => b.role !== "cool_down");
  structure.catalog = { ...structure.catalog, aggregate: "session-model-v2.6", templates: "strength-templates-v2.1", planDosePolicy: "plan-dose-policy-v2.4" };
  return { ...s.plannedPrescription, generatedPlanSessionId: s.generatedPlanSessionId, catalogVersion: "session-model-v2.6", structure };
}

function input(decision: "KEEP" | "MODIFY", finalSession: BuildFinalPrescriptionV2Input["decision"]["finalSession"]): BuildFinalPrescriptionV2Input {
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
    plannedPrescription: asStoredV26(force),
    adaptation: { athlete: toSessionModelV2Input(SNAPSHOT), ridingAvailable: true, mintId: counter("b") },
  };
}

describe("PHYS-01 — a stored v2.6 Force under the v2.7 runtime", () => {
  it("KEEP: served verbatim (its own content, no cool-down added), never a mismatch", () => {
    const r = buildFinalPrescriptionV2(input("KEEP", { kind: force.kind, loadProfile: force.loadProfile!, durationMin: force.durationMin }));
    expect(r.status).toBe("created");
    if (r.status === "created") {
      expect(r.finalPrescription.catalogVersion).toBe("session-model-v2.6");
      expect(r.finalPrescription.structure.blocks.map((b) => b.role)).not.toContain("cool_down");
    }
  });

  it("MODIFY: a §9 catalogue mismatch (no adaptation with the new tables)", () => {
    expect(buildFinalPrescriptionV2(input("MODIFY", { kind: force.kind, loadProfile: "LIGHT" }))).toEqual({
      status: "blocked",
      code: "final_prescription_catalog_mismatch",
      detail: { plannedAggregate: "session-model-v2.6", runtimeAggregate: "session-model-v2.7" },
    });
  });

  it("30 min today: the Force steps are refused the same way; active recovery inside 30 min", () => {
    const r = buildFinalPrescriptionWithinTodayTimeV2({ ...input("KEEP", { kind: force.kind, loadProfile: force.loadProfile!, durationMin: force.durationMin }), availableMinutes: 30 });
    expect(r.status === "created" && [r.finalPrescription.structure.family, r.timeConstraint?.action]).toEqual(["recovery", "adapted"]);
  });
});
