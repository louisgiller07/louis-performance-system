import { describe, expect, it } from "vitest";
import { athleteSafeReasoning, athleteSafeRuleDetail, athleteSafeTrainingObjective, hasActiveSafetyRule } from "./safetyPresentation";
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

// V0.3_006C1 (A5 copy-leak hotfix) — rules/safety.ts A1's exact detail.
const A1_RULE: TriggeredRule = {
  layer: "A",
  rule_id: "A1",
  detail: "Suspicion de commotion déclarée — REST et orientation médicale immédiate",
};

describe("athleteSafeRuleDetail", () => {
  it("leaves a non-A5/A1 rule's detail unchanged", () => {
    const rule: TriggeredRule = { layer: "B", rule_id: "RACE_PROTOCOL_TX", detail: "T-5 : réduction de charge." };
    expect(athleteSafeRuleDetail(rule)).toBe("T-5 : réduction de charge.");
  });

  it("substitutes A5's detail with a factual, slug-free sentence", () => {
    const safe = athleteSafeRuleDetail(A5_RULE);
    expect(safe).not.toContain("concussion_suspect");
    expect(safe).toContain("toujours actif");
  });

  // V0.3_006C1 (A5 copy-leak hotfix) — the raw English "REST" action token
  // must never reach athlete-facing copy, even though the rest of A1's
  // detail is already French.
  it("substitutes A1's detail, replacing the raw 'REST' token with 'repos'", () => {
    const safe = athleteSafeRuleDetail(A1_RULE);
    expect(safe).not.toMatch(/\bREST\b/);
    expect(safe).toContain("repos et orientation médicale immédiate");
    expect(safe).toContain("Suspicion de commotion déclarée");
  });
});

describe("athleteSafeTrainingObjective (V0.3_006C1 A5 copy-leak hotfix)", () => {
  it("returns undefined when training.objective is undefined", () => {
    expect(athleteSafeTrainingObjective(BASE_PLAN)).toBeUndefined();
  });

  // buildDailyPlan.ts sets training.objective to the raw detail of the LAST
  // triggered rule — for A5 this is exactly A5_RULE.detail, the same leak
  // the production canary caught in the Training card (never previously
  // covered by athleteSafeRuleDetail/athleteSafeReasoning, which only
  // handle triggered_rules/reasoning).
  it("sanitizes training.objective when it exactly matches a triggered rule with a registered override (A5)", () => {
    const plan: DailyPlan = {
      ...BASE_PLAN,
      training: { active: true, session_type: { kind: "RECOVERY_ACTIVE" }, objective: A5_RULE.detail },
      triggered_rules: [A5_RULE],
    };
    const safe = athleteSafeTrainingObjective(plan);
    expect(safe).not.toContain("concussion_suspect");
    expect(safe).not.toContain("Flag");
    expect(safe).toContain("toujours actif");
  });

  it("sanitizes training.objective for A1 too, replacing the raw 'REST' token", () => {
    const plan: DailyPlan = {
      ...BASE_PLAN,
      training: { active: false, objective: A1_RULE.detail },
      triggered_rules: [A1_RULE],
    };
    const safe = athleteSafeTrainingObjective(plan);
    expect(safe).not.toMatch(/\bREST\b/);
    expect(safe).toContain("repos et orientation médicale immédiate");
  });

  // A1's actual training.objective in production is the fixed
  // "Repos complet — SAFETY" string (buildSafetyPlan), never equal to A1's
  // rule.detail — must pass through completely unchanged, not accidentally
  // matched/mangled by the new helper.
  it("leaves an objective that does not match any triggered rule's detail unchanged, even when a Safety rule fired", () => {
    const plan: DailyPlan = {
      ...BASE_PLAN,
      training: { active: false, objective: "Repos complet — SAFETY" },
      triggered_rules: [A1_RULE],
    };
    expect(athleteSafeTrainingObjective(plan)).toBe("Repos complet — SAFETY");
  });

  it("leaves training.objective unchanged when no triggered rule has a registered override", () => {
    const plan: DailyPlan = {
      ...BASE_PLAN,
      training: { active: true, objective: "Aucune séance planifiée." },
      triggered_rules: [{ layer: "C", rule_id: "INFERENCE_FALLBACK", detail: "Aucune séance planifiée." }],
    };
    expect(athleteSafeTrainingObjective(plan)).toBe("Aucune séance planifiée.");
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

  // V0.3_006C1 (A5 copy-leak hotfix)
  it("substitutes A1's raw 'REST' token when A1's detail appears in reasoning", () => {
    const plan: DailyPlan = {
      ...BASE_PLAN,
      triggered_rules: [A1_RULE],
      reasoning: A1_RULE.detail,
    };
    expect(athleteSafeReasoning(plan)).not.toMatch(/\bREST\b/);
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
