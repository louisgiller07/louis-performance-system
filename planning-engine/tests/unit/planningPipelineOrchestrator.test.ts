import { describe, expect, it, vi } from "vitest";
import { runPlanningPipeline, PLANNING_ENGINE_VERSION, type PlanningPipelineOrchestratorInput } from "../../src/pipeline/planningPipelineOrchestrator.js";
import * as loadDerivationModule from "../../src/pipeline/loadDerivation.js";
import { InvalidBlockRangeError } from "../../src/pipeline/weekSequenceBuilder.js";
import type { TrainingPlanBlock } from "../../src/types/planBlock.js";
import type { PlanInputAvailability, PlanInputRace, PlanInputRecentHistory } from "../../src/types/planInputSnapshot.js";

const FULL_WEEK_AVAILABILITY: PlanInputAvailability = {
  windows: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
    dayOfWeek: dayOfWeek as PlanInputAvailability["windows"][number]["dayOfWeek"],
    startTime: "16:00",
    endTime: "20:00",
  })),
  exceptions: [],
};

function block(overrides: Partial<TrainingPlanBlock> = {}): TrainingPlanBlock {
  return {
    id: "block-1",
    planVersionId: "version-1",
    sequenceNumber: 1,
    name: "Test block",
    mode: "IN_SEASON",
    primaryFocus: "test",
    startDate: "2026-10-19",
    endDate: "2026-10-25",
    ...overrides,
  };
}

function recentHistory(overrides: Partial<PlanInputRecentHistory> = {}): PlanInputRecentHistory {
  return { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 300, ...overrides };
}

function baseInput(overrides: Partial<PlanningPipelineOrchestratorInput> = {}): PlanningPipelineOrchestratorInput {
  return {
    block: block(),
    races: [],
    availability: FULL_WEEK_AVAILABILITY,
    terrainAccess: ["flow_trail", "technical_trail"],
    lockedDates: [],
    strengthExperienceTier: "intermediate",
    recentHistory: recentHistory(),
    ...overrides,
  };
}

describe("runPlanningPipeline — standard development pipeline", () => {
  it("produces one week matching the development template's slot counts, each session carrying a rationale", () => {
    const result = runPlanningPipeline(baseInput());

    expect(result.weeks).toHaveLength(1);
    const week = result.weeks[0]!;
    expect(week.weekType).toBe("development");
    expect(week.sessions.filter((s) => s.domain === "strength")).toHaveLength(2);
    expect(week.sessions.filter((s) => s.domain === "dh_technical")).toHaveLength(2);
    expect(week.sessions.filter((s) => s.domain === "aerobic")).toHaveLength(1);
    for (const session of week.sessions) {
      expect(session.rationale.length).toBeGreaterThan(0);
    }
    expect(week.rationale.length).toBeGreaterThan(0);
  });

  it("computes a doseSummary consistent with the produced sessions", () => {
    const result = runPlanningPipeline(baseInput());
    const week = result.weeks[0]!;

    expect(week.doseSummary.plannedStrengthSessionCount).toBe(2);
    expect(week.doseSummary.plannedDhTechnicalSessionCount).toBe(2);
    expect(week.doseSummary.plannedAerobicSessionCount).toBe(1);
    expect(week.doseSummary.totalPlannedMinutes).toBe(week.sessions.reduce((sum, s) => sum + s.durationMin, 0));
    expect(week.doseSummary.plannedRestOrRecoveryDayCount).toBe(7 - week.sessions.length);
  });
});

describe("runPlanningPipeline — multi-week generation", () => {
  it("produces one OrchestratedWeek per WeekSequenceBuilder week, with correct weekNumber and dates", () => {
    const result = runPlanningPipeline(baseInput({ block: block({ startDate: "2026-10-19", endDate: "2026-11-15" }) })); // 28 days = 4 weeks

    expect(result.weeks).toHaveLength(4);
    expect(result.weeks.map((w) => w.weekNumber)).toEqual([1, 2, 3, 4]);
    expect(result.weeks[0]).toMatchObject({ startDate: "2026-10-19", endDate: "2026-10-25" });
    expect(result.weeks[3]).toMatchObject({ startDate: "2026-11-09", endDate: "2026-11-15" });
  });
});

