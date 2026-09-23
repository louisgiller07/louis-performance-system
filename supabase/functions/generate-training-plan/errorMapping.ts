// V0.5_023 — maps generateAndPersistTrainingPlan's typed errors to an HTTP
// status/code/message. No business/persistence logic here, only response
// shaping — same discipline as accept-training-plan/errorMapping.ts /
// abandon-training-plan/errorMapping.ts.
//
// GenerationBlockedError is defined in planning-engine (buildPlanInputSnapshot
// throws it, via head-coach-engine), not re-exported by any head-coach-engine
// file — every OTHER Edge Function in this project only ever imports from
// head-coach-engine/dist/ (planning-engine is a local workspace package, not
// npm-published, and cannot be resolved by Deno's "npm:" specifier
// mechanism). Since the ticket requires a real `instanceof` check (never
// parsing error.message, never a string comparison on error.name), and
// head-coach-engine cannot be modified to re-export the class, the only
// technically correct source is planning-engine's own compiled output —
// planning-engine already builds to dist/ exactly like head-coach-engine
// does (confirmed before writing this file). This is a read of an existing
// build artifact, not a modification of planning-engine.
import {
  GenerationBlockedError,
  type GenerationBlockedReason,
} from "../../../planning-engine/dist/validation/validatePlanInputSnapshot.js";

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
