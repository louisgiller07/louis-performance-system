/**
 * Raw PostgREST row → source-domain type mapping. Every mapper here fails
 * loudly (throws {@link InvalidSourceRowError}) on a missing required
 * field, a wrong-typed field, or an unrecognized enum value — an unknown
 * DB enum value is never silently coerced to a fallback, and a malformed
 * row never becomes a partially-fabricated source object. Raw
 * Supabase/PostgREST rows never leak past this module.
 */
import type {
  CompletedSessionSource,
  CompletionStatus,
  ConfidenceLevel,
  DailyCheckinSource,
  DbSessionType,
  DecisionOutcomeHorizon,
  DecisionOutcomeSource,
  DecisionSource,
  HealthFlagSource,
  HealthFlagStatus,
  HealthFlagType,
  PainLocationCode,
  TrainingMode,
} from "../types/sources.js";
import type { PatternEvidenceCurrentEffectiveRow, PatternEvidenceEventType } from "../aggregation/types.js";

export class InvalidSourceRowError extends Error {
  constructor(table: string, reason: string, value: unknown) {
    super(`Invalid ${table} row: ${reason} (${JSON.stringify(value)})`);
    this.name = "InvalidSourceRowError";
  }
}

// ---------------------------------------------------------------------------
// Generic field guards — small, deliberately not a validation framework.
// ---------------------------------------------------------------------------

type RawRow = Record<string, unknown>;

function requireString(table: string, field: string, row: RawRow): string {
  const value = row[field];
  if (typeof value !== "string") {
    throw new InvalidSourceRowError(table, `${field} is missing or not a string`, row);
  }
  return value;
}

function requireBoolean(table: string, field: string, row: RawRow): boolean {
  const value = row[field];
  if (typeof value !== "boolean") {
    throw new InvalidSourceRowError(table, `${field} is missing or not a boolean`, row);
  }
  return value;
}

function requireNumber(table: string, field: string, row: RawRow): number {
  const value = row[field];
  if (typeof value !== "number") {
    throw new InvalidSourceRowError(table, `${field} is missing or not a number`, row);
  }
  return value;
}

function optionalString(table: string, field: string, row: RawRow): string | null {
  const value = row[field];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new InvalidSourceRowError(table, `${field} is present but not a string`, row);
  }
  return value;
}

function optionalNumber(table: string, field: string, row: RawRow): number | null {
  const value = row[field];
  if (value === null || value === undefined) return null;
  if (typeof value !== "number") {
    throw new InvalidSourceRowError(table, `${field} is present but not a number`, row);
  }
  return value;
}

function optionalBoolean(table: string, field: string, row: RawRow): boolean | null {
  const value = row[field];
  if (value === null || value === undefined) return null;
  if (typeof value !== "boolean") {
    throw new InvalidSourceRowError(table, `${field} is present but not a boolean`, row);
  }
  return value;
}

/** JSON object column (jsonb) — required, must actually be an object (never an array/scalar). */
function requireJsonObject(table: string, field: string, row: RawRow): Record<string, unknown> {
  const value = row[field];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidSourceRowError(table, `${field} is missing or not a JSON object`, row);
  }
  return value as Record<string, unknown>;
}

/** JSON object column (jsonb) — nullable. */
function optionalJsonObject(table: string, field: string, row: RawRow): Record<string, unknown> | null {
  const value = row[field];
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidSourceRowError(table, `${field} is present but not a JSON object`, row);
  }
  return value as Record<string, unknown>;
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function requireEnum<T extends string>(table: string, field: string, row: RawRow, allowed: readonly T[]): T {
  const value = row[field];
  if (!isOneOf(value, allowed)) {
    throw new InvalidSourceRowError(table, `${field} is not a recognized value`, row);
  }
  return value;
}

