import { describe, expect, it } from "vitest";
import {
  resolveConstraints,
  InvalidSessionSequenceError,
  type ConstraintResolverInput,
  type ConstraintResolverSessionEntry,
} from "../../src/pipeline/constraintResolver.js";
import type { UnplaceableSlot } from "../../src/pipeline/weekSegmenter.js";

function session(overrides: Partial<ConstraintResolverSessionEntry> = {}): ConstraintResolverSessionEntry {
  return {
    date: "2026-10-19",
    domain: "strength",
    kind: "STRENGTH_LOWER",
    loadProfile: "HEAVY",
    durationMin: 60,
    doseTarget: { domain: "strength", setVolume: 12, targetRpeOrRir: 7 },
    ...overrides,
  };
}

const NO_CONFLICT_INPUT: ConstraintResolverInput = {
  weekStartDate: "2026-10-19",
  weekEndDate: "2026-10-25",
  sessions: [
    session({ date: "2026-10-19", kind: "STRENGTH_LOWER", loadProfile: "MODERATE" }),
    session({ date: "2026-10-21", domain: "dh_technical", kind: "DH_TECHNICAL", loadProfile: "HEAVY", doseTarget: { domain: "dh_technical", skillTargets: ["cornering"], focusedRunsCount: 8 } }),
  ],
  unplaceable: [],
};

describe("resolveConstraints — no conflict", () => {
  it("returns sessions unchanged and no relaxedConstraints when there is nothing to resolve", () => {
    const result = resolveConstraints(NO_CONFLICT_INPUT);

    expect(result.relaxedConstraints).toEqual([]);
    expect(result.sessions).toEqual(
      [...NO_CONFLICT_INPUT.sessions].sort((a, b) => a.date.localeCompare(b.date))
    );
  });
});

describe("resolveConstraints — unplaceable slots", () => {
  const unplaceable: UnplaceableSlot[] = [{ domain: "dh_technical", reason: "terrain_incompatible" }];

  it("converts each unplaceable slot into exactly one placement_shortfall RelaxedConstraint", () => {
    const result = resolveConstraints({ ...NO_CONFLICT_INPUT, unplaceable });

    expect(result.relaxedConstraints).toEqual([
      { constraintId: "placement_shortfall", reason: "terrain_incompatible", domain: "dh_technical" },
    ]);
  });

  it("preserves the domain on the RelaxedConstraint", () => {
    const result = resolveConstraints({
      ...NO_CONFLICT_INPUT,
      unplaceable: [{ domain: "strength", reason: "insufficient_available_dates" }],
    });

    expect(result.relaxedConstraints[0]?.domain).toBe("strength");
  });

  it("never merges multiple unplaceable slots into one entry", () => {
    const result = resolveConstraints({
      ...NO_CONFLICT_INPUT,
      unplaceable: [
        { domain: "strength", reason: "insufficient_available_dates" },
        { domain: "dh_technical", reason: "terrain_incompatible" },
      ],
    });

    expect(result.relaxedConstraints).toHaveLength(2);
  });
});

