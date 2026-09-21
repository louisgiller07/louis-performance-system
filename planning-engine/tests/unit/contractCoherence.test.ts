/**
 * Smoke test that the full entity graph (M0 §B) actually hangs together —
 * constructs one of each canonical entity, wired by their real ids, and
 * runs every M1 validator across them. This is the closest thing to an
 * "integration test" M1 can have without a repository layer.
 */
import { describe, expect, it } from "vitest";
import { validateLifecycleChain } from "../../src/validation/validateLifecycle.js";
import { validatePrescriptionStructure } from "../../src/validation/validatePrescription.js";
import { validateFinalPrescriptionProvenance } from "../../src/validation/validateFinalPrescriptionProvenance.js";
import type { TrainingPlanVersion } from "../../src/types/planVersion.js";
import type { TrainingPlanVersionLifecycleTransition } from "../../src/types/planLifecycle.js";
import type { TrainingPlanBlock } from "../../src/types/planBlock.js";
import type { TrainingPlanWeek } from "../../src/types/planWeek.js";
import type { GeneratedPlanSession } from "../../src/types/generatedSession.js";
import type { PlannedPrescription } from "../../src/types/prescription.js";
import type { FinalPrescription } from "../../src/types/prescription.js";

describe("contract coherence — one full entity graph", () => {
  const version: TrainingPlanVersion = {
    id: "v1",
    athleteId: "athlete-1",
    horizonStartDate: "2026-10-19",
    horizonEndDate: "2026-11-15",
    inputSnapshot: {
      discipline: "Downhill",
      competitionLevel: "Amateur racer",
      races: [],
      availability: { windows: [{ dayOfWeek: 2, startTime: "17:00", endTime: "19:00" }], exceptions: [] },
      equipment: ["barbell", "squat_rack"],
      terrainAccess: ["flow_trail"],
      strengthExperienceTier: "intermediate",
      declaredLimitations: [],
      technicalPriorities: { strengths: [], weaknesses: [], priorityAreas: [] },
      lockedDates: [],
      recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 0 },
    },
    inputSnapshotSchemaVersion: "v1",
    inputSnapshotHash: "hash-1",
    plannerVersion: "v1",
    rulesetVersion: "v1",
    catalogVersion: "v1",
    prescriptionSchemaVersion: "v1",
    generationTrigger: "initial",
    generationRequestId: "gen-req-1",
    generatedAt: "2026-10-18T12:00:00Z",
    rationale: "Initial development block.",
    relaxedConstraints: [],
  };

  const lifecycle: TrainingPlanVersionLifecycleTransition[] = [
    { id: "t1", planVersionId: version.id, transitionNumber: 1, state: "draft", createdAt: "2026-10-18T12:00:00Z" },
    { id: "t2", planVersionId: version.id, transitionNumber: 2, supersedesId: "t1", state: "accepted", createdAt: "2026-10-18T13:00:00Z" },
  ];

  const block: TrainingPlanBlock = {
    id: "b1",
    planVersionId: version.id,
    sequenceNumber: 1,
    name: "Development Block 1",
    mode: "IN_SEASON",
    primaryFocus: "General development",
    startDate: version.horizonStartDate,
    endDate: version.horizonEndDate,
  };

  const week: TrainingPlanWeek = {
    id: "w1",
    blockId: block.id,
    weekNumber: 1,
    startDate: "2026-10-19",
    endDate: "2026-10-25",
    weekType: "development",
    doseSummary: {
      plannedStrengthSessionCount: 2,
      plannedDhTechnicalSessionCount: 2,
      plannedAerobicSessionCount: 1,
      plannedRestOrRecoveryDayCount: 2,
      totalPlannedMinutes: 480,
    },
    rationale: "Standard development week.",
  };

  const session: GeneratedPlanSession = {
    id: "s1",
    weekId: week.id,
    planVersionId: version.id,
    date: "2026-10-20",
    kind: "STRENGTH_LOWER",
    loadProfile: "MODERATE",
    durationMin: 60,
    doseTarget: { domain: "strength", setVolume: 12, targetRpeOrRir: 7 },
    rationale: "Development-phase lower body strength.",
  };

  const plannedPrescription: PlannedPrescription = {
    id: "pp1",
    generatedPlanSessionId: session.id,
    schemaVersion: "v1",
    catalogVersion: "v1",
    structure: {
      domain: "strength",
      schemaVersion: "v1",
      blocks: [
        {
          role: "work",
          exerciseId: "barbell_back_squat",
          sets: 4,
          repScheme: { type: "range", min: 5, max: 8 },
          intensity: { type: "rpe", target: 7 },
          restSeconds: 150,
        },
      ],
    },
  };

  const finalPrescription: FinalPrescription = {
    id: "fp1",
    decisionId: "decision-1",
    planVersionId: version.id,
    plannedPrescriptionId: plannedPrescription.id,
    activeSessionOrigin: "generated",
    reconciliationAction: "keep",
    adaptationRuleIds: [],
    schemaVersion: "v1",
    catalogVersion: "v1",
    structure: plannedPrescription.structure,
    generatedAt: "2026-10-20T07:00:00Z",
  };

  it("the lifecycle chain is valid", () => {
    expect(() => validateLifecycleChain(lifecycle)).not.toThrow();
  });

  it("the planned prescription's structure is valid", () => {
    expect(() => validatePrescriptionStructure(plannedPrescription.structure)).not.toThrow();
  });

  it("the final prescription's structure is valid", () => {
    expect(() => validatePrescriptionStructure(finalPrescription.structure)).not.toThrow();
  });

  it("the final prescription's provenance is internally consistent", () => {
    expect(() => validateFinalPrescriptionProvenance(finalPrescription)).not.toThrow();
  });

  it("every foreign-key-shaped reference actually points at an id present in this graph", () => {
    expect(lifecycle.every((t) => t.planVersionId === version.id)).toBe(true);
    expect(block.planVersionId).toBe(version.id);
    expect(week.blockId).toBe(block.id);
    expect(session.weekId).toBe(week.id);
    expect(session.planVersionId).toBe(version.id);
    expect(plannedPrescription.generatedPlanSessionId).toBe(session.id);
    expect(finalPrescription.plannedPrescriptionId).toBe(plannedPrescription.id);
    expect(finalPrescription.planVersionId).toBe(version.id);
  });
});
