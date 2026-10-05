/**
 * Pure validation for POST /functions/v1/session-execution (UX-11B.2.2).
 * Zero I/O, zero Deno-specific APIs, zero npm:/jsr: imports — portable plain
 * TypeScript, unit-tested with vitest (head-coach-engine/tests/edge/sessionExecution)
 * and imported by the Deno handler (index.ts).
 *
 * Shape and bounds only. Every rule that needs the database (prescription
 * item exists, v2 only, one active execution per day, lifecycle order,
 * corrections, idempotence) belongs to record_session_execution
 * (supabase/migrations/20260930120500_ux11b2_record_session_execution.sql),
 * the authority. Deliberately no `decision_id` and no `exercise_id` in the
 * client contract: the server derives both.
 */

export const EXECUTION_EVENT_TYPES = ["started", "paused", "resumed", "completed", "abandoned"] as const;
export type ExecutionEventType = (typeof EXECUTION_EVENT_TYPES)[number];

export const SET_MEASURE_TYPES = ["reps", "duration", "distance", "pass"] as const;
export type SetMeasureType = (typeof SET_MEASURE_TYPES)[number];

export const MAX_BATCH_ITEMS = 200;
export const MAX_COMMENT_LENGTH = 500;
export const MAX_OTHER_EXERCISE_NAME_LENGTH = 80;
export const MAX_ACTIVITY_ID_LENGTH = 64;

export interface ExecutionInput {
  id: string;
  session_date: string;
  started_at: string;
  final_prescription_id: string | null;
  comment: string | null;
}

export interface ExecutionEventInput {
  id: string;
  execution_id: string;
  event_type: ExecutionEventType;
  occurred_at: string;
}

export interface SetResultInput {
  id: string;
  execution_id: string;
  prescription_item_id: string | null;
  other_exercise_name: string | null;
  set_number: number;
  done: boolean;
  measure_type: SetMeasureType;
  measure_value: number | null;
  load_kg: number | null;
  rpe_actual: number | null;
  success: boolean | null;
  comment: string | null;
  supersedes_id: string | null;
  occurred_at: string;
}

/**
 * UX-11B.2.5 — the endurance activity actually performed (session_activity_results).
 * Not a prescription item: no prescription_item_id, no exercise_id. Whether
 * activity_id is allowed is decided by the server from the execution's own
 * final prescription (activitySelection).
 */
export interface ActivityResultInput {
  id: string;
  execution_id: string;
  activity_id: string;
  /** Actual performed duration, seconds. */
  duration_seconds: number;
  /** Actual distance, metres. */
  distance_m: number | null;
  rpe_actual: number | null;
  comment: string | null;
  supersedes_id: string | null;
  occurred_at: string;
}

export interface SessionExecutionBatch {
  execution: ExecutionInput | null;
  events: ExecutionEventInput[];
  sets: SetResultInput[];
  activities: ActivityResultInput[];
}

export interface ValidationError {
  code: "invalid_body";
  message: string;
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: ValidationError };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// ISO-8601 date-time with an explicit offset (Z or ±hh:mm): never a local, zone-less time.
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

function fail<T>(message: string): ValidationResult<T> {
  return { ok: false, error: { code: "invalid_body", message } };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && TIMESTAMP_PATTERN.test(value) && !Number.isNaN(new Date(value).getTime());
}

/** null/undefined → null; otherwise a non-blank string within the limit, or invalid. */
function optionalText(value: unknown, max: number): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) return { ok: false };
  return { ok: true, value };
}

function hasDecimalsAtMost(value: number, decimals: number): boolean {
  const factor = 10 ** decimals;
  return Math.abs(Math.round(value * factor) - value * factor) < 1e-9;
}

function validateExecution(raw: unknown): ValidationResult<ExecutionInput> {
  if (!isObject(raw)) return fail("execution must be an object.");
  if (!isUuid(raw.id)) return fail("execution.id must be a UUID.");
  if (!isDate(raw.session_date)) return fail("execution.session_date must be a valid YYYY-MM-DD date.");
  if (!isTimestamp(raw.started_at)) return fail("execution.started_at must be an ISO-8601 date-time with an offset.");
  if (raw.final_prescription_id !== undefined && raw.final_prescription_id !== null && !isUuid(raw.final_prescription_id)) {
    return fail("execution.final_prescription_id must be a UUID or null.");
  }
  if ("decision_id" in raw) return fail("execution.decision_id is derived by the server and must not be sent.");
  const comment = optionalText(raw.comment, MAX_COMMENT_LENGTH);
  if (!comment.ok) return fail(`execution.comment must be a non-empty string of at most ${MAX_COMMENT_LENGTH} characters, or null.`);
  return {
    ok: true,
    value: {
      id: raw.id,
      session_date: raw.session_date,
      started_at: raw.started_at,
      final_prescription_id: (raw.final_prescription_id as string | null | undefined) ?? null,
      comment: comment.value,
    },
  };
}

