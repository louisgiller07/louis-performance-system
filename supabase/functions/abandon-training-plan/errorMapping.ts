// V0.4_102 — maps abandonTrainingPlanVersionRpc's typed errors to an HTTP
// status/code/message. No business/persistence logic here, only response
// shaping — same discipline as daily-run/errorMapping.ts.
import {
  AbandonTrainingPlanVersionRpcError,
  InvalidAbandonTrainingPlanVersionResultError,
} from "../../../head-coach-engine/dist/supabase/abandonTrainingPlanVersionRpc.js";

export interface MappedAbandonError {
  status: number;
  code: string;
  message: string;
}

// AbandonTrainingPlanVersionRpcError wraps every business-level rejection
// the RPC itself can raise (plan_version_id does not exist, does not belong
// to the caller's athlete, or is not currently in draft state) as a single
// error class carrying only a free-text Postgres message — there is no
// structured error code to switch on today, and this codebase's one
// existing precedent (daily-run/errorMapping.ts) never pattern-matches on
// error message text, only on error class. Introducing message-parsing here
// would be a new pattern this ticket was explicitly scoped not to invent.
// 409 is the closest single honest status for "the RPC declined the
// requested state change" — a real simplification, not a distinction this
// mapping can currently make; documented in the V0.4_102 final report.
//
// Everything else (InvalidAbandonTrainingPlanVersionResultError, or
// anything unforeseen) falls through to the generic 500 below by design —
// same discipline as mapDailyRunError.
export function mapAbandonError(error: unknown): MappedAbandonError {
  if (error instanceof AbandonTrainingPlanVersionRpcError) {
    return { status: 409, code: "abandon_rejected", message: "The training plan version could not be abandoned in its current state." };
  }
  if (error instanceof InvalidAbandonTrainingPlanVersionResultError) {
    return { status: 500, code: "internal_error", message: "An unexpected error occurred while abandoning the training plan version." };
  }
  return { status: 500, code: "internal_error", message: "An unexpected error occurred." };
}
