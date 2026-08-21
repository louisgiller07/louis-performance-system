/**
 * Pure validation for PUT /functions/v1/completed-session's request body
 * (and GET's `date` query parameter). Zero I/O, zero Deno-specific APIs,
 * zero npm:/jsr: imports — deliberately portable plain TypeScript so it can
 * be unit-tested with a plain Node/vitest runner (see tests/validation.test.ts)
 * as well as imported by the real Deno Edge handler (index.ts).
 *
 * Mirrors the frozen persist_completed_session RPC contract
 * (supabase/migrations/20260819210000_persist_completed_session_rpc.sql)
 * as closely as the M5_003 client-facing API allows — see index.ts for the
 * one deliberate gap (`free_notes`, not part of this API surface at all).
 */

export const SESSION_TYPES = [
  "STRENGTH_A",
  "STRENGTH_B",
  "AEROBIC_BASE",
  "AEROBIC_INTERVALS",
  "DH_TECHNICAL",
  "DH_PERFORMANCE",
  "RECOVERY",
  "REST",
  "BIKE_MAINTENANCE",
  "RACE_PREP",
] as const;
export type SessionType = (typeof SESSION_TYPES)[number];

export const COMPLETION_STATUSES = ["done", "partial", "skipped", "replaced"] as const;
export type CompletionStatus = (typeof COMPLETION_STATUSES)[number];

export interface ValidatedCompletedSessionBody {
  session_date: string;
  decision_id: string | null;
  session_type: SessionType;
  completion_status: CompletionStatus;
  actual_duration_min: number | null;
  rpe: number | null;
  post_leg_fatigue: number | null;
  post_grip_fatigue: number | null;
  new_pain: boolean;
  new_pain_note: string | null;
  intervention: Record<string, unknown> | null;
  main_content: Record<string, unknown> | null;
}

export interface ValidationError {
  code: string;
  message: string;
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: ValidationError };

// The exact, closed set of keys the M5_003 PUT body accepts — every one
// required-present (nullable keys included). Deliberately NOT the RPC's
// own 13-key set: `free_notes` isn't part of this API surface (see
// index.ts) — sending it here is an unknown_field, same as any typo.
const CANONICAL_KEYS = [
  "session_date",
  "decision_id",
  "session_type",
  "completion_status",
  "actual_duration_min",
  "rpe",
  "post_leg_fatigue",
  "post_grip_fatigue",
  "new_pain",
  "new_pain_note",
  "intervention",
  "main_content",
] as const;

