import { athleteSafeReasoning, hasActiveSafetyRule } from "./safetyPresentation";
import type { DailyPlan } from "./dailyPlanTypes";

// UX-04 — "what your coach took into account", presentation only.
//
// The engine already records, on every rule that changed today's plan, the
// check-in signals that rule actually consumed (`TriggeredRule.signals_used`,
// double-counting guarded engine-side). This module only reads that list and
// words it for a rider. It never re-derives a signal from check-in values,
// never judges a value the engine did not flag ("ton sommeil est bon" is
// never said), and never shows an unknown identifier.

/** Every signal the frozen M1 engine can emit (domains/*.ts, engine/computeDimensions.ts, rules/safety.ts). */
export const SIGNAL_LABELS: Readonly<Record<string, string>> = {
  sleep_deficit: "Nuit trop courte",
  sleep_quality_low: "Sommeil de mauvaise qualité",
  sleep_fragmented: "Nuit hachée",
  energy_low: "Énergie basse",
  stress_high: "Stress élevé",
  motivation_low: "Motivation en baisse",
  leg_fatigue_high: "Fatigue jambes élevée",
  grip_fatigue_high: "Avant-bras fatigués",
  recent_load_very_high: "Charge récente très élevée",
  pain_severity_criterion: "Douleur signalée",
  pain_new_severe: "Douleur signalée",
  suspected_concussion: "Suspicion de commotion",
  unresolved_concussion_flag: "Suspicion de commotion",
  fever_or_illness: "Fièvre ou maladie",
};

/** Which check-in answer a signal comes from — lets Today highlight the matching value. */
export type CheckinField = "sleep" | "energy" | "stress" | "motivation" | "leg_fatigue" | "grip_fatigue";

export const SIGNAL_CHECKIN_FIELD: Readonly<Record<string, CheckinField>> = {
  sleep_deficit: "sleep",
  sleep_quality_low: "sleep",
  sleep_fragmented: "sleep",
  energy_low: "energy",
  stress_high: "stress",
  motivation_low: "motivation",
  leg_fatigue_high: "leg_fatigue",
  grip_fatigue_high: "grip_fatigue",
};

function ownLabel(signal: string): string | null {
  return Object.prototype.hasOwnProperty.call(SIGNAL_LABELS, signal) ? SIGNAL_LABELS[signal]! : null;
}

export interface RetainedSignal {
  signal: string;
  label: string;
}

/**
 * The signals the engine actually used for today's final decision, in the
 * engine's own order, one entry per rider-facing label (two engine signals
 * worded the same, e.g. both pain criteria, are shown once). Source is
 * `decision_reasoning` (the rules that explain the final decision), falling
 * back to `triggered_rules` for a decision persisted before that field.
 */
export function retainedSignals(dailyPlan: DailyPlan): RetainedSignal[] {
  const rules = dailyPlan.decision_reasoning ?? dailyPlan.triggered_rules;
  const seenLabels = new Set<string>();
  const result: RetainedSignal[] = [];
  for (const rule of rules) {
    for (const signal of rule.signals_used ?? []) {
      const label = ownLabel(signal);
      if (!label || seenLabels.has(label)) continue;
      seenLabels.add(label);
      result.push({ signal, label });
    }
  }
  return result;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function detected(signals: RetainedSignal[]): string {
  const list = signals.map((entry) => lowerFirst(entry.label)).join(", ");
  return signals.length > 1 ? `Signaux détectés : ${list}.` : `Signal détecté : ${list}.`;
}

/**
 * "Pourquoi ?" — one rider-facing sentence for today's decision (validated
 * wording, UX-04):
 * - safety (layer A), race protocol (layer B), REST, or no planned session
 *   to compare against → the engine's own sanitized reasoning, unchanged;
 * - KEEP without retained signal → "Rien dans ton check-in ne demande…";
 * - KEEP / MODIFY / REPLACE with retained signals → the signals, then what
 *   NALYNT does about them;
 * - anything else → the engine's sanitized reasoning.
 */
export function coachWhy(dailyPlan: DailyPlan): string {
  const rules = dailyPlan.decision_reasoning ?? dailyPlan.triggered_rules;
  const engineDriven =
    dailyPlan.decision === "REST" ||
    hasActiveSafetyRule(dailyPlan) ||
    rules.some((rule) => rule.layer === "B") ||
    dailyPlan.overrode_race_protocol ||
    dailyPlan.planned_session_before === null;
  if (engineDriven) return athleteSafeReasoning(dailyPlan);

  const signals = retainedSignals(dailyPlan);
  if (dailyPlan.decision === "KEEP") {
    return signals.length === 0
      ? "Rien dans ton check-in ne demande d'adapter ta séance. Tu suis ton plan."
      : `${detected(signals)} NALYNT ajuste la façon de faire, ta séance reste la même.`;
  }
  if (signals.length > 0 && dailyPlan.decision === "MODIFY") {
    return `${detected(signals)} NALYNT ajuste la charge pour préserver ton objectif.`;
  }
  if (signals.length > 0 && dailyPlan.decision === "REPLACE") {
    return `${detected(signals)} NALYNT propose une séance adaptée à ton état.`;
  }
  return athleteSafeReasoning(dailyPlan);
}
