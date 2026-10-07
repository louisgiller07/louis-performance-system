import { describe, expect, it } from "vitest";
import { athleteSafeOverrideReason, athleteSafeReasoning, athleteSafeRuleDetail } from "./safetyPresentation";
import { coachWhy } from "./coachInsights";
import { KEEP_PLAN } from "../history/historyFixtures";
import type { DailyPlan } from "./dailyPlanTypes";

// P0 — the planned load kept instead of a stronger race-protocol proposal reads as a plain sentence.

const TX = { layer: "B", rule_id: "RACE_PROTOCOL_TX", detail: "T-6 avant Hot Trail (HOT_TRAIL_2DAY, priorité A) — protocole T-X par défaut.", signals_used: [] };
const CAP = {
  layer: "ARBITRATION",
  rule_id: "PLANNED_LOAD_CAP",
  detail: "Séance planifiée DH_TECHNICAL LIGHT — proposition DH_TECHNICAL MODERATE (protocole T-X) plafonnée à la charge planifiée : DH_TECHNICAL LIGHT.",
  signals_used: [],
};
const DH_LIGHT = { kind: "DH_TECHNICAL", load_profile: "LIGHT", duration_min: 60 } as const;

const plan: DailyPlan = {
  ...KEEP_PLAN,
  decision: "KEEP",
  planned_session_before: DH_LIGHT,
  final_session: DH_LIGHT,
  triggered_rules: [TX, CAP],
  decision_reasoning: [TX, CAP],
  reasoning: `${TX.detail} ${CAP.detail}`,
  overrode_race_protocol: true,
  override_reason: CAP.detail,
} as DailyPlan;

describe("P0 — PLANNED_LOAD_CAP for the rider", () => {
  it("the rule reads « La charge prévue est conservée pour respecter ton affûtage. », never the engine identifiers", () => {
    expect(athleteSafeRuleDetail(CAP as DailyPlan["triggered_rules"][number])).toBe("La charge prévue est conservée pour respecter ton affûtage.");
    expect(athleteSafeReasoning(plan)).toBe("J-6 avant Hot Trail (Hot Trail, 2 jours, priorité A) — protocole de préparation standard. La charge prévue est conservée pour respecter ton affûtage.");
    expect(athleteSafeOverrideReason(plan)).toBe("La charge prévue est conservée pour respecter ton affûtage.");
    expect(coachWhy(plan)).not.toMatch(/MODERATE|DH_TECHNICAL|plafonnée/);
  });

  it("a cap from the day's arbitration (not the protocol) has its own plain sentence", () => {
    const daily = { ...CAP, detail: "Séance planifiée STRENGTH_LOWER LIGHT — proposition STRENGTH_UPPER MODERATE (arbitrage du jour) plafonnée à la charge planifiée : STRENGTH_UPPER LIGHT." };
    expect(athleteSafeRuleDetail(daily as DailyPlan["triggered_rules"][number])).toBe("La charge prévue est conservée : NALYNT n'alourdit jamais automatiquement une séance de ton plan.");
  });
});
