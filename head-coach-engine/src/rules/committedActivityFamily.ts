/**
 * V0.3_005A (NAL-001) — committed-activity family preservation.
 *
 * Reuses exactly the family-preserving destinations already established
 * elsewhere in the engine — no new kind, no new taxonomy:
 *  - DH family (`DH_TECHNICAL`/`DH_PERFORMANCE`/`PUMPTRACK`/`DH_LIGHT`) →
 *    `DH_LIGHT`/`LIGHT`, the same destination `domains/training.ts`'s
 *    arms_grip/legs RED pivots and `rules/modes.ts`'s `no_dh_intense`
 *    strong constraint already use.
 *  - `AEROBIC_INTERVALS` → `AEROBIC_BASE`, the same "same nature" relation
 *    `engine/buildDailyPlan.ts`'s `MODIFY_EQUIVALENT_KIND_PAIRS` and
 *    `domains/training.ts`'s MENTAL_RED handling already use.
 *  - Any other load-variable kind (`AEROBIC_BASE`, the strength-family
 *    kinds) → the same kind with `load_profile` downgraded one notch, via
 *    the existing `withDowngradedLoad`.
 *  - Fixed-load kinds (`MOBILITY`, `RECOVERY_ACTIVE`, `REST`,
 *    `BIKE_MAINTENANCE`, `RACE_ACTIVITY`) have no lower rung within their
 *    own family — `null` (caller falls back to the raw T-X recommendation,
 *    traced explicitly — see engine/buildDailyPlan.ts).
 *
 * See docs/11_DECISION_LOG.md (V0.3_005A) for the full architecture
 * decision this implements.
 */
import type { TrainingIntervention, TrainingInterventionKind } from "../types/trainingIntervention.js";
import { withDowngradedLoad } from "../types/trainingIntervention.js";

const DH_FAMILY_KINDS: ReadonlySet<TrainingInterventionKind> = new Set([
  "DH_TECHNICAL",
  "DH_PERFORMANCE",
  "PUMPTRACK",
  "DH_LIGHT",
]);

const STRENGTH_FAMILY_KINDS: ReadonlySet<TrainingInterventionKind> = new Set([
  "STRENGTH_LOWER",
  "STRENGTH_UPPER",
  "STRENGTH_FULL_LIGHT",
  "POWER",
  "GRIP_WORK",
]);

/**
 * Given the athlete's committed `TrainingIntervention`, returns a truthful
 * same-family, equal-or-lower-load adaptation reflecting an ordinary T-X
 * "reduce load approaching the race" intent — or `null` if no such
 * adaptation exists for this kind.
 */
export function preserveCommittedActivityFamily(committed: TrainingIntervention): TrainingIntervention | null {
  if (DH_FAMILY_KINDS.has(committed.kind)) {
    return { kind: "DH_LIGHT", load_profile: "LIGHT" };
  }

  if (committed.kind === "AEROBIC_INTERVALS") {
    return withDowngradedLoad({ kind: "AEROBIC_BASE", load_profile: committed.load_profile });
  }

  if (committed.kind === "AEROBIC_BASE" || STRENGTH_FAMILY_KINDS.has(committed.kind)) {
    return withDowngradedLoad(committed);
  }

  // MOBILITY, RECOVERY_ACTIVE, REST, BIKE_MAINTENANCE, RACE_ACTIVITY: fixed
  // load, no lower rung within their own family.
  return null;
}
