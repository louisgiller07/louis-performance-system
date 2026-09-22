/**
 * movementCategorySelection — chooses the first movement category (in the
 * locked order, V0.4_124 §1) that has at least one equipment-compatible,
 * non-deprecated exercise. STRENGTH_FULL_LIGHT/POWER have no locked
 * category list (V0.4_124 §1: never produced by SessionKindAssignment in
 * V1 — see planning-engine's sessionKindAssignment.ts) and are rejected
 * explicitly rather than guessed at.
 *
 * Pure: same input always produces the same output, no mutable state, no
 * randomness, reads only the frozen EXERCISE_CATALOG_ENTRIES.
 */
import type { SessionKind, MovementCategory, ExerciseCatalogEntry } from "planning-engine";
import { EXERCISE_CATALOG_ENTRIES } from "planning-engine";
import { UnsupportedPrescriptionKindError, NoCompatibleExerciseError } from "../errors.js";

export interface MovementCategorySelectionInput {
  kind: SessionKind;
  equipment: readonly string[];
}

/** Locked mapping, V0.4_124 §1 — order is significant (first compatible wins). */
const CATEGORIES_BY_KIND: Partial<Record<SessionKind, readonly MovementCategory[]>> = {
  STRENGTH_LOWER: ["squat", "hinge", "carry"],
  STRENGTH_UPPER: ["push", "pull", "core"],
};

/** exercise.equipmentRequirements ⊆ athlete.equipment. */
function isEquipmentCompatible(entry: ExerciseCatalogEntry, equipment: readonly string[]): boolean {
  return entry.equipmentRequirements.every((requirement) => equipment.includes(requirement));
}

function hasCompatibleExercise(category: MovementCategory, equipment: readonly string[]): boolean {
  return EXERCISE_CATALOG_ENTRIES.some(
    (entry) => entry.movementCategory === category && entry.deprecated !== true && isEquipmentCompatible(entry, equipment)
  );
}

export function selectMovementCategory(input: MovementCategorySelectionInput): MovementCategory {
  const allowedCategories = CATEGORIES_BY_KIND[input.kind];
  if (allowedCategories === undefined) {
    throw new UnsupportedPrescriptionKindError(input.kind);
  }

  for (const category of allowedCategories) {
    if (hasCompatibleExercise(category, input.equipment)) {
      return category;
    }
  }

  throw new NoCompatibleExerciseError(
    allowedCategories.join("/"),
    `no movement category in [${allowedCategories.join(", ")}] has an equipment-compatible, non-deprecated exercise for kind "${input.kind}"`
  );
}
