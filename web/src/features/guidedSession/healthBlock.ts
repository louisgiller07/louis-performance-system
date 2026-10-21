// P0-3 (HPM 2026-10-13) — why the rider's open guided session cannot go on, read only from what the server
// persisted (open health signals, the day's latest decision and its currency). Mirrors the server's
// execution_health_block (migration 20261013160000), which stays the authority: record_session_execution refuses
// `resumed`, new results and completion whatever the browser shows.
//   health_suspended           — an open follow-up health signal (injury_suspect, illness, pain_persistent), an open
//                                concussion signal for ANY session (SPORT-SAFE-02 A5-P0; was DH only), or the day's
//                                latest decision a REST ruled by the Safety layer. An ordinary REST is not a suspension.
//   daily_decision_not_current — the day's latest decision no longer matches the check-in: the analysis must run again.
import { isHealthSuspension } from "../dailyPlan/bodyStatus";
import type { DailyPlan } from "../dailyPlan/dailyPlanTypes";

export type HealthBlock = "health_suspended" | "daily_decision_not_current";

const FOLLOW_UP_FLAG_TYPES: ReadonlySet<string> = new Set(["injury_suspect", "illness", "pain_persistent"]);

export interface HealthBlockInput {
  /** Types of the athlete's open (active / monitoring) health signals. */
  openFlagTypes: readonly string[];
  /** Family of the execution's own final prescription (e.g. dh_technical), when known. No rule narrows on it since SPORT-SAFE-02 A5-P0. */
  family: string | null;
  /** The day's latest decision and whether it still matches its inputs; null when the day has none. */
  latestDecision: { dailyPlan: Pick<DailyPlan, "decision"> & Partial<Pick<DailyPlan, "triggered_rules">>; isCurrent: boolean } | null;
}

export function healthBlockOf({ openFlagTypes, latestDecision }: HealthBlockInput): HealthBlock | null {
  if (openFlagTypes.some((type) => FOLLOW_UP_FLAG_TYPES.has(type))) return "health_suspended";
  if (openFlagTypes.includes("concussion_suspect")) return "health_suspended";
  if (latestDecision && isHealthSuspension(latestDecision.dailyPlan)) return "health_suspended";
  if (latestDecision && !latestDecision.isCurrent) return "daily_decision_not_current";
  return null;
}
