/**
 * drillSelection — chooses one drillId for an already-selected skillTarget
 * (V0.4_123 §4, V0.4_124 §4/§7). Filters by skillTarget, terrain
 * (terrainRequirement) and difficulty (StrengthExperienceTier, same
 * vocabulary as DrillDifficultyTier — exact match, no invented threshold
 * relationship). Also excludes deprecated entries, consistent with
 * V0.4_132's strength-side policy for the same catalogue-lifecycle rule.
 *
 * Zero candidates -> NoCompatibleDrillError (a real, reachable condition
 * here — no structural guarantee exists for DH, V0.4_124 §4 "Cas B" —
 * never silently turned into a relaxation; insufficient_exercise_variety
 * belongs to the future resolver, not this layer). One candidate -> return
 * it. Multiple candidates -> deterministic: first in DRILL_CATALOG_ENTRIES
 * declaration order, never Math.random/Date.now/Map-Set iteration order.
 *
 * Pure: same input always produces the same output.
 */
import type { StrengthExperienceTier, DrillCatalogEntry } from "planning-engine";
import { DRILL_CATALOG_ENTRIES } from "planning-engine";
import { NoCompatibleDrillError } from "../errors.js";

export interface DrillSelectionInput {
  skillTarget: string;
  terrainAccess: readonly string[];
  strengthExperienceTier: StrengthExperienceTier;
}

function isCompatible(
  entry: DrillCatalogEntry,
  skillTarget: string,
  terrainAccess: readonly string[],
  strengthExperienceTier: StrengthExperienceTier
): boolean {
  return (
    entry.skillTarget === skillTarget &&
    entry.deprecated !== true &&
    terrainAccess.includes(entry.terrainRequirement) &&
    entry.difficulty === strengthExperienceTier
  );
}

export function selectDrill(input: DrillSelectionInput): string {
  const candidates = DRILL_CATALOG_ENTRIES.filter((entry) =>
    isCompatible(entry, input.skillTarget, input.terrainAccess, input.strengthExperienceTier)
  );

  if (candidates.length === 0) {
    throw new NoCompatibleDrillError(
      input.skillTarget,
      `no drill compatible with terrainAccess=[${input.terrainAccess.join(", ")}] and difficulty="${input.strengthExperienceTier}" exists for skillTarget "${input.skillTarget}"`
    );
  }

  // Deterministic: candidates preserves DRILL_CATALOG_ENTRIES declaration order; first wins.
  return candidates[0]!.id;
}
