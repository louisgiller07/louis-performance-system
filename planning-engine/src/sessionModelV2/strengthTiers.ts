/**
 * UX-11A.5a.4 — cumulative athlete tiers, Session Model V2 only (ADR
 * UX-11A.5a.4; the legacy V1 chain-position rule is unchanged).
 *
 * An exercise's tier is the MINIMUM level it needs: the lowest entry of its
 * catalogue `tiers` list. An athlete may use every exercise whose minimum
 * tier is at or below their own declared strengthExperienceTier:
 * beginner → beginner; intermediate → beginner + intermediate;
 * advanced → beginner + intermediate + advanced.
 */
import type { StrengthExperienceTier } from "../types/planInputSnapshot.js";
import type { SessionExerciseV2 } from "../catalog/sessionExerciseCatalogV2.js";
import { SessionModelV2ContractError } from "./generationErrors.js";

export const STRENGTH_TIER_ORDER_V2: readonly StrengthExperienceTier[] = ["beginner", "intermediate", "advanced"];

const rank = (tier: StrengthExperienceTier): number => STRENGTH_TIER_ORDER_V2.indexOf(tier);

/** The minimum tier an exercise requires (lowest entry of its `tiers`). */
export function exerciseMinimumTierV2(exercise: Pick<SessionExerciseV2, "exerciseId" | "tiers">): StrengthExperienceTier {
  if (exercise.tiers.length === 0) throw new SessionModelV2ContractError(`exercise ${exercise.exerciseId} declares no tier`);
  return [...exercise.tiers].sort((a, b) => rank(a) - rank(b))[0]!;
}

/** Cumulative V2 rule: allowed when the exercise's minimum tier is at or below the athlete's tier. */
export function isExerciseAllowedForTierV2(exercise: Pick<SessionExerciseV2, "exerciseId" | "tiers">, athleteTier: StrengthExperienceTier): boolean {
  return rank(exerciseMinimumTierV2(exercise)) <= rank(athleteTier);
}

/** Tiers an athlete of `athleteTier` may use. */
export function allowedExerciseTiersV2(athleteTier: StrengthExperienceTier): readonly StrengthExperienceTier[] {
  return STRENGTH_TIER_ORDER_V2.slice(0, rank(athleteTier) + 1);
}
