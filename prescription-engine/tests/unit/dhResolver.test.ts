import { describe, expect, it } from "vitest";
import type { PrescriptionRequest } from "../../src/index.js";
import { resolveDh, resolveDhKnownFields } from "../../src/dh/dhResolver.js";
import { PendingProductDecisionError } from "../../src/errors.js";

const FULL_TERRAIN = ["flow_trail", "bermed_trail", "technical_trail", "rock_garden", "root_rock_trail", "bike_park_jump_line", "full_dh_track"];

function dhRequest(overrides: Partial<PrescriptionRequest> = {}): PrescriptionRequest {
  return {
    generatedPlanSessionId: "session-1",
    plannedPrescriptionId: "planned-prescription-test-id",
    kind: "DH_TECHNICAL",
    durationMin: 90,
    doseTarget: { domain: "dh_technical", skillTargets: [], focusedRunsCount: 6 },
    equipment: [],
    technicalPriorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering"] },
    terrainAccess: FULL_TERRAIN,
    strengthExperienceTier: "beginner",
    ...overrides,
  };
}

describe("resolveDhKnownFields — calls the real selectors correctly", () => {
  it("selects skillTarget from priorityAreas[0] and the matching drill", () => {
    const result = resolveDhKnownFields(dhRequest());
    expect(result.skillTarget).toBe("cornering");
    expect(result.drillId).toBe("cornering_flat_turn_precision");
  });
});

describe("resolveDhKnownFields — runs, successCriterion, terrainRequirement", () => {
  it("runs equals doseTarget.focusedRunsCount", () => {
    const result = resolveDhKnownFields(dhRequest({ doseTarget: { domain: "dh_technical", skillTargets: [], focusedRunsCount: 4 } }));
    expect(result.runs).toBe(4);
  });

  it("successCriterion equals the catalogue entry's successCriteria", () => {
    const result = resolveDhKnownFields(dhRequest());
    expect(result.successCriterion).toBe("Hits the marked apex within a bike length on 4/5 runs.");
  });

  it("terrainRequirement equals the catalogue entry's terrainRequirement", () => {
    const result = resolveDhKnownFields(dhRequest());
    expect(result.terrainRequirement).toBe("flow_trail");
  });
});

describe("resolveDh — explicit error when executionCue has no source", () => {
  it("throws PendingProductDecisionError('executionCue') even though the other fields resolve correctly", () => {
    try {
      resolveDh(dhRequest());
      throw new Error("expected resolveDh to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(PendingProductDecisionError);
      expect((error as PendingProductDecisionError).field).toBe("executionCue");
    }
  });
});
