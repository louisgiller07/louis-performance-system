import { describe, expect, it } from "vitest";
import { athleteSafeOverrideReason, athleteSafeReasoning, athleteSafeRuleDetail, athleteSafeTrainingObjective, hasActiveSafetyRule } from "./safetyPresentation";
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

// REV-016 — INFERENCE_FALLBACK's raw TrainingMode enum "(mode=…)" never reaches the athlete.
describe("INFERENCE_FALLBACK sanitization (REV-016)", () => {
  const fallbackRule = (mode: string): TriggeredRule => ({
    layer: "C",
    rule_id: "INFERENCE_FALLBACK",
    detail: `Aucune séance planifiée — inférence depuis le contexte (mode=${mode})`,
    signals_used: [],
  });

  it.each(["UNSPECIFIED", "IN_SEASON", "RACE_CLUSTER", "OFF_SEASON_DEVELOPMENT"])("mode=%s → 'Aucune séance planifiée.'", (mode) => {
    expect(athleteSafeRuleDetail(fallbackRule(mode))).toBe("Aucune séance planifiée.");
  });

  it("an unexpected wording of the same rule is left untouched (never guessed)", () => {
    const rule = { ...fallbackRule("UNSPECIFIED"), detail: "Aucune séance planifiée — autre formulation future" };
    expect(athleteSafeRuleDetail(rule)).toBe("Aucune séance planifiée — autre formulation future");
  });

  it("the same text under another rule_id is not rewritten", () => {
    const rule = { ...fallbackRule("UNSPECIFIED"), rule_id: "SOMETHING_ELSE" };
    expect(athleteSafeRuleDetail(rule)).toBe(rule.detail);
  });

  it("reasoning and objective are cleaned, the rest of the reasoning is unchanged", () => {
    const rule = fallbackRule("UNSPECIFIED");
    const plan: DailyPlan = {
      ...BASE_PLAN,
      reasoning: `${rule.detail} Ton plan reste aligné avec ton objectif.`,
      training: { ...BASE_PLAN.training, objective: rule.detail },
      triggered_rules: [rule],
    };

    expect(athleteSafeReasoning(plan)).toBe("Aucune séance planifiée. Ton plan reste aligné avec ton objectif.");
    expect(athleteSafeTrainingObjective(plan)).toBe("Aucune séance planifiée.");
  });

  it("absent objective stays absent; a normal objective stays unchanged", () => {
    const rule = fallbackRule("UNSPECIFIED");
    expect(athleteSafeTrainingObjective({ ...BASE_PLAN, training: { ...BASE_PLAN.training, objective: undefined }, triggered_rules: [rule] })).toBeUndefined();
    expect(athleteSafeTrainingObjective({ ...BASE_PLAN, training: { ...BASE_PLAN.training, objective: "Séance de force planifiée" }, triggered_rules: [rule] })).toBe(
      "Séance de force planifiée"
    );
  });
});

