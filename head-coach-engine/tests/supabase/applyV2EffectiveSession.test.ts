import { describe, expect, it } from "vitest";
import type { DailyPlan, TrainingIntervention } from "../../src/types/index.js";
import type { FinalPrescriptionV2Result } from "../../src/supabase/dailyV2/reconcileFinalPrescriptionV2.js";
import { applyV2EffectiveSession, EffectiveSessionMismatchError, V2_EFFECTIVE_SESSION_RULE_ID } from "../../src/supabase/dailyV2/applyV2EffectiveSession.js";

// A07 — the persisted V2 decision carries the final prescription's duration.

const FORCE_LIGHT_60: TrainingIntervention = { kind: "STRENGTH_LOWER", load_profile: "LIGHT", duration_min: 60 };

function plan(final: TrainingIntervention): DailyPlan {
  return {
    date: "2026-10-15",
    active_mode: "UNSPECIFIED",
    training: { active: true, session_type: final, ...(final.duration_min !== undefined ? { duration_min: final.duration_min } : {}) },
    dh_or_technical: { active: false },
    mental: { active: false },
    recovery: { active: false, actions: [] },
    nutrition: { active: false },
    sleep: { active: false },
    protection: { do_not_do: [] },
    monitoring: { observe: [] },
    reasoning: "M1 reasoning.",
    confidence: "MEDIUM",
    triggered_rules: [],
    planned_session_before: { kind: "STRENGTH_LOWER", load_profile: "MODERATE", duration_min: 60 },
    final_session: final,
    decision: "MODIFY",
    overrode_race_protocol: false,
    engine_version: "v0.2",
  };
}

function created(sessionKind: string, effectiveDurationMin?: number): FinalPrescriptionV2Result {
  return {
    status: "created",
    finalPrescription: { id: "fp-1", structure: { sessionKind } } as never,
    ...(effectiveDurationMin !== undefined ? { effectiveDurationMin } : {}),
  } as FinalPrescriptionV2Result;
}

describe("A07 — applyV2EffectiveSession", () => {
  it("MODIFY Force 60 → 45: final session and training take 45 min, traced with M1's value; everything else unchanged", () => {
    const before = plan(FORCE_LIGHT_60);
    const after = applyV2EffectiveSession(before, created("STRENGTH_LOWER", 45));
    expect(after.final_session).toEqual({ ...FORCE_LIGHT_60, duration_min: 45 });
    expect(after.training).toEqual({ active: true, session_type: { ...FORCE_LIGHT_60, duration_min: 45 }, duration_min: 45 });
    expect(after.triggered_rules).toEqual([{ layer: "ARBITRATION", rule_id: V2_EFFECTIVE_SESSION_RULE_ID, detail: "Durée de la séance effective : 45 min (prescription du jour) — durée M1 : 60 min.", signals_used: [] }]);
    expect([after.decision, after.reasoning, after.planned_session_before]).toEqual([before.decision, before.reasoning, before.planned_session_before]);
    expect(before.final_session.duration_min).toBe(60);
  });

  it("same duration, no effective duration, or no final prescription: the plan is returned as is", () => {
    const p = plan(FORCE_LIGHT_60);
    expect(applyV2EffectiveSession(p, created("STRENGTH_LOWER", 60))).toBe(p);
    expect(applyV2EffectiveSession(p, created("STRENGTH_LOWER"))).toBe(p);
    expect(applyV2EffectiveSession(p, { status: "not_required" } as FinalPrescriptionV2Result)).toBe(p);
  });

  it("an M1 session without duration gets the prescription's, traced without an M1 value", () => {
    const after = applyV2EffectiveSession(plan({ kind: "STRENGTH_LOWER", load_profile: "LIGHT" }), created("STRENGTH_LOWER", 45));
    expect(after.final_session.duration_min).toBe(45);
    expect(after.triggered_rules[0]!.detail).toBe("Durée de la séance effective : 45 min (prescription du jour).");
  });

  it("a final prescription of another kind is a contract error, never silently aligned", () => {
    expect(() => applyV2EffectiveSession(plan(FORCE_LIGHT_60), created("DH_TECHNICAL", 90))).toThrow(EffectiveSessionMismatchError);
  });
});
