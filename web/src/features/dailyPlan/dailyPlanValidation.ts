import type { ArbitrationDecision, Confidence, DailyRunResponse, TrainingMode } from "./dailyPlanTypes";

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
];

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

export function isValidDailyRunResponse(data: unknown): data is DailyRunResponse {
  if (!isObject(data)) return false;

  if (typeof data.decisionId !== "string") return false;
  if (data.healthFlagId !== null && typeof data.healthFlagId !== "string") return false;
  if (!isStringArray(data.warnings)) return false;

  if (!isObject(data.dailyPlan)) return false;
  const plan = data.dailyPlan;

  if (!isOneOf(plan.decision, ALLOWED_DECISIONS)) return false;
  if (!isOneOf(plan.confidence, ALLOWED_CONFIDENCE)) return false;
  if (typeof plan.reasoning !== "string") return false;
  if (!isOneOf(plan.active_mode, ALLOWED_TRAINING_MODES)) return false;

  // Every section is property-accessed (`.active`, `.actions`, ...)
  // unconditionally by the renderer — must be real objects/arrays, not
  // just "present if you're lucky".
  if (!isSectionActive(plan.training)) return false;
  if (!isSectionActive(plan.dh_or_technical)) return false;
  if (!isSectionActive(plan.mental)) return false;
  if (!isRecoverySection(plan.recovery)) return false;
  if (!isSectionActive(plan.nutrition)) return false;
  if (!isSectionActive(plan.sleep)) return false;
  if (!isObject(plan.protection) || !isStringArray(plan.protection.do_not_do)) return false;
  if (!isObject(plan.monitoring) || !isStringArray(plan.monitoring.observe)) return false;

  if (!isValidTriggeredRules(plan.triggered_rules)) return false;

  if (plan.planned_session_before !== null && !isValidIntervention(plan.planned_session_before)) return false;
  if (!isValidIntervention(plan.final_session)) return false;

  if (typeof plan.overrode_race_protocol !== "boolean") return false;
  if (typeof plan.engine_version !== "string") return false;

  return true;
}
