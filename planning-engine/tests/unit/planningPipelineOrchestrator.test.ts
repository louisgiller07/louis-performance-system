import { describe, expect, it, vi } from "vitest";
import { runPlanningPipeline, PLANNING_ENGINE_VERSION, type PlanningPipelineOrchestratorInput } from "../../src/pipeline/planningPipelineOrchestrator.js";
import * as loadDerivationModule from "../../src/pipeline/loadDerivation.js";
import { InvalidBlockRangeError } from "../../src/pipeline/weekSequenceBuilder.js";
import { windowCapacityMinutes } from "../../src/pipeline/weekSegmenter.js";
import { GOLDEN_SCENARIOS } from "../fixtures/goldenScenarios.js";
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

// V06-03 — full generation against real availability windows: no generated
// session may exceed the longest window of its own date.
describe("runPlanningPipeline — availability window capacity (V06-03)", () => {
  // The audit's real availability: Tue 14-17 (180), Wed 18-19 (60), Sat 9-13 (240), Sun 10-11 (60) — as HH:mm:ss, the way Postgres returns them.
  const AUDIT_AVAILABILITY: PlanInputAvailability = {
    windows: [
      { dayOfWeek: 2, startTime: "14:00:00", endTime: "17:00:00" },
      { dayOfWeek: 3, startTime: "18:00:00", endTime: "19:00:00" },
      { dayOfWeek: 6, startTime: "09:00:00", endTime: "13:00:00" },
      { dayOfWeek: 0, startTime: "10:00:00", endTime: "11:00:00" },
    ],
    exceptions: [],
  };
  const TUESDAY_ONLY_60: PlanInputAvailability = { windows: [{ dayOfWeek: 2, startTime: "18:00:00", endTime: "19:00:00" }], exceptions: [] };
  const FOUR_WEEKS = block({ startDate: "2026-10-19", endDate: "2026-11-15" });

  function longestWindowByDayOfWeek(availability: PlanInputAvailability): Map<number, number> {
    const longest = new Map<number, number>();
    for (const w of availability.windows) longest.set(w.dayOfWeek, Math.max(windowCapacityMinutes(w), longest.get(w.dayOfWeek) ?? 0));
    return longest;
  }

  function dayOfWeek(isoDate: string): number {
    const [y, m, d] = isoDate.split("-").map(Number);
    return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  }

  function expectEverySessionFitsItsWindow(result: ReturnType<typeof runPlanningPipeline>, availability: PlanInputAvailability): void {
    const longest = longestWindowByDayOfWeek(availability);
    const sessions = result.weeks.flatMap((w) => w.sessions);
    for (const session of sessions) {
      expect(session.durationMin, `${session.date} ${session.kind}`).toBeLessThanOrEqual(longest.get(dayOfWeek(session.date))!);
    }
  }

  it("audit case over 4 weeks: every session fits its window, DH 90 min never lands on the 60-min Wednesday/Sunday", () => {
    const result = runPlanningPipeline(baseInput({ block: FOUR_WEEKS, availability: AUDIT_AVAILABILITY }));

    expectEverySessionFitsItsWindow(result, AUDIT_AVAILABILITY);
    const dhDays = result.weeks.flatMap((w) => w.sessions).filter((s) => s.domain === "dh_technical").map((s) => dayOfWeek(s.date));
    expect(dhDays.length).toBeGreaterThan(0);
    expect(dhDays.every((d) => d === 2 || d === 6)).toBe(true);
  });

  it("audit case, week 1 exactly: the second DH moves from Wed (60 min) to Sat (240 min); strength 60 min fills Wed/Sun exactly", () => {
    const week = runPlanningPipeline(baseInput({ availability: AUDIT_AVAILABILITY })).weeks[0]!;

    // v1 placed DH_TECHNICAL 90 min on Wednesday's 60-min window (audit finding).
    expect(week.sessions.map((s) => [s.date, s.kind, s.durationMin])).toEqual([
      ["2026-10-20", "DH_TECHNICAL", 90],
      ["2026-10-21", "STRENGTH_LOWER", 60],
      ["2026-10-24", "DH_TECHNICAL", 90],
      ["2026-10-25", "STRENGTH_UPPER", 60],
    ]);
    expect(week.relaxedConstraints).toEqual([{ constraintId: "placement_shortfall", reason: "insufficient_available_dates", domain: "aerobic" }]);
  });

  it("Tuesday 18:00-19:00 only: no 90-min DH is generated; the shortfall is explicit", () => {
    const result = runPlanningPipeline(baseInput({ block: FOUR_WEEKS, availability: TUESDAY_ONLY_60 }));

    expectEverySessionFitsItsWindow(result, TUESDAY_ONLY_60);
    const sessions = result.weeks.flatMap((w) => w.sessions);
    expect(sessions.some((s) => s.domain === "dh_technical")).toBe(false);
    for (const week of result.weeks) {
      expect(week.relaxedConstraints).toContainEqual({ constraintId: "placement_shortfall", reason: "insufficient_available_time", domain: "dh_technical" });
    }
  });

  it("taper week: the shorter taper DH (60 min) fits a 60-min window that a development DH (90 min) could not use", () => {
    const race: PlanInputRace = { eventName: "Swiss Cup", startDate: "2026-10-31", endDate: "2026-11-01", priority: "A" };
    const taperWeek = runPlanningPipeline(baseInput({ block: block({ startDate: "2026-10-19", endDate: "2026-11-01" }), races: [race], availability: TUESDAY_ONLY_60 })).weeks[0]!;

    expect(taperWeek.weekType).toBe("taper");
    const dh = taperWeek.sessions.find((s) => s.domain === "dh_technical");
    expect(dh?.date).toBe("2026-10-20");
    expect(dh?.durationMin).toBe(60);
  });

  it("history-adjusted durations (lowered) still fit their window", () => {
    const result = runPlanningPipeline(
      baseInput({ block: FOUR_WEEKS, availability: AUDIT_AVAILABILITY, recentHistory: recentHistory({ recentMissedOrReplacedCount: 3 }) })
    );

    expectEverySessionFitsItsWindow(result, AUDIT_AVAILABILITY);
  });

  it("case 5 — golden scenarios: wide 16:00-20:00 windows never bind, output identical to unbounded windows", () => {
    const scenarios = GOLDEN_SCENARIOS.filter((s) => s.inputSnapshot.availability.windows.length > 0);
    expect(scenarios.length).toBeGreaterThan(0);

    for (const scenario of scenarios) {
      const snapshot = scenario.inputSnapshot;
      const input = baseInput({
        block: FOUR_WEEKS,
        races: snapshot.races,
        availability: snapshot.availability,
        terrainAccess: snapshot.terrainAccess,
        lockedDates: snapshot.lockedDates,
        strengthExperienceTier: snapshot.strengthExperienceTier,
        recentHistory: snapshot.recentHistory,
      });
      const unbounded: PlanInputAvailability = {
        ...snapshot.availability,
        windows: snapshot.availability.windows.map((w) => ({ ...w, startTime: "00:00", endTime: "24:00" })),
      };

      expect(runPlanningPipeline(input), `scenario ${scenario.id}`).toEqual(runPlanningPipeline({ ...input, availability: unbounded }));
    }
  });
});
