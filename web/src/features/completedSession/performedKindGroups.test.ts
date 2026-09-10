import { describe, expect, it } from "vitest";
import { PERFORMED_KIND_GROUPS } from "./performedKindGroups";
import { PERFORMED_FIXED_LOAD_KINDS, PERFORMED_LOAD_VARIABLE_KINDS } from "./performedInterventionTypes";

describe("PERFORMED_KIND_GROUPS — completeness invariant", () => {
  const flattened = PERFORMED_KIND_GROUPS.flatMap((group) => group.kinds);
  const allPerformedKinds = new Set([...PERFORMED_FIXED_LOAD_KINDS, ...PERFORMED_LOAD_VARIABLE_KINDS]);

  it("contains exactly 16 kinds (all of TrainingInterventionKind, including RACE_ACTIVITY)", () => {
    expect(flattened).toHaveLength(16);
  });

  it("contains no duplicates", () => {
    expect(new Set(flattened).size).toBe(flattened.length);
  });

  it("includes RACE_ACTIVITY (unlike Planning's own kind groups)", () => {
    expect(flattened).toContain("RACE_ACTIVITY");
  });

  it("matches the canonical performed-kind set exactly (no omission, no drift)", () => {
    expect(new Set(flattened)).toEqual(allPerformedKinds);
  });
});
