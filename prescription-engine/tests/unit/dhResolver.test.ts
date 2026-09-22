import { describe, expect, it } from "vitest";
import type { PrescriptionRequest } from "../../src/index.js";
import type { DrillCatalogEntry } from "planning-engine";
import { DRILL_CATALOG, validatePrescriptionStructure } from "planning-engine";
import { resolveDh, resolveDhKnownFields, resolveExecutionCue } from "../../src/dh/dhResolver.js";
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

/** Not the real catalogue — a local object matching DrillCatalogEntry's shape, used only to exercise resolveExecutionCue's guard clause in isolation. */
function fakeDrill(overrides: Partial<DrillCatalogEntry> = {}): DrillCatalogEntry {
  return {
    id: "fake_drill",
    displayName: "Fake Drill",
    skillTarget: "cornering",
    terrainRequirement: "flow_trail",
    difficulty: "beginner",
    successCriteria: "Fake success criteria.",
    executionCue: "",
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

describe("resolveExecutionCue — reads directly from the catalogue (V0.4_138/139)", () => {
  it("returns the real executionCue for cornering_flat_turn_precision", () => {
    expect(resolveExecutionCue(DRILL_CATALOG["cornering_flat_turn_precision"]!)).toBe(
      "Pick the marked apex before entry and steer your front wheel through it every run."
    );
  });

  it("throws PendingProductDecisionError when the catalogue entry has a blank executionCue", () => {
    expect(() => resolveExecutionCue(fakeDrill({ executionCue: "" }))).toThrow(PendingProductDecisionError);
  });

  it("throws PendingProductDecisionError when the catalogue entry's executionCue is only whitespace", () => {
    expect(() => resolveExecutionCue(fakeDrill({ executionCue: "   " }))).toThrow(PendingProductDecisionError);
  });
});

describe("resolveDhKnownFields — executionCue resolved as part of the known fields", () => {
  it("includes the real executionCue", () => {
    const result = resolveDhKnownFields(dhRequest());
    expect(result.executionCue).toBe("Pick the marked apex before entry and steer your front wheel through it every run.");
  });
});

describe("resolveDh — returns a valid DhTechnicalPrescription end to end", () => {
  it("resolves DH_TECHNICAL + cornering priority to a complete, structurally valid prescription", () => {
    const result = resolveDh(dhRequest());

    expect(result).toEqual({
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
    });
  });

  it("the result passes validatePrescriptionStructure (final validation)", () => {
    const result = resolveDh(dhRequest());
    expect(() => validatePrescriptionStructure(result)).not.toThrow();
  });

  it("resolves for an advanced-tier drill (cornering_off_camber) without error", () => {
    const result = resolveDh(
      dhRequest({ strengthExperienceTier: "advanced", terrainAccess: ["technical_trail"] })
    );
    expect(result.drills[0]!.drillId).toBe("cornering_off_camber");
    expect(result.drills[0]!.executionCue.length).toBeGreaterThan(0);
  });
});
