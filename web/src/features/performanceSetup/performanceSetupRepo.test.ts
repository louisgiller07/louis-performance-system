import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockedFrom } = vi.hoisted(() => ({ mockedFrom: vi.fn() }));
vi.mock("../../lib/supabase", () => ({
  supabase: { from: mockedFrom },
}));

import { loadPerformanceSetupAnswers, savePerformanceSetup, saveDhTechnicalProfile, PerformanceSetupError, type SavePerformanceSetupInput } from "./performanceSetupRepo";

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
      dhTechnicalTier: null,
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
            dh_technical_tier: "advanced",
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
      dhTechnicalTier: "advanced",
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
            dh_technical_tier: "expert",
          },
        ],
        error: null,
      }),
    });

    const answers = await loadPerformanceSetupAnswers();

    expect(answers.equipment).toEqual(["barbell"]);
    expect(answers.strengthExperienceTier).toBeNull();
    expect(answers.dhTechnicalTier).toBeNull();
  });

  it("throws PerformanceSetupError when the read fails", async () => {
    mockedFrom.mockReturnValue({ select: vi.fn().mockResolvedValue({ data: null, error: { code: "500" } }) });

    await expect(loadPerformanceSetupAnswers()).rejects.toBeInstanceOf(PerformanceSetupError);
  });
});

/** A from() mock that serves the raw technical_priorities read, then records the upsert. */
function mockRawThenUpsert(rawPriorities: unknown, upsertError: unknown = null) {
  const upsert = vi.fn().mockResolvedValue({ error: upsertError });
  const select = vi.fn().mockResolvedValue({ data: rawPriorities === undefined ? [] : [{ technical_priorities: rawPriorities }], error: null });
  mockedFrom.mockReturnValue({ select, upsert });
  return { upsert, select };
}

const EMPTY_ANSWERS: SavePerformanceSetupInput = {
  equipment: [],
  terrainAccess: [],
  strengths: [],
  weaknesses: [],
  priorityAreas: [],
  strengthExperienceTier: null,
  dhTechnicalTier: null,
  seasonObjective: null,
};

