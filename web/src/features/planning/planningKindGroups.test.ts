import { describe, expect, it } from "vitest";
import { PLANNING_KIND_GROUPS } from "./planningKindGroups";
import { PLANNABLE_KINDS } from "./planningTypes";

describe("PLANNING_KIND_GROUPS — completeness invariant", () => {
  const flattened = PLANNING_KIND_GROUPS.flatMap((group) => group.kinds);

  it("contains exactly 15 kinds", () => {
    expect(flattened).toHaveLength(15);
  });

  it("contains no duplicates", () => {
    expect(new Set(flattened).size).toBe(flattened.length);
  });

  it("never includes RACE_ACTIVITY", () => {
    expect(flattened).not.toContain("RACE_ACTIVITY");
  });

  it("matches PLANNABLE_KINDS exactly (no omission, no drift)", () => {
    expect(new Set(flattened)).toEqual(new Set(PLANNABLE_KINDS));
  });
});
