import { describe, expect, it } from "vitest";
import { validatePlannedIntervention } from "./planningValidation";
import { PLANNABLE_FIXED_LOAD_KINDS, PLANNABLE_LOAD_VARIABLE_KINDS } from "./planningTypes";

describe("planningValidation.validatePlannedIntervention", () => {
  it("rejects RACE_ACTIVITY regardless of load_profile (exclusively race-protocol-derived)", () => {
    expect(validatePlannedIntervention("RACE_ACTIVITY", null)).toEqual({
      ok: false,
      error: expect.stringContaining("RACE_ACTIVITY"),
    });
    expect(validatePlannedIntervention("RACE_ACTIVITY", "HEAVY").ok).toBe(false);
  });

  it("rejects an unknown kind string", () => {
    const result = validatePlannedIntervention("NOT_A_REAL_KIND", null);
    expect(result.ok).toBe(false);
  });

  for (const kind of PLANNABLE_FIXED_LOAD_KINDS) {
    it(`accepts fixed-load kind ${kind} with no load_profile`, () => {
      const result = validatePlannedIntervention(kind, null);
      expect(result).toEqual({ ok: true, intervention: { kind } });
    });

    it(`rejects fixed-load kind ${kind} when a load_profile is supplied`, () => {
      const result = validatePlannedIntervention(kind, "HEAVY");
      expect(result.ok).toBe(false);
    });
  }

  for (const kind of PLANNABLE_LOAD_VARIABLE_KINDS) {
    it(`rejects load-variable kind ${kind} when load_profile is missing`, () => {
      const result = validatePlannedIntervention(kind, null);
      expect(result.ok).toBe(false);
    });

    it(`rejects load-variable kind ${kind} with an invalid load_profile string`, () => {
      const result = validatePlannedIntervention(kind, "EXTREME");
      expect(result.ok).toBe(false);
    });

    for (const loadProfile of ["HEAVY", "MODERATE", "LIGHT"] as const) {
      it(`accepts load-variable kind ${kind} with load_profile ${loadProfile}`, () => {
        const result = validatePlannedIntervention(kind, loadProfile);
        expect(result).toEqual({ ok: true, intervention: { kind, load_profile: loadProfile } });
      });
    }
  }
});
