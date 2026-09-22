import { describe, expect, it } from "vitest";
import type { PrescriptionRequest } from "../../src/index.js";
import { EXERCISE_CATALOG } from "planning-engine";
import { resolveStrength, resolveStrengthKnownFields, resolveRepScheme } from "../../src/strength/strengthResolver.js";
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

describe("resolveRepScheme — amrap accepted directly", () => {
  it("returns {type: 'amrap'} for an exercise that supports it", () => {
    expect(resolveRepScheme(EXERCISE_CATALOG["bodyweight_squat"]!)).toEqual({ type: "amrap" });
  });
});

describe("resolveStrengthKnownFields — repScheme, amrap-eligible exercise", () => {
  it("beginner tier resolves to bodyweight_squat and repScheme succeeds as amrap", () => {
    const result = resolveStrengthKnownFields(strengthRequest({ strengthExperienceTier: "beginner" }));
    expect(result.exerciseId).toBe("bodyweight_squat");
    expect(result.repScheme).toEqual({ type: "amrap" });
  });
});

describe("resolveStrengthKnownFields — explicit error when repScheme has no source", () => {
  it("throws PendingProductDecisionError('repScheme') for an exercise that does not support amrap", () => {
    // intermediate tier -> goblet_squat, which does not support amrap
    expect(() => resolveStrengthKnownFields(strengthRequest({ strengthExperienceTier: "intermediate" }))).toThrow(
      PendingProductDecisionError
    );
    try {
      resolveStrengthKnownFields(strengthRequest({ strengthExperienceTier: "intermediate" }));
      throw new Error("expected resolveStrengthKnownFields to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(PendingProductDecisionError);
      expect((error as PendingProductDecisionError).field).toBe("repScheme");
    }
  });
});

describe("resolveStrength — explicit error when restSeconds has no source", () => {
  it("throws PendingProductDecisionError('restSeconds') even when repScheme itself succeeds (amrap-eligible exercise)", () => {
    try {
      resolveStrength(strengthRequest({ strengthExperienceTier: "beginner" }));
      throw new Error("expected resolveStrength to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(PendingProductDecisionError);
      expect((error as PendingProductDecisionError).field).toBe("restSeconds");
    }
  });
});