describe("runPlanningPipeline — race week", () => {
  const RACE: PlanInputRace = { eventName: "Swiss Cup", startDate: "2026-10-24", endDate: "2026-10-25", priority: "A" };

  it("selects the race template and produces zero sessions (all slot counts are zero)", () => {
    const result = runPlanningPipeline(baseInput({ races: [RACE] }));
    const week = result.weeks[0]!;

    expect(week.weekType).toBe("race");
    expect(week.sessions).toEqual([]);
  });

  it("never calls LoadDerivation for a race week — there are no assignments to iterate", () => {
    const spy = vi.spyOn(loadDerivationModule, "deriveLoad");

    runPlanningPipeline(baseInput({ races: [RACE] }));

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("runPlanningPipeline — taper week", () => {
  it("selects the taper template for the week preceding a race, with reduced load versus a development week", () => {
    const race: PlanInputRace = { eventName: "Swiss Cup", startDate: "2026-10-31", endDate: "2026-11-01", priority: "A" };
    const twoWeekBlock = block({ startDate: "2026-10-19", endDate: "2026-11-01" }); // week1: 10-19..10-25, week2: 10-26..11-01 (race)

    const taperResult = runPlanningPipeline(baseInput({ block: twoWeekBlock, races: [race] }));
    const developmentResult = runPlanningPipeline(baseInput({ block: block({ startDate: "2026-10-19", endDate: "2026-10-25" }) }));

    const taperWeek = taperResult.weeks[0]!;
    const developmentWeek = developmentResult.weeks[0]!;

    expect(taperWeek.weekType).toBe("taper");
    const taperStrength = taperWeek.sessions.find((s) => s.domain === "strength")!;
    const devStrength = developmentWeek.sessions.find((s) => s.domain === "strength")!;
    expect(taperStrength.durationMin).toBeLessThan(devStrength.durationMin);
  });
});

describe("runPlanningPipeline — availability conflict", () => {
  it("propagates a placement shortfall as relaxedConstraints, producing fewer sessions than the template requested", () => {
    const scarceAvailability: PlanInputAvailability = {
      windows: [{ dayOfWeek: 1, startTime: "16:00", endTime: "20:00" }], // Monday only
      exceptions: [],
    };

    const result = runPlanningPipeline(baseInput({ availability: scarceAvailability }));
    const week = result.weeks[0]!;

    expect(week.sessions.length).toBeLessThan(5); // development template wants 2+2+1=5
    expect(week.relaxedConstraints.some((rc) => rc.constraintId === "placement_shortfall")).toBe(true);
  });
});

describe("runPlanningPipeline — recent history pattern", () => {
  it("includes the adjustment reason in the affected session's rationale when recentMissedOrReplacedCount >= 3", () => {
    const result = runPlanningPipeline(baseInput({ recentHistory: recentHistory({ recentMissedOrReplacedCount: 5 }) }));
    const week = result.weeks[0]!;

    const strengthSession = week.sessions.find((s) => s.domain === "strength")!;
    expect(strengthSession.rationale).toMatch(/missed|replaced/i);
  });
});

describe("runPlanningPipeline — ConstraintResolver receives HistoryAdjuster's finalized load, not LoadDerivation's raw baseline", () => {
  it("a reduced-history session's final durationMin reflects the HistoryAdjuster adjustment, not the LoadDerivation baseline", () => {
    // The real LoadDerivation baseline never produces HEAVY (only MODERATE/LIGHT), so
    // a literal "two consecutive HEAVY strength sessions" scenario cannot occur through
    // this orchestrator's real data today — already covered in isolation by
    // constraintResolver.test.ts. What IS verifiable here, and is the actual wiring
    // claim this test protects, is that ConstraintResolver's session data comes from
    // HistoryAdjuster's output, never a bypassed LoadDerivation baseline.
    const adjustedResult = runPlanningPipeline(baseInput({ recentHistory: recentHistory({ recentMissedOrReplacedCount: 5 }) }));
    const baselineResult = runPlanningPipeline(baseInput());

    const adjustedStrength = adjustedResult.weeks[0]!.sessions.find((s) => s.domain === "strength")!;
    const baselineStrength = baselineResult.weeks[0]!.sessions.find((s) => s.domain === "strength")!;

    expect(adjustedStrength.durationMin).toBeLessThan(baselineStrength.durationMin);
  });
});

describe("runPlanningPipeline — determinism", () => {
  it("the same input produces the exact same output on repeated calls", () => {
    const input = baseInput({ block: block({ startDate: "2026-10-19", endDate: "2026-11-01" }) });

    expect(runPlanningPipeline(input)).toEqual(runPlanningPipeline(input));
  });
});

describe("runPlanningPipeline — error propagation", () => {
  it("propagates InvalidBlockRangeError from WeekSequenceBuilder uncaught", () => {
    const input = baseInput({ block: block({ startDate: "2026-10-25", endDate: "2026-10-19" }) });

    expect(() => runPlanningPipeline(input)).toThrow(InvalidBlockRangeError);
  });
});

// V0.5_005 — PLANNING_ENGINE_VERSION contract: exported, non-blank, same
// technical-version-stamp convention as EXERCISE_CATALOG_VERSION/DRILL_CATALOG_VERSION.
describe("PLANNING_ENGINE_VERSION", () => {
  it("is exported as a non-blank string", () => {
    expect(typeof PLANNING_ENGINE_VERSION).toBe("string");
    expect(PLANNING_ENGINE_VERSION.trim().length).toBeGreaterThan(0);
  });
});
