// V0.5_012 — maps acceptTrainingPlanVersion's typed errors to an HTTP
// status/code/message. No business/persistence logic here, only response
// shaping — same discipline as abandon-training-plan/errorMapping.ts.
import {
  AcceptTrainingPlanVersionRpcError,
  InvalidAcceptTrainingPlanVersionResultError,
} from "../../../head-coach-engine/dist/supabase/acceptTrainingPlanVersionRpc.js";

export interface MappedAcceptError {
  status: number;
  code: string;
  message: string;
}

// AcceptTrainingPlanVersionRpcError wraps every business-level rejection
// the accept_training_plan_version RPC itself can raise (plan_version_id
// does not exist, does not belong to the caller's athlete, or is not
// currently in draft state) as a single error class carrying only a
// free-text Postgres message — there is no structured error code to switch
// on today. Same precedent as abandon-training-plan/errorMapping.ts: this
// codebase's established discipline never pattern-matches on error message
// text, only on error class, so these three real, distinct cases cannot be
// separated into 404 ("plan introuvable") vs 409 ("transition impossible")
// without inventing message-parsing — explicitly out of scope here, exactly
// as it was for abandon-training-plan (V0.4_102). 409 is used for all three
// as the closest single honest status: every one of them is "the RPC
// declined the requested state change on a resource that does exist,"
// including the cross-athlete case (never distinguished from
// not-in-draft-state at the RPC boundary either) — never a literal
// "resource not found."
//
// Everything else (InvalidAcceptTrainingPlanVersionResultError, or anything
// unforeseen) falls through to the generic 500 below by design — same
// discipline as mapAbandonError/mapDailyRunError.
export function mapAcceptError(error: unknown): MappedAcceptError {
  if (error instanceof AcceptTrainingPlanVersionRpcError) {
    return { status: 409, code: "accept_rejected", message: "The training plan version could not be accepted in its current state." };
  }
  if (error instanceof InvalidAcceptTrainingPlanVersionResultError) {
    return { status: 500, code: "internal_error", message: "An unexpected error occurred while accepting the training plan version." };
  }
  return { status: 500, code: "internal_error", message: "An unexpected error occurred." };
}
