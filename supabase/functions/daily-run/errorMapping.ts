// M3_003 — maps runDailyFor's typed errors to an HTTP status/code/message.
// No business/M1/persistence logic here, only response shaping.
import { NoCurrentCheckinError, NoCurrentTrainingBlockError } from "../../../head-coach-engine/dist/supabase/buildRawContext.js";
import { IncompleteDailyCheckinError } from "../../../head-coach-engine/dist/supabase/mapping/dailyCheckinRow.js";
import { IncompleteCheckinPainCriteriaError } from "../../../head-coach-engine/dist/supabase/mapping/dailyCheckinPainCriteria.js";
import { PersistDailyRunRpcError, InvalidPersistDailyRunResultError } from "../../../head-coach-engine/dist/supabase/persistDailyRun.js";
import { DailyPlanDateMismatchError } from "../../../head-coach-engine/dist/supabase/runDailyFor.js";

export interface MappedDailyRunError {
  status: number;
  code: string;
  message: string;
}

// Every other error thrown along this path (InvalidHealthFlagRowError,
// InvalidRaceCalendarRowError, InvalidCompletedSessionRowError,
// InvalidTrainingInterventionJsonError, InvalidTrainingModeError,
// MissingSupabaseServerConfigError, or anything unforeseen) falls through
// to the generic 500 below by design — these represent a broken invariant
// M2 already treats as a hard failure, not a client-correctable request.
export function mapDailyRunError(error: unknown): MappedDailyRunError {
  if (error instanceof NoCurrentCheckinError) {
    return { status: 422, code: "no_checkin_for_date", message: "No check-in exists for the requested date." };
  }
  if (error instanceof NoCurrentTrainingBlockError) {
    return { status: 422, code: "no_current_training_block", message: "No current training block is configured for this athlete." };
  }
  if (error instanceof IncompleteCheckinPainCriteriaError) {
    return { status: 422, code: "pain_criteria_missing", message: "The check-in for the requested date is missing required pain criteria." };
  }
  if (error instanceof IncompleteDailyCheckinError) {
    return { status: 422, code: "checkin_incomplete", message: "The check-in for the requested date is incomplete." };
  }
  if (error instanceof PersistDailyRunRpcError) {
    return { status: 500, code: "persistence_failed", message: "Failed to persist the daily run." };
  }
  if (error instanceof InvalidPersistDailyRunResultError) {
    return { status: 500, code: "internal_error", message: "An unexpected error occurred while persisting the daily run." };
  }
  if (error instanceof DailyPlanDateMismatchError) {
    return { status: 500, code: "internal_error", message: "An unexpected error occurred while computing the daily plan." };
  }
  return { status: 500, code: "internal_error", message: "An unexpected error occurred." };
}