function validateEvent(raw: unknown, index: number): ValidationResult<ExecutionEventInput> {
  const at = `events[${index}]`;
  if (!isObject(raw)) return fail(`${at} must be an object.`);
  if (!isUuid(raw.id)) return fail(`${at}.id must be a UUID.`);
  if (!isUuid(raw.execution_id)) return fail(`${at}.execution_id must be a UUID.`);
  if (typeof raw.event_type !== "string" || !(EXECUTION_EVENT_TYPES as readonly string[]).includes(raw.event_type)) {
    return fail(`${at}.event_type must be one of ${EXECUTION_EVENT_TYPES.join(", ")}.`);
  }
  if (!isTimestamp(raw.occurred_at)) return fail(`${at}.occurred_at must be an ISO-8601 date-time with an offset.`);
  return {
    ok: true,
    value: { id: raw.id, execution_id: raw.execution_id, event_type: raw.event_type as ExecutionEventType, occurred_at: raw.occurred_at },
  };
}

function validateSet(raw: unknown, index: number): ValidationResult<SetResultInput> {
  const at = `sets[${index}]`;
  if (!isObject(raw)) return fail(`${at} must be an object.`);
  if (!isUuid(raw.id)) return fail(`${at}.id must be a UUID.`);
  if (!isUuid(raw.execution_id)) return fail(`${at}.execution_id must be a UUID.`);
  if ("exercise_id" in raw) return fail(`${at}.exercise_id is copied by the server from the prescription and must not be sent.`);

  const itemId = raw.prescription_item_id ?? null;
  if (itemId !== null && !isUuid(itemId)) return fail(`${at}.prescription_item_id must be a UUID or null.`);
  const other = optionalText(raw.other_exercise_name, MAX_OTHER_EXERCISE_NAME_LENGTH);
  if (!other.ok) return fail(`${at}.other_exercise_name must be a non-empty string of at most ${MAX_OTHER_EXERCISE_NAME_LENGTH} characters, or null.`);
  if ((itemId === null) === (other.value === null)) {
    return fail(`${at} must reference exactly one of prescription_item_id or other_exercise_name.`);
  }

  if (!Number.isInteger(raw.set_number) || (raw.set_number as number) < 1) return fail(`${at}.set_number must be an integer >= 1.`);
  if (typeof raw.done !== "boolean") return fail(`${at}.done must be a boolean.`);
  if (typeof raw.measure_type !== "string" || !(SET_MEASURE_TYPES as readonly string[]).includes(raw.measure_type)) {
    return fail(`${at}.measure_type must be one of ${SET_MEASURE_TYPES.join(", ")}.`);
  }
  const measureType = raw.measure_type as SetMeasureType;
  const measureValue = raw.measure_value ?? null;
  if (measureValue !== null && (!Number.isInteger(measureValue) || (measureValue as number) < 0 || (measureValue as number) > 2147483647)) {
    return fail(`${at}.measure_value must be a non-negative integer or null.`);
  }
  if (measureType === "pass" && measureValue !== null) return fail(`${at}.measure_value must be null for a pass.`);
  if (measureType !== "pass" && measureValue === null && raw.done === true) {
    return fail(`${at}.measure_value is required for a done ${measureType} set.`);
  }

  const load = raw.load_kg ?? null;
  if (load !== null && (typeof load !== "number" || !Number.isFinite(load) || load < 0 || load > 1000 || !hasDecimalsAtMost(load, 2))) {
    return fail(`${at}.load_kg must be a number between 0 and 1000 with at most 2 decimals, or null.`);
  }
  const rpe = raw.rpe_actual ?? null;
  if (rpe !== null && (typeof rpe !== "number" || !Number.isFinite(rpe) || rpe < 1 || rpe > 10 || !hasDecimalsAtMost(rpe, 1))) {
    return fail(`${at}.rpe_actual must be a number between 1 and 10 with at most 1 decimal, or null.`);
  }
  const success = raw.success ?? null;
  if (success !== null && typeof success !== "boolean") return fail(`${at}.success must be a boolean or null.`);
  const comment = optionalText(raw.comment, MAX_COMMENT_LENGTH);
  if (!comment.ok) return fail(`${at}.comment must be a non-empty string of at most ${MAX_COMMENT_LENGTH} characters, or null.`);
  const supersedes = raw.supersedes_id ?? null;
  if (supersedes !== null && !isUuid(supersedes)) return fail(`${at}.supersedes_id must be a UUID or null.`);
  if (supersedes !== null && supersedes === raw.id) return fail(`${at}.supersedes_id must not reference the set itself.`);
  if (!isTimestamp(raw.occurred_at)) return fail(`${at}.occurred_at must be an ISO-8601 date-time with an offset.`);

  return {
    ok: true,
    value: {
      id: raw.id,
      execution_id: raw.execution_id,
      prescription_item_id: itemId as string | null,
      other_exercise_name: other.value,
      set_number: raw.set_number as number,
      done: raw.done,
      measure_type: measureType,
      measure_value: measureValue as number | null,
      load_kg: load as number | null,
      rpe_actual: rpe as number | null,
      success: success as boolean | null,
      comment: comment.value,
      supersedes_id: supersedes as string | null,
      occurred_at: raw.occurred_at,
    },
  };
}

