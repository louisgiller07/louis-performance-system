import { describe, expect, it } from "vitest";
import type { PrescriptionRequest } from "../../src/index.js";
import type { ExerciseCatalogEntry } from "planning-engine";
import { EXERCISE_CATALOG, validatePrescriptionStructure } from "planning-engine";
import { resolveStrength, resolveStrengthKnownFields, resolveRepScheme, resolveRestSeconds } from "../../src/strength/strengthResolver.js";
import { PendingProductDecisionError } from "../../src/errors.js";

const FULL_EQUIPMENT = ["barbell", "squat_rack", "dumbbells", "bench", "pull_up_bar", "cable_machine", "resistance_bands"];

function strengthRequest(overrides: Partial<PrescriptionRequest> = {}): PrescriptionRequest {
  return {
    generatedPlanSessionId: "session-1",
    plannedPrescriptionId: "planned-prescription-test-id",
    kind: "STRENGTH_LOWER",
    durationMin: 60,
    doseTarget: { domain: "strength", setVolume: 12, targetRpeOrRir: 7 },
    equipment: FULL_EQUIPMENT,
    technicalPriorities: { strengths: [], weaknesses: [], priorityAreas: [] },
    terrainAccess: [],
    strengthExperienceTier: "beginner",
    ...overrides,
  };
}

/** Not the real catalogue — a local object matching ExerciseCatalogEntry's shape, used only to exercise resolveRepScheme/resolveRestSeconds' guard clauses in isolation. */
function fakeExercise(overrides: Partial<ExerciseCatalogEntry> = {}): ExerciseCatalogEntry {
  return {
    id: "fake_exercise",
    displayName: "Fake Exercise",
    movementCategory: "squat",
    equipmentRequirements: [],
    supportedModalities: ["fixed_reps"],
    substitutions: [],
    ...overrides,
  };
}

describe("resolveStrengthKnownFields — calls the real selectors correctly", () => {
  it("resolves STRENGTH_LOWER + beginner to the squat category and bodyweight_squat", () => {
    const result = resolveStrengthKnownFields(strengthRequest({ strengthExperienceTier: "beginner" }));
    expect(result.movementCategory).toBe("squat");
    expect(result.exerciseId).toBe("bodyweight_squat");
  });

  it("resolves STRENGTH_UPPER to the push category", () => {
    const result = resolveStrengthKnownFields(strengthRequest({ kind: "STRENGTH_UPPER", strengthExperienceTier: "beginner" }));
    expect(result.movementCategory).toBe("push");
  });
});

describe("resolveStrengthKnownFields — sets and intensity", () => {
  it("sets equals doseTarget.setVolume", () => {
    const result = resolveStrengthKnownFields(strengthRequest({ doseTarget: { domain: "strength", setVolume: 15, targetRpeOrRir: 7 } }));
    expect(result.sets).toBe(15);
  });

  it("intensity is {type: 'rpe', target: doseTarget.targetRpeOrRir}", () => {
    const result = resolveStrengthKnownFields(strengthRequest({ doseTarget: { domain: "strength", setVolume: 12, targetRpeOrRir: 8 } }));
    expect(result.intensity).toEqual({ type: "rpe", target: 8 });
  });
});

describe("resolveRepScheme — reads directly from the catalogue (V0.4_138/139)", () => {
  it("returns the real repScheme for an amrap-eligible exercise (bodyweight_squat)", () => {
    expect(resolveRepScheme(EXERCISE_CATALOG["bodyweight_squat"]!)).toEqual({ type: "amrap" });
  });

  it("returns the real repScheme for a range-based exercise (goblet_squat)", () => {
    expect(resolveRepScheme(EXERCISE_CATALOG["goblet_squat"]!)).toEqual({ type: "range", min: 8, max: 12 });
  });

  it("returns the real repScheme for a heavier compound exercise (barbell_back_squat)", () => {
    expect(resolveRepScheme(EXERCISE_CATALOG["barbell_back_squat"]!)).toEqual({ type: "range", min: 5, max: 8 });
  });

  it("throws PendingProductDecisionError when the catalogue entry has no repScheme", () => {
    expect(() => resolveRepScheme(fakeExercise({ repScheme: undefined }))).toThrow(PendingProductDecisionError);
  });
});

describe("resolveRestSeconds — reads directly from the catalogue (V0.4_138/139)", () => {
  it("returns the real restSeconds for bodyweight_squat", () => {
    expect(resolveRestSeconds(EXERCISE_CATALOG["bodyweight_squat"]!)).toBe(60);
  });

  it("returns the real restSeconds for barbell_back_squat", () => {
    expect(resolveRestSeconds(EXERCISE_CATALOG["barbell_back_squat"]!)).toBe(150);
  });

  it("throws PendingProductDecisionError when the catalogue entry has no restSeconds", () => {
    expect(() => resolveRestSeconds(fakeExercise({ restSeconds: undefined }))).toThrow(PendingProductDecisionError);
  });
});

describe("resolveStrength — returns a valid StrengthPrescription end to end", () => {
  it("resolves STRENGTH_LOWER + beginner to a complete, structurally valid prescription", () => {
    const result = resolveStrength(strengthRequest({ strengthExperienceTier: "beginner" }));

    expect(result).toEqual({
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
    });
  });

  it("the result passes validatePrescriptionStructure (final validation)", () => {
    const result = resolveStrength(strengthRequest({ strengthExperienceTier: "advanced" }));
    expect(() => validatePrescriptionStructure(result)).not.toThrow();
  });

  it("resolves for a non-amrap exercise (intermediate tier -> goblet_squat) without error", () => {
    const result = resolveStrength(strengthRequest({ strengthExperienceTier: "intermediate" }));
    expect(result.blocks[0]!.exerciseId).toBe("goblet_squat");
    expect(result.blocks[0]!.repScheme).toEqual({ type: "range", min: 8, max: 12 });
    expect(result.blocks[0]!.restSeconds).toBe(90);
  });
});
