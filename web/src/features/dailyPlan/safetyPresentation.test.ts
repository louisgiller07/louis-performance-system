import { describe, expect, it } from "vitest";
import { athleteSafeReasoning, athleteSafeRuleDetail, hasActiveSafetyRule } from "./safetyPresentation";
import type { DailyPlan, TriggeredRule } from "./dailyPlanTypes";

const BASE_PLAN: DailyPlan = {
  active_mode: "IN_SEASON",
  training: { active: false },
  dh_or_technical: { active: false },
  mental: { active: false },
  recovery: { active: false, actions: [] },
  nutrition: { active: false },
  sleep: { active: false },
  protection: { do_not_do: [] },
  monitoring: { observe: [] },
  reasoning: "Aucun signal particulier — séance maintenue telle quelle.",
  confidence: "MEDIUM",
  triggered_rules: [],
  planned_session_before: null,
  final_session: { kind: "AEROBIC_BASE", load_profile: "MODERATE" },
  decision: "KEEP",
  overrode_race_protocol: false,
  engine_version: "1.0.0",
};

const A5_RULE: TriggeredRule = {
  layer: "A",
  rule_id: "A5",
  detail: "Flag concussion_suspect actif non résolu — DH interdit tant que non validé médicalement",
};

describe("athleteSafeRuleDetail", () => {
  it("leaves a non-A5 rule's detail unchanged", () => {
    const rule: TriggeredRule = { layer: "B", rule_id: "RACE_PROTOCOL_TX", detail: "T-5 : réduction de charge." };
    expect(athleteSafeRuleDetail(rule)).toBe("T-5 : réduction de charge.");
  });

  it("substitutes A5's detail with a factual, slug-free sentence", () => {
    const safe = athleteSafeRuleDetail(A5_RULE);
    expect(safe).not.toContain("concussion_suspect");
    expect(safe).toContain("toujours actif");
  });
});

describe("athleteSafeReasoning", () => {
  it("returns dailyPlan.reasoning unchanged when triggered_rules is empty", () => {
    expect(athleteSafeReasoning(BASE_PLAN)).toBe(BASE_PLAN.reasoning);
  });

  it("reproduces the same join as buildDailyPlan.ts when no substitution applies", () => {
    const plan: DailyPlan = {
      ...BASE_PLAN,
      triggered_rules: [
        { layer: "C", rule_id: "INFERENCE_FALLBACK", detail: "Aucune séance planifiée." },
        { layer: "ARBITRATION", rule_id: "SOFT_CONSTRAINT_STRONG_APPLIED", detail: "Contrainte appliquée." },
      ],
      reasoning: "Aucune séance planifiée. Contrainte appliquée.",
    };
    expect(athleteSafeReasoning(plan)).toBe(plan.reasoning);
  });

  it("substitutes only the A5 portion when A5 is one of several triggered rules", () => {
    const plan: DailyPlan = {
      ...BASE_PLAN,
      triggered_rules: [A5_RULE, { layer: "C", rule_id: "INFERENCE_FALLBACK", detail: "Aucune séance planifiée." }],
      reasoning: `${A5_RULE.detail} Aucune séance planifiée.`,
    };
    const reasoning = athleteSafeReasoning(plan);
    expect(reasoning).not.toContain("concussion_suspect");
    expect(reasoning).toContain("Aucune séance planifiée.");
  });
});

describe("hasActiveSafetyRule", () => {
  it("false when no triggered rule is layer A", () => {
    expect(hasActiveSafetyRule({ ...BASE_PLAN, triggered_rules: [{ layer: "C", rule_id: "X", detail: "d" }] })).toBe(false);
  });

  it("true when a layer-A rule is present", () => {
    expect(hasActiveSafetyRule({ ...BASE_PLAN, triggered_rules: [A5_RULE] })).toBe(true);
  });

  it("false for an empty triggered_rules array", () => {
    expect(hasActiveSafetyRule(BASE_PLAN)).toBe(false);
  });
});
