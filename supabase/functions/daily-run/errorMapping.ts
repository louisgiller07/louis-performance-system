// M3_003 — maps runDailyFor's typed errors to an HTTP status/code/message.
// No business/M1/persistence logic here, only response shaping.
import { NoCurrentCheckinError } from "../../../head-coach-engine/dist/supabase/buildRawContext.js";
import { IncompleteDailyCheckinError } from "../../../head-coach-engine/dist/supabase/mapping/dailyCheckinRow.js";
import { IncompleteCheckinPainCriteriaError } from "../../../head-coach-engine/dist/supabase/mapping/dailyCheckinPainCriteria.js";
import { PersistDailyRunRpcError, InvalidPersistDailyRunResultError } from "../../../head-coach-engine/dist/supabase/persistDailyRun.js";
import { DailyPlanDateMismatchError } from "../../../head-coach-engine/dist/supabase/runDailyFor.js";
import { UnsupportedPlanPrescriptionSchemaError } from "../../../head-coach-engine/dist/supabase/dailyV2/dailyPrescriptionModel.js";
import { PersistDailyRunV2RpcError, InvalidPersistDailyRunV2ResultError, DhDrillRevokedError } from "../../../head-coach-engine/dist/supabase/dailyV2/persistDailyRunV2.js";

export interface MappedDailyRunError {
  status: number;
  code: string;
  message: string;
}

// Every other error thrown along this path (InvalidHealthFlagRowError,
// InvalidRaceCalendarRowError, InvalidCompletedSessionRowError,
// InvalidTrainingInterventionJsonError, InvalidTrainingModeError — now
// also the sole signal for a current training_blocks row with a malformed
// mode, V0.3_004C, since a MISSING current row is no longer an error at
// all (buildRawContext.ts resolves it to active_mode="UNSPECIFIED") —
// MissingSupabaseServerConfigError, or anything unforeseen) falls through
// to the generic 500 below by design — these represent a broken invariant
// M2 already treats as a hard failure, not a client-correctable request.
export function mapDailyRunError(error: unknown): MappedDailyRunError {
  if (error instanceof NoCurrentCheckinError) {
    return { status: 422, code: "no_checkin_for_date", message: "No check-in exists for the requested date." };
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
  // UX-11A.5c.3 — the current plan version's prescription schema is unknown: fail-closed, nothing written.
  if (error instanceof UnsupportedPlanPrescriptionSchemaError) {
    return { status: 409, code: "unsupported_plan_prescription_schema", message: "The current training plan uses a format this daily run does not support." };
  }
  if (error instanceof PersistDailyRunV2RpcError) {
    return { status: 500, code: "persistence_failed", message: "Failed to persist the daily run." };
  }
  if (error instanceof InvalidPersistDailyRunV2ResultError) {
    return { status: 500, code: "internal_error", message: "An unexpected error occurred while persisting the daily run." };
  }
  // V2-DH-SPORT-GATE-01C — the day's DH session is no longer validated (DhSportValidationNotCurrentError, thrown
  // inside the V2 bundle: matched by name). Fail-closed, nothing written, never REST: an explicit business code,
  // no validation detail.
  if (error instanceof Error && error.name === "DhSportValidationNotCurrentError") {
    return { status: 409, code: "dh_validation_not_current", message: "Today's technical session is no longer validated: no session is served for today." };
  }
  // V2-DH-REVOCATION (candidate) — a DH drill revoked for safety in the database (persist_daily_run_v2, NX302): the
  // same refusal for the rider, nothing written, never REST; no drill id in the response.
  if (error instanceof DhDrillRevokedError) {
    return { status: 409, code: "dh_validation_not_current", message: "Today's technical session is no longer validated: no session is served for today." };
  }
  if (error instanceof DailyPlanDateMismatchError) {
    return { status: 500, code: "internal_error", message: "An unexpected error occurred while computing the daily plan." };
  }
  return { status: 500, code: "internal_error", message: "An unexpected error occurred." };
}
