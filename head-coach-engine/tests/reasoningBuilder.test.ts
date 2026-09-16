import { describe, it, expect } from "vitest";
import { selectDecisionReasoningRules, joinDecisionReasoning } from "../src/engine/reasoningBuilder.js";
import type { TriggeredRule } from "../src/types/triggeredRule.js";

/**
 * V0.3.011 — pure unit tests for the explicit A (decision reasoning) / B
 * (monitoring context) separation, isolated from the full buildDailyPlan
 * pipeline (see tests/t18_reasoningCoherence.test.ts for the same
 * guarantees proven end-to-end through real RawContext scenarios). A
 * simple `isSameNature` stub is used throughout — this module never
 * reimplements or depends on buildDailyPlan.ts's own kind-pairing rules.
 */

const sameNature = (a: string, b: string) => a === b;

const c37: TriggeredRule = {
  layer: "C",
  rule_id: "C3.7",
  detail: "Charge 7 jours très élevée — point d'attention récupération, sans effet automatique sur la séance",
  signals_used: ["recent_load_very_high"],
};

const c33: TriggeredRule = {
  layer: "C",
  rule_id: "C3.3",
  detail: "Sommeil insuffisant — adaptation d'intensité, nature de la séance préservée",
  signals_used: ["sleep_deficit"],
};

const c35: TriggeredRule = {
  layer: "C",
  rule_id: "C3.5",
  detail: "Fatigue grip élevée — pivot vers exercice/séance sans sollicitation grip lourde",
  signals_used: ["grip_fatigue_high"],
};

const c36: TriggeredRule = {
  layer: "C",
  rule_id: "C3.6",
  detail: "Fatigue jambes élevée — pivot vers haut du corps / DH léger",
  signals_used: ["leg_fatigue_high"],
};

describe("Test 1 — C3.7 informatif (SIM-002)", () => {
  it("KEEP (nature unchanged), C3.7 the only triggered rule: excluded from reasoning, absent from the joined text", () => {
    const selected = selectDecisionReasoningRules({
      triggeredRules: [c37],
      comparisonBaseKind: "DH_PERFORMANCE",
      finalSessionKind: "DH_PERFORMANCE",
      isSameNature: sameNature,
    });

    expect(selected).toEqual([]);
    expect(joinDecisionReasoning(selected)).not.toContain("récupération");
  });

  it("C3.7 is never selected for A regardless of whether other rules also fired", () => {
    const selected = selectDecisionReasoningRules({
      triggeredRules: [c37, c33],
      comparisonBaseKind: "STRENGTH_LOWER",
      finalSessionKind: "STRENGTH_LOWER",
      isSameNature: sameNature,
    });

    expect(selected.map((r) => r.rule_id)).toEqual(["C3.3"]);
  });
});

describe("Test 2 — REPLACE reasoning (SIM-003)", () => {
  it("REPLACE (kind actually changed): C3.3's 'nature préservée' claim is dropped, the rules that actually explain the change remain", () => {
    const selected = selectDecisionReasoningRules({
      triggeredRules: [c35, c36, c33],
      comparisonBaseKind: "DH_TECHNICAL",
      finalSessionKind: "DH_LIGHT",
      isSameNature: sameNature, // "DH_TECHNICAL" !== "DH_LIGHT" — not same-nature, exactly as buildDailyPlan.ts's own isSameNature would resolve (only AEROBIC_INTERVALS/AEROBIC_BASE are paired)
    });

    const text = joinDecisionReasoning(selected);
    expect(selected.map((r) => r.rule_id)).toEqual(["C3.5", "C3.6"]);
    expect(text).not.toContain("nature de la séance préservée");
    expect(text.length).toBeGreaterThan(0);
  });
});

describe("Test 3 — KEEP même nature: 'nature préservée' n'est pas supprimée globalement", () => {
  it("a genuine same-kind MODIFY still shows C3.3's 'nature préservée' text normally", () => {
    const selected = selectDecisionReasoningRules({
      triggeredRules: [c33],
      comparisonBaseKind: "STRENGTH_LOWER",
      finalSessionKind: "STRENGTH_LOWER", // unchanged kind — C3.3's claim is true here
      isSameNature: sameNature,
    });

    expect(joinDecisionReasoning(selected)).toContain("nature de la séance préservée");
  });

  it("MENTAL_RED's 'nature physique préservée' text is likewise preserved when nothing else changed the kind", () => {
    const mentalRed: TriggeredRule = {
      layer: "C",
      rule_id: "MENTAL_RED",
      detail: "Mental RED — réduction de la charge cognitive/structurelle, nature physique préservée",
      signals_used: ["stress_high"],
    };

    const selected = selectDecisionReasoningRules({
      triggeredRules: [mentalRed],
      comparisonBaseKind: "AEROBIC_BASE",
      finalSessionKind: "AEROBIC_BASE",
      isSameNature: sameNature,
    });

    expect(joinDecisionReasoning(selected)).toContain("nature physique préservée");
  });
});

describe("joinDecisionReasoning — no-signal fallback", () => {
  it("falls back to the neutral message when every triggered rule was excluded (or none fired)", () => {
    expect(joinDecisionReasoning([])).toBe("Aucun signal particulier — séance maintenue telle quelle.");
  });
});