function optionalEnum<T extends string>(table: string, field: string, row: RawRow, allowed: readonly T[]): T | null {
  const value = row[field];
  if (value === null || value === undefined) return null;
  if (!isOneOf(value, allowed)) {
    throw new InvalidSourceRowError(table, `${field} is not a recognized value`, row);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Enum allow-lists — mirrored from src/types/sources.ts, kept local so this
// module fails loudly independent of how the type-level union is spelled.
// ---------------------------------------------------------------------------

const PAIN_LOCATION_CODES: readonly PainLocationCode[] = [
  "lower_back", "upper_back", "neck", "shoulder_L", "shoulder_R", "elbow_L", "elbow_R",
  "wrist_L", "wrist_R", "hand_L", "hand_R", "thumb_L", "thumb_R", "forearm_L", "forearm_R",
  "hip_L", "hip_R", "knee_L", "knee_R", "ankle_L", "ankle_R", "quad_L", "quad_R",
  "hamstring_L", "hamstring_R", "calf_L", "calf_R", "groin", "chest", "abs", "head", "other",
];

const DB_SESSION_TYPES: readonly DbSessionType[] = [
  "STRENGTH_A", "STRENGTH_B", "AEROBIC_BASE", "AEROBIC_INTERVALS", "DH_TECHNICAL",
  "DH_PERFORMANCE", "RECOVERY", "REST", "BIKE_MAINTENANCE", "RACE_PREP",
];

const COMPLETION_STATUSES: readonly CompletionStatus[] = ["done", "partial", "skipped", "replaced"];

const HEALTH_FLAG_TYPES: readonly HealthFlagType[] = [
  "injury_suspect", "concussion_suspect", "illness", "pain_persistent", "other",
];

const HEALTH_FLAG_STATUSES: readonly HealthFlagStatus[] = ["active", "monitoring", "resolved"];

const CONFIDENCE_LEVELS: readonly ConfidenceLevel[] = ["LOW", "MEDIUM", "HIGH"];

const TRAINING_MODES: readonly TrainingMode[] = [
  "RACE_WEEK", "RACE_CLUSTER", "OFF_SEASON_RECOVERY", "OFF_SEASON_DEVELOPMENT",
  "PRE_SEASON", "IN_SEASON", "INJURY_RECOVERY", "OTHER",
];

const DECISION_OUTCOME_HORIZONS: readonly DecisionOutcomeHorizon[] = ["J_PLUS_1", "J_PLUS_3", "J_PLUS_7"];

const PATTERN_EVIDENCE_EVENT_TYPES: readonly PatternEvidenceEventType[] = ["supporting", "contradicting", "neutral"];

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

export function mapDailyCheckinRow(row: RawRow): DailyCheckinSource {
  const table = "daily_checkins";
  return {
    id: requireString(table, "id", row),
    athleteId: requireString(table, "athlete_id", row),
    checkinDate: requireString(table, "checkin_date", row),
    submittedAt: requireString(table, "submitted_at", row),
    sleepHours: optionalNumber(table, "sleep_hours", row),
    sleepQuality: optionalNumber(table, "sleep_quality", row),
    sleepWakeUps: optionalNumber(table, "sleep_wake_ups", row),
    energy: optionalNumber(table, "energy", row),
    legFatigue: optionalNumber(table, "leg_fatigue", row),
    gripFatigue: optionalNumber(table, "grip_fatigue", row),
    motivation: optionalNumber(table, "motivation", row),
    workStress: optionalNumber(table, "work_stress", row),
    pain: requireBoolean(table, "pain", row),
    painIntensity: optionalNumber(table, "pain_intensity", row),
    painNew: optionalBoolean(table, "pain_new", row),
    painLocationCode: optionalEnum(table, "pain_location_code", row, PAIN_LOCATION_CODES),
    painTraumatic: optionalBoolean(table, "pain_traumatic", row),
    painFunctionLoss: optionalBoolean(table, "pain_function_loss", row),
    painGettingWorse: optionalBoolean(table, "pain_getting_worse", row),
    suspectedConcussion: requireBoolean(table, "suspected_concussion", row),
    feverOrIllness: requireBoolean(table, "fever_or_illness", row),
    freeComment: optionalString(table, "free_comment", row),
  };
}

export function mapDecisionRow(row: RawRow): DecisionSource {
  const table = "decisions";
  return {
    id: requireString(table, "id", row),
    athleteId: requireString(table, "athlete_id", row),
    decisionDate: requireString(table, "decision_date", row),
    computedAt: requireString(table, "computed_at", row),
    finalSession: requireEnum(table, "final_session", row, DB_SESSION_TYPES),
    plannedSessionBefore: optionalEnum(table, "planned_session_before", row, DB_SESSION_TYPES),
    activeMode: optionalEnum(table, "active_mode", row, TRAINING_MODES),
    confidenceLevel: optionalEnum(table, "confidence_level", row, CONFIDENCE_LEVELS),
    dailyPlan: optionalJsonObject(table, "daily_plan", row),
    engineVersion: requireString(table, "engine_version", row),
    overriddenByUser: requireBoolean(table, "overridden_by_user", row),
    overrideReason: optionalString(table, "override_reason", row),
    sourceCheckinId: optionalString(table, "source_checkin_id", row),
  };
}

export function mapCompletedSessionRow(row: RawRow): CompletedSessionSource {
  const table = "completed_sessions";
  return {
    id: requireString(table, "id", row),
    athleteId: requireString(table, "athlete_id", row),
    sessionDate: requireString(table, "session_date", row),
    decisionId: optionalString(table, "decision_id", row),
    plannedSessionId: optionalString(table, "planned_session_id", row),
    sessionType: requireEnum(table, "session_type", row, DB_SESSION_TYPES),
    completionStatus: requireEnum(table, "completion_status", row, COMPLETION_STATUSES),
    actualDurationMin: optionalNumber(table, "actual_duration_min", row),
    rpe: optionalNumber(table, "rpe", row),
    sessionLoad: optionalNumber(table, "session_load", row),
    intervention: optionalJsonObject(table, "intervention", row),
    mainContent: optionalJsonObject(table, "main_content", row),
    postLegFatigue: optionalNumber(table, "post_leg_fatigue", row),
    postGripFatigue: optionalNumber(table, "post_grip_fatigue", row),
    newPain: requireBoolean(table, "new_pain", row),
    newPainNote: optionalString(table, "new_pain_note", row),
  };
}

export function mapDecisionOutcomeRow(row: RawRow): DecisionOutcomeSource {
  const table = "decision_outcomes";
  return {
    id: requireString(table, "id", row),
    athleteId: requireString(table, "athlete_id", row),
    decisionId: requireString(table, "decision_id", row),
    horizon: requireEnum(table, "horizon", row, DECISION_OUTCOME_HORIZONS),
    calculatorId: requireString(table, "calculator_id", row),
    calculatorVersion: requireString(table, "calculator_version", row),
    inputSnapshot: requireJsonObject(table, "input_snapshot", row),
    outcomeSignals: requireJsonObject(table, "outcome_signals", row),
    calculatedAt: requireString(table, "calculated_at", row),
    createdAt: requireString(table, "created_at", row),
  };
}

export function mapHealthFlagRow(row: RawRow): HealthFlagSource {
  const table = "health_flags";
  return {
    id: requireString(table, "id", row),
    athleteId: requireString(table, "athlete_id", row),
    flagDate: requireString(table, "flag_date", row),
    flagType: requireEnum(table, "flag_type", row, HEALTH_FLAG_TYPES),
    status: requireEnum(table, "status", row, HEALTH_FLAG_STATUSES),
    description: requireString(table, "description", row),
    bodyLocation: optionalString(table, "body_location", row),
    intensity: optionalNumber(table, "intensity", row),
    professionalConsulted: requireBoolean(table, "professional_consulted", row),
    professionalType: optionalString(table, "professional_type", row),
    resolvedAt: optionalString(table, "resolved_at", row),
    resolutionNote: optionalString(table, "resolution_note", row),
    sourceCheckinId: optionalString(table, "source_checkin_id", row),
    createdAt: requireString(table, "created_at", row),
  };
}

/**
 * M5_006D — maps a `pattern_evidence_current_effective` row (M5_006B view)
 * to its camelCase domain shape. `observed_value` is passed through
 * verbatim as `unknown` — never validated/interpreted here, same
 * "opaque to this layer" discipline as `input_snapshot`/`outcome_signals`
 * above, except this one is never even required to be a JSON object,
 * since aggregation never reads it at all.
 */
export function mapPatternEvidenceCurrentEffectiveRow(row: RawRow): PatternEvidenceCurrentEffectiveRow {
  const table = "pattern_evidence_current_effective";
  return {
    identityId: requireString(table, "identity_id", row),
    athleteId: requireString(table, "athlete_id", row),
    detectorRuleId: requireString(table, "detector_rule_id", row),
    detectorRuleVersion: requireString(table, "detector_rule_version", row),
    evaluationKey: requireString(table, "evaluation_key", row),
    evidenceKey: requireString(table, "evidence_key", row),
    revisionId: requireString(table, "revision_id", row),
    revisionNumber: requireNumber(table, "revision_number", row),
    supersedesId: optionalString(table, "supersedes_id", row),
    eventType: requireEnum(table, "event_type", row, PATTERN_EVIDENCE_EVENT_TYPES),
    eventDate: requireString(table, "event_date", row),
    observedValue: row["observed_value"],
    revisionCreatedAt: requireString(table, "revision_created_at", row),
  };
}
