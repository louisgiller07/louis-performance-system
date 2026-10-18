/**
 * PHYS-03 — trace of a power session withheld for fatigue (V2 daily path only, after the reconciliation; M1 is
 * unchanged). When the reconciliation returned `power_fatigue_not_cleared` (powerFatigueGate.ts), M1's decision is
 * kept as is and only the trace is added: rule `V2_POWER_FATIGUE_HOLD` (layer ARBITRATION) with M1's session and the
 * fatigue rules that fired. No session, no sentence changed. Any other result is returned as is.
 */
import type { DailyPlan, TriggeredRule } from "../../types/index.js";
import type { FinalPrescriptionV2Result } from "./reconcileFinalPrescriptionV2.js";

export const V2_POWER_FATIGUE_HOLD_RULE_ID = "V2_POWER_FATIGUE_HOLD";

export function applyV2PowerFatigueHold(plan: DailyPlan, reconciliation: FinalPrescriptionV2Result): DailyPlan {
  if (reconciliation.status !== "blocked" || reconciliation.detail.reason !== "power_fatigue_not_cleared") return plan;
  const rules = Array.isArray(reconciliation.detail.rules) ? (reconciliation.detail.rules as string[]).join(", ") : "";
  const m1 = plan.final_session;
  const hold: TriggeredRule = {
    layer: "ARBITRATION",
    rule_id: V2_POWER_FATIGUE_HOLD_RULE_ID,
    detail: `Séance de puissance non prescrite : fatigue signalée par M1 (${rules}) et puissance = qualité maximale (docs/03 §5). M1 : ${plan.decision} ${m1.kind}${"load_profile" in m1 && m1.load_profile ? ` ${m1.load_profile}` : ""}.`,
    signals_used: [],
  };
  return { ...plan, triggered_rules: [...plan.triggered_rules, hold] };
}
