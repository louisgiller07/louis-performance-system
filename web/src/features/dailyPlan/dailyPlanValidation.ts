import type { ArbitrationDecision, Confidence, DailyRunResponse, TrainingMode } from "./dailyPlanTypes";

// supabase.functions.invoke<DailyRunResponse>() only gives compile-time
// typing — the actual JSON on the wire is unchecked `unknown` until this
// guard runs. No Zod/new dependency: a plain structural check against the
// real contract in supabase/functions/daily-run/index.ts.
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

export function isValidDailyRunResponse(data: unknown): data is DailyRunResponse {
  if (!data || typeof data !== "object") return false;
  const obj = data as Record<string, unknown>;

  if (typeof obj.decisionId !== "string") return false;
  if (obj.healthFlagId !== null && typeof obj.healthFlagId !== "string") return false;
  if (!Array.isArray(obj.warnings) || !obj.warnings.every((warning) => typeof warning === "string")) return false;

  if (!obj.dailyPlan || typeof obj.dailyPlan !== "object") return false;
  const plan = obj.dailyPlan as Record<string, unknown>;

  if (!isOneOf(plan.decision, ALLOWED_DECISIONS)) return false;
  if (!isOneOf(plan.confidence, ALLOWED_CONFIDENCE)) return false;
  if (typeof plan.reasoning !== "string") return false;
  if (!isOneOf(plan.active_mode, ALLOWED_TRAINING_MODES)) return false;

  return true;
}
