// P0-SAFE (HPM 2026-10-12) — "État du corps", one reading for Today, the readiness card and History.
// Was: "Signal actif" only when a health signal was CREATED by this run, "Prêt" otherwise — so a
// severe pain kept as an adapted session, or a day ruled by a signal still open from a previous day,
// read "Prêt". Now derived only from what the server persisted on the decision (never a rule
// re-evaluated in the browser):
//   signal — a health signal created or any Safety-layer rule (A1–A7) ruled the day;
//   watch  — a pain was declared and adapted for (PAIN_NON_SAFETY), read "Douleur signalée", never "ready";
//   ready  — nothing of the kind.
// SPORT-SAFE-RELEASE-01 (HPM 2026-10-19) — « ready » means NO HEALTH SIGNAL (no Safety rule, no declared pain), never
// fitness or readiness to train: fatigue is shown elsewhere (« Ce que ton coach a retenu », « Ton état du jour ») and a
// fatigue day still reads « ready » here. Its label says exactly that, never « Prêt » (presentation only).
import type { DailyPlan } from "./dailyPlanTypes";

export type BodyStatus = "signal" | "watch" | "ready";

export const BODY_STATUS_LABELS: Record<BodyStatus, string> = {
  signal: "Signal actif",
  watch: "Douleur signalée",
  ready: "Aucun signal de santé",
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

/**
 * Safety rules whose REST reads as a suspension of NALYNT's proposals: A6, A7 (P0-SAFE), A5 (open concussion
 * follow-up) and A1 (concussion suspicion declared today) — SPORT-SAFE-02 A5-P0, candidate. A historical A5 (before
 * SPORT-SAFE-02) was never a REST: never matched here.
 */
const SUSPENSION_RULE_IDS: ReadonlySet<string> = new Set(["A1", "A5", "A6", "A7"]);

/** The sentence under "Attention santé": the signal created today, else the Safety rule that ruled the day. */
export function healthSignalReasonOf(dailyPlan: Pick<DailyPlan, "triggered_rules" | "health_flag_to_create"> & Partial<Pick<DailyPlan, "decision">>): string | undefined {
  return (
    dailyPlan.health_flag_to_create?.reason ??
    dailyPlan.triggered_rules.find((rule) => rule.layer === "A" && (rule.rule_id === "A6" || rule.rule_id === "A7" || (rule.rule_id === "A5" && dailyPlan.decision === "REST")))?.detail
  );
}

/**
 * P0-SAFE (HPM 2026-10-12) — a day ruled by A6 (severe pain) or A7 (open health signal) reads as a
 * suspension of NALYNT's training proposals, never as a medical statement imposing absolute rest.
 * SPORT-SAFE-02 (candidate): A5 (open concussion follow-up) and A1 (suspicion declared today) too. A2–A4 keep their
 * own "Repos" wording.
 */
export const COACHING_SUSPENDED_TITLE = "Coaching suspendu";
export const COACHING_SUSPENDED_STATUS = "NALYNT suspend ses propositions d'entraînement";

export function isCoachingSuspended(dailyPlan: Pick<DailyPlan, "decision"> & Partial<Pick<DailyPlan, "triggered_rules">>): boolean {
  return dailyPlan.decision === "REST" && (dailyPlan.triggered_rules ?? []).some((rule) => rule.layer === "A" && SUSPENSION_RULE_IDS.has(rule.rule_id));
}

/**
 * P0-3 (HPM 2026-10-13) — a REST ruled by ANY Safety-layer rule (A1–A4, A6, A7): no training action may go on in
 * a guided session (same rule as the server's execution_health_block). Wider than isCoachingSuspended, which
 * only chooses the "Coaching suspendu" wording; an ordinary REST (race protocol, planned rest day) is not one.
 */
export function isHealthSuspension(dailyPlan: Pick<DailyPlan, "decision"> & Partial<Pick<DailyPlan, "triggered_rules">>): boolean {
  return dailyPlan.decision === "REST" && (dailyPlan.triggered_rules ?? []).some((rule) => rule.layer === "A");
}
