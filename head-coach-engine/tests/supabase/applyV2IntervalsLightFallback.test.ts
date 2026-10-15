import { describe, expect, it } from "vitest";
import type { DailyPlan, TrainingIntervention } from "../../src/types/index.js";
import type { FinalPrescriptionV2Result } from "../../src/supabase/dailyV2/reconcileFinalPrescriptionV2.js";
import {
  applyV2IntervalsLightFallback,
  INTERVALS_LIGHT_FALLBACK_SENTENCE,
  IntervalsLightFallbackMismatchError,
  V2_INTERVALS_LIGHT_FALLBACK_RULE_ID,
} from "../../src/supabase/dailyV2/applyV2IntervalsLightFallback.js";
import { applyV2EffectiveSession } from "../../src/supabase/dailyV2/applyV2EffectiveSession.js";

// PHYS-02.1 — the persisted decision of an intervals session lowered to LIGHT by M1 says the effective session.

const INTERVALS_LIGHT: TrainingIntervention = { kind: "AEROBIC_INTERVALS", load_profile: "LIGHT", duration_min: 53 };
const C33 = { layer: "C" as const, rule_id: "C3.3", detail: "Sommeil insuffisant", signals_used: ["sleep_deficit"] };

function plan(final: TrainingIntervention, decision: DailyPlan["decision"] = "MODIFY"): DailyPlan {
  return {
    date: "2026-10-23",
    active_mode: "UNSPECIFIED",
    training: { active: true, session_type: final, duration_min: 53, objective: "M1 objective" },
    dh_or_technical: { active: false },
    mental: { active: false },
    recovery: { active: false, actions: [] },
    nutrition: { active: false },
    sleep: { active: false },
    protection: { do_not_do: ["Réduire l'intensité globale de la séance (RPE cible réduit) — sommeil insuffisant"] },
    monitoring: { observe: [] },
    reasoning: "M1 reasoning.",
    decision_reasoning: [C33],
    confidence: "MEDIUM",
    triggered_rules: [C33],
    planned_session_before: { kind: "AEROBIC_INTERVALS", load_profile: "MODERATE", duration_min: 53 },
    final_session: final,
    decision,
    overrode_race_protocol: false,
    engine_version: "v0.2",
  } as DailyPlan;
}

function created(sessionKind: string, adaptationRuleIds: string[], effectiveDurationMin = 45): FinalPrescriptionV2Result {
  return { status: "created", finalPrescription: { id: "fp-1", adaptationRuleIds, structure: { sessionKind } } as never, effectiveDurationMin } as FinalPrescriptionV2Result;
}

describe("PHYS-02.1 — applyV2IntervalsLightFallback", () => {
  it("MODIFY AEROBIC_INTERVALS LIGHT + the fallback document: same decision and load, kind AEROBIC_BASE, traced with M1's session and rules, sentence for the rider", () => {
    const before = plan(INTERVALS_LIGHT);
    const after = applyV2IntervalsLightFallback(before, created("AEROBIC_BASE", ["v2.modify.intervals_light_to_base"]));
    expect([after.decision, after.final_session, after.training.session_type, after.training.objective]).toEqual([
      "MODIFY",
      { kind: "AEROBIC_BASE", load_profile: "LIGHT", duration_min: 53 },
      { kind: "AEROBIC_BASE", load_profile: "LIGHT", duration_min: 53 },
      INTERVALS_LIGHT_FALLBACK_SENTENCE,
    ]);
    expect(after.triggered_rules).toEqual([
      C33,
      {
        layer: "ARBITRATION",
        rule_id: V2_INTERVALS_LIGHT_FALLBACK_RULE_ID,
        detail: "Fractionné prévu, charge LIGHT décidée par M1 (C3.3) : aucun fractionné allégé n'existe. Séance effective : AEROBIC_BASE LIGHT (v2.modify.intervals_light_to_base). M1 : MODIFY AEROBIC_INTERVALS LIGHT.",
        signals_used: [],
      },
    ]);
    expect(after.decision_reasoning!.at(-1)).toEqual({ layer: "ARBITRATION", rule_id: V2_INTERVALS_LIGHT_FALLBACK_RULE_ID, detail: INTERVALS_LIGHT_FALLBACK_SENTENCE, signals_used: [] });
    expect(after.reasoning).toContain(INTERVALS_LIGHT_FALLBACK_SENTENCE);
    // M1's protection (its own signals) is kept; M1's object is not mutated.
    expect(after.protection).toEqual(before.protection);
    expect(before.final_session).toEqual(INTERVALS_LIGHT);
  });

  it("then A07 gives the effective duration (45 min): one effective session, no contract error", () => {
    const after = applyV2EffectiveSession(applyV2IntervalsLightFallback(plan(INTERVALS_LIGHT), created("AEROBIC_BASE", ["v2.modify.intervals_light_to_base"])), created("AEROBIC_BASE", ["v2.modify.intervals_light_to_base"]));
    expect(after.final_session).toEqual({ kind: "AEROBIC_BASE", load_profile: "LIGHT", duration_min: 45 });
    expect(after.triggered_rules.map((r) => r.rule_id)).toEqual(["C3.3", V2_INTERVALS_LIGHT_FALLBACK_RULE_ID, "V2_EFFECTIVE_SESSION"]);
    // Without this step A07 refuses the mismatch (never silently aligned).
    expect(() => applyV2EffectiveSession(plan(INTERVALS_LIGHT), created("AEROBIC_BASE", ["v2.modify.intervals_light_to_base"]))).toThrow(/final prescription AEROBIC_BASE vs decision AEROBIC_INTERVALS/);
  });

  it("anything else is returned as is: REST, a blocked day, another rule (KEEP intervals, A10 recovery, MENTAL_RED base)", () => {
    const p = plan(INTERVALS_LIGHT);
    expect(applyV2IntervalsLightFallback(p, { status: "none", reason: "rest" } as FinalPrescriptionV2Result)).toBe(p);
    expect(applyV2IntervalsLightFallback(p, { status: "blocked", code: "final_prescription_adaptation_not_defined", detail: {} } as FinalPrescriptionV2Result)).toBe(p);
    expect(applyV2IntervalsLightFallback(p, created("RECOVERY_ACTIVE", ["v2.replace.recovery_active", "v2.time.today_limit"]))).toBe(p);
    const base = plan({ kind: "AEROBIC_BASE", load_profile: "MODERATE", duration_min: 53 });
    expect(applyV2IntervalsLightFallback(base, created("AEROBIC_BASE", ["v2.modify.intervals_to_base"]))).toBe(base);
  });

  it("a fallback document under any other decision is a contract error, never silently aligned", () => {
    expect(() => applyV2IntervalsLightFallback(plan(INTERVALS_LIGHT, "REPLACE"), created("AEROBIC_BASE", ["v2.modify.intervals_light_to_base"]))).toThrow(IntervalsLightFallbackMismatchError);
    expect(() => applyV2IntervalsLightFallback(plan({ kind: "AEROBIC_INTERVALS", load_profile: "MODERATE" }), created("AEROBIC_BASE", ["v2.modify.intervals_light_to_base"]))).toThrow(IntervalsLightFallbackMismatchError);
    expect(() => applyV2IntervalsLightFallback(plan(INTERVALS_LIGHT), created("AEROBIC_INTERVALS", ["v2.modify.intervals_light_to_base"]))).toThrow(IntervalsLightFallbackMismatchError);
  });
});
