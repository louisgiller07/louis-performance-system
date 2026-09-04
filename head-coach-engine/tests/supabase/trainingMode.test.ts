import { describe, it, expect } from "vitest";
import { parseTrainingMode, InvalidTrainingModeError } from "../../src/supabase/mapping/trainingMode.js";

describe("M2 read path — parseTrainingMode", () => {
  it("accepts every known TrainingMode value", () => {
    const modes = [
      "RACE_WEEK",
      "RACE_CLUSTER",
      "OFF_SEASON_RECOVERY",
      "OFF_SEASON_DEVELOPMENT",
      "PRE_SEASON",
      "IN_SEASON",
      "INJURY_RECOVERY",
      "OTHER",
      "UNSPECIFIED",
    ];
    for (const mode of modes) {
      expect(parseTrainingMode(mode)).toBe(mode);
    }
  });

  it("rejects an unknown mode string", () => {
    expect(() => parseTrainingMode("SOMETHING_ELSE")).toThrow(InvalidTrainingModeError);
  });

  it("rejects null", () => {
    expect(() => parseTrainingMode(null)).toThrow(InvalidTrainingModeError);
  });
});
