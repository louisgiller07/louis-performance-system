import { describe, expect, it } from "vitest";
import type { MovementCategory, StrengthExperienceTier } from "planning-engine";
import { EXERCISE_CATALOG_ENTRIES, SESSION_EXERCISE_CATALOG_V2_ENTRIES } from "planning-engine";
import { selectExercise } from "../../src/strength/exerciseSelection.js";
import { selectMovementCategory } from "../../src/strength/movementCategorySelection.js";

// UX-11A.5a.1 — non-regression lock on V1 exercise selection. Recorded
// BEFORE the Session Model V2 catalogue existed: every (movement category ×
// declared equipment subset × strength tier) combination must keep resolving
// to the exact same V1 exercise (or the same error). V2 content lives in a
// separate catalogue that no V1 path reads.
const EQUIPMENT = ["barbell", "squat_rack", "dumbbells", "bench", "resistance_bands", "cable_machine", "pull_up_bar"] as const;
const TIERS: StrengthExperienceTier[] = ["beginner", "intermediate", "advanced"];

function allEquipmentSubsets(): string[][] {
  const subsets: string[][] = [];
  for (let mask = 0; mask < 1 << EQUIPMENT.length; mask++) {
    subsets.push(EQUIPMENT.filter((_, bit) => (mask & (1 << bit)) !== 0));
  }
  return subsets;
}

function selectionMatrix(): Record<string, string> {
  const categories = [...new Set(EXERCISE_CATALOG_ENTRIES.map((entry) => entry.movementCategory))].sort() as MovementCategory[];
  const matrix: Record<string, string> = {};
  for (const movementCategory of categories) {
    for (const equipment of allEquipmentSubsets()) {
      for (const strengthExperienceTier of TIERS) {
        const key = `${movementCategory}|${equipment.join("+") || "none"}|${strengthExperienceTier}`;
        try {
          matrix[key] = selectExercise({ movementCategory, equipment, strengthExperienceTier });
        } catch (error) {
          matrix[key] = `error:${(error as Error).name}`;
        }
      }
    }
  }
  return matrix;
}

describe("V1 exercise selection — frozen by UX-11A.5a.1", () => {
  it("resolves every category × equipment subset × tier exactly as before", () => {
    expect(selectionMatrix()).toMatchSnapshot();
  });

  it("only ever selects exercises of the V1 catalogue — never a Session Model V2-only exercise", () => {
    const v1Ids = new Set(EXERCISE_CATALOG_ENTRIES.map((entry) => entry.id));
    const v2OnlyIds = new Set(SESSION_EXERCISE_CATALOG_V2_ENTRIES.filter((e) => e.origin === "v2_only").map((e) => e.exerciseId));
    expect(v2OnlyIds.size).toBeGreaterThan(0);
    for (const selected of Object.values(selectionMatrix())) {
      if (selected.startsWith("error:")) continue;
      expect(v1Ids.has(selected), selected).toBe(true);
      expect(v2OnlyIds.has(selected), selected).toBe(false);
    }
  });

  it("keeps the strength kind → movement category mapping for every equipment subset", () => {
    const mapping: Record<string, string> = {};
    for (const kind of ["STRENGTH_LOWER", "STRENGTH_UPPER", "STRENGTH_FULL_LIGHT", "POWER"] as const) {
      for (const equipment of allEquipmentSubsets()) {
        try {
          mapping[`${kind}|${equipment.join("+") || "none"}`] = selectMovementCategory({ kind, equipment });
        } catch (error) {
          mapping[`${kind}|${equipment.join("+") || "none"}`] = `error:${(error as Error).name}`;
        }
      }
    }
    expect(mapping).toMatchSnapshot();
  });
});
