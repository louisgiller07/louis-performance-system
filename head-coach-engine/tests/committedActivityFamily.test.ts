import { describe, it, expect } from "vitest";
import { preserveCommittedActivityFamily } from "../src/rules/committedActivityFamily.js";

describe("V0.3_005A (NAL-001) — preserveCommittedActivityFamily", () => {
  it.each([
    ["DH_TECHNICAL", "MODERATE"],
    ["DH_PERFORMANCE", "HEAVY"],
    ["PUMPTRACK", "LIGHT"],
    ["DH_LIGHT", "MODERATE"],
  ] as const)("%s -> DH_LIGHT/LIGHT (bike family, already-established destination)", (kind, load_profile) => {
    expect(preserveCommittedActivityFamily({ kind, load_profile })).toEqual({ kind: "DH_LIGHT", load_profile: "LIGHT" });
  });

  it("AEROBIC_INTERVALS -> AEROBIC_BASE, load downgraded one notch", () => {
    expect(preserveCommittedActivityFamily({ kind: "AEROBIC_INTERVALS", load_profile: "HEAVY" })).toEqual({
      kind: "AEROBIC_BASE",
      load_profile: "MODERATE",
    });
  });

  it("AEROBIC_BASE -> same kind, load downgraded one notch", () => {
    expect(preserveCommittedActivityFamily({ kind: "AEROBIC_BASE", load_profile: "MODERATE" })).toEqual({
      kind: "AEROBIC_BASE",
      load_profile: "LIGHT",
    });
  });

  it.each(["STRENGTH_LOWER", "STRENGTH_UPPER", "STRENGTH_FULL_LIGHT", "POWER", "GRIP_WORK"] as const)(
    "%s -> same kind, load downgraded one notch (strength family)",
    (kind) => {
      expect(preserveCommittedActivityFamily({ kind, load_profile: "HEAVY" })).toEqual({
        kind,
        load_profile: "MODERATE",
      });
    }
  );

  it("already-LIGHT load stays truthful (no-op preservation still counts as a valid adaptation)", () => {
    expect(preserveCommittedActivityFamily({ kind: "STRENGTH_LOWER", load_profile: "LIGHT" })).toEqual({
      kind: "STRENGTH_LOWER",
      load_profile: "LIGHT",
    });
  });

  it.each(["MOBILITY", "RECOVERY_ACTIVE", "REST", "BIKE_MAINTENANCE", "RACE_ACTIVITY"] as const)(
    "%s -> null (fixed-load kind, no lower rung within family)",
    (kind) => {
      expect(preserveCommittedActivityFamily({ kind })).toBeNull();
    }
  );
});
