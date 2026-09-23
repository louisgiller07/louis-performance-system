import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GenerationBlockedError, PlanningEngineValidationError } from "planning-engine";
import { buildPlanInputSnapshot, type BuildPlanInputSnapshotDeps } from "../../src/supabase/buildPlanInputSnapshot.js";
import type { AthleteCoachingContext } from "../../src/supabase/repositories/athleteCoachingContextRepo.js";
import type { AthletePerformanceProfileRawRow } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import type { AthleteAvailabilityWindowRawRow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import type { AthleteAvailabilityExceptionRawRow } from "../../src/supabase/repositories/athleteAvailabilityExceptionsRepo.js";
import type { AthleteLockedDateRawRow } from "../../src/supabase/repositories/athleteLockedDatesRepo.js";
import type { RaceCalendarRawRow } from "../../src/supabase/repositories/raceCalendarRepo.js";
import type { CompletedSessionRawRow } from "../../src/supabase/repositories/completedSessionsRepo.js";

const ATHLETE_ID = "athlete-1";
const TODAY = "2026-09-23";
const HORIZON = { startDate: "2026-09-23", endDate: "2026-09-29" };
const FAKE_CLIENT = {} as SupabaseClient;

const FULL_COACHING_CONTEXT: AthleteCoachingContext = {
  athlete_id: ATHLETE_ID,
  discipline: "Downhill",
  competition_level: "Amateur racer",
};

const NO_DISCIPLINE_CONTEXT: AthleteCoachingContext = { athlete_id: ATHLETE_ID };

function fullPerformanceProfile(overrides: Partial<AthletePerformanceProfileRawRow> = {}): AthletePerformanceProfileRawRow {
  return {
    equipment: ["barbell", "dumbbells"],
    terrain_access: ["flow_trail", "technical_trail"],
    strength_experience_tier: "beginner",
    declared_limitations: ["left_knee"],
    season_objective: "Podium at nationals",
    technical_priorities: { strengths: ["jumps"], weaknesses: ["braking"], priorityAreas: ["cornering"] },
    ...overrides,
  };
}

const ONE_WINDOW: AthleteAvailabilityWindowRawRow[] = [{ id: "w1", day_of_week: 2, start_time: "16:00", end_time: "20:00", label: null }];
const NO_WINDOWS: AthleteAvailabilityWindowRawRow[] = [];
const ONE_EXCEPTION: AthleteAvailabilityExceptionRawRow[] = [{ id: "e1", date: "2026-10-03", available: false, note: "travel" }];
const ONE_LOCKED_DATE: AthleteLockedDateRawRow[] = [{ id: "l1", date: "2026-10-05", reason: "family event" }];
const ONE_RACE: RaceCalendarRawRow[] = [{ event_name: "Nationals", start_date: "2026-10-10", end_date: "2026-10-11", priority: "A" }];
const NO_SESSIONS: CompletedSessionRawRow[] = [];

function buildDeps(overrides: Partial<BuildPlanInputSnapshotDeps> = {}): BuildPlanInputSnapshotDeps {
  return {
    getAthleteCoachingContext: vi.fn(async () => FULL_COACHING_CONTEXT),
    getPerformanceProfileFor: vi.fn(async () => fullPerformanceProfile()),
    getAvailabilityWindowsFor: vi.fn(async () => ONE_WINDOW),
    getAvailabilityExceptionsFor: vi.fn(async () => ONE_EXCEPTION),
    getLockedDatesFor: vi.fn(async () => ONE_LOCKED_DATE),
    getRacesOverlappingRange: vi.fn(async () => ONE_RACE),
    getRecentSessions: vi.fn(async () => NO_SESSIONS),
    ...overrides,
  };
}

describe("buildPlanInputSnapshot — V0.5_009", () => {
  it("maps a complete set of sources into a valid PlanInputSnapshot", async () => {
    const snapshot = await buildPlanInputSnapshot(FAKE_CLIENT, ATHLETE_ID, TODAY, HORIZON, buildDeps());

    expect(snapshot).toEqual({
      discipline: "Downhill",
      competitionLevel: "Amateur racer",
      seasonObjective: "Podium at nationals",
      races: [{ eventName: "Nationals", startDate: "2026-10-10", endDate: "2026-10-11", priority: "A" }],
      availability: {
        windows: [{ dayOfWeek: 2, startTime: "16:00", endTime: "20:00" }],
        exceptions: [{ date: "2026-10-03", available: false, note: "travel" }],
      },
      equipment: ["barbell", "dumbbells"],
      terrainAccess: ["flow_trail", "technical_trail"],
      strengthExperienceTier: "beginner",
      declaredLimitations: ["left_knee"],
      technicalPriorities: { strengths: ["jumps"], weaknesses: ["braking"], priorityAreas: ["cornering"] },
      lockedDates: [{ date: "2026-10-05", reason: "family event" }],
      recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 0 },
    });
  });

  it("throws missing_performance_profile when no athlete_performance_profiles row exists", async () => {
    const deps = buildDeps({ getPerformanceProfileFor: vi.fn(async () => null) });

    await expect(buildPlanInputSnapshot(FAKE_CLIENT, ATHLETE_ID, TODAY, HORIZON, deps)).rejects.toMatchObject({
      blockedReason: "missing_performance_profile",
    });
    await expect(buildPlanInputSnapshot(FAKE_CLIENT, ATHLETE_ID, TODAY, HORIZON, deps)).rejects.toBeInstanceOf(GenerationBlockedError);
  });

  it("throws missing_strength_experience_tier when the profile row exists but the tier is NULL", async () => {
    const deps = buildDeps({
      getPerformanceProfileFor: vi.fn(async () => fullPerformanceProfile({ strength_experience_tier: null })),
    });

    await expect(buildPlanInputSnapshot(FAKE_CLIENT, ATHLETE_ID, TODAY, HORIZON, deps)).rejects.toMatchObject({
      blockedReason: "missing_strength_experience_tier",
    });
  });

  it("throws a PlanningEngineValidationError when the tier is present but not one of the 3 allowed values", async () => {
    const deps = buildDeps({
      getPerformanceProfileFor: vi.fn(async () => fullPerformanceProfile({ strength_experience_tier: "expert" })),
    });

    await expect(buildPlanInputSnapshot(FAKE_CLIENT, ATHLETE_ID, TODAY, HORIZON, deps)).rejects.toBeInstanceOf(PlanningEngineValidationError);
  });

  it("throws missing_discipline when the athlete has no recognized declared discipline", async () => {
    const deps = buildDeps({ getAthleteCoachingContext: vi.fn(async () => NO_DISCIPLINE_CONTEXT) });

    await expect(buildPlanInputSnapshot(FAKE_CLIENT, ATHLETE_ID, TODAY, HORIZON, deps)).rejects.toMatchObject({
      blockedReason: "missing_discipline",
    });
  });

  it("throws missing_availability when no recurring availability window is declared", async () => {
    const deps = buildDeps({ getAvailabilityWindowsFor: vi.fn(async () => NO_WINDOWS) });

    await expect(buildPlanInputSnapshot(FAKE_CLIENT, ATHLETE_ID, TODAY, HORIZON, deps)).rejects.toMatchObject({
      blockedReason: "missing_availability",
    });
  });

  it("normalizes an empty technical_priorities object ({}) into empty arrays for all 3 sub-fields", async () => {
    const deps = buildDeps({
      getPerformanceProfileFor: vi.fn(async () => fullPerformanceProfile({ technical_priorities: {} })),
    });

    const snapshot = await buildPlanInputSnapshot(FAKE_CLIENT, ATHLETE_ID, TODAY, HORIZON, deps);

    expect(snapshot.technicalPriorities).toEqual({ strengths: [], weaknesses: [], priorityAreas: [] });
  });

  // V0.5_019 — equipment/terrainAccess/priorityAreas are validated against
  // the real planning-engine catalogue values before a snapshot is ever
  // returned, same "present but malformed -> PlanningEngineValidationError"
  // category as the tier check above (never GenerationBlockedError).
  it("throws a PlanningEngineValidationError for an unrecognized equipment value", async () => {
    const deps = buildDeps({
      getPerformanceProfileFor: vi.fn(async () => fullPerformanceProfile({ equipment: ["barbell", "random_machine"] })),
    });

    await expect(buildPlanInputSnapshot(FAKE_CLIENT, ATHLETE_ID, TODAY, HORIZON, deps)).rejects.toBeInstanceOf(PlanningEngineValidationError);
  });

  it("throws a PlanningEngineValidationError for an unrecognized terrainAccess value", async () => {
    const deps = buildDeps({
      getPerformanceProfileFor: vi.fn(async () => fullPerformanceProfile({ terrain_access: ["forest_unknown"] })),
    });

    await expect(buildPlanInputSnapshot(FAKE_CLIENT, ATHLETE_ID, TODAY, HORIZON, deps)).rejects.toBeInstanceOf(PlanningEngineValidationError);
  });

  it("throws a PlanningEngineValidationError for an unrecognized technicalPriorities.priorityAreas value", async () => {
    const deps = buildDeps({
      getPerformanceProfileFor: vi.fn(async () =>
        fullPerformanceProfile({ technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["wheelie"] } })
      ),
    });

    await expect(buildPlanInputSnapshot(FAKE_CLIENT, ATHLETE_ID, TODAY, HORIZON, deps)).rejects.toBeInstanceOf(PlanningEngineValidationError);
  });

  it("is pure — two calls with the same inputs produce the exact same result, and never mutate the deps' return values", async () => {
    const profile = fullPerformanceProfile();
    const profileSnapshot = JSON.parse(JSON.stringify(profile));
    const deps = buildDeps({ getPerformanceProfileFor: vi.fn(async () => profile) });

    const first = await buildPlanInputSnapshot(FAKE_CLIENT, ATHLETE_ID, TODAY, HORIZON, deps);
    const second = await buildPlanInputSnapshot(FAKE_CLIENT, ATHLETE_ID, TODAY, HORIZON, deps);

    expect(first).toEqual(second);
    expect(profile).toEqual(profileSnapshot);
  });
});

