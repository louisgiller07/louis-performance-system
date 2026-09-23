import { describe, expect, it } from "vitest";
import { GenerationBlockedError, type GenerationBlockedReason } from "../../src/validation/validatePlanInputSnapshot.js";
import { assertValidEquipment, assertValidTerrainAccess, assertValidPriorityAreas } from "../../src/validation/validatePlanInputSnapshot.js";
import { PlanningEngineValidationError } from "../../src/validation/errors.js";

// V0.5_005 — GenerationBlockedReason extension contract. Only the two new
// reasons are covered here; "missing_availability" via assertAvailabilityDeclared
// stays covered by goldenScenarios.test.ts (scenario J), unchanged.
describe("GenerationBlockedError — V0.5_005 reason extension", () => {
  it.each<GenerationBlockedReason>(["missing_performance_profile", "missing_discipline"])(
    "accepts %s as a valid blockedReason and embeds it in the message",
    (reason) => {
      const error = new GenerationBlockedError(reason);
      expect(error.blockedReason).toBe(reason);
      expect(error.message).toBe(`Plan generation blocked: ${reason}`);
      expect(error.name).toBe("GenerationBlockedError");
    }
  );
});

// V0.5_019 — equipment/terrainAccess/priorityAreas validation, derived
// directly from the real catalogue entries (not a second hardcoded list) —
// see this file's own module doc for why.
describe("assertValidEquipment", () => {
  it("accepts a real catalogue equipment value", () => {
    expect(() => assertValidEquipment(["barbell", "dumbbells"])).not.toThrow();
  });

  it("accepts an empty array (bodyweight only)", () => {
    expect(() => assertValidEquipment([])).not.toThrow();
  });

  it("throws PlanningEngineValidationError for an unrecognized value", () => {
    expect(() => assertValidEquipment(["barbell", "random_machine"])).toThrow(PlanningEngineValidationError);
  });
});

describe("assertValidTerrainAccess", () => {
  it("accepts a real catalogue terrain value", () => {
    expect(() => assertValidTerrainAccess(["flow_trail", "technical_trail"])).not.toThrow();
  });

  it("throws PlanningEngineValidationError for an unrecognized value", () => {
    expect(() => assertValidTerrainAccess(["forest_unknown"])).toThrow(PlanningEngineValidationError);
  });
});

describe("assertValidPriorityAreas", () => {
  it("accepts a real catalogue skillTarget value", () => {
    expect(() => assertValidPriorityAreas(["cornering"])).not.toThrow();
  });

  it("accepts an empty array (no declared priority)", () => {
    expect(() => assertValidPriorityAreas([])).not.toThrow();
  });

  it("throws PlanningEngineValidationError for an unrecognized value", () => {
    expect(() => assertValidPriorityAreas(["wheelie"])).toThrow(PlanningEngineValidationError);
  });
});
