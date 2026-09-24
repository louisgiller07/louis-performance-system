// V0.5_023 — maps generateAndPersistTrainingPlan's typed errors to an HTTP
// status/code/message. No business/persistence logic here, only response
// shaping — same discipline as accept-training-plan/errorMapping.ts /
// abandon-training-plan/errorMapping.ts.
//
// GenerationBlockedError must come from the same Edge bundle as
// generateAndPersistTrainingPlan (V0.5_059): the bundle embeds its own copy of
// planning-engine, so importing the class from anywhere else would break the
// `instanceof` check below.
import {
  GenerationBlockedError,
  NoCompatibleDrillError,
  NoCompatibleExerciseError,
  type GenerationBlockedReason,
} from "../../../head-coach-engine/dist/edge/generateTrainingPlan.bundle.js";

export interface MappedGenerateTrainingPlanError {
  status: number;
  code: string;
  message: string;
}

// Closed mapping, one message per known blockedReason — never free text
// derived from the error itself. Exhaustive over the 4 reasons locked by
// V0.5_005/009; a 5th reason added later without updating this map still
// resolves safely via the fallback message below, never a crash.
const MESSAGE_FOR_BLOCKED_REASON: Partial<Record<GenerationBlockedReason, string>> = {
  missing_availability: "No recurring availability declared for this athlete.",
  missing_performance_profile: "No performance profile configured for this athlete.",
  missing_discipline: "No discipline declared for this athlete.",
  missing_strength_experience_tier: "No strength experience tier declared for this athlete.",
};

// PILOT_015 — NoCompatibleDrillError/NoCompatibleExerciseError are real,
// reachable outcomes of a valid Performance Setup (V0.4_124 §4 "Cas B": the
// catalogue has no drill/exercise for the declared priority, tier, terrain or
// equipment), never a programming error — the athlete can act on them by
// changing that setup, so they get an actionable 422 instead of a 500.
//
// Everything else (PlanningEngineValidationError from an invalid — not
// merely absent — equipment/terrain/priorityArea/tier value,
// PendingProductDecisionError/UnsupportedPrescriptionKindError from prescription-engine,
// GenerateTrainingPlanVersionRpcError/InvalidGenerateTrainingPlanVersionResultError
// from the RPC wrapper, or anything unforeseen) falls through to the generic
// 500 below by design — same discipline as mapDailyRunError/mapAbandonError/
// mapAcceptError, and explicitly scoped this way by the ticket itself (only
// GenerationBlockedError gets a dedicated category).
export function mapGenerateTrainingPlanError(error: unknown): MappedGenerateTrainingPlanError {
  if (error instanceof GenerationBlockedError) {
    return {
      status: 422,
      code: error.blockedReason,
      message: MESSAGE_FOR_BLOCKED_REASON[error.blockedReason] ?? "Configuration incomplete for training plan generation.",
    };
  }
  if (error instanceof NoCompatibleDrillError) {
    return {
      status: 422,
      code: "no_compatible_drill",
      message: "No DH drill matches the declared plan priority, strength experience tier and terrain access.",
    };
  }
  if (error instanceof NoCompatibleExerciseError) {
    return {
      status: 422,
      code: "no_compatible_exercise",
      message: "No strength exercise matches the declared equipment and strength experience tier.",
    };
  }
  return { status: 500, code: "internal_error", message: "An unexpected error occurred while generating the training plan." };
}
