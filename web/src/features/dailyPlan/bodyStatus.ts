// P0-SAFE (HPM 2026-10-12) — "État du corps", one reading for Today, the readiness card and History.
// Was: "Signal actif" only when a health signal was CREATED by this run, "Prêt" otherwise — so a
// severe pain kept as an adapted session, or a day ruled by a signal still open from a previous day,
// read "Prêt". Now derived only from what the server persisted on the decision (never a rule
// re-evaluated in the browser):
//   signal — a health signal created or any Safety-layer rule (A1–A7) ruled the day;
//   watch  — a pain was declared and adapted for (PAIN_NON_SAFETY), read "Douleur signalée", never "ready";
//   ready  — nothing of the kind.
import type { DailyPlan } from "./dailyPlanTypes";

export type BodyStatus = "signal" | "watch" | "ready";

export const BODY_STATUS_LABELS: Record<BodyStatus, string> = {
  signal: "Signal actif",
  watch: "Douleur signalée",
  ready: "Prêt",
};

export const BODY_STATUS_TONE: Record<BodyStatus, string> = {
  signal: "text-red-400",
  watch: "text-amber-300",
  ready: "text-gold",
};

export function bodyStatusOf(dailyPlan: Pick<DailyPlan, "triggered_rules" | "health_flag_to_create">, healthFlagId: string | null = null): BodyStatus {
  if (healthFlagId !== null || dailyPlan.health_flag_to_create !== undefined) return "signal";
  if (dailyPlan.triggered_rules.some((rule) => rule.layer === "A")) return "signal";
  if (dailyPlan.triggered_rules.some((rule) => rule.rule_id === "PAIN_NON_SAFETY")) return "watch";
  return "ready";
}

/** The sentence under "Attention santé": the signal created today, else the Safety rule that ruled the day. */
export function healthSignalReasonOf(dailyPlan: Pick<DailyPlan, "triggered_rules" | "health_flag_to_create">): string | undefined {
  return dailyPlan.health_flag_to_create?.reason ?? dailyPlan.triggered_rules.find((rule) => rule.layer === "A" && (rule.rule_id === "A6" || rule.rule_id === "A7"))?.detail;
}
