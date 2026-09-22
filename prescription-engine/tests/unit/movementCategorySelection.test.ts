import { describe, expect, it } from "vitest";
import { selectMovementCategory } from "../../src/strength/movementCategorySelection.js";
import { UnsupportedPrescriptionKindError } from "../../src/errors.js";

const FULL_EQUIPMENT = ["barbell", "squat_rack", "dumbbells", "bench", "pull_up_bar", "cable_machine", "resistance_bands"];
const LOWER_CATEGORIES = new Set(["squat", "hinge", "carry"]);
const UPPER_CATEGORIES = new Set(["push", "pull", "core"]);

describe("selectMovementCategory — STRENGTH_LOWER", () => {
  it("only ever returns squat, hinge, or carry, regardless of equipment", () => {
    for (const equipment of [[], FULL_EQUIPMENT, ["dumbbells"]]) {
      const result = selectMovementCategory({ kind: "STRENGTH_LOWER", equipment });
      expect(LOWER_CATEGORIES.has(result)).toBe(true);
    }
  });
});

describe("selectMovementCategory — STRENGTH_UPPER", () => {
  it("only ever returns push, pull, or core, regardless of equipment", () => {
    for (const equipment of [[], FULL_EQUIPMENT, ["resistance_bands"]]) {
      const result = selectMovementCategory({ kind: "STRENGTH_UPPER", equipment });
      expect(UPPER_CATEGORIES.has(result)).toBe(true);
    }
  });
});

describe("selectMovementCategory — deterministic order", () => {
  it("picks the first category in the locked order (squat/push) when it has a compatible exercise", () => {
    expect(selectMovementCategory({ kind: "STRENGTH_LOWER", equipment: FULL_EQUIPMENT })).toBe("squat");
    expect(selectMovementCategory({ kind: "STRENGTH_UPPER", equipment: FULL_EQUIPMENT })).toBe("push");
  });
});

describe("selectMovementCategory — empty equipment", () => {
  it("still resolves to squat for STRENGTH_LOWER via the bodyweight exercise", () => {
    expect(selectMovementCategory({ kind: "STRENGTH_LOWER", equipment: [] })).toBe("squat");
  });

  it("still resolves to push for STRENGTH_UPPER via the bodyweight exercise", () => {
    expect(selectMovementCategory({ kind: "STRENGTH_UPPER", equipment: [] })).toBe("push");
  });
});

describe("selectMovementCategory — determinism", () => {
  it("the same input produces the exact same output on repeated calls", () => {
    const input = { kind: "STRENGTH_LOWER" as const, equipment: ["dumbbells"] };
    expect(selectMovementCategory(input)).toEqual(selectMovementCategory(input));
  });
});

describe("selectMovementCategory — unsupported kind", () => {
  it("throws UnsupportedPrescriptionKindError for a kind with no locked category list", () => {
    expect(() => selectMovementCategory({ kind: "STRENGTH_FULL_LIGHT", equipment: [] })).toThrow(UnsupportedPrescriptionKindError);
  });

  it("throws UnsupportedPrescriptionKindError for a non-strength kind", () => {
    expect(() => selectMovementCategory({ kind: "AEROBIC_BASE", equipment: [] })).toThrow(UnsupportedPrescriptionKindError);
  });
});