const MAX_INT = 2147483647;

function validateActivity(raw: unknown, index: number): ValidationResult<ActivityResultInput> {
  const at = `activities[${index}]`;
  if (!isObject(raw)) return fail(`${at} must be an object.`);
  if (!isUuid(raw.id)) return fail(`${at}.id must be a UUID.`);
  if (!isUuid(raw.execution_id)) return fail(`${at}.execution_id must be a UUID.`);
  if ("prescription_item_id" in raw || "exercise_id" in raw) return fail(`${at} is not a prescription item: no prescription_item_id or exercise_id.`);
  if (typeof raw.activity_id !== "string" || raw.activity_id.trim().length === 0 || raw.activity_id.length > MAX_ACTIVITY_ID_LENGTH) {
    return fail(`${at}.activity_id must be a non-empty string of at most ${MAX_ACTIVITY_ID_LENGTH} characters.`);
  }
  if (!Number.isInteger(raw.duration_seconds) || (raw.duration_seconds as number) < 1 || (raw.duration_seconds as number) > MAX_INT) {
    return fail(`${at}.duration_seconds must be a positive integer (actual duration in seconds).`);
  }
  const distance = raw.distance_m ?? null;
  if (distance !== null && (!Number.isInteger(distance) || (distance as number) < 0 || (distance as number) > MAX_INT)) {
    return fail(`${at}.distance_m must be a non-negative integer (metres) or null.`);
  }
  const rpe = raw.rpe_actual ?? null;
  if (rpe !== null && (typeof rpe !== "number" || !Number.isFinite(rpe) || rpe < 1 || rpe > 10 || !hasDecimalsAtMost(rpe, 1))) {
    return fail(`${at}.rpe_actual must be a number between 1 and 10 with at most 1 decimal, or null.`);
  }
  const comment = optionalText(raw.comment, MAX_COMMENT_LENGTH);
  if (!comment.ok) return fail(`${at}.comment must be a non-empty string of at most ${MAX_COMMENT_LENGTH} characters, or null.`);
  const supersedes = raw.supersedes_id ?? null;
  if (supersedes !== null && !isUuid(supersedes)) return fail(`${at}.supersedes_id must be a UUID or null.`);
  if (supersedes !== null && supersedes === raw.id) return fail(`${at}.supersedes_id must not reference the result itself.`);
  if (!isTimestamp(raw.occurred_at)) return fail(`${at}.occurred_at must be an ISO-8601 date-time with an offset.`);
  return {
    ok: true,
    value: {
      id: raw.id,
      execution_id: raw.execution_id,
      activity_id: raw.activity_id,
      duration_seconds: raw.duration_seconds as number,
      distance_m: distance as number | null,
      rpe_actual: rpe as number | null,
      comment: comment.value,
      supersedes_id: supersedes as string | null,
      occurred_at: raw.occurred_at,
    },
  };
}

