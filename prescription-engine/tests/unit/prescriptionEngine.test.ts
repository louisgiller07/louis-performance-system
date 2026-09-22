import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrescriptionRequest } from "../../src/index.js";
import type { StrengthPrescription } from "planning-engine";
import { PlanningEngineValidationError, EXERCISE_CATALOG_VERSION, DRILL_CATALOG_VERSION } from "planning-engine";
import { prescriptionEngine } from "../../src/prescriptionEngine.js";
import { UnsupportedPrescriptionKindError } from "../../src/errors.js";
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
  // Both real resolvers now resolve successfully for real catalogue data
  // (V0.4_138/139) — dispatch is proven here by which resolver's real
  // selection output shows up in the result, not by which error fires.
  it("STRENGTH_LOWER calls the strength resolver and returns a real strength prescription", () => {
    const result = prescriptionEngine(baseRequest({ kind: "STRENGTH_LOWER" }));
    expect(result.prescription.structure.domain).toBe("strength");
    expect(result.prescription.structure).toMatchObject({ blocks: [{ exerciseId: "bodyweight_squat" }] });
  });

  it("DH_TECHNICAL calls the dh resolver and returns a real DH prescription", () => {
    const result = prescriptionEngine(dhRequest());
    expect(result.prescription.structure.domain).toBe("dh_technical");
    expect(result.prescription.structure).toMatchObject({ drills: [{ drillId: "cornering_flat_turn_precision" }] });
  });

  it("AEROBIC_BASE throws UnsupportedPrescriptionKindError without calling any resolver", () => {
    expect(() =>
      prescriptionEngine(baseRequest({ kind: "AEROBIC_BASE", doseTarget: { domain: "aerobic", intensityZone: "easy" } }))
    ).toThrow(UnsupportedPrescriptionKindError);
  });
});

describe("prescriptionEngine — integration, full PlannedPrescription envelope (V0.4_140)", () => {
  it("Strength: a real PrescriptionRequest resolves to a valid, complete PlannedPrescription", () => {
    const result = prescriptionEngine(baseRequest({ kind: "STRENGTH_LOWER" }));

    expect(result.prescription).toEqual({
      id: "prescription-1",
      generatedPlanSessionId: "session-1",
      schemaVersion: "v1",
      catalogVersion: EXERCISE_CATALOG_VERSION,
      structure: {
        domain: "strength",
        schemaVersion: "v1",
        blocks: [
          {
            role: "work",
            exerciseId: "bodyweight_squat",
            sets: 12,
            intensity: { type: "rpe", target: 7 },
            repScheme: { type: "amrap" },
            restSeconds: 60,
          },
        ],
      },
    });
    expect(result.relaxedConstraints).toEqual([]);
  });

  it("DH: a real PrescriptionRequest resolves to a valid, complete PlannedPrescription", () => {
    const result = prescriptionEngine(dhRequest());

    expect(result.prescription).toEqual({
      id: "prescription-1",
      generatedPlanSessionId: "session-1",
      schemaVersion: "v1",
      catalogVersion: DRILL_CATALOG_VERSION,
      structure: {
        domain: "dh_technical",
        schemaVersion: "v1",
        drills: [
          {
            drillId: "cornering_flat_turn_precision",
            skillTarget: "cornering",
            terrainRequirement: "flow_trail",
            runs: 6,
            successCriterion: "Hits the marked apex within a bike length on 4/5 runs.",
            executionCue: "Pick the marked apex before entry and steer your front wheel through it every run.",
          },
        ],
      },
    });
    expect(result.relaxedConstraints).toEqual([]);
  });
});

describe("prescriptionEngine — validation boundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The integration tests above already exercise the real resolvers end to
  // end successfully (V0.4_138/139 filled the catalogue). Mocking here
  // targets a case the real catalogue can no longer produce — an invalid
  // structure — to prove validatePrescriptionStructure actually runs rather
  // than being skipped. Does not change production behavior;
  // strengthResolver.ts/dhResolver.ts are untouched.
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
