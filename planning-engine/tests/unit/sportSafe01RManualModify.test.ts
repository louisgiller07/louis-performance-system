import { describe, expect, it } from "vitest";
import {
  buildFinalPrescriptionWithinTodayTimeV2,
  canonicalSportContent,
  dailyAdaptationContextV2,
  generatePlanV2InMemory,
  type BuildFinalPrescriptionV2Input,
  type FinalPrescriptionV2,
  type FinalPrescriptionV2Result,
  type PlanInputSnapshotV2,
  type PlanV2InMemory,
  type PrescriptionV2,
} from "../../src/sessionModelV2/index.js";
import type { PlanInputAvailabilityWindow } from "../../src/types/planInputSnapshot.js";

// SPORT-SAFE-01R (HPM 2026-10-18) — ADR A04 §6 on a manual session (P0-3): its content is built for M1's final kind and
// load by the REPLACE builders, and the endurance builder has no load lever (fixed protocol RPE). M1's LIGHT on a
// manual endurance therefore rebuilt the very document its KEEP gets, whatever its duration. The reference is that KEEP
// document (the rider's session before M1, `lineage.manualSession`): an identical MODIFY is refused, before A10.

const ALL_DAY: PlanInputAvailabilityWindow[] = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d as PlanInputAvailabilityWindow["dayOfWeek"], startTime: "08:00", endTime: "20:00" }));
const SNAPSHOT: PlanInputSnapshotV2 = {
  discipline: "Downhill",
  races: [],
  availability: { windows: ALL_DAY, exceptions: [] },
  equipment: ["dumbbells", "bench"],
  terrainAccess: ["flow_trail", "bermed_trail"],
  strengthExperienceTier: "intermediate",
  declaredLimitations: [],
  technicalPriorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
  lockedDates: [],
  recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 240 },
  dhTechnicalTier: "intermediate",
};
const counter = (prefix: string) => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${prefix}${String(++n).padStart(12 - prefix.length, "0")}`;
};
const PLAN: PlanV2InMemory = (() => {
  const r = generatePlanV2InMemory({ block: { sequenceNumber: 1, name: "Plan", mode: "UNSPECIFIED", primaryFocus: "Test", startDate: "2026-10-05", endDate: "2026-10-25" }, snapshot: SNAPSHOT, mintId: counter("a") });
  if (r.status !== "generated") throw new Error("expected a generated plan");
  return r.plan;
})();
const DATE = "2026-10-17";
type Session = BuildFinalPrescriptionV2Input["decision"]["finalSession"];

function manual(decision: "KEEP" | "MODIFY", finalSession: Session, manualSession: Session | undefined, availableMinutes: number | null) {
  return buildFinalPrescriptionWithinTodayTimeV2({
    availableMinutes,
    finalPrescriptionId: "final-m",
    decision: { decisionId: "decision-m", decision, finalSession },
    lineage: {
      plannedSessionSource: "manual",
      sourcePlanVersionId: null,
      sourceGeneratedSessionId: null,
      currentPlanVersionId: PLAN.planVersionId,
      generatedSession: null,
      currentPlanCoversDate: true,
      ...(manualSession !== undefined ? { manualSession } : {}),
    },
    plannedPrescription: null,
    adaptation: dailyAdaptationContextV2(SNAPSHOT, DATE, counter("m")),
  });
}
function created(r: FinalPrescriptionV2Result): FinalPrescriptionV2 {
  if (r.status !== "created") throw new Error(`expected created, got ${JSON.stringify(r)}`);
  return r.finalPrescription;
}
const content = (p: PrescriptionV2) => canonicalSportContent(p);
const refused = (planned: string, final: string, durationMin: number) => ({ status: "blocked", code: "final_prescription_adaptation_not_defined", detail: { reason: "modify_not_supported", planned, final, durationMin } });

describe("SPORT-SAFE-01R — a manual session's MODIFY: a real reduction, or an explicit refusal", () => {
  it.each([45, 60])("the anomaly: manual endurance MODERATE %i min, M1 LIGHT → the very document its KEEP gets (no load lever)", (min) => {
    const keep = created(manual("KEEP", { kind: "AEROBIC_BASE", loadProfile: "MODERATE", durationMin: min }, undefined, null));
    const modify = created(manual("MODIFY", { kind: "AEROBIC_BASE", loadProfile: "LIGHT", durationMin: min }, undefined, null));
    expect(content(modify.structure)).toBe(content(keep.structure));
    expect(modify.reconciliationAction).toBe("modify");
  });

  it.each([
    [45, null],
    [60, null],
  ] as const)("manual endurance MODERATE %i min + MODIFY LIGHT (no time) → refused modify_not_supported", (min, availableMinutes) => {
    const before = { kind: "AEROBIC_BASE", loadProfile: "MODERATE", durationMin: min } as const;
    expect(manual("MODIFY", { kind: "AEROBIC_BASE", loadProfile: "LIGHT", durationMin: min }, before, availableMinutes)).toEqual(refused("MODERATE", "LIGHT", min));
  });

  it.each([20, 30, 45, 90])("manual endurance MODERATE 45 + MODIFY LIGHT, %i min available → refused before A10, time not evaluated", (availableMinutes) => {
    const before = { kind: "AEROBIC_BASE", loadProfile: "MODERATE", durationMin: 45 } as const;
    const session = { decision: "MODIFY", kind: "AEROBIC_BASE", loadProfile: "LIGHT", durationMin: 45 };
    expect(manual("MODIFY", { kind: "AEROBIC_BASE", loadProfile: "LIGHT", durationMin: 45 }, before, availableMinutes)).toEqual({
      ...refused("MODERATE", "LIGHT", 45),
      timeConstraint: { availableMinutes, action: "not_evaluated", before: session, after: session },
    });
  });

  it("unchanged: KEEP of the manual endurance is created (no reference check on KEEP)", () => {
    const before = { kind: "AEROBIC_BASE", loadProfile: "MODERATE", durationMin: 45 } as const;
    expect(manual("KEEP", before, before, null).status).toBe("created");
  });

  it("unchanged: without the rider's session before M1, no reference, the previous behaviour", () => {
    expect(manual("MODIFY", { kind: "AEROBIC_BASE", loadProfile: "LIGHT", durationMin: 45 }, undefined, null).status).toBe("created");
  });

  it.each([
    ["Force bas", { kind: "STRENGTH_LOWER", loadProfile: "MODERATE" }, { kind: "STRENGTH_LOWER", loadProfile: "LIGHT" }],
    ["Force haut", { kind: "STRENGTH_UPPER", loadProfile: "MODERATE" }, { kind: "STRENGTH_UPPER", loadProfile: "LIGHT" }],
    ["DH", { kind: "DH_TECHNICAL", loadProfile: "MODERATE", durationMin: 90 }, { kind: "DH_TECHNICAL", loadProfile: "LIGHT", durationMin: 90 }],
  ] as const)("counter-proof: manual %s MODERATE → LIGHT is really lighter, created (no extension beyond the identical case)", (_, before, after) => {
    const keep = created(manual("KEEP", before, before, null));
    const modify = created(manual("MODIFY", after, before, null));
    expect(content(modify.structure)).not.toBe(content(keep.structure));
  });
});
