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
    getRacesInWindow: vi.fn(async () => ONE_RACE),
    getRecentSessions: vi.fn(async () => NO_SESSIONS),
    ...overrides,
  };
}

describe("buildPlanInputSnapshot — V0.5_009", () => {
  it("maps a complete set of sources into a valid PlanInputSnapshot", async () => {
    const snapshot = await buildPlanInputSnapshot(FAKE_CLIENT, ATHLETE_ID, TODAY, buildDeps());

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

    await expect(buildPlanInputSnapshot(FAKE_CLIENT, ATHLETE_ID, TODAY, deps)).rejects.toMatchObject({
      blockedReason: "missing_performance_profile",
    });
    await expect(buildPlanInputSnapshot(FAKE_CLIENT, ATHLETE_ID, TODAY, deps)).rejects.toBeInstanceOf(GenerationBlockedError);
  });

  it("throws missing_strength_experience_tier when the profile row exists but the tier is NULL", async () => {
    const deps = buildDeps({
      getPerformanceProfileFor: vi.fn(async () => fullPerformanceProfile({ strength_experience_tier: null })),
    });

    await expect(buildPlanInputSnapshot(FAKE_CLIENT, ATHLETE_ID, TODAY, deps)).rejects.toMatchObject({
      blockedReason: "missing_strength_experience_tier",
    });
  });

  it("throws a PlanningEngineValidationError when the tier is present but not one of the 3 allowed values", async () => {
    const deps = buildDeps({
      getPerformanceProfileFor: vi.fn(async () => fullPerformanceProfile({ strength_experience_tier: "expert" })),
    });

    await expect(buildPlanInputSnapshot(FAKE_CLIENT, ATHLETE_ID, TODAY, deps)).rejects.toBeInstanceOf(PlanningEngineValidationError);
  });

  it("throws missing_discipline when the athlete has no recognized declared discipline", async () => {
    const deps = buildDeps({ getAthleteCoachingContext: vi.fn(async () => NO_DISCIPLINE_CONTEXT) });

    await expect(buildPlanInputSnapshot(FAKE_CLIENT, ATHLETE_ID, TODAY, deps)).rejects.toMatchObject({
      blockedReason: "missing_discipline",
    });
  });

  it("throws missing_availability when no recurring availability window is declared", async () => {
    const deps = buildDeps({ getAvailabilityWindowsFor: vi.fn(async () => NO_WINDOWS) });

    await expect(buildPlanInputSnapshot(FAKE_CLIENT, ATHLETE_ID, TODAY, deps)).rejects.toMatchObject({
      blockedReason: "missing_availability",
    });
  });

  it("normalizes an empty technical_priorities object ({}) into empty arrays for all 3 sub-fields", async () => {
    const deps = buildDeps({
      getPerformanceProfileFor: vi.fn(async () => fullPerformanceProfile({ technical_priorities: {} })),
    });

    const snapshot = await buildPlanInputSnapshot(FAKE_CLIENT, ATHLETE_ID, TODAY, deps);

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

    await expect(buildPlanInputSnapshot(FAKE_CLIENT, ATHLETE_ID, TODAY, deps)).rejects.toBeInstanceOf(PlanningEngineValidationError);
  });

  it("throws a PlanningEngineValidationError for an unrecognized terrainAccess value", async () => {
    const deps = buildDeps({
      getPerformanceProfileFor: vi.fn(async () => fullPerformanceProfile({ terrain_access: ["forest_unknown"] })),
    });

    await expect(buildPlanInputSnapshot(FAKE_CLIENT, ATHLETE_ID, TODAY, deps)).rejects.toBeInstanceOf(PlanningEngineValidationError);
  });

  it("throws a PlanningEngineValidationError for an unrecognized technicalPriorities.priorityAreas value", async () => {
    const deps = buildDeps({
      getPerformanceProfileFor: vi.fn(async () =>
        fullPerformanceProfile({ technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["wheelie"] } })
      ),
    });

    await expect(buildPlanInputSnapshot(FAKE_CLIENT, ATHLETE_ID, TODAY, deps)).rejects.toBeInstanceOf(PlanningEngineValidationError);
  });

  it("is pure — two calls with the same inputs produce the exact same result, and never mutate the deps' return values", async () => {
    const profile = fullPerformanceProfile();
    const profileSnapshot = JSON.parse(JSON.stringify(profile));
    const deps = buildDeps({ getPerformanceProfileFor: vi.fn(async () => profile) });

    const first = await buildPlanInputSnapshot(FAKE_CLIENT, ATHLETE_ID, TODAY, deps);
    const second = await buildPlanInputSnapshot(FAKE_CLIENT, ATHLETE_ID, TODAY, deps);

    expect(first).toEqual(second);
    expect(profile).toEqual(profileSnapshot);
  });
});
