import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { PlanInputTechnicalPriorities } from "planning-engine";
import { selectSkillTarget } from "../../src/dh/skillTargetSelection.js";
import { NoCompatibleDrillError } from "../../src/errors.js";

const FULL_TERRAIN = [
  "any_groomed_trail",
  "flow_trail",
  "bermed_trail",
  "technical_trail",
  "rock_garden",
  "steep_technical_trail",
  "root_rock_trail",
  "bike_park_jump_line",
  "full_dh_track",
];

const EMPTY_PRIORITIES: PlanInputTechnicalPriorities = { strengths: [], weaknesses: [], priorityAreas: [] };

describe("selectSkillTarget — priorityAreas non-empty", () => {
  it("returns priorityAreas[0] directly", () => {
    const result = selectSkillTarget({
      technicalPriorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
      terrainAccess: FULL_TERRAIN,
      strengthExperienceTier: "beginner",
      generatedPlanSessionId: "session-a",
    });
    expect(result).toBe("cornering");
  });

  it("never falls back to a later priority, even when the first has zero compatible drills", () => {
    const result = selectSkillTarget({
      technicalPriorities: { strengths: [], weaknesses: [], priorityAreas: ["nonexistent_skill", "cornering"] },
      terrainAccess: [],
      strengthExperienceTier: "beginner",
      generatedPlanSessionId: "session-a",
    });
    expect(result).toBe("nonexistent_skill");
  });
});

describe("selectSkillTarget — priorityAreas empty, deterministic rotation", () => {
  it("returns the same result for the same generatedPlanSessionId", () => {
    const input = {
      technicalPriorities: EMPTY_PRIORITIES,
      terrainAccess: FULL_TERRAIN,
      strengthExperienceTier: "beginner" as const,
      generatedPlanSessionId: "session-id-123",
    };
    expect(selectSkillTarget(input)).toEqual(selectSkillTarget(input));
  });

  it("different generatedPlanSessionId values can produce different results", () => {
    const results = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      results.add(
        selectSkillTarget({
          technicalPriorities: EMPTY_PRIORITIES,
          terrainAccess: FULL_TERRAIN,
          strengthExperienceTier: "beginner",
          generatedPlanSessionId: `session-id-${i}`,
        })
      );
    }
    expect(results.size).toBeGreaterThan(1);
  });

  it("only rotates over skillTargets with a terrain- and difficulty-compatible drill", () => {
    // With only "flow_trail" and difficulty "beginner", only "cornering"
    // (cornering_flat_turn_precision) survives filtering among real entries.
    const result = selectSkillTarget({
      technicalPriorities: EMPTY_PRIORITIES,
      terrainAccess: ["flow_trail"],
      strengthExperienceTier: "beginner",
      generatedPlanSessionId: "any-session-id",
    });
    expect(result).toBe("cornering");
  });

  it("throws NoCompatibleDrillError when no skillTarget has any compatible drill", () => {
    expect(() =>
      selectSkillTarget({
        technicalPriorities: EMPTY_PRIORITIES,
        terrainAccess: [],
        strengthExperienceTier: "beginner",
        generatedPlanSessionId: "session-id-123",
      })
    ).toThrow(NoCompatibleDrillError);
  });
});

describe("selectSkillTarget — no randomness, no non-deterministic ordering", () => {
  it("the source file's code never references Math.random or Date.now (doc comments may still mention them in prose)", () => {
    const sourcePath = fileURLToPath(new URL("../../src/dh/skillTargetSelection.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toContain("Math.random");
    expect(code).not.toContain("Date.now");
  });
});