// Checked BEFORE the generic unknown-field classification, so these get
// the intentional forbidden_field code and message rather than being
// lumped in with an ordinary typo.
const FORBIDDEN_KEYS = ["athlete_id", "session_load", "planned_session_id", "id", "created_at", "updated_at", "submitted_at"] as const;

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Round-trips through Date.UTC to reject roll-over dates (e.g. 2026-02-30 would silently become 2026-03-02 if we trusted the constructor alone). */
export function isValidCalendarDate(value: string): boolean {
  if (!DATE_FORMAT.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function err<T>(code: string, message: string): ValidationResult<T> {
  return { ok: false, error: { code, message } };
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

interface NumericFields {
  actual_duration_min: number | null;
  rpe: number | null;
  post_leg_fatigue: number | null;
  post_grip_fatigue: number | null;
}

/** Shared by the skipped and REST branches below: both require duration/rpe null, fatigue null-or-0..10. */
function validateNullTrainingLoad(
  legFatigue: unknown,
  gripFatigue: unknown
): ValidationResult<Pick<NumericFields, "post_leg_fatigue" | "post_grip_fatigue">> {
  if (legFatigue !== null && !isIntegerInRange(legFatigue, 0, 10)) {
    return err("invalid_range", "post_leg_fatigue must be null or an integer between 0 and 10.");
  }
  if (gripFatigue !== null && !isIntegerInRange(gripFatigue, 0, 10)) {
    return err("invalid_range", "post_grip_fatigue must be null or an integer between 0 and 10.");
  }
  return {
    ok: true,
    value: {
      post_leg_fatigue: (legFatigue as number | null) ?? null,
      post_grip_fatigue: (gripFatigue as number | null) ?? null,
    },
  };
}

/**
 * Section 6 of the M5_003 spec, plus the REST correction from the final
 * review: `skipped` always requires actual_duration_min/rpe null
 * (fatigue null-or-0..10), regardless of session_type. `session_type ===
 * "REST"` gets the same null-training-load treatment for `done` and
 * `replaced` (a rest day has no duration/RPE to invent — the frozen
 * M5_001A DB/RPC contract already allows these null) — REST is
 * deliberately never generalized to other session types here.
 * `session_type === "REST"` with `completion_status === "partial"` is
 * rejected outright: "partial rest" is not a meaningful M5 state. Every
 * other (session_type, completion_status) combination requires all four
 * numeric fields non-null and in range. `invalid_body_for_status` covers a
 * wrong-nullability violation (field present when it must be null, or vice
 * versa, or an outright invalid combination); `invalid_range` covers a
 * present field whose value is the wrong type or out of range.
 */
function validateStatusDependentNumbers(
  status: CompletionStatus,
  sessionType: SessionType,
  body: Record<string, unknown>
): ValidationResult<NumericFields> {
  const duration = body.actual_duration_min;
  const rpe = body.rpe;
  const legFatigue = body.post_leg_fatigue;
  const gripFatigue = body.post_grip_fatigue;

  if (status === "skipped") {
    if (duration !== null) {
      return err("invalid_body_for_status", "actual_duration_min must be null when completion_status is skipped.");
    }
    if (rpe !== null) {
      return err("invalid_body_for_status", "rpe must be null when completion_status is skipped.");
    }
    const fatigue = validateNullTrainingLoad(legFatigue, gripFatigue);
    if (!fatigue.ok) return fatigue;
    return { ok: true, value: { actual_duration_min: null, rpe: null, ...fatigue.value } };
  }

  if (sessionType === "REST") {
    if (status === "partial") {
      return err("invalid_body_for_status", "session_type REST is not valid with completion_status partial.");
    }
    // done | replaced
    if (duration !== null) {
      return err("invalid_body_for_status", "actual_duration_min must be null when session_type is REST.");
    }
    if (rpe !== null) {
      return err("invalid_body_for_status", "rpe must be null when session_type is REST.");
    }
    const fatigue = validateNullTrainingLoad(legFatigue, gripFatigue);
    if (!fatigue.ok) return fatigue;
    return { ok: true, value: { actual_duration_min: null, rpe: null, ...fatigue.value } };
  }

  // done | partial | replaced, session_type !== REST
  if (duration === null) {
    return err("invalid_body_for_status", "actual_duration_min is required for this completion_status (must not be null).");
  }
  if (!isPositiveInteger(duration)) {
    return err("invalid_range", "actual_duration_min must be a positive integer (minutes).");
  }
  if (rpe === null) {
    return err("invalid_body_for_status", "rpe is required for this completion_status (must not be null).");
  }
  if (!isIntegerInRange(rpe, 0, 10)) {
    return err("invalid_range", "rpe must be an integer between 0 and 10.");
  }
  if (legFatigue === null) {
    return err("invalid_body_for_status", "post_leg_fatigue is required for this completion_status (must not be null).");
  }
  if (!isIntegerInRange(legFatigue, 0, 10)) {
    return err("invalid_range", "post_leg_fatigue must be an integer between 0 and 10.");
  }
  if (gripFatigue === null) {
    return err("invalid_body_for_status", "post_grip_fatigue is required for this completion_status (must not be null).");
  }
  if (!isIntegerInRange(gripFatigue, 0, 10)) {
    return err("invalid_range", "post_grip_fatigue must be an integer between 0 and 10.");
  }

  return { ok: true, value: { actual_duration_min: duration, rpe, post_leg_fatigue: legFatigue, post_grip_fatigue: gripFatigue } };
}

interface PainFields {
  new_pain: boolean;
  new_pain_note: string | null;
}

/** Section 7: new_pain is always required; new_pain_note is required (trimmed, 1..500 chars) iff new_pain is true, and must be null iff new_pain is false. */
function validatePainShape(body: Record<string, unknown>): ValidationResult<PainFields> {
  const newPain = body.new_pain;
  if (typeof newPain !== "boolean") {
    return err("invalid_pain_shape", "new_pain is required and must be a boolean.");
  }

  const noteRaw = body.new_pain_note;
  if (newPain) {
    if (typeof noteRaw !== "string") {
      return err("invalid_pain_shape", "new_pain_note is required (a non-empty string) when new_pain is true.");
    }
    const trimmed = noteRaw.trim();
    if (trimmed.length < 1 || trimmed.length > 500) {
      return err("invalid_pain_shape", "new_pain_note must be a trimmed, non-empty string of at most 500 characters when new_pain is true.");
    }
    return { ok: true, value: { new_pain: true, new_pain_note: trimmed } };
  }

  if (noteRaw !== null) {
    return err("invalid_pain_shape", "new_pain_note must be null when new_pain is false.");
  }
  return { ok: true, value: { new_pain: false, new_pain_note: null } };
}

export function validateCompletedSessionBody(rawBody: unknown): ValidationResult<ValidatedCompletedSessionBody> {
  if (!isPlainObject(rawBody)) {
    return err("invalid_body", "Request body must be a JSON object.");
  }
  const body = rawBody;
  const bodyKeys = Object.keys(body);

  const forbiddenPresent = bodyKeys.filter((k) => (FORBIDDEN_KEYS as readonly string[]).includes(k));
  if (forbiddenPresent.length > 0) {
    return err("forbidden_field", `Field${forbiddenPresent.length === 1 ? "" : "s"} not accepted: ${forbiddenPresent.join(", ")}.`);
  }

  const unknown = bodyKeys.filter((k) => !(CANONICAL_KEYS as readonly string[]).includes(k));
  if (unknown.length > 0) {
    return err("unknown_field", `Unknown field${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}.`);
  }

  const missing = CANONICAL_KEYS.filter((k) => !Object.prototype.hasOwnProperty.call(body, k));
  if (missing.length > 0) {
    return err("invalid_body", `Missing required field${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`);
  }

  const sessionDate = body.session_date;
  if (typeof sessionDate !== "string" || !isValidCalendarDate(sessionDate)) {
    return err("invalid_date_format", "session_date is required and must be a valid calendar date in YYYY-MM-DD format.");
  }

  const decisionIdRaw = body.decision_id;
  if (decisionIdRaw !== null && (typeof decisionIdRaw !== "string" || !UUID_FORMAT.test(decisionIdRaw))) {
    return err("invalid_body", "decision_id must be a UUID string or null.");
  }

  const sessionTypeRaw = body.session_type;
  if (typeof sessionTypeRaw !== "string" || !(SESSION_TYPES as readonly string[]).includes(sessionTypeRaw)) {
    return err("invalid_enum", `session_type must be one of: ${SESSION_TYPES.join(", ")}.`);
  }

  const statusRaw = body.completion_status;
  if (typeof statusRaw !== "string" || !(COMPLETION_STATUSES as readonly string[]).includes(statusRaw)) {
    return err("invalid_enum", `completion_status must be one of: ${COMPLETION_STATUSES.join(", ")}.`);
  }
  const completionStatus = statusRaw as CompletionStatus;

  if (body.intervention !== null && !isPlainObject(body.intervention)) {
    return err("invalid_body", "intervention must be a JSON object or null.");
  }
  if (body.main_content !== null && !isPlainObject(body.main_content)) {
    return err("invalid_body", "main_content must be a JSON object or null.");
  }

  const numericResult = validateStatusDependentNumbers(completionStatus, sessionTypeRaw as SessionType, body);
  if (!numericResult.ok) return numericResult;

  const painResult = validatePainShape(body);
  if (!painResult.ok) return painResult;

  return {
    ok: true,
    value: {
      session_date: sessionDate,
      decision_id: decisionIdRaw as string | null,
      session_type: sessionTypeRaw as SessionType,
      completion_status: completionStatus,
      actual_duration_min: numericResult.value.actual_duration_min,
      rpe: numericResult.value.rpe,
      post_leg_fatigue: numericResult.value.post_leg_fatigue,
      post_grip_fatigue: numericResult.value.post_grip_fatigue,
      new_pain: painResult.value.new_pain,
      new_pain_note: painResult.value.new_pain_note,
      intervention: (body.intervention as Record<string, unknown> | null) ?? null,
      main_content: (body.main_content as Record<string, unknown> | null) ?? null,
    },
  };
}

/** GET's `?date=` query parameter — absent is a distinct code (missing_date) from malformed (invalid_date_format). */
export function validateDateParam(value: string | null): ValidationResult<string> {
  if (value === null || value === "") {
    return err("missing_date", "The date query parameter is required.");
  }
  if (!isValidCalendarDate(value)) {
    return err("invalid_date_format", "date must be a valid calendar date in YYYY-MM-DD format.");
  }
  return { ok: true, value };
}
