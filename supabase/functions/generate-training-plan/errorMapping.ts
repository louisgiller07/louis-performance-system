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

// Everything else (PlanningEngineValidationError from an invalid — not
// merely absent — equipment/terrain/priorityArea/tier value,
// PendingProductDecisionError/UnsupportedPrescriptionKindError/
// NoCompatibleExerciseError/NoCompatibleDrillError from prescription-engine,
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
  return { status: 500, code: "internal_error", message: "An unexpected error occurred while generating the training plan." };
}