export function validateSessionExecutionBody(raw: unknown): ValidationResult<SessionExecutionBatch> {
  if (!isObject(raw)) return fail("Request body must be a JSON object.");
  const allowedKeys = new Set(["execution", "events", "sets", "activities"]);
  const unknownKey = Object.keys(raw).find((key) => !allowedKeys.has(key));
  if (unknownKey) return fail(`Unknown field "${unknownKey}".`);

  let execution: ExecutionInput | null = null;
  if (raw.execution !== undefined && raw.execution !== null) {
    const result = validateExecution(raw.execution);
    if (!result.ok) return result;
    execution = result.value;
  }

  const rawEvents = raw.events ?? [];
  const rawSets = raw.sets ?? [];
  const rawActivities = raw.activities ?? [];
  if (!Array.isArray(rawEvents)) return fail("events must be an array.");
  if (!Array.isArray(rawSets)) return fail("sets must be an array.");
  if (!Array.isArray(rawActivities)) return fail("activities must be an array.");
  if (rawEvents.length > MAX_BATCH_ITEMS) return fail(`events must contain at most ${MAX_BATCH_ITEMS} items.`);
  if (rawSets.length > MAX_BATCH_ITEMS) return fail(`sets must contain at most ${MAX_BATCH_ITEMS} items.`);
  if (rawActivities.length > MAX_BATCH_ITEMS) return fail(`activities must contain at most ${MAX_BATCH_ITEMS} items.`);
  if (execution === null && rawEvents.length === 0 && rawSets.length === 0 && rawActivities.length === 0) return fail("The batch is empty.");

  const events: ExecutionEventInput[] = [];
  for (const [index, item] of rawEvents.entries()) {
    const result = validateEvent(item, index);
    if (!result.ok) return result;
    events.push(result.value);
  }
  const sets: SetResultInput[] = [];
  for (const [index, item] of rawSets.entries()) {
    const result = validateSet(item, index);
    if (!result.ok) return result;
    sets.push(result.value);
  }
  const activities: ActivityResultInput[] = [];
  for (const [index, item] of rawActivities.entries()) {
    const result = validateActivity(item, index);
    if (!result.ok) return result;
    activities.push(result.value);
  }
  return { ok: true, value: { execution, events, sets, activities } };
}

/** record_session_execution's stable rejection codes → HTTP status. Anything else is unexpected (500). */
export const REJECTION_STATUS: Readonly<Record<string, number>> = {
  invalid_payload: 400,
  execution_not_found: 404,
  prescription_not_found: 404,
  id_conflict: 409,
  active_execution_exists: 409,
  invalid_transition: 409,
  invalid_correction: 409,
  missing_start_event: 422,
  not_executable: 422,
  date_mismatch: 422,
  invalid_item: 422,
  measure_mismatch: 422,
  // UX-11B.2.3 — the prescribed item carries a missing or unknown measure type (fail-closed).
  invalid_prescribed_measure: 422,
  // UX-11A.5c.2 — the final prescription belongs to a decision that is no longer the day's current one.
  final_prescription_not_current: 409,
  // UX-11B.2.5 — activity results (session_activity_results).
  activity_not_allowed_by_prescription: 422,
  activity_result_exists: 409,
  activity_result_required: 422,
  // UX-11B.2.6 — result integrity: frozen results of a terminal execution, bounded ordinal, one original per slot.
  execution_terminal: 409,
  result_slot_out_of_range: 422,
  result_slot_exists: 409,
  // UX-11R.9 — completion and one-main-session-per-day invariants (migration 20261005120000).
  dh_pass_required: 422,
  session_already_completed: 409,
};

/**
 * UX-11R.1 — one structured, PII-free log line per batch for rollout
 * monitoring (Edge logs): the outcome, the stable rejection code, and how
 * many lifecycle events (by type), set results and activity results were
 * newly recorded. No athlete / execution id, no comment, no value. Never
 * blocks the response (built from data already at hand).
 */
export interface ExecutionLogLine {
  source: "session-execution";
  outcome: "recorded" | "rejected";
  code?: string;
  status?: number;
  events?: Partial<Record<ExecutionEventType, number>>;
  sets?: number;
  activities?: number;
  replayed?: number;
}

export function executionLogLine(
  batch: { events: readonly { id: string; event_type: ExecutionEventType }[] },
  outcome: { status: "ok"; inserted: Record<string, unknown>; unchanged: Record<string, unknown> } | { status: "rejected"; code: string }
): ExecutionLogLine {
  if (outcome.status === "rejected") {
    return { source: "session-execution", outcome: "rejected", code: outcome.code, status: REJECTION_STATUS[outcome.code] ?? 500 };
  }
  const ids = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === "string") : []);
  const insertedEvents = new Set(ids(outcome.inserted.events));
  const events: Partial<Record<ExecutionEventType, number>> = {};
  for (const e of batch.events) if (insertedEvents.has(e.id)) events[e.event_type] = (events[e.event_type] ?? 0) + 1;
  const replayed = ["executions", "events", "sets", "activities"].reduce((n, k) => n + ids(outcome.unchanged[k]).length, 0);
  return {
    source: "session-execution",
    outcome: "recorded",
    events,
    sets: ids(outcome.inserted.sets).length,
    activities: ids(outcome.inserted.activities).length,
    replayed,
  };
}

