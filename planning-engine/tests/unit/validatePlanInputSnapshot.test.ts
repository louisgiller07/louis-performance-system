import { describe, expect, it } from "vitest";
import { GenerationBlockedError, type GenerationBlockedReason } from "../../src/validation/validatePlanInputSnapshot.js";

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