// V0.5_041/042 — buildPlanInputSnapshot must load races over the generated
// plan's own horizon, never M1's fixed short window. These tests are what
// actually closes the V0.5_040 BLOCKER at this layer.
describe("buildPlanInputSnapshot — horizon-aware races (V0.5_041/042)", () => {
  it("a 1-week horizon calls getRacesOverlappingRange with exactly [startDate, endDate, today]", async () => {
    const deps = buildDeps();
    const horizon = { startDate: "2026-09-23", endDate: "2026-09-29" };

    await buildPlanInputSnapshot(FAKE_CLIENT, ATHLETE_ID, TODAY, horizon, deps);

    expect(deps.getRacesOverlappingRange).toHaveBeenCalledWith(FAKE_CLIENT, ATHLETE_ID, "2026-09-23", "2026-09-29", TODAY);
  });

  it("a 6-week horizon includes a race at ~J+30 — the exact scenario the V0.5_040 BLOCKER described", async () => {
    // 2026-09-23 -> 2026-11-03 is a real 6-week (42-day) horizon
    // (deriveTrainingPlanBlock(2026-09-23, 6).endDate, already proven
    // elsewhere) — well beyond M1's old today+14 cutoff of 2026-10-07.
    const horizon = { startDate: "2026-09-23", endDate: "2026-11-03" };
    const raceAtJPlus30: RaceCalendarRawRow = { event_name: "Late race", start_date: "2026-10-23", end_date: "2026-10-23", priority: "A_PLUS" };
    const deps = buildDeps({ getRacesOverlappingRange: vi.fn(async () => [raceAtJPlus30]) });

    const snapshot = await buildPlanInputSnapshot(FAKE_CLIENT, ATHLETE_ID, TODAY, horizon, deps);

    expect(snapshot.races).toContainEqual({ eventName: "Late race", startDate: "2026-10-23", endDate: "2026-10-23", priority: "A_PLUS" });
  });

  it("never contaminates recentHistory/availability/lockedDates — none of their deps receive the horizon", async () => {
    const deps = buildDeps();
    const horizon = { startDate: "2026-09-23", endDate: "2026-11-03" };

    await buildPlanInputSnapshot(FAKE_CLIENT, ATHLETE_ID, TODAY, horizon, deps);

    expect(deps.getRecentSessions).toHaveBeenCalledWith(FAKE_CLIENT, ATHLETE_ID, TODAY);
    expect(deps.getAvailabilityWindowsFor).toHaveBeenCalledWith(FAKE_CLIENT, ATHLETE_ID);
    expect(deps.getAvailabilityExceptionsFor).toHaveBeenCalledWith(FAKE_CLIENT, ATHLETE_ID);
    expect(deps.getLockedDatesFor).toHaveBeenCalledWith(FAKE_CLIENT, ATHLETE_ID);
  });
});
