import { describe, expect, it } from "vitest";
import { assignSessionKinds, type SessionKindAssignmentInput } from "../../src/pipeline/sessionKindAssignment.js";
import type { PlacedSlot } from "../../src/pipeline/weekSegmenter.js";

function slot(date: string, domain: PlacedSlot["domain"]): PlacedSlot {
  return { date, domain };
}

describe("assignSessionKinds — strength alternation", () => {
  it("a single strength slot gets STRENGTH_LOWER", () => {
    const result = assignSessionKinds({ placedSlots: [slot("2026-10-19", "strength")] });

    expect(result.assignments).toEqual([{ date: "2026-10-19", domain: "strength", kind: "STRENGTH_LOWER" }]);
  });

  it("two strength slots alternate LOWER then UPPER, in date order", () => {
    const result = assignSessionKinds({
      placedSlots: [slot("2026-10-19", "strength"), slot("2026-10-22", "strength")],
    });

    expect(result.assignments.map((a) => a.kind)).toEqual(["STRENGTH_LOWER", "STRENGTH_UPPER"]);
  });

  it("three strength slots alternate LOWER / UPPER / LOWER, in date order", () => {
    const result = assignSessionKinds({
      placedSlots: [slot("2026-10-19", "strength"), slot("2026-10-22", "strength"), slot("2026-10-24", "strength")],
    });

    expect(result.assignments.map((a) => a.kind)).toEqual(["STRENGTH_LOWER", "STRENGTH_UPPER", "STRENGTH_LOWER"]);
  });

  it("never assigns POWER or STRENGTH_FULL_LIGHT", () => {
    const result = assignSessionKinds({
      placedSlots: [slot("2026-10-19", "strength"), slot("2026-10-20", "strength"), slot("2026-10-21", "strength"), slot("2026-10-22", "strength")],
    });

    for (const a of result.assignments) {
      expect(["STRENGTH_LOWER", "STRENGTH_UPPER"]).toContain(a.kind);
    }
  });

  it("the alternation is based on ascending date, independent of the input array's own order", () => {
    const reversed: SessionKindAssignmentInput = {
      placedSlots: [slot("2026-10-24", "strength"), slot("2026-10-22", "strength"), slot("2026-10-19", "strength")],
    };

    const result = assignSessionKinds(reversed);

    expect(result.assignments.map((a) => a.kind)).toEqual(["STRENGTH_LOWER", "STRENGTH_UPPER", "STRENGTH_LOWER"]);
    expect(result.assignments.map((a) => a.date)).toEqual(["2026-10-19", "2026-10-22", "2026-10-24"]);
  });
});

describe("assignSessionKinds — dh_technical and aerobic defaults", () => {
  it("every dh_technical slot gets DH_TECHNICAL, never DH_PERFORMANCE or DH_LIGHT", () => {
    const result = assignSessionKinds({
      placedSlots: [slot("2026-10-19", "dh_technical"), slot("2026-10-20", "dh_technical")],
    });

    expect(result.assignments.map((a) => a.kind)).toEqual(["DH_TECHNICAL", "DH_TECHNICAL"]);
  });

  it("every aerobic slot gets AEROBIC_BASE, never AEROBIC_INTERVALS", () => {
    const result = assignSessionKinds({ placedSlots: [slot("2026-10-19", "aerobic")] });

    expect(result.assignments).toEqual([{ date: "2026-10-19", domain: "aerobic", kind: "AEROBIC_BASE" }]);
  });
});

describe("assignSessionKinds — shape and data preservation", () => {
  it("preserves date and domain exactly as received", () => {
    const input: SessionKindAssignmentInput = { placedSlots: [slot("2026-10-21", "dh_technical")] };

    const result = assignSessionKinds(input);

    expect(result.assignments[0]?.date).toBe("2026-10-21");
    expect(result.assignments[0]?.domain).toBe("dh_technical");
  });

  it("produces no additional data beyond date/domain/kind — no loadProfile, durationMin, doseTarget, or prescription fields", () => {
    const result = assignSessionKinds({ placedSlots: [slot("2026-10-19", "strength")] });

    expect(Object.keys(result.assignments[0]!).sort()).toEqual(["date", "domain", "kind"]);
  });

  it("a mixed week (strength + dh_technical + aerobic) assigns each domain independently, sorted by date overall", () => {
    const input: SessionKindAssignmentInput = {
      placedSlots: [
        slot("2026-10-24", "aerobic"),
        slot("2026-10-19", "strength"),
        slot("2026-10-20", "dh_technical"),
        slot("2026-10-22", "strength"),
        slot("2026-10-23", "dh_technical"),
      ],
    };

    const result = assignSessionKinds(input);

    expect(result.assignments).toEqual([
      { date: "2026-10-19", domain: "strength", kind: "STRENGTH_LOWER" },
      { date: "2026-10-20", domain: "dh_technical", kind: "DH_TECHNICAL" },
      { date: "2026-10-22", domain: "strength", kind: "STRENGTH_UPPER" },
      { date: "2026-10-23", domain: "dh_technical", kind: "DH_TECHNICAL" },
      { date: "2026-10-24", domain: "aerobic", kind: "AEROBIC_BASE" },
    ]);
  });
});

describe("assignSessionKinds — determinism", () => {
  it("the same input produces the exact same output on repeated calls", () => {
    const input: SessionKindAssignmentInput = {
      placedSlots: [slot("2026-10-22", "strength"), slot("2026-10-19", "strength"), slot("2026-10-20", "dh_technical")],
    };

    expect(assignSessionKinds(input)).toEqual(assignSessionKinds(input));
  });
});
