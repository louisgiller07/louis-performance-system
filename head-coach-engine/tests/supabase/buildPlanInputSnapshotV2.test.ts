import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildPlanInputSnapshot, type BuildPlanInputSnapshotDeps } from "../../src/supabase/buildPlanInputSnapshot.js";
import { buildPlanInputSnapshotV2, InvalidDhTechnicalTierError } from "../../src/supabase/buildPlanInputSnapshotV2.js";
import type { AthletePerformanceProfileRawRow } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";

// UX-11A.5b.5a — runtime PlanInputSnapshotV2: the V1 snapshot unchanged + the declared DH tier.

const ATHLETE_ID = "athlete-1";
const TODAY = "2026-10-05";
const HORIZON = { startDate: "2026-10-05", endDate: "2026-10-18" };
const FAKE_CLIENT = {} as SupabaseClient;

function profile(overrides: Partial<AthletePerformanceProfileRawRow> = {}): AthletePerformanceProfileRawRow {
  return {
    equipment: ["dumbbells", "bench"],
    terrain_access: ["flow_trail", "bermed_trail"],
    strength_experience_tier: "intermediate",
    declared_limitations: [],
    season_objective: null,
    technical_priorities: { strengths: ["jumps"], weaknesses: ["braking"], priorityAreas: ["cornering", "braking"] },
    dh_technical_tier: "intermediate",
    ...overrides,
  };
}

function deps(row: AthletePerformanceProfileRawRow | null = profile()): BuildPlanInputSnapshotDeps & { getPerformanceProfileFor: ReturnType<typeof vi.fn> } {
  return {
    getAthleteCoachingContext: vi.fn(async () => ({ athlete_id: ATHLETE_ID, discipline: "Downhill" })),
    getPerformanceProfileFor: vi.fn(async () => row),
    getAvailabilityWindowsFor: vi.fn(async () => [{ id: "w1", day_of_week: 6, start_time: "08:00", end_time: "18:00", label: null }]),
    getAvailabilityExceptionsFor: vi.fn(async () => []),
    getLockedDatesFor: vi.fn(async () => []),
    getRacesOverlappingRange: vi.fn(async () => []),
    getRecentSessions: vi.fn(async () => []),
  } as never;
}

describe("buildPlanInputSnapshotV2", () => {
  it("is exactly the V1 snapshot plus dhTechnicalTier, from a single profile read", async () => {
    const d = deps();
    const v2 = await buildPlanInputSnapshotV2(FAKE_CLIENT, ATHLETE_ID, TODAY, HORIZON, d);
    const v1 = await buildPlanInputSnapshot(FAKE_CLIENT, ATHLETE_ID, TODAY, HORIZON, deps());
    expect(v2).toEqual({ ...v1, dhTechnicalTier: "intermediate" });
    expect(d.getPerformanceProfileFor).toHaveBeenCalledTimes(1);
  });

  it("keeps priorityAreas in declared order as the single source (no duplicate DH field)", async () => {
    const v2 = await buildPlanInputSnapshotV2(FAKE_CLIENT, ATHLETE_ID, TODAY, HORIZON, deps());
    expect(v2.technicalPriorities.priorityAreas).toEqual(["cornering", "braking"]);
    expect(Object.keys(v2).filter((k) => /dh/i.test(k))).toEqual(["dhTechnicalTier"]);
  });

  it("a legacy profile without tier gives null (no default, no inference)", async () => {
    expect((await buildPlanInputSnapshotV2(FAKE_CLIENT, ATHLETE_ID, TODAY, HORIZON, deps(profile({ dh_technical_tier: null })))).dhTechnicalTier).toBeNull();
    const absent = profile();
    delete absent.dh_technical_tier;
    expect((await buildPlanInputSnapshotV2(FAKE_CLIENT, ATHLETE_ID, TODAY, HORIZON, deps(absent))).dhTechnicalTier).toBeNull();
  });

  it("refuses an unknown tier value, and keeps the V1 blocking errors (missing profile)", async () => {
    await expect(buildPlanInputSnapshotV2(FAKE_CLIENT, ATHLETE_ID, TODAY, HORIZON, deps(profile({ dh_technical_tier: "expert" })))).rejects.toBeInstanceOf(InvalidDhTechnicalTierError);
    await expect(buildPlanInputSnapshotV2(FAKE_CLIENT, ATHLETE_ID, TODAY, HORIZON, deps(null))).rejects.toThrow(/missing_performance_profile/);
  });
});
