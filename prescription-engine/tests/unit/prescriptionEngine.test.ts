import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrescriptionRequest } from "../../src/index.js";
import type { StrengthPrescription } from "planning-engine";
import { PlanningEngineValidationError, EXERCISE_CATALOG_VERSION } from "planning-engine";
import { prescriptionEngine } from "../../src/prescriptionEngine.js";
import { UnsupportedPrescriptionKindError, PendingProductDecisionError } from "../../src/errors.js";
import * as strengthResolverModule from "../../src/strength/strengthResolver.js";

const FULL_EQUIPMENT = ["barbell", "squat_rack", "dumbbells", "bench", "pull_up_bar", "cable_machine", "resistance_bands"];
const FULL_TERRAIN = ["flow_trail", "bermed_trail", "technical_trail", "rock_garden", "root_rock_trail", "bike_park_jump_line", "full_dh_track"];

function baseRequest(overrides: Partial<PrescriptionRequest> = {}): PrescriptionRequest {
  return {
    generatedPlanSessionId: "session-1",
    plannedPrescriptionId: "prescription-1",
    kind: "STRENGTH_LOWER",
    durationMin: 60,
    doseTarget: { domain: "strength", setVolume: 12, targetRpeOrRir: 7 },
    equipment: FULL_EQUIPMENT,
    technicalPriorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering"] },
    terrainAccess: FULL_TERRAIN,
    strengthExperienceTier: "beginner",
    ...overrides,
  };
}

function dhRequest(overrides: Partial<PrescriptionRequest> = {}): PrescriptionRequest {
  return baseRequest({
    kind: "DH_TECHNICAL",
    doseTarget: { domain: "dh_technical", skillTargets: [], focusedRunsCount: 6 },
    ...overrides,
  });
}

describe("prescriptionEngine — dispatch", () => {
  it("STRENGTH_LOWER calls the strength resolver — surfaces its real restSeconds blocker", () => {
    try {
      prescriptionEngine(baseRequest({ kind: "STRENGTH_LOWER" }));
      throw new Error("expected prescriptionEngine to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(PendingProductDecisionError);
      expect((error as PendingProductDecisionError).field).toBe("restSeconds");
    }
  });

  it("DH_TECHNICAL calls the dh resolver — surfaces its real executionCue blocker", () => {
    try {
      prescriptionEngine(dhRequest());
      throw new Error("expected prescriptionEngine to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(PendingProductDecisionError);
      expect((error as PendingProductDecisionError).field).toBe("executionCue");
    }
  });

  it("AEROBIC_BASE throws UnsupportedPrescriptionKindError without calling any resolver", () => {
    expect(() =>
      prescriptionEngine(baseRequest({ kind: "AEROBIC_BASE", doseTarget: { domain: "aerobic", intensityZone: "easy" } }))
    ).toThrow(UnsupportedPrescriptionKindError);
  });
});

describe("prescriptionEngine — validation boundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Both real resolvers always throw today (repScheme/restSeconds/executionCue
  // are blocked, V0.4_134) — so the validation boundary and result shape can
  // only be exercised by mocking a resolver's return value here. This does
  // not change production behavior; strengthResolver.ts/dhResolver.ts are
  // untouched.
  it("calls validatePrescriptionStructure after resolution and returns {prescription, relaxedConstraints: []} for a valid structure", () => {
    const validPrescription: StrengthPrescription = {
      domain: "strength",
      schemaVersion: "v1",
      blocks: [
        {
          role: "work",
          exerciseId: "bodyweight_squat",
          sets: 12,
          intensity: { type: "rpe", target: 7 },
          repScheme: { type: "amrap" },
          restSeconds: 90,
        },
      ],
    };
    vi.spyOn(strengthResolverModule, "resolveStrength").mockReturnValue(validPrescription);

    const result = prescriptionEngine(baseRequest({ kind: "STRENGTH_LOWER" }));

    expect(result.prescription).toEqual({
      id: "prescription-1",
      generatedPlanSessionId: "session-1",
      schemaVersion: "v1",
      catalogVersion: EXERCISE_CATALOG_VERSION,
      structure: validPrescription,
    });
    expect(result.relaxedConstraints).toEqual([]);
  });

  it("propagates a validation error for a structurally invalid prescription — proves validation actually runs, not skipped", () => {
    const invalidPrescription = {
      domain: "strength",
      schemaVersion: "v1",
      blocks: [
        {
          role: "work",
          exerciseId: "bodyweight_squat",
          sets: 0, // invalid: validatePrescriptionStructure requires sets > 0
          intensity: { type: "rpe", target: 7 },
          repScheme: { type: "amrap" },
          restSeconds: 90,
        },
      ],
    } as StrengthPrescription;
    vi.spyOn(strengthResolverModule, "resolveStrength").mockReturnValue(invalidPrescription);

    expect(() => prescriptionEngine(baseRequest({ kind: "STRENGTH_LOWER" }))).toThrow(PlanningEngineValidationError);
  });
});
