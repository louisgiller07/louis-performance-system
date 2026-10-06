/**
 * A04 — V2 systemic floor (V2 daily path only, after M1; M1 itself is frozen
 * and unchanged).
 *
 * M1 rule C3.3 (systemic RED, e.g. sleep deficit) lowers the session's load
 * and keeps its nature. When the session is a Force session ALREADY at the
 * lowest V2 load (LIGHT: introduction, consolidation, taper weeks), nothing
 * can be lowered: M1 then labels the day KEEP and the rider would be asked to
 * do the same Force session on a systemic-RED day (finding BUG-V2-2).
 *
 * On the V2 path the integration layer resolves that case explicitly: the
 * decision becomes REPLACE → RECOVERY_ACTIVE, traced by its own rule
 * (`V2_SYSTEMIC_FLOOR`, layer ARBITRATION, same signals as C3.3), and the
 * decision's explanation says why. C3.3 stays in `triggered_rules` (audit);
 * the athlete-facing explanation (`decision_reasoning`, `reasoning`,
 * `training.objective`) carries the floor rule instead of C3.3's
 * "nature preserved", which no longer describes the day. Every other
 * DailyPlan field is M1's.
 *
 * Scope (ADR A04): Force only. A LIGHT DH or endurance session on a
 * systemic-RED day stays M1's KEEP (C3.3 "nature preserved", DH fatigue
 * monitoring note) — to validate with coaching.
 */
import { joinDecisionReasoning } from "../../engine/reasoningBuilder.js";
import type { DailyPlan, TrainingIntervention, TriggeredRule } from "../../types/index.js";

export const V2_SYSTEMIC_FLOOR_RULE_ID = "V2_SYSTEMIC_FLOOR";

const FLOOR_DETAIL =
  "Fatigue générale élevée (sommeil insuffisant) et séance de force déjà au niveau le plus léger : aucune charge ne peut encore baisser, récupération active à la place.";

const FORCE_KINDS = new Set(["STRENGTH_LOWER", "STRENGTH_UPPER"]);

export function applyV2SystemicFloor(plan: DailyPlan): DailyPlan {
  if (plan.decision !== "KEEP" || !FORCE_KINDS.has(plan.final_session.kind) || plan.final_session.load_profile !== "LIGHT") return plan;
  const c33 = plan.triggered_rules.find((r) => r.rule_id === "C3.3");
  if (c33 === undefined) return plan;

  const recovery: TrainingIntervention = { kind: "RECOVERY_ACTIVE" };
  const rule: TriggeredRule = { layer: "ARBITRATION", rule_id: V2_SYSTEMIC_FLOOR_RULE_ID, detail: FLOOR_DETAIL, signals_used: [...(c33.signals_used ?? [])] };
  const decisionReasoning = [...(plan.decision_reasoning ?? []).filter((r) => r.rule_id !== "C3.3"), rule];
  const { duration_min: _duration, ...training } = plan.training;
  return {
    ...plan,
    decision: "REPLACE",
    final_session: recovery,
    training: { ...training, active: true, session_type: recovery, objective: FLOOR_DETAIL },
    reasoning: joinDecisionReasoning(decisionReasoning),
    triggered_rules: [...plan.triggered_rules, rule],
    decision_reasoning: decisionReasoning,
  };
}
