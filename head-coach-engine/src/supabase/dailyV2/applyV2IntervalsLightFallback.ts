/**
 * PHYS-02.1 — the intervals LIGHT fallback (V2 daily path only, after the
 * reconciliation; M1 itself is unchanged). ADR PHYS-02.1.
 *
 * When M1 MODIFIES an intervals session down to LIGHT, no lighter intervals
 * session exists (ADR UX-11A.5a.3 §5): the reconciliation builds the
 * catalogue base endurance session at the LIGHT dose instead (rule
 * `v2.modify.intervals_light_to_base`). This step makes the persisted
 * decision say so, as A07 requires one effective session on every screen:
 * - the decision stays M1's (MODIFY) and so does the dose (LIGHT); only the
 *   session kind becomes AEROBIC_BASE (its duration is then A07's);
 * - trace: rule `V2_INTERVALS_LIGHT_FALLBACK` (layer ARBITRATION) in
 *   `triggered_rules` with M1's session and the reason, also in
 *   `decision_reasoning` with a plain athlete-facing sentence appended to
 *   M1's own reasons; `training.objective` carries that sentence;
 * - no signal is consumed: the LIGHT dose is M1's, already traced by the
 *   rules that decided it.
 * When the fallback was withheld for today's pain
 * (`intervals_fallback_pain_not_cleared`), the decision is kept as M1's and
 * only the trace is added (no session, the reason and the zone category).
 * Any other result (REST, blocked, another rule, an A10 adaptation) is
 * returned as is: never a session out of a rest day or a health stop.
 */
import { joinDecisionReasoning } from "../../engine/reasoningBuilder.js";
import type { DailyPlan, TrainingIntervention, TriggeredRule } from "../../types/index.js";
import type { FinalPrescriptionV2Result } from "./reconcileFinalPrescriptionV2.js";
import { realignSessionSections } from "./realignSessionSections.js";

export const V2_INTERVALS_LIGHT_FALLBACK_RULE_ID = "V2_INTERVALS_LIGHT_FALLBACK";
/** The final prescription's adaptation rule (DAILY_ADAPTATION_RULES_V2.intervalsLightToBase). */
export const INTERVALS_LIGHT_TO_BASE_ADAPTATION_RULE = "v2.modify.intervals_light_to_base";

export const INTERVALS_LIGHT_FALLBACK_SENTENCE =
  "Ton état du jour demande une séance légère et le fractionné prévu n'a pas de version allégée : endurance fondamentale légère à la place, à un rythme où tu peux parler en phrases complètes.";

export class IntervalsLightFallbackMismatchError extends Error {
  constructor(message: string) {
    super(`PHYS-02.1 intervals LIGHT fallback: ${message}`);
    this.name = "IntervalsLightFallbackMismatchError";
  }
}

export function applyV2IntervalsLightFallback(plan: DailyPlan, reconciliation: FinalPrescriptionV2Result): DailyPlan {
  if (reconciliation.status === "blocked" && reconciliation.detail.reason === "intervals_fallback_pain_not_cleared") {
    const withheld: TriggeredRule = {
      layer: "ARBITRATION",
      rule_id: V2_INTERVALS_LIGHT_FALLBACK_RULE_ID,
      detail: `Repli non proposé : douleur du jour (zone ${String(reconciliation.detail.zone)}) que la règle douleur existante ne libère pas pour l'endurance ; compatibilité d'activité non établie, aucune séance du jour. M1 : ${plan.decision} ${plan.final_session.kind}${"load_profile" in plan.final_session && plan.final_session.load_profile ? ` ${plan.final_session.load_profile}` : ""}.`,
      signals_used: [],
    };
    return { ...plan, triggered_rules: [...plan.triggered_rules, withheld] };
  }
  if (reconciliation.status !== "created") return plan;
  const fp = reconciliation.finalPrescription;
  if (!fp.adaptationRuleIds.includes(INTERVALS_LIGHT_TO_BASE_ADAPTATION_RULE)) return plan;
  const m1 = plan.final_session;
  if (plan.decision !== "MODIFY" || m1.kind !== "AEROBIC_INTERVALS" || !("load_profile" in m1) || m1.load_profile !== "LIGHT" || fp.structure.sessionKind !== "AEROBIC_BASE") {
    throw new IntervalsLightFallbackMismatchError(`decision ${plan.decision} ${m1.kind} with a ${fp.structure.sessionKind} fallback document`);
  }
  const m1Rules = plan.triggered_rules.filter((r) => r.layer === "C" || r.layer === "B").map((r) => r.rule_id);
  const trace: TriggeredRule = {
    layer: "ARBITRATION",
    rule_id: V2_INTERVALS_LIGHT_FALLBACK_RULE_ID,
    detail: `Fractionné prévu, charge LIGHT décidée par M1${m1Rules.length > 0 ? ` (${m1Rules.join(", ")})` : ""} : aucun fractionné allégé n'existe. Séance effective : AEROBIC_BASE LIGHT (${INTERVALS_LIGHT_TO_BASE_ADAPTATION_RULE}). M1 : MODIFY AEROBIC_INTERVALS LIGHT.`,
    signals_used: [],
  };
  const finalSession = { ...m1, kind: "AEROBIC_BASE" } as TrainingIntervention;
  const decisionReasoning = [...(plan.decision_reasoning ?? []), { ...trace, detail: INTERVALS_LIGHT_FALLBACK_SENTENCE }];
  return {
    ...plan,
    final_session: finalSession,
    training: { ...plan.training, session_type: finalSession, objective: INTERVALS_LIGHT_FALLBACK_SENTENCE },
    ...realignSessionSections(plan, finalSession),
    reasoning: joinDecisionReasoning(decisionReasoning),
    triggered_rules: [...plan.triggered_rules, trace],
    decision_reasoning: decisionReasoning,
  };
}
