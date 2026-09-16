import type {
  ArbitrationDecision,
  Confidence,
  DailyPlan,
  DailyRunResponse,
  HealthFlagType,
  RecentRecoveryCompletionStatus,
  TrainingMode,
} from "./dailyPlanTypes";

// supabase.functions.invoke<DailyRunResponse>() only gives compile-time
// typing — the actual JSON on the wire is unchecked `unknown` until this
// guard runs. No Zod/new dependency: a plain structural check against the
// real contract in supabase/functions/daily-run/index.ts. Deep-validates
// only what the renderer actually property-accesses on non-optional paths
// (a real crash risk) — optional leaf fields (focus, notes, cue, ...) are
// rendered defensively in JSX and don't need their own check here.
const ALLOWED_DECISIONS: readonly ArbitrationDecision[] = ["KEEP", "MODIFY", "REPLACE", "REST"];
const ALLOWED_CONFIDENCE: readonly Confidence[] = ["LOW", "MEDIUM", "HIGH"];
const ALLOWED_TRAINING_MODES: readonly TrainingMode[] = [
  "RACE_WEEK",
  "RACE_CLUSTER",
  "OFF_SEASON_RECOVERY",
  "OFF_SEASON_DEVELOPMENT",
  "PRE_SEASON",
  "IN_SEASON",
  "INJURY_RECOVERY",
  "OTHER",
  "UNSPECIFIED",
];
const ALLOWED_HEALTH_FLAG_TYPES: readonly HealthFlagType[] = ["concussion_suspect", "injury_suspect", "illness", "pain_persistent"];
const ALLOWED_RECENT_RECOVERY_STATUSES: readonly RecentRecoveryCompletionStatus[] = ["partial", "replaced", "skipped"];
const ALLOWED_TECHNICAL_OUTCOMES: readonly ("yes" | "partial" | "no")[] = ["yes", "partial", "no"];

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isSectionActive(value: unknown): value is { active: boolean } {
  return isObject(value) && typeof value.active === "boolean";
}

function isRecoverySection(value: unknown): value is { active: boolean; actions: string[] } {
  return isObject(value) && typeof value.active === "boolean" && isStringArray(value.actions);
}

function isValidIntervention(value: unknown): boolean {
  return isObject(value) && typeof value.kind === "string";
}

function isValidTriggeredRules(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.every(
    (rule) => isObject(rule) && typeof rule.layer === "string" && typeof rule.rule_id === "string" && typeof rule.detail === "string"
  );
}

/**
 * V0.3.012 — same "never survive as present just because it's not
 * undefined" discipline as the other optional fields below: this is what
 * gates DailyPlanView's "Pourquoi cette décision ?" panel reading the
 * filtered decision-reasoning list instead of falling back to the full
 * (unfiltered) triggered_rules, so a malformed value must fall back to
 * legacy behavior, never be rendered half-trusted.
 */
function isValidDecisionReasoning(value: unknown): boolean {
  if (value === undefined) return true;
  return isValidTriggeredRules(value);
}

/**
 * health_flag_to_create is what both DailyPlanView (hasHealthSignal) and
 * /history's HistoryDetail treat as the one legitimate source of a health
 * banner — so an untrusted or malformed value here must never survive as
 * "present" (`!== undefined`) just because it happens to not be undefined.
 * `{"health_flag_to_create": null}` or `"A1"` must be rejected outright,
 * not silently read as "no signal" or, worse, misrendered as one.
 */
function isValidHealthFlagToCreate(value: unknown): boolean {
  if (value === undefined) return true;
  return isObject(value) && isOneOf(value.type, ALLOWED_HEALTH_FLAG_TYPES) && typeof value.reason === "string";
}

/**
 * V0.3_008A — same "never survive as present just because it's not
 * undefined" discipline as isValidHealthFlagToCreate above: this is what
 * gates DailyPlanView rendering a factual recovery-context card, so a
 * malformed value must degrade the whole plan to the legacy fallback, never
 * be rendered half-trusted.
 */
