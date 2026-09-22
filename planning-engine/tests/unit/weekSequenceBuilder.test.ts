import { describe, expect, it } from "vitest";
import { buildWeekSequence, InvalidBlockRangeError, type WeekSequenceBuilderInput } from "../../src/pipeline/weekSequenceBuilder.js";
import type { TrainingPlanBlock } from "../../src/types/planBlock.js";

function block(overrides: Partial<TrainingPlanBlock> = {}): TrainingPlanBlock {
  return {
    id: "block-1",
    planVersionId: "version-1",
    sequenceNumber: 1,
    name: "Test block",
    mode: "IN_SEASON",
    primaryFocus: "test",
    startDate: "2026-10-19",
    endDate: "2026-11-15",
    ...overrides,
  };
}

describe("buildWeekSequence — full-week blocks", () => {
  it("a 28-day block (exact multiple of 7) produces exactly 4 full 7-day weeks", () => {
    const result = buildWeekSequence({ block: block() });

    expect(result.weeks).toEqual([
      { weekNumber: 1, startDate: "2026-10-19", endDate: "2026-10-25" },
      { weekNumber: 2, startDate: "2026-10-26", endDate: "2026-11-01" },
      { weekNumber: 3, startDate: "2026-11-02", endDate: "2026-11-08" },
      { weekNumber: 4, startDate: "2026-11-09", endDate: "2026-11-15" },
    ]);
  });

  it("a 7-day block produces exactly one full week", () => {
    const result = buildWeekSequence({ block: block({ startDate: "2026-10-19", endDate: "2026-10-25" }) });

    expect(result.weeks).toEqual([{ weekNumber: 1, startDate: "2026-10-19", endDate: "2026-10-25" }]);
  });
});

describe("buildWeekSequence — partial final week", () => {
  it("a 12-day block produces one full week and one 5-day partial final week, never rounded or truncated", () => {
    const result = buildWeekSequence({ block: block({ startDate: "2026-10-19", endDate: "2026-10-30" }) });

    expect(result.weeks).toEqual([
      { weekNumber: 1, startDate: "2026-10-19", endDate: "2026-10-25" },
      { weekNumber: 2, startDate: "2026-10-26", endDate: "2026-10-30" },
    ]);
  });

  it("a single-day block produces exactly one degenerate one-day week", () => {
    const result = buildWeekSequence({ block: block({ startDate: "2026-10-19", endDate: "2026-10-19" }) });

    expect(result.weeks).toEqual([{ weekNumber: 1, startDate: "2026-10-19", endDate: "2026-10-19" }]);
  });
});

describe("buildWeekSequence — structural invariants", () => {
  it("weekNumber is 1-based and strictly sequential", () => {
    const result = buildWeekSequence({ block: block() });

    expect(result.weeks.map((w) => w.weekNumber)).toEqual([1, 2, 3, 4]);
  });

  it("consecutive weeks never overlap and never leave a gap", () => {
    const result = buildWeekSequence({ block: block({ startDate: "2026-10-19", endDate: "2026-11-20" }) });

    for (let i = 1; i < result.weeks.length; i++) {
      const previous = result.weeks[i - 1]!;
      const current = result.weeks[i]!;
      const dayAfterPrevious = new Date(Date.parse(`${previous.endDate}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
      expect(current.startDate).toBe(dayAfterPrevious);
    }
  });

  it("the total number of days across all weeks equals the block's own duration", () => {
    const b = block({ startDate: "2026-10-19", endDate: "2026-11-20" }); // 33 days
    const result = buildWeekSequence({ block: b });

    const daysBetween = (a: string, z: string) => Math.round((Date.parse(z) - Date.parse(a)) / 86_400_000) + 1;
    const totalDays = result.weeks.reduce((sum, w) => sum + daysBetween(w.startDate, w.endDate), 0);

    expect(totalDays).toBe(daysBetween(b.startDate, b.endDate));
  });

  it("only startDate/endDate matter — other TrainingPlanBlock fields never affect the sequence", () => {
    const a = buildWeekSequence({ block: block({ mode: "RACE_WEEK", primaryFocus: "racing", name: "A" }) });
    const b = buildWeekSequence({ block: block({ mode: "OFF_SEASON_RECOVERY", primaryFocus: "recovery", name: "B" }) });

    expect(a).toEqual(b);
  });
});

describe("buildWeekSequence — determinism", () => {
  it("the same input produces the exact same output on repeated calls", () => {
    const input: WeekSequenceBuilderInput = { block: block() };

    expect(buildWeekSequence(input)).toEqual(buildWeekSequence(input));
  });
});

describe("buildWeekSequence — errors", () => {
  it("throws InvalidBlockRangeError when block.endDate is before block.startDate", () => {
    expect(() => buildWeekSequence({ block: block({ startDate: "2026-11-15", endDate: "2026-10-19" }) })).toThrow(InvalidBlockRangeError);
  });
});
