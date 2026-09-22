/**
 * exerciseSelection — chooses one exerciseId within an already-selected
 * MovementCategory: filter by category, then equipment compatibility, then
 * exclude deprecated entries, then pick a position in the progressesTo/
 * regressesTo chain by strengthExperienceTier (V0.4_122 §2, V0.4_124 §2).
 *
 * Position is computed relative to the equipment-filtered subset, never the
 * full catalogue chain — a node excluded by the equipment filter is never
 * treated as reachable (V0.4_124 §2). "Depth" (distance from the chain's
 * global root via regressesTo) is still computed against the FULL
 * catalogue so a partially-filtered chain still orders correctly; ties
 * (e.g. core's plank -> {pallof_press, hanging_leg_raise} branch, V0.4_125
 * §2) break on catalogue declaration order, never arbitrarily.
 *
 * beginner = lowest depth in the filtered subset, advanced = highest,
 * intermediate = the middle index (Math.floor((length-1)/2)) — a single
 * formula that degrades cleanly to a nearby available level when no true
 * middle exists (V0.4_122 §2 "repli propre"), never an invented level.
 *
 * Pure: same input always produces the same output, no mutable state, no
 * randomness, reads only the frozen EXERCISE_CATALOG_ENTRIES.
 */
import type { MovementCategory, ExerciseCatalogEntry, StrengthExperienceTier } from "planning-engine";
import { EXERCISE_CATALOG_ENTRIES } from "planning-engine";
import { NoCompatibleExerciseError } from "../errors.js";

export interface ExerciseSelectionInput {
  movementCategory: MovementCategory;
  equipment: readonly string[];
  strengthExperienceTier: StrengthExperienceTier;
}

/** exercise.equipmentRequirements ⊆ athlete.equipment. */
function isEquipmentCompatible(entry: ExerciseCatalogEntry, equipment: readonly string[]): boolean {
  return entry.equipmentRequirements.every((requirement) => equipment.includes(requirement));
}

function compatibleEntries(movementCategory: MovementCategory, equipment: readonly string[]): ExerciseCatalogEntry[] {
  return EXERCISE_CATALOG_ENTRIES.filter(
    (entry) => entry.movementCategory === movementCategory && entry.deprecated !== true && isEquipmentCompatible(entry, equipment)
  );
}

/** Distance from the chain's global root, walked via regressesTo on the FULL (unfiltered) catalogue. */
function computeDepth(entry: ExerciseCatalogEntry, byId: ReadonlyMap<string, ExerciseCatalogEntry>): number {
  let depth = 0;
  let current = entry;
  const visited = new Set<string>([current.id]);
  while (current.regressesTo !== undefined) {
    const previous = byId.get(current.regressesTo);
    if (previous === undefined || visited.has(previous.id)) break;
    visited.add(previous.id);
    current = previous;
    depth += 1;
  }
  return depth;
}

export function selectExercise(input: ExerciseSelectionInput): string {
  const candidates = compatibleEntries(input.movementCategory, input.equipment);

  if (candidates.length === 0) {
    throw new NoCompatibleExerciseError(
      input.movementCategory,
      `no equipment-compatible, non-deprecated exercise exists for movement category "${input.movementCategory}" with the declared equipment`
    );
  }

  const byId = new Map(EXERCISE_CATALOG_ENTRIES.map((entry) => [entry.id, entry]));
  const declarationIndex = new Map(EXERCISE_CATALOG_ENTRIES.map((entry, index) => [entry.id, index]));

  const sorted = [...candidates].sort((a, b) => {
    const depthDiff = computeDepth(a, byId) - computeDepth(b, byId);
    if (depthDiff !== 0) return depthDiff;
    return declarationIndex.get(a.id)! - declarationIndex.get(b.id)!;
  });

  const index =
    input.strengthExperienceTier === "beginner"
      ? 0
      : input.strengthExperienceTier === "advanced"
        ? sorted.length - 1
        : Math.floor((sorted.length - 1) / 2);

  // Safe: index is mathematically within [0, sorted.length - 1] since sorted.length >= 1 (checked above).
  return sorted[index]!.id;
}
