import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockedFrom } = vi.hoisted(() => ({ mockedFrom: vi.fn() }));
vi.mock("../../lib/supabase", () => ({
  supabase: { from: mockedFrom },
}));

import { loadPerformanceSetupAnswers, savePerformanceSetup, PerformanceSetupError } from "./performanceSetupRepo";

beforeEach(() => {
  vi.resetAllMocks();
});

const ATHLETE_ID = "athlete-1";

describe("performanceSetupRepo — loadPerformanceSetupAnswers", () => {
  it("returns all-empty/null answers for a brand new athlete with no row yet", async () => {
    mockedFrom.mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [], error: null }) });

    const answers = await loadPerformanceSetupAnswers();

    expect(answers).toEqual({
      equipment: [],
      terrainAccess: [],
      strengths: [],
      weaknesses: [],
      priorityAreas: [],
      strengthExperienceTier: null,
      seasonObjective: null,
    });
  });

  it("reads back a fully configured profile", async () => {
    mockedFrom.mockReturnValue({
      select: vi.fn().mockResolvedValue({
        data: [
          {
            equipment: ["barbell", "dumbbells"],
            terrain_access: ["flow_trail"],
            strength_experience_tier: "intermediate",
            season_objective: "Podium at nationals",
            technical_priorities: { strengths: ["jumps"], weaknesses: ["braking"], priorityAreas: ["cornering"] },
          },
        ],
        error: null,
      }),
    });

    const answers = await loadPerformanceSetupAnswers();

    expect(answers).toEqual({
      equipment: ["barbell", "dumbbells"],
      terrainAccess: ["flow_trail"],
      strengths: ["jumps"],
      weaknesses: ["braking"],
      priorityAreas: ["cornering"],
      strengthExperienceTier: "intermediate",
      seasonObjective: "Podium at nationals",
    });
  });

  it("filters out a stale value that is no longer a known option, never crashes", async () => {
    mockedFrom.mockReturnValue({
      select: vi.fn().mockResolvedValue({
        data: [
          {
            equipment: ["barbell", "some_removed_machine"],
            terrain_access: [],
            strength_experience_tier: "not_a_real_tier",
            season_objective: null,
            technical_priorities: {},
          },
        ],
        error: null,
      }),
    });

    const answers = await loadPerformanceSetupAnswers();

    expect(answers.equipment).toEqual(["barbell"]);
    expect(answers.strengthExperienceTier).toBeNull();
  });

  it("throws PerformanceSetupError when the read fails", async () => {
    mockedFrom.mockReturnValue({ select: vi.fn().mockResolvedValue({ data: null, error: { code: "500" } }) });

    await expect(loadPerformanceSetupAnswers()).rejects.toBeInstanceOf(PerformanceSetupError);
  });
});

describe("performanceSetupRepo — savePerformanceSetup", () => {
  it("upserts every field together, normalizing a blank seasonObjective to null", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    mockedFrom.mockReturnValue({ upsert });

    await savePerformanceSetup(ATHLETE_ID, {
      equipment: ["barbell"],
      terrainAccess: ["flow_trail"],
      strengths: ["jumps"],
      weaknesses: [],
      priorityAreas: ["cornering"],
      strengthExperienceTier: "beginner",
      seasonObjective: "   ",
    });

    expect(mockedFrom).toHaveBeenCalledWith("athlete_performance_profiles");
    expect(upsert).toHaveBeenCalledWith(
      {
        athlete_id: ATHLETE_ID,
        equipment: ["barbell"],
        terrain_access: ["flow_trail"],
        strength_experience_tier: "beginner",
        season_objective: null,
        technical_priorities: { strengths: ["jumps"], weaknesses: [], priorityAreas: ["cornering"] },
      },
      { onConflict: "athlete_id" }
    );
  });

  it("preserves a real, non-blank seasonObjective", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    mockedFrom.mockReturnValue({ upsert });

    await savePerformanceSetup(ATHLETE_ID, {
      equipment: [],
      terrainAccess: [],
      strengths: [],
      weaknesses: [],
      priorityAreas: [],
      strengthExperienceTier: null,
      seasonObjective: "  Podium at nationals  ",
    });

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ season_objective: "Podium at nationals" }), expect.anything());
  });

  it("throws PerformanceSetupError when the write fails", async () => {
    mockedFrom.mockReturnValue({ upsert: vi.fn().mockResolvedValue({ error: { code: "500" } }) });

    await expect(
      savePerformanceSetup(ATHLETE_ID, {
        equipment: [],
        terrainAccess: [],
        strengths: [],
        weaknesses: [],
        priorityAreas: [],
        strengthExperienceTier: null,
        seasonObjective: null,
      })
    ).rejects.toBeInstanceOf(PerformanceSetupError);
  });
});
