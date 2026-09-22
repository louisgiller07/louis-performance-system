import { describe, expect, it } from "vitest";
import type { MovementCategory } from "planning-engine";
import { EXERCISE_CATALOG } from "planning-engine";
import { selectExercise } from "../../src/strength/exerciseSelection.js";
import { NoCompatibleExerciseError } from "../../src/errors.js";

const FULL_EQUIPMENT = ["barbell", "squat_rack", "dumbbells", "bench", "pull_up_bar", "cable_machine", "resistance_bands"];

describe("selectExercise — squat tier progression, full equipment", () => {
  it("beginner picks the lowest reachable exercise (bodyweight_squat)", () => {
    expect(selectExercise({ movementCategory: "squat", equipment: FULL_EQUIPMENT, strengthExperienceTier: "beginner" })).toBe(
      "bodyweight_squat"
    );
  });

  it("intermediate picks the middle exercise (goblet_squat)", () => {
    expect(selectExercise({ movementCategory: "squat", equipment: FULL_EQUIPMENT, strengthExperienceTier: "intermediate" })).toBe(
      "goblet_squat"
    );
  });

  it("advanced picks the highest reachable exercise (barbell_back_squat)", () => {
    expect(selectExercise({ movementCategory: "squat", equipment: FULL_EQUIPMENT, strengthExperienceTier: "advanced" })).toBe(
      "barbell_back_squat"
    );
  });
});

describe("selectExercise — equipment filter", () => {
  it("an advanced athlete with zero equipment falls back cleanly to the only compatible exercise", () => {
    expect(selectExercise({ movementCategory: "squat", equipment: [], strengthExperienceTier: "advanced" })).toBe("bodyweight_squat");
  });

  it("never selects an exercise whose equipmentRequirements are not a subset of the declared equipment", () => {
    const result = selectExercise({ movementCategory: "hinge", equipment: ["dumbbells"], strengthExperienceTier: "advanced" });
    const entry = EXERCISE_CATALOG[result]!;
    expect(entry.equipmentRequirements.every((requirement) => ["dumbbells"].includes(requirement))).toBe(true);
  });
});

describe("selectExercise — deprecated exclusion", () => {
  it("never returns an exercise flagged deprecated (real catalogue has none today, this guards the invariant)", () => {
    const categories: MovementCategory[] = ["squat", "hinge", "push", "pull", "carry", "core"];
    const tiers = ["beginner", "intermediate", "advanced"] as const;
    for (const movementCategory of categories) {
      for (const strengthExperienceTier of tiers) {
        const result = selectExercise({ movementCategory, equipment: FULL_EQUIPMENT, strengthExperienceTier });
        expect(EXERCISE_CATALOG[result]?.deprecated).not.toBe(true);
      }
    }
  });
});

describe("selectExercise — determinism", () => {
  it("the same input produces the exact same output on repeated calls", () => {
    const input = { movementCategory: "pull" as const, equipment: FULL_EQUIPMENT, strengthExperienceTier: "intermediate" as const };
    expect(selectExercise(input)).toEqual(selectExercise(input));
  });
});

describe("selectExercise — no compatible exercise", () => {
  it("throws NoCompatibleExerciseError when the movement category has no candidate at all", () => {
    // Real catalogue data always has >=1 bodyweight-compatible exercise per
    // category (catalog.test.ts), so this guard is unreachable through any
    // real MovementCategory — exercised here via an out-of-catalogue value
    // to prove the safety net itself, not to fabricate catalogue data.
    expect(() =>
      selectExercise({
        movementCategory: "does_not_exist" as MovementCategory,
        equipment: FULL_EQUIPMENT,
        strengthExperienceTier: "beginner",
      })
    ).toThrow(NoCompatibleExerciseError);
  });
});
