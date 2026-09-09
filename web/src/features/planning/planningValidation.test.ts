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

// V0.3_006C2 — planned DH duration wiring. The ONE authoritative source is
// intervention.duration_min, DH-only in this slice.
describe("planningValidation.validatePlannedIntervention — planned duration (V0.3_006C2)", () => {
  const DH_KINDS = ["DH_PERFORMANCE", "DH_TECHNICAL", "DH_LIGHT", "PUMPTRACK"] as const;
  const NON_DH_VARIABLE_KINDS = ["STRENGTH_LOWER", "STRENGTH_UPPER", "STRENGTH_FULL_LIGHT", "POWER", "GRIP_WORK", "AEROBIC_BASE", "AEROBIC_INTERVALS"];
  const FIXED_KINDS = ["MOBILITY", "RECOVERY_ACTIVE", "REST", "BIKE_MAINTENANCE"];

  it("no duration passed (default) never adds a duration_min key, for any accepted kind", () => {
    for (const kind of DH_KINDS) {
      expect(validatePlannedIntervention(kind, "HEAVY")).toEqual({ ok: true, intervention: { kind, load_profile: "HEAVY" } });
    }
    for (const kind of FIXED_KINDS) {
      expect(validatePlannedIntervention(kind, null)).toEqual({ ok: true, intervention: { kind } });
    }
  });

  for (const kind of DH_KINDS) {
    it(`accepts a valid preset duration for DH kind ${kind}, merged into the intervention`, () => {
      const result = validatePlannedIntervention(kind, "HEAVY", "120");
      expect(result).toEqual({ ok: true, intervention: { kind, load_profile: "HEAVY", duration_min: 120 } });
    });

    it(`accepts every preset from 60 to 480 for DH kind ${kind}`, () => {
      for (const min of [60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360, 390, 420, 450, 480]) {
        const result = validatePlannedIntervention(kind, "HEAVY", String(min));
        expect(result).toEqual({ ok: true, intervention: { kind, load_profile: "HEAVY", duration_min: min } });
      }
    });
  }

  it("rejects a duration for a non-DH load-variable kind", () => {
    for (const kind of NON_DH_VARIABLE_KINDS) {
      const result = validatePlannedIntervention(kind, "HEAVY", "120");
      expect(result.ok).toBe(false);
    }
  });

  it("rejects a duration for every fixed-load kind (none are DH-family)", () => {
    for (const kind of FIXED_KINDS) {
      const result = validatePlannedIntervention(kind, null, "120");
      expect(result.ok).toBe(false);
    }
  });

  it("rejects an out-of-preset numeric value (e.g. 47) for a DH kind", () => {
    expect(validatePlannedIntervention("DH_PERFORMANCE", "HEAVY", "47").ok).toBe(false);
  });

  it("rejects zero, negative, and non-finite values for a DH kind", () => {
    expect(validatePlannedIntervention("DH_PERFORMANCE", "HEAVY", "0").ok).toBe(false);
    expect(validatePlannedIntervention("DH_PERFORMANCE", "HEAVY", "-120").ok).toBe(false);
    expect(validatePlannedIntervention("DH_PERFORMANCE", "HEAVY", "Infinity").ok).toBe(false);
  });

  it("rejects a non-numeric string for a DH kind", () => {
    expect(validatePlannedIntervention("DH_PERFORMANCE", "HEAVY", "deux heures").ok).toBe(false);
  });

  it("rejects RACE_ACTIVITY regardless of duration (still checked before any duration logic)", () => {
    expect(validatePlannedIntervention("RACE_ACTIVITY", null, "120").ok).toBe(false);
  });
});
