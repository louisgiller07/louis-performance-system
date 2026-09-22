import { describe, expect, it } from "vitest";
import { selectDrill } from "../../src/dh/drillSelection.js";
import { NoCompatibleDrillError } from "../../src/errors.js";

const FULL_TERRAIN = ["flow_trail", "bermed_trail", "technical_trail", "rock_garden", "root_rock_trail", "bike_park_jump_line", "full_dh_track"];

describe("selectDrill — selection by skillTarget", () => {
  it("picks the drill matching the requested skillTarget", () => {
    const result = selectDrill({ skillTarget: "cornering", terrainAccess: FULL_TERRAIN, strengthExperienceTier: "beginner" });
    expect(result).toBe("cornering_flat_turn_precision");
  });
});

describe("selectDrill — terrain filtering", () => {
  it("selects the drill whose terrainRequirement is declared", () => {
    const result = selectDrill({ skillTarget: "cornering", terrainAccess: ["technical_trail"], strengthExperienceTier: "advanced" });
    expect(result).toBe("cornering_off_camber");
  });

  it("throws NoCompatibleDrillError when the required terrain is not declared", () => {
    expect(() =>
      selectDrill({ skillTarget: "cornering", terrainAccess: ["flow_trail"], strengthExperienceTier: "advanced" })
    ).toThrow(NoCompatibleDrillError);
  });
});

describe("selectDrill — difficulty filtering", () => {
  it("selects the drill matching the requested difficulty tier, not a lower/higher one", () => {
    const beginner = selectDrill({ skillTarget: "cornering", terrainAccess: FULL_TERRAIN, strengthExperienceTier: "beginner" });
    const intermediate = selectDrill({ skillTarget: "cornering", terrainAccess: FULL_TERRAIN, strengthExperienceTier: "intermediate" });
    const advanced = selectDrill({ skillTarget: "cornering", terrainAccess: FULL_TERRAIN, strengthExperienceTier: "advanced" });
    expect(beginner).toBe("cornering_flat_turn_precision");
    expect(intermediate).toBe("cornering_berm_speed");
    expect(advanced).toBe("cornering_off_camber");
  });
});

describe("selectDrill — deterministic when multiple candidates would exist", () => {
  it("is deterministic across repeated calls with the same input", () => {
    const input = { skillTarget: "roots_rocks", terrainAccess: FULL_TERRAIN, strengthExperienceTier: "advanced" as const };
    expect(selectDrill(input)).toEqual(selectDrill(input));
  });

  it("returns the single filtered candidate (real catalogue data has exactly one drill per skillTarget+difficulty pair today — this proves the 'first of the filtered, catalogue-ordered list' mechanism is exercised, not a >1-candidate branch, which is unreachable with current real data)", () => {
    const result = selectDrill({ skillTarget: "jumps", terrainAccess: FULL_TERRAIN, strengthExperienceTier: "beginner" });
    expect(result).toBe("jumps_table_top_basic");
  });
});

describe("selectDrill — no compatible drill", () => {
  it("throws NoCompatibleDrillError, never a relaxation, when the filtered pool is empty", () => {
    expect(() =>
      selectDrill({ skillTarget: "does_not_exist", terrainAccess: FULL_TERRAIN, strengthExperienceTier: "beginner" })
    ).toThrow(NoCompatibleDrillError);
  });

  it("throws NoCompatibleDrillError when terrainAccess is empty", () => {
    expect(() => selectDrill({ skillTarget: "cornering", terrainAccess: [], strengthExperienceTier: "beginner" })).toThrow(
      NoCompatibleDrillError
    );
  });
});