function isValidRecentRecoveryContext(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isObject(value)) return false;
  return (
    typeof value.session_date === "string" &&
    isOneOf(value.completion_status, ALLOWED_RECENT_RECOVERY_STATUSES) &&
    value.change_reason === "fatigue_control" &&
    (value.post_leg_fatigue === null || typeof value.post_leg_fatigue === "number") &&
    (value.post_grip_fatigue === null || typeof value.post_grip_fatigue === "number")
  );
}

/**
 * V0.3_008B — same "never survive as present just because it's not
 * undefined" discipline as isValidRecentRecoveryContext above: this is what
 * gates DailyPlanView rendering the distinct "Tâche précédente" sub-block,
 * so a malformed value must degrade to no historical block, never be
 * rendered half-trusted (e.g. an invalid `technical_outcome` used as a
 * label lookup key).
 */
function isValidPriorTaskReference(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isObject(value)) return false;
  return (
    typeof value.source_decision_id === "string" &&
    typeof value.session_date === "string" &&
    typeof value.kind === "string" &&
    typeof value.execution_task === "string" &&
    isOneOf(value.technical_outcome, ALLOWED_TECHNICAL_OUTCOMES)
  );
}

/** V0.3_008B — dh_or_technical additionally gates its optional `prior_task_reference` sub-block, unlike focus/execution_task/load_guidance/spot_hint (plain optional leaf strings, rendered defensively in JSX). */
function isValidDhTechnicalSection(value: unknown): boolean {
  if (!isSectionActive(value)) return false;
  return isValidPriorTaskReference((value as { prior_task_reference?: unknown }).prior_task_reference);
}

/**
 * Validates a bare DailyPlan object — the same shape whether it just came
 * back from daily-run (nested in a DailyRunResponse) or was read back from
 * decisions.daily_plan for /history (M4_006). A historical row's JSON may
 * predate the current DailyPlan contract (engine_version drift) — this
 * guard is what lets a caller fall back to a degraded summary for that one
 * row instead of crashing the whole page.
 */
export function isValidDailyPlan(plan: unknown): plan is DailyPlan {
  if (!isObject(plan)) return false;

  if (!isOneOf(plan.decision, ALLOWED_DECISIONS)) return false;
  if (!isOneOf(plan.confidence, ALLOWED_CONFIDENCE)) return false;
  if (typeof plan.reasoning !== "string") return false;
  if (!isOneOf(plan.active_mode, ALLOWED_TRAINING_MODES)) return false;

  // Every section is property-accessed (`.active`, `.actions`, ...)
  // unconditionally by the renderer — must be real objects/arrays, not
  // just "present if you're lucky".
  if (!isSectionActive(plan.training)) return false;
  if (!isValidDhTechnicalSection(plan.dh_or_technical)) return false;
  if (!isSectionActive(plan.mental)) return false;
  if (!isRecoverySection(plan.recovery)) return false;
  if (!isSectionActive(plan.nutrition)) return false;
  if (!isSectionActive(plan.sleep)) return false;
  if (!isObject(plan.protection) || !isStringArray(plan.protection.do_not_do)) return false;
  if (!isObject(plan.monitoring) || !isStringArray(plan.monitoring.observe)) return false;

  if (!isValidTriggeredRules(plan.triggered_rules)) return false;
  if (!isValidDecisionReasoning(plan.decision_reasoning)) return false;
  if (!isValidHealthFlagToCreate(plan.health_flag_to_create)) return false;
  if (!isValidRecentRecoveryContext(plan.recent_recovery_context)) return false;

  if (plan.planned_session_before !== null && !isValidIntervention(plan.planned_session_before)) return false;
  if (!isValidIntervention(plan.final_session)) return false;

  if (typeof plan.overrode_race_protocol !== "boolean") return false;
  if (typeof plan.engine_version !== "string") return false;

  return true;
}

export function isValidDailyRunResponse(data: unknown): data is DailyRunResponse {
  if (!isObject(data)) return false;

  if (typeof data.decisionId !== "string") return false;
  if (data.healthFlagId !== null && typeof data.healthFlagId !== "string") return false;
  if (!isStringArray(data.warnings)) return false;

  return isValidDailyPlan(data.dailyPlan);
}
