import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockedFrom } = vi.hoisted(() => ({ mockedFrom: vi.fn() }));
vi.mock("../../lib/supabase", () => ({
  supabase: { from: mockedFrom },
}));

import {
  loadOnboardingAnswers,
  saveDiscipline,
  saveCompetitionLevel,
  savePrimaryGoal,
  saveWeeklyTrainingHours,
  completeOnboarding,
  AthleteOnboardingError,
} from "./athleteOnboardingRepo";

beforeEach(() => {
  vi.resetAllMocks();
});

function mockTables(byTable: Record<string, { data?: unknown; error?: unknown }>) {
  mockedFrom.mockImplementation((table: string) => ({
    select: vi.fn().mockResolvedValue(byTable[table] ?? { data: null, error: null }),
  }));
}

describe("athleteOnboardingRepo — loadOnboardingAnswers", () => {
  it("returns all-null/empty answers for a brand new athlete (legacy discipline default is not a valid option)", async () => {
    mockTables({
      athletes: { data: [{ discipline: "DH_MTB" }], error: null },
      athlete_onboarding_profiles: { data: [], error: null },
    });

    const answers = await loadOnboardingAnswers();

    expect(answers).toEqual({
      discipline: null,
      competitionLevel: null,
      primaryGoal: null,
      weeklyTrainingHours: null,
      preferredRidingDays: [],
    });
  });

  it("reads back a discipline the athlete actually chose", async () => {
    mockTables({
      athletes: { data: [{ discipline: "Enduro" }], error: null },
      athlete_onboarding_profiles: { data: [], error: null },
    });

    const answers = await loadOnboardingAnswers();

    expect(answers.discipline).toBe("Enduro");
  });

  it("reads back a partially completed onboarding profile", async () => {
    mockTables({
      athletes: { data: [{ discipline: "Downhill" }], error: null },
      athlete_onboarding_profiles: {
        data: [{ competition_level: "National level", primary_goal: null, weekly_training_hours: null, preferred_riding_days: [] }],
        error: null,
      },
    });

    const answers = await loadOnboardingAnswers();

    expect(answers).toEqual({
      discipline: "Downhill",
      competitionLevel: "National level",
      primaryGoal: null,
      weeklyTrainingHours: null,
      preferredRidingDays: [],
    });
  });

  it("filters out any riding day that is no longer a valid option", async () => {
    mockTables({
      athletes: { data: [{ discipline: "Downhill" }], error: null },
      athlete_onboarding_profiles: {
        data: [
          {
            competition_level: "Beginner",
            primary_goal: "Fitness",
            weekly_training_hours: "5-10h",
            preferred_riding_days: ["Monday", "SomeRemovedDay", "Sunday"],
          },
        ],
        error: null,
      },
    });

    const answers = await loadOnboardingAnswers();

    expect(answers.preferredRidingDays).toEqual(["Monday", "Sunday"]);
  });

  it("throws AthleteOnboardingError, never the raw Supabase error, when the athletes read fails", async () => {
    mockTables({
      athletes: { data: null, error: { code: "PGRST000", message: "boom" } },
      athlete_onboarding_profiles: { data: [], error: null },
    });

    await expect(loadOnboardingAnswers()).rejects.toThrow(AthleteOnboardingError);
  });
});

describe("athleteOnboardingRepo — save functions", () => {
  it("saveDiscipline updates athletes.discipline for the given athlete id", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    mockedFrom.mockReturnValue({ update: vi.fn().mockReturnValue({ eq }) });

    await saveDiscipline("athlete-1", "Downhill");

    expect(mockedFrom).toHaveBeenCalledWith("athletes");
    expect(eq).toHaveBeenCalledWith("id", "athlete-1");
  });

  it("saveDiscipline throws AthleteOnboardingError on failure", async () => {
    const eq = vi.fn().mockResolvedValue({ error: { code: "42501", message: "denied" } });
    mockedFrom.mockReturnValue({ update: vi.fn().mockReturnValue({ eq }) });

    await expect(saveDiscipline("athlete-1", "Downhill")).rejects.toThrow(AthleteOnboardingError);
  });

  it("saveCompetitionLevel upserts exactly the changed field, keyed on athlete_id", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    mockedFrom.mockReturnValue({ upsert });

    await saveCompetitionLevel("athlete-1", "World Cup");

    expect(mockedFrom).toHaveBeenCalledWith("athlete_onboarding_profiles");
    expect(upsert).toHaveBeenCalledWith(
      { athlete_id: "athlete-1", competition_level: "World Cup" },
      { onConflict: "athlete_id" }
    );
  });

  it("savePrimaryGoal upserts exactly the changed field", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    mockedFrom.mockReturnValue({ upsert });

    await savePrimaryGoal("athlete-1", "Consistency");

    expect(upsert).toHaveBeenCalledWith({ athlete_id: "athlete-1", primary_goal: "Consistency" }, { onConflict: "athlete_id" });
  });

  it("saveWeeklyTrainingHours upserts exactly the changed field", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    mockedFrom.mockReturnValue({ upsert });

    await saveWeeklyTrainingHours("athlete-1", "10-15h");

    expect(upsert).toHaveBeenCalledWith({ athlete_id: "athlete-1", weekly_training_hours: "10-15h" }, { onConflict: "athlete_id" });
  });

  it("completeOnboarding re-sends all four Niveau 1 answers together, not just riding days", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    mockedFrom.mockReturnValue({ upsert });

    await completeOnboarding("athlete-1", {
      competitionLevel: "World Cup",
      primaryGoal: "Consistency",
      weeklyTrainingHours: "10-15h",
      preferredRidingDays: ["Monday", "Saturday"],
    });

    expect(upsert).toHaveBeenCalledTimes(1);
    const [payload] = upsert.mock.calls[0] as [Record<string, unknown>, unknown];
    expect(payload.athlete_id).toBe("athlete-1");
    expect(payload.competition_level).toBe("World Cup");
    expect(payload.primary_goal).toBe("Consistency");
    expect(payload.weekly_training_hours).toBe("10-15h");
    expect(payload.preferred_riding_days).toEqual(["Monday", "Saturday"]);
    expect(typeof payload.onboarding_completed_at).toBe("string");
  });

  it("upsert failure throws AthleteOnboardingError, never the raw Supabase error", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: { code: "23514", message: "check constraint violated" } });
    mockedFrom.mockReturnValue({ upsert });

    await expect(
      completeOnboarding("athlete-1", {
        competitionLevel: "World Cup",
        primaryGoal: "Consistency",
        weeklyTrainingHours: "10-15h",
        preferredRidingDays: ["Monday"],
      })
    ).rejects.toThrow(AthleteOnboardingError);
  });
});