describe("performanceSetupRepo — savePerformanceSetup", () => {
  it("upserts every field together (DH tier included), normalizing a blank seasonObjective to null", async () => {
    const { upsert } = mockRawThenUpsert(undefined);

    await savePerformanceSetup(ATHLETE_ID, {
      equipment: ["barbell"],
      terrainAccess: ["flow_trail"],
      strengths: ["jumps"],
      weaknesses: [],
      priorityAreas: ["cornering"],
      strengthExperienceTier: "beginner",
      dhTechnicalTier: "intermediate",
      seasonObjective: "   ",
    });

    expect(mockedFrom).toHaveBeenCalledWith("athlete_performance_profiles");
    expect(upsert).toHaveBeenCalledWith(
      {
        athlete_id: ATHLETE_ID,
        equipment: ["barbell"],
        terrain_access: ["flow_trail"],
        strength_experience_tier: "beginner",
        dh_technical_tier: "intermediate",
        season_objective: null,
        technical_priorities: { strengths: ["jumps"], weaknesses: [], priorityAreas: ["cornering"] },
      },
      { onConflict: "athlete_id" }
    );
  });

  it("merges into the saved technical_priorities object: keys unknown to this UI are kept", async () => {
    const { upsert } = mockRawThenUpsert({ strengths: ["jumps"], weaknesses: ["braking"], priorityAreas: ["cornering"], coachNote: "kept" });

    await savePerformanceSetup(ATHLETE_ID, { ...EMPTY_ANSWERS, strengths: ["jumps"], weaknesses: ["braking"], priorityAreas: ["roots_rocks"] });

    expect(upsert.mock.calls[0]![0].technical_priorities).toEqual({ strengths: ["jumps"], weaknesses: ["braking"], priorityAreas: ["roots_rocks"], coachNote: "kept" });
  });

  it("keeps a legacy NULL DH tier as NULL", async () => {
    const { upsert } = mockRawThenUpsert({});
    await savePerformanceSetup(ATHLETE_ID, { ...EMPTY_ANSWERS, strengthExperienceTier: "advanced" });
    expect(upsert.mock.calls[0]![0].dh_technical_tier).toBeNull();
  });

  it("preserves a real, non-blank seasonObjective", async () => {
    const { upsert } = mockRawThenUpsert(undefined);
    await savePerformanceSetup(ATHLETE_ID, { ...EMPTY_ANSWERS, seasonObjective: "  Podium at nationals  " });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ season_objective: "Podium at nationals" }), expect.anything());
  });

  it("throws PerformanceSetupError when the write fails", async () => {
    mockRawThenUpsert(undefined, { code: "500" });
    await expect(savePerformanceSetup(ATHLETE_ID, EMPTY_ANSWERS)).rejects.toBeInstanceOf(PerformanceSetupError);
  });

  it("throws PerformanceSetupError when the raw read fails, and writes nothing", async () => {
    const upsert = vi.fn();
    mockedFrom.mockReturnValue({ select: vi.fn().mockResolvedValue({ data: null, error: { code: "500" } }), upsert });
    await expect(savePerformanceSetup(ATHLETE_ID, EMPTY_ANSWERS)).rejects.toBeInstanceOf(PerformanceSetupError);
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe("performanceSetupRepo — saveDhTechnicalProfile (UX-11A.5a.2b)", () => {
  it("writes only the DH tier and priorityAreas; strengths, weaknesses and any other key stay exactly as saved", async () => {
    const saved = { strengths: ["jumps", "a_removed_value"], weaknesses: ["braking"], priorityAreas: ["cornering"], coachNote: "kept" };
    const { upsert } = mockRawThenUpsert(saved);

    await saveDhTechnicalProfile(ATHLETE_ID, { dhTechnicalTier: "advanced", priorityAreas: ["roots_rocks", "jumps"] });

    expect(upsert).toHaveBeenCalledWith(
      {
        athlete_id: ATHLETE_ID,
        dh_technical_tier: "advanced",
        technical_priorities: { strengths: ["jumps", "a_removed_value"], weaknesses: ["braking"], priorityAreas: ["roots_rocks", "jumps"], coachNote: "kept" },
      },
      { onConflict: "athlete_id" }
    );
  });

  it("keeps the declared order and never touches the strength tier, equipment, terrain or objective", async () => {
    const { upsert } = mockRawThenUpsert(undefined);
    await saveDhTechnicalProfile(ATHLETE_ID, { dhTechnicalTier: "beginner", priorityAreas: ["race_execution", "braking", "cornering"] });
    const payload = upsert.mock.calls[0]![0];
    expect(Object.keys(payload).sort()).toEqual(["athlete_id", "dh_technical_tier", "technical_priorities"]);
    expect(payload.technical_priorities).toEqual({ priorityAreas: ["race_execution", "braking", "cornering"] });
  });

  it.each([
    ["no priority", { dhTechnicalTier: "intermediate", priorityAreas: [] }],
    ["four priorities", { dhTechnicalTier: "intermediate", priorityAreas: ["braking", "cornering", "jumps", "roots_rocks"] }],
    ["a duplicate", { dhTechnicalTier: "intermediate", priorityAreas: ["braking", "braking"] }],
    ["an unknown priority", { dhTechnicalTier: "intermediate", priorityAreas: ["wheelies"] }],
    ["an unknown tier", { dhTechnicalTier: "expert", priorityAreas: ["braking"] }],
  ])("refuses %s and writes nothing", async (_label, input) => {
    const { upsert, select } = mockRawThenUpsert({});
    await expect(saveDhTechnicalProfile(ATHLETE_ID, input as never)).rejects.toBeInstanceOf(PerformanceSetupError);
    expect(select).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("throws PerformanceSetupError when the write fails", async () => {
    mockRawThenUpsert({}, { code: "500" });
    await expect(saveDhTechnicalProfile(ATHLETE_ID, { dhTechnicalTier: "advanced", priorityAreas: ["braking"] })).rejects.toBeInstanceOf(PerformanceSetupError);
  });
});
