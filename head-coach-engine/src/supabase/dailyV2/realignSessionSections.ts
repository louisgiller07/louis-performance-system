/**
 * P0 adapted-session coherence — when the V2 daily path changes the session
 * AFTER M1 (V2_SYSTEMIC_FLOOR, V2_TODAY_TIME_CONSTRAINT), M1's session-derived
 * sections were still those of the session M1 had chosen: a DH replaced by an
 * active recovery kept « Jour DH » nutrition, the post-DH forearm roll, the DH
 * fatigue / pain monitoring notes and the « pendant le run » mental hint.
 *
 * This realigns them on the NEW effective session with M1's own pure domain
 * functions (read-only use; M1 is unchanged):
 * - recovery and nutrition: recomputed (computeRecoveryDomain /
 *   computeNutritionDomain take only the session, the mode and the event);
 * - technique (dh_or_technical): inactive when the session is no longer DH;
 * - monitoring: M1's DH-only notes removed when the session is no longer DH
 *   (their exact text is obtained from M1's own resolvers);
 * - mental: the DH pre-run hint replaced by M1's base hint for the mental
 *   rule that fired (recomputed by computeMentalDomain without a DH focus).
 * Everything signal-driven (protection, the other monitoring lines, sleep)
 * is kept: the rider's state did not change.
 */
import { computeRecoveryDomain } from "../../domains/recovery.js";
import { computeNutritionDomain } from "../../domains/nutrition.js";
import { computeMentalDomain } from "../../domains/mental.js";
import { isDhFamilyKind, resolveDhFatigueMonitoringNote, resolveDhImmediatePainMonitoringNote } from "../../domains/dhPrescription.js";
import { getModeSoftConstraints } from "../../rules/modes.js";
import { SignalTrace } from "../../engine/signalTrace.js";
import type { DailyPlan, MentalSection, TrainingIntervention } from "../../types/index.js";

type SessionSections = Pick<DailyPlan, "recovery" | "nutrition" | "dh_or_technical" | "monitoring" | "mental">;

const DH_PROBE: TrainingIntervention["kind"] = "DH_TECHNICAL";
const DH_ONLY_NOTES = new Set(
  [resolveDhFatigueMonitoringNote(DH_PROBE, [{ layer: "C", rule_id: "C3.3", detail: "", signals_used: [] }]), resolveDhImmediatePainMonitoringNote(DH_PROBE, true)].filter(
    (note): note is string => note !== undefined
  )
);

/** M1's base mental hint for the mental rule that fired (no DH focus), or undefined when none applies. */
function baseMentalHint(plan: DailyPlan): string | undefined {
  const rules = plan.triggered_rules;
  const red = rules.find((r) => r.rule_id === "MENTAL_RED");
  const amberStress = rules.find((r) => r.rule_id === "MENTAL_AMBER_STRESS");
  const amberMotivation = rules.find((r) => r.rule_id === "MENTAL_AMBER_MOTIVATION");
  const source = red ?? amberStress ?? amberMotivation;
  if (!source) return undefined;
  const signal = (source.signals_used ?? [])[0] ?? (amberMotivation ? "motivation_low" : "stress_high");
  const trace = new SignalTrace();
  if (red) trace.consume(signal, "MENTAL_RED");
  const level = red ? "RED" : "AMBER";
  return computeMentalDomain({ mentalDimension: { level, raw_signals: [signal] } as never, signalTrace: trace }).mental.action_hint;
}

export function realignSessionSections(plan: DailyPlan, session: TrainingIntervention): SessionSections {
  const stillDh = isDhFamilyKind(session.kind);
  const mental: MentalSection =
    !stillDh && plan.mental.action_hint !== undefined && plan.mental.action_hint.startsWith("Avant de partir, fais quelques respirations lentes puis rappelle-toi ta priorité")
      ? (() => {
          const hint = baseMentalHint(plan);
          const { action_hint: _dh, ...rest } = plan.mental;
          const section: MentalSection = hint !== undefined ? { ...rest, action_hint: hint } : rest;
          return { ...section, active: section.focus !== undefined || section.action_hint !== undefined };
        })()
      : plan.mental;
  return {
    recovery: computeRecoveryDomain({ finalSession: session, modeConstraints: getModeSoftConstraints(plan.active_mode), eventContext: plan.event_context }),
    nutrition: computeNutritionDomain({ finalSession: session, activeMode: plan.active_mode, eventContext: plan.event_context }),
    dh_or_technical: stillDh ? plan.dh_or_technical : { active: false },
    monitoring: stillDh ? plan.monitoring : { ...plan.monitoring, observe: plan.monitoring.observe.filter((note) => !DH_ONLY_NOTES.has(note)) },
    mental,
  };
}
