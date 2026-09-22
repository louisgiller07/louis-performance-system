/**
 * skillTargetSelection — chooses one skillTarget for a DH session
 * (V0.4_124 §3, V0.4_125 §4, V0.4_126 §1 — decisions locked across this
 * design chain).
 *
 * Normal case: technicalPriorities.priorityAreas is non-empty ->
 * priorityAreas[0] is used directly, no fallback to a later priority even
 * if it later turns out to have zero compatible drills (that failure
 * surfaces from drillSelection as NoCompatibleDrillError, never silently
 * avoided here) — DrillCatalogEntry.skillTarget already shares
 * PlanInputTechnicalPriorities' vocabulary, no translation needed.
 *
 * Empty case (the majority of golden scenarios): deterministic rotation
 * over the skillTargets that actually have >=1 terrain- and
 * difficulty-compatible drill (never the raw catalogue list, V0.4_126 §1)
 * keyed by generatedPlanSessionId — every skillTarget weighted equally, no
 * coaching preference encoded.
 *
 * Pure: same input always produces the same output. No Math.random, no
 * Date.now, no Map/Set iteration order dependency — skillTargets are
 * collected preserving DRILL_CATALOG_ENTRIES declaration order.
 */
import type { PlanInputTechnicalPriorities, StrengthExperienceTier, DrillCatalogEntry } from "planning-engine";
import { DRILL_CATALOG_ENTRIES } from "planning-engine";
import { NoCompatibleDrillError } from "../errors.js";

export interface SkillTargetSelectionInput {
  technicalPriorities: PlanInputTechnicalPriorities;
  terrainAccess: readonly string[];
  strengthExperienceTier: StrengthExperienceTier;
  generatedPlanSessionId: string;
}

function isDrillCandidateCompatible(
  entry: DrillCatalogEntry,
  terrainAccess: readonly string[],
  strengthExperienceTier: StrengthExperienceTier
): boolean {
  return entry.deprecated !== true && terrainAccess.includes(entry.terrainRequirement) && entry.difficulty === strengthExperienceTier;
}

/** Distinct skillTargets with >=1 compatible drill, in DRILL_CATALOG_ENTRIES declaration order. */
function compatibleSkillTargets(terrainAccess: readonly string[], strengthExperienceTier: StrengthExperienceTier): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of DRILL_CATALOG_ENTRIES) {
    if (seen.has(entry.skillTarget)) continue;
    if (isDrillCandidateCompatible(entry, terrainAccess, strengthExperienceTier)) {
      seen.add(entry.skillTarget);
      result.push(entry.skillTarget);
    }
  }
  return result;
}

/** Simple deterministic string hash (djb2-like multiply/add) — no randomness, no clock. */
function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function selectSkillTarget(input: SkillTargetSelectionInput): string {
  if (input.technicalPriorities.priorityAreas.length > 0) {
    // Safe: length > 0 guarantees index 0 exists.
    return input.technicalPriorities.priorityAreas[0]!;
  }

  const candidates = compatibleSkillTargets(input.terrainAccess, input.strengthExperienceTier);
  if (candidates.length === 0) {
    throw new NoCompatibleDrillError(
      "(rotation)",
      `no skillTarget has a terrain- and difficulty-compatible drill for terrainAccess=[${input.terrainAccess.join(", ")}], difficulty="${input.strengthExperienceTier}"`
    );
  }

  const index = hashString(input.generatedPlanSessionId) % candidates.length;
  return candidates[index]!;
}
