/**
 * PHYS-03 — may today's power session be prescribed given M1's fatigue signals? Integration layer, pure;
 * M1 is unchanged and its decision is never altered here.
 *
 * docs/03 §5: power is maximal-quality work, « jamais après une séance fatigante ». M1 flags legs fatigue (C3.6)
 * and grip / forearm fatigue (C3.5) and adapts the sessions those rules know (lower-body Force, DH, grip,
 * upper-body Force, endurance), but has no POWER branch: a planned power session is kept as is. Only these
 * two existing M1 rules are read — no new fatigue rule. C3.7 (7-day load) stays informative, as decided for M1.
 * - cleared: M1's final session is not POWER, or neither rule fired;
 * - not cleared: the power session is not prescribed today (a safe, explicit state, the decision kept).
 */
import type { DailyPlan } from "../../types/index.js";

export const POWER_FATIGUE_RULE_IDS: readonly string[] = ["C3.6", "C3.5"];

export type PowerFatigueGate = { cleared: true } | { cleared: false; rules: readonly string[] };

export function powerFatigueGate(dailyPlan: Pick<DailyPlan, "final_session" | "triggered_rules">): PowerFatigueGate {
  if (dailyPlan.final_session.kind !== "POWER") return { cleared: true };
  const rules = POWER_FATIGUE_RULE_IDS.filter((id) => dailyPlan.triggered_rules.some((r) => r.rule_id === id));
  return rules.length === 0 ? { cleared: true } : { cleared: false, rules };
}