describe("resolveConstraints — recovery spacing (noBackToBackHeavyStrength)", () => {
  const CONSECUTIVE_HEAVY_INPUT: ConstraintResolverInput = {
    weekStartDate: "2026-10-19",
    weekEndDate: "2026-10-25",
    sessions: [
      session({ date: "2026-10-19", kind: "STRENGTH_LOWER", loadProfile: "HEAVY" }),
      session({ date: "2026-10-20", kind: "STRENGTH_UPPER", loadProfile: "HEAVY" }),
    ],
    unplaceable: [],
  };

  it("detects two consecutive HEAVY strength sessions and downgrades the later one to MODERATE", () => {
    const result = resolveConstraints(CONSECUTIVE_HEAVY_INPUT);

    const monday = result.sessions.find((s) => s.date === "2026-10-19")!;
    const tuesday = result.sessions.find((s) => s.date === "2026-10-20")!;

    expect(monday.loadProfile).toBe("HEAVY");
    expect(tuesday.loadProfile).toBe("MODERATE");
  });

  it("only adjusts the later session, never the earlier one", () => {
    const result = resolveConstraints(CONSECUTIVE_HEAVY_INPUT);

    const monday = result.sessions.find((s) => s.date === "2026-10-19")!;
    expect(monday).toEqual(CONSECUTIVE_HEAVY_INPUT.sessions[0]);
  });

  it("never changes kind when adjusting load", () => {
    const result = resolveConstraints(CONSECUTIVE_HEAVY_INPUT);

    const tuesday = result.sessions.find((s) => s.date === "2026-10-20")!;
    expect(tuesday.kind).toBe("STRENGTH_UPPER");
  });

  it("never changes date, domain, durationMin, or doseTarget on the adjusted session", () => {
    const result = resolveConstraints(CONSECUTIVE_HEAVY_INPUT);

    const tuesday = result.sessions.find((s) => s.date === "2026-10-20")!;
    expect(tuesday.date).toBe("2026-10-20");
    expect(tuesday.domain).toBe("strength");
    expect(tuesday.durationMin).toBe(CONSECUTIVE_HEAVY_INPUT.sessions[1]!.durationMin);
    expect(tuesday.doseTarget).toEqual(CONSECUTIVE_HEAVY_INPUT.sessions[1]!.doseTarget);
  });

  it("adds a recovery_spacing RelaxedConstraint with the adjusted session's date", () => {
    const result = resolveConstraints(CONSECUTIVE_HEAVY_INPUT);

    expect(result.relaxedConstraints).toEqual([
      {
        constraintId: "recovery_spacing",
        reason: "Reduced heavy strength load to avoid consecutive heavy strength sessions",
        domain: "strength",
        date: "2026-10-20",
      },
    ]);
  });

  it("leaves every other session unchanged", () => {
    const input: ConstraintResolverInput = {
      ...CONSECUTIVE_HEAVY_INPUT,
      sessions: [
        ...CONSECUTIVE_HEAVY_INPUT.sessions,
        session({ date: "2026-10-22", domain: "aerobic", kind: "AEROBIC_BASE", loadProfile: "LIGHT", doseTarget: { domain: "aerobic", intensityZone: "easy" } }),
      ],
    };

    const result = resolveConstraints(input);

    const friday = result.sessions.find((s) => s.date === "2026-10-22")!;
    expect(friday).toEqual(input.sessions[2]);
  });

  it("never flags dh_technical or aerobic domains for recovery spacing, even when HEAVY and consecutive", () => {
    const input: ConstraintResolverInput = {
      weekStartDate: "2026-10-19",
      weekEndDate: "2026-10-25",
      sessions: [
        session({ date: "2026-10-19", domain: "dh_technical", kind: "DH_TECHNICAL", loadProfile: "HEAVY", doseTarget: { domain: "dh_technical", skillTargets: ["cornering"], focusedRunsCount: 8 } }),
        session({ date: "2026-10-20", domain: "aerobic", kind: "AEROBIC_INTERVALS", loadProfile: "HEAVY", doseTarget: { domain: "aerobic", intensityZone: "moderate" } }),
      ],
      unplaceable: [],
    };

    const result = resolveConstraints(input);

    expect(result.relaxedConstraints).toEqual([]);
    expect(result.sessions).toEqual([...input.sessions].sort((a, b) => a.date.localeCompare(b.date)));
  });

  it("does not flag two HEAVY strength sessions that are not on consecutive calendar days", () => {
    const input: ConstraintResolverInput = {
      weekStartDate: "2026-10-19",
      weekEndDate: "2026-10-25",
      sessions: [
        session({ date: "2026-10-19", kind: "STRENGTH_LOWER", loadProfile: "HEAVY" }),
        session({ date: "2026-10-22", kind: "STRENGTH_UPPER", loadProfile: "HEAVY" }),
      ],
      unplaceable: [],
    };

    const result = resolveConstraints(input);

    expect(result.relaxedConstraints).toEqual([]);
  });
});

describe("resolveConstraints — errors", () => {
  it("throws InvalidSessionSequenceError when two sessions share the same date", () => {
    const input: ConstraintResolverInput = {
      weekStartDate: "2026-10-19",
      weekEndDate: "2026-10-25",
      sessions: [session({ date: "2026-10-19" }), session({ date: "2026-10-19", domain: "aerobic", kind: "AEROBIC_BASE" })],
      unplaceable: [],
    };

    expect(() => resolveConstraints(input)).toThrow(InvalidSessionSequenceError);
  });
});

describe("resolveConstraints — determinism", () => {
  it("the same input produces the exact same output on repeated calls", () => {
    const input: ConstraintResolverInput = {
      weekStartDate: "2026-10-19",
      weekEndDate: "2026-10-25",
      sessions: [
        session({ date: "2026-10-19", kind: "STRENGTH_LOWER", loadProfile: "HEAVY" }),
        session({ date: "2026-10-20", kind: "STRENGTH_UPPER", loadProfile: "HEAVY" }),
      ],
      unplaceable: [{ domain: "dh_technical", reason: "terrain_incompatible" }],
    };

    expect(resolveConstraints(input)).toEqual(resolveConstraints(input));
  });
});
