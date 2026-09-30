import { describe, it, expect } from "vitest";
import {
  DH_TECHNICAL_TIER_OPTIONS,
  DH_TECHNICAL_TIER_LABELS,
  DH_TECHNICAL_TIER_DESCRIPTIONS,
  MAX_PRIORITY_AREAS,
  toggleOrderedPriority,
  EQUIPMENT_OPTIONS,
  TERRAIN_OPTIONS,
  TECHNICAL_PRIORITY_OPTIONS,
  STRENGTH_EXPERIENCE_TIER_OPTIONS,
} from "./performanceSetupOptions";

// V0.5_019 — guards the exact contents of each closed list. web/ cannot
// import planning-engine to compare against the real catalogue at test time
// (the same boundary this file's own module doc documents), so this only
// catches an accidental local edit — it cannot catch drift against the
// engine's real catalogue values. That trade-off is the deliberate cost of
// Option A (V0.5_018).
describe("performanceSetupOptions", () => {
  it("EQUIPMENT_OPTIONS matches the exact known catalogue vocabulary", () => {
    expect(EQUIPMENT_OPTIONS).toEqual(["barbell", "squat_rack", "dumbbells", "bench", "resistance_bands", "cable_machine", "pull_up_bar"]);
  });

  it("TERRAIN_OPTIONS matches the exact known catalogue vocabulary", () => {
    expect(TERRAIN_OPTIONS).toEqual([
      "any_groomed_trail",
      "flow_trail",
      "bermed_trail",
      "technical_trail",
      "rock_garden",
      "steep_technical_trail",
      "root_rock_trail",
      "bike_park_jump_line",
      "full_dh_track",
    ]);
  });

  it("TECHNICAL_PRIORITY_OPTIONS matches the exact known catalogue vocabulary", () => {
    expect(TECHNICAL_PRIORITY_OPTIONS).toEqual([
      "braking",
      "cornering",
      "line_choice",
      "steep_terrain",
      "roots_rocks",
      "jumps",
      "race_execution",
    ]);
  });

  it("STRENGTH_EXPERIENCE_TIER_OPTIONS matches the exact known product enum", () => {
    expect(STRENGTH_EXPERIENCE_TIER_OPTIONS).toEqual(["beginner", "intermediate", "advanced"]);
  });

  it.each([
    ["EQUIPMENT_OPTIONS", EQUIPMENT_OPTIONS],
    ["TERRAIN_OPTIONS", TERRAIN_OPTIONS],
    ["TECHNICAL_PRIORITY_OPTIONS", TECHNICAL_PRIORITY_OPTIONS],
    ["STRENGTH_EXPERIENCE_TIER_OPTIONS", STRENGTH_EXPERIENCE_TIER_OPTIONS],
  ] as const)("%s is non-empty with no duplicate values", (_name, options) => {
    expect(options.length).toBeGreaterThan(0);
    expect(new Set(options).size).toBe(options.length);
  });
});

describe("UX-11A.5a.2b — declared DH tier and ordered priorities", () => {

  it("offers exactly beginner / intermediate / advanced, each with a label and a description", () => {
    expect(DH_TECHNICAL_TIER_OPTIONS).toEqual(["beginner", "intermediate", "advanced"]);
    for (const tier of DH_TECHNICAL_TIER_OPTIONS) {
      expect(DH_TECHNICAL_TIER_LABELS[tier].length).toBeGreaterThan(0);
      expect(DH_TECHNICAL_TIER_DESCRIPTIONS[tier].length).toBeGreaterThan(0);
    }
  });

  it("appends in click order, re-ranks on removal, never duplicates, never exceeds 3", () => {
    expect(MAX_PRIORITY_AREAS).toBe(3);
    let list = toggleOrderedPriority([], "cornering");
    list = toggleOrderedPriority(list, "braking");
    list = toggleOrderedPriority(list, "jumps");
    expect(list).toEqual(["cornering", "braking", "jumps"]);
    expect(toggleOrderedPriority(list, "roots_rocks")).toEqual(["cornering", "braking", "jumps"]);
    expect(toggleOrderedPriority(list, "cornering")).toEqual(["braking", "jumps"]);
    expect(toggleOrderedPriority(["braking"], "braking")).toEqual([]);
  });
});
