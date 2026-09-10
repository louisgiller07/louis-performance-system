import { describe, expect, it } from "vitest";
import { validatePerformedIntervention, PERFORMED_FIXED_LOAD_KINDS, PERFORMED_LOAD_VARIABLE_KINDS } from "./performedInterventionTypes";

describe("performedInterventionTypes.validatePerformedIntervention", () => {
  it("accepts RACE_ACTIVITY with no load_profile — the one deliberate divergence from Planning's own validator", () => {
    const result = validatePerformedIntervention("RACE_ACTIVITY", null);
    expect(result).toEqual({ ok: true, intervention: { kind: "RACE_ACTIVITY" } });
  });

  it("rejects RACE_ACTIVITY with a load_profile", () => {
    expect(validatePerformedIntervention("RACE_ACTIVITY", "HEAVY").ok).toBe(false);
  });

  it("rejects an unknown kind string", () => {
    expect(validatePerformedIntervention("NOT_A_REAL_KIND", null).ok).toBe(false);
  });

  for (const kind of PERFORMED_FIXED_LOAD_KINDS) {
    it(`accepts fixed-load kind ${kind} with no load_profile`, () => {
      const result = validatePerformedIntervention(kind, null);
      expect(result).toEqual({ ok: true, intervention: { kind } });
    });

    it(`rejects fixed-load kind ${kind} when a load_profile is supplied`, () => {
      expect(validatePerformedIntervention(kind, "HEAVY").ok).toBe(false);
    });
  }

  for (const kind of PERFORMED_LOAD_VARIABLE_KINDS) {
    it(`rejects load-variable kind ${kind} when load_profile is missing`, () => {
      expect(validatePerformedIntervention(kind, null).ok).toBe(false);
    });

    for (const loadProfile of ["HEAVY", "MODERATE", "LIGHT"] as const) {
      it(`accepts load-variable kind ${kind} with load_profile ${loadProfile}`, () => {
        const result = validatePerformedIntervention(kind, loadProfile);
        expect(result).toEqual({ ok: true, intervention: { kind, load_profile: loadProfile } });
      });
    }
  }
});
