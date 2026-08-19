import { isValidDailyPlan } from "../dailyPlan/dailyPlanValidation";
import type { DailyPlan } from "../dailyPlan/dailyPlanTypes";
import type { DecisionHistoryRow } from "./historyTypes";

export type DecisionSummary = { valid: true; dailyPlan: DailyPlan } | { valid: false };

/**
 * A stored decisions.daily_plan JSONB is runtime-unknown — an older row
 * may predate the current DailyPlan contract (engine_version drift). This
 * never re-derives a shape; it only decides whether the real, persisted
 * JSON is trustworthy enough for rich rendering, or must fall back to a
 * degraded summary that shows only what's safely available on the row
 * itself (decisionDate, createdAt, finalSessionDb).
 */
export function summarizeDecision(row: DecisionHistoryRow): DecisionSummary {
  if (isValidDailyPlan(row.dailyPlan)) {
    return { valid: true, dailyPlan: row.dailyPlan };
  }
  return { valid: false };
}