// REV-016b — race explanations: exact engine sentences rebuilt with validated labels; anything else kept verbatim.
describe("race explanations (REV-016b)", () => {
  const rule = (rule_id: string, detail: string, layer: TriggeredRule["layer"] = "B"): TriggeredRule => ({ layer, rule_id, detail, signals_used: [] });

  it("old production shapes are rewritten (T-X race protocol, post-event, committed activity)", () => {
    expect(athleteSafeRuleDetail(rule("RACE_PROTOCOL_TX", "T-3 avant iXS Cup Lenzerheide (IXS_3DAY, priorité A_PLUS) — protocole T-X par défaut."))).toBe(
      "J-3 avant iXS Cup Lenzerheide (iXS, 3 jours, priorité A+) — protocole de préparation standard."
    );
    expect(athleteSafeRuleDetail(rule("RACE_PROTOCOL_TX", "T-1 avant Hot Trail Leysin (HOT_TRAIL_2DAY, priorité A) — protocole T-X par défaut."))).toBe(
      "J-1 avant Hot Trail Leysin (Hot Trail, 2 jours, priorité A) — protocole de préparation standard."
    );
    expect(athleteSafeRuleDetail(rule("POST_EVENT", "T+2 après la fin de iXS Cup Lenzerheide — récupération active post-course."))).toBe(
      "J+2 après la fin de iXS Cup Lenzerheide — récupération active post-course."
    );
    expect(
      athleteSafeRuleDetail(
        rule(
          "COMMITTED_FAMILY_NO_ADAPTATION",
          "Activité engagée (BIKE_MAINTENANCE) — aucune adaptation de même famille disponible pour cette activité, recommandation T-X (RECOVERY_ACTIVE) utilisée.",
          "ARBITRATION"
        )
      )
    ).toBe("Activité engagée (Entretien vélo) — aucune adaptation de même famille disponible pour cette activité, recommandation de préparation course (Récupération active) utilisée.");
  });

  it("committed activity preserved and every in-progress phase are rewritten", () => {
    expect(
      athleteSafeRuleDetail(
        rule(
          "COMMITTED_FAMILY_PRESERVED",
          "Activité engagée (DH_TECHNICAL) — famille d'activité préservée, adaptation appliquée au lieu de la recommandation T-X (RECOVERY_ACTIVE).",
          "ARBITRATION"
        )
      )
    ).toBe("Activité engagée (DH technique) — famille d'activité préservée, adaptation appliquée au lieu de la recommandation de préparation course (Récupération active).");
    const phases: Array<[string, string]> = [
      ["TRACKWALK", "reconnaissance"],
      ["PRACTICE", "entraînements"],
      ["PRACTICE_TIMED", "entraînements chronométrés"],
      ["QUALI", "qualifications"],
      ["FINAL", "finale"],
      ["RACE_DAY_GENERIC", "jour de course"],
    ];
    for (const [phase, label] of phases) {
      expect(athleteSafeRuleDetail(rule("RACE_DAY_ACTIVE", `Événement en cours (event_day=1, phase=${phase}) — activité de course.`))).toBe(
        `Course en cours (jour 1, ${label}) — activité de course.`
      );
    }
  });

  it("a race name containing parentheses or dashes is kept verbatim", () => {
    expect(athleteSafeRuleDetail(rule("RACE_PROTOCOL_TX", "T-2 avant Coupe (Valais) — manche 3 (IXS_3DAY, priorité B) — protocole T-X par défaut."))).toBe(
      "J-2 avant Coupe (Valais) — manche 3 (iXS, 3 jours, priorité B) — protocole de préparation standard."
    );
  });

  it("unknown values or wording keep the original sentence (never a partial rewrite)", () => {
    for (const detail of [
      "T-3 avant Course X (OTHER, priorité A) — protocole T-X par défaut.",
      "T-3 avant Course X (IXS_3DAY, priorité Z) — protocole T-X par défaut.",
      "T-3 avant Course X (IXS_3DAY, priorité A) — nouvelle formulation.",
    ]) {
      expect(athleteSafeRuleDetail(rule("RACE_PROTOCOL_TX", detail))).toBe(detail);
    }
    const unknownPhase = "Événement en cours (event_day=1, phase=PRE_EVENT) — activité de course.";
    expect(athleteSafeRuleDetail(rule("RACE_DAY_ACTIVE", unknownPhase))).toBe(unknownPhase);
    const unknownKind = "Activité engagée (FUTURE_KIND) — aucune adaptation de même famille disponible pour cette activité, recommandation T-X (REST) utilisée.";
    expect(athleteSafeRuleDetail(rule("COMMITTED_FAMILY_NO_ADAPTATION", unknownKind, "ARBITRATION"))).toBe(unknownKind);
  });

  it("reasoning and mission objective carry the rewritten race sentence", () => {
    const race = rule("RACE_PROTOCOL_TX", "T-3 avant iXS Cup (IXS_3DAY, priorité A_PLUS) — protocole T-X par défaut.");
    const plan: DailyPlan = { ...BASE_PLAN, reasoning: `${race.detail} Ton plan reste aligné.`, training: { ...BASE_PLAN.training, objective: race.detail }, triggered_rules: [race] };

    expect(athleteSafeReasoning(plan)).toBe("J-3 avant iXS Cup (iXS, 3 jours, priorité A+) — protocole de préparation standard. Ton plan reste aligné.");
    expect(athleteSafeTrainingObjective(plan)).toBe("J-3 avant iXS Cup (iXS, 3 jours, priorité A+) — protocole de préparation standard.");
  });
});

describe("athleteSafeOverrideReason (REV-016b)", () => {
  const committed: TriggeredRule = {
    layer: "ARBITRATION",
    rule_id: "COMMITTED_FAMILY_NO_ADAPTATION",
    detail: "Activité engagée (BIKE_MAINTENANCE) — aucune adaptation de même famille disponible pour cette activité, recommandation T-X (RECOVERY_ACTIVE) utilisée.",
    signals_used: [],
  };

  it("absent → absent", () => {
    expect(athleteSafeOverrideReason({ ...BASE_PLAN, override_reason: undefined })).toBeUndefined();
  });

  it("engine fallback sentence → French, raw kinds and 'T-X' removed", () => {
    expect(
      athleteSafeOverrideReason({
        ...BASE_PLAN,
        override_reason: "Séance finale (STRENGTH_LOWER) différente de la recommandation T-X (RECOVERY_ACTIVE), sans cause de domaine tracée.",
      })
    ).toBe("Séance finale (Renfo bas du corps) différente de la séance de préparation course (Récupération active).");
  });

  it("joined rule details are rewritten like the reasoning; the production French reason is kept as-is", () => {
    const sleep = "Sommeil insuffisant — adaptation d'intensité, nature de la séance préservée";
    expect(athleteSafeOverrideReason({ ...BASE_PLAN, override_reason: `${sleep} ${committed.detail}`, triggered_rules: [committed] })).toBe(
      `${sleep} Activité engagée (Entretien vélo) — aucune adaptation de même famille disponible pour cette activité, recommandation de préparation course (Récupération active) utilisée.`
    );
    expect(athleteSafeOverrideReason({ ...BASE_PLAN, override_reason: sleep, triggered_rules: [] })).toBe(sleep);
  });
});
