// PILOT_017 — the 9 skillTarget × difficulty combinations missing before the catalogue was
// completed, exercised through the real selection code (selectSkillTarget / selectDrill),
// never a bare catalogue lookup. Selection policy itself is unchanged: exact difficulty,
// priorityAreas[0], no fallback.
import { describe, expect, it } from "vitest";
import { DRILL_CATALOG } from "planning-engine";
import { selectDrill } from "../../src/dh/drillSelection.js";
import { selectSkillTarget } from "../../src/dh/skillTargetSelection.js";
import type { StrengthExperienceTier } from "planning-engine";

// Terrain set of the production profile that failed on 2026-09-24 (PILOT_015).
const PRODUCTION_TERRAIN = [
  "flow_trail",
  "bermed_trail",
  "steep_technical_trail",
  "full_dh_track",
  "bike_park_jump_line",
  "rock_garden",
  "root_rock_trail",
  "technical_trail",
  "any_groomed_trail",
];

// A realistic trail-only rider: no bike park, no full DH track.
const COMMON_TRAIL_TERRAIN = ["any_groomed_trail", "flow_trail", "bermed_trail", "technical_trail", "rock_garden", "steep_technical_trail", "root_rock_trail"];

const FORMERLY_MISSING: ReadonlyArray<{ tier: StrengthExperienceTier; skillTarget: string; terrain: readonly string[] }> = [
  { tier: "beginner", skillTarget: "line_choice", terrain: COMMON_TRAIL_TERRAIN },
  { tier: "beginner", skillTarget: "steep_terrain", terrain: COMMON_TRAIL_TERRAIN },
  { tier: "beginner", skillTarget: "race_execution", terrain: COMMON_TRAIL_TERRAIN },
  { tier: "intermediate", skillTarget: "jumps", terrain: [...COMMON_TRAIL_TERRAIN, "bike_park_jump_line"] },
  { tier: "intermediate", skillTarget: "roots_rocks", terrain: COMMON_TRAIL_TERRAIN },
  { tier: "intermediate", skillTarget: "race_execution", terrain: COMMON_TRAIL_TERRAIN },
  { tier: "advanced", skillTarget: "braking", terrain: COMMON_TRAIL_TERRAIN },
  { tier: "advanced", skillTarget: "line_choice", terrain: COMMON_TRAIL_TERRAIN },
  { tier: "advanced", skillTarget: "steep_terrain", terrain: COMMON_TRAIL_TERRAIN },
];

describe("selectDrill — formerly missing skillTarget × difficulty combinations (PILOT_017)", () => {
  it.each(FORMERLY_MISSING)("$tier / $skillTarget is selectable with a realistic terrain set", ({ tier, skillTarget, terrain }) => {
    const drillId = selectDrill({ skillTarget, terrainAccess: terrain, strengthExperienceTier: tier });
    const drill = DRILL_CATALOG[drillId]!;
    expect(drill.skillTarget).toBe(skillTarget);
    expect(drill.difficulty).toBe(tier);
    expect(terrain).toContain(drill.terrainRequirement);
  });

  it.each(FORMERLY_MISSING)("$tier / $skillTarget is also selectable with the production terrain set", ({ tier, skillTarget }) => {
    const drillId = selectDrill({ skillTarget, terrainAccess: PRODUCTION_TERRAIN, strengthExperienceTier: tier });
    expect(DRILL_CATALOG[drillId]!.skillTarget).toBe(skillTarget);
    expect(DRILL_CATALOG[drillId]!.difficulty).toBe(tier);
  });
});

describe("production regression — Downhill, intermediate, priorityAreas[0] = race_execution (PILOT_015 → PILOT_017)", () => {
  it("selects a race_execution drill at the exact intermediate tier instead of throwing NoCompatibleDrillError", () => {
    const skillTarget = selectSkillTarget({
      technicalPriorities: { strengths: ["cornering"], weaknesses: ["race_execution"], priorityAreas: ["race_execution"] },
      terrainAccess: PRODUCTION_TERRAIN,
      strengthExperienceTier: "intermediate",
      generatedPlanSessionId: "any-session-id",
    });
    expect(skillTarget).toBe("race_execution");

    const drillId = selectDrill({ skillTarget, terrainAccess: PRODUCTION_TERRAIN, strengthExperienceTier: "intermediate" });
    expect(DRILL_CATALOG[drillId]!.skillTarget).toBe("race_execution");
    expect(DRILL_CATALOG[drillId]!.difficulty).toBe("intermediate");
  });

  it("does not depend on the rare full_dh_track terrain", () => {
    const drillId = selectDrill({ skillTarget: "race_execution", terrainAccess: COMMON_TRAIL_TERRAIN, strengthExperienceTier: "intermediate" });
    expect(DRILL_CATALOG[drillId]!.terrainRequirement).not.toBe("full_dh_track");
  });
});
