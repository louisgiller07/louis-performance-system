import { describe, expect, it } from "vitest";
import type { DailyPlan, TrainingIntervention } from "../../src/types/index.js";
import type { FinalPrescriptionV2Result, TodayTimeConstraintV2 } from "../../src/supabase/dailyV2/reconcileFinalPrescriptionV2.js";
import { A04_MODIFY_NOT_SUPPORTED_RULE_ID, applyV2TodayTimeConstraint, V2_TODAY_TIME_CONSTRAINT_RULE_ID } from "../../src/supabase/dailyV2/applyV2TodayTimeConstraint.js";

// A10 — the decision says the session that fits in the rider's time, traced.

const DH_90: TrainingIntervention = { kind: "DH_TECHNICAL", load_profile: "MODERATE", duration_min: 90 };
const C33 = { layer: "C" as const, rule_id: "C3.3", detail: "Fatigue générale.", signals_used: ["sleep_deficit"] };

function plan(final: TrainingIntervention, decision: DailyPlan["decision"] = "KEEP"): DailyPlan {
  return {
    date: "2026-10-15",
    active_mode: "UNSPECIFIED",
    training: { active: true, session_type: final, ...(final.duration_min !== undefined ? { duration_min: final.duration_min } : {}), objective: "M1 objective" },
    dh_or_technical: { active: true, focus: "cornering" } as DailyPlan["dh_or_technical"],
    mental: { active: false },
    recovery: { active: false, actions: [] },
    nutrition: { active: false },
    sleep: { active: false },
    protection: { do_not_do: [] },
    monitoring: { observe: [] },
    reasoning: "M1 reasoning.",
    confidence: "MEDIUM",
    triggered_rules: [C33],
    decision_reasoning: [C33],
    planned_session_before: DH_90,
    final_session: final,
    decision,
    overrode_race_protocol: false,
    engine_version: "v0.2",
  };
}

const before = { decision: "KEEP" as const, kind: "DH_TECHNICAL", loadProfile: "MODERATE" as const, durationMin: 90 };
function result(timeConstraint: TodayTimeConstraintV2 | undefined, status: "created" | "none" = "created"): FinalPrescriptionV2Result {
  return (status === "none" ? { status: "none", reason: "rest", timeConstraint } : { status: "created", finalPrescription: {} as never, timeConstraint }) as FinalPrescriptionV2Result;
}

describe("A10 — applyV2TodayTimeConstraint", () => {
  it("no time given: the plan as is", () => {
    const p = plan(DH_90);
    expect(applyV2TodayTimeConstraint(p, result(undefined))).toBe(p);
  });

  it("the session fits: only a trace in triggered_rules (minutes, session, « fits »), nothing athlete-facing changes", () => {
    const p = plan(DH_90);
    const after = applyV2TodayTimeConstraint(p, result({ availableMinutes: 120, action: "fits", before, after: before }));
    expect(after.triggered_rules.at(-1)).toEqual({ layer: "ARBITRATION", rule_id: V2_TODAY_TIME_CONSTRAINT_RULE_ID, detail: "Temps disponible : 120 min. Avant : KEEP DH_TECHNICAL MODERATE 90 min. Action : fits.", signals_used: ["available_minutes_today"] });
    expect({ ...after, triggered_rules: p.triggered_rules }).toEqual(p);
  });

  it("DH 90 → 60-min window: MODIFY, final session / training 60, « raccourcie », DH section kept, M1's reasons kept first", () => {
    const after = applyV2TodayTimeConstraint(plan(DH_90), result({ availableMinutes: 60, action: "adapted", before, after: { decision: "MODIFY", kind: "DH_TECHNICAL", loadProfile: "MODERATE", durationMin: 60 } }));
    expect([after.decision, after.final_session, after.training.duration_min, after.dh_or_technical.active]).toEqual(["MODIFY", { kind: "DH_TECHNICAL", load_profile: "MODERATE", duration_min: 60 }, 60, true]);
    const sentence = "Tu as 60 min aujourd'hui : la séance a été raccourcie pour tenir dans ce temps.";
    expect(after.decision_reasoning!.map((r) => r.detail)).toEqual(["Fatigue générale.", sentence]);
    expect([after.training.objective, after.reasoning]).toEqual([sentence, `Fatigue générale. ${sentence}`]);
    expect(after.triggered_rules.at(-1)!.detail).toBe("Temps disponible : 60 min. Avant : KEEP DH_TECHNICAL MODERATE 90 min. Action : adapted → MODIFY DH_TECHNICAL MODERATE 60 min.");
  });

  it("Force MODERATE → LIGHT: « allégée »", () => {
    const force = { decision: "KEEP" as const, kind: "STRENGTH_LOWER", loadProfile: "MODERATE" as const, durationMin: 60 };
    const after = applyV2TodayTimeConstraint(plan({ kind: "STRENGTH_LOWER", load_profile: "MODERATE", duration_min: 60 }), result({ availableMinutes: 45, action: "adapted", before: force, after: { ...force, decision: "MODIFY", loadProfile: "LIGHT", durationMin: 45 } }));
    expect(after.training.objective).toBe("Tu as 45 min aujourd'hui : la séance a été allégée pour tenir dans ce temps.");
  });

  it("DH → active recovery: REPLACE, no duration (a range), DH section off", () => {
    const after = applyV2TodayTimeConstraint(plan(DH_90), result({ availableMinutes: 30, action: "adapted", before, after: { decision: "REPLACE", kind: "RECOVERY_ACTIVE" } }));
    expect([after.decision, after.final_session, "duration_min" in after.training, after.dh_or_technical]).toEqual(["REPLACE", { kind: "RECOVERY_ACTIVE" }, false, { active: false }]);
    expect(after.training.objective).toBe("Tu as 30 min aujourd'hui : la séance prévue ne tient pas dans ce temps, récupération active à la place.");
  });

  it("REST: training inactive, the REST session, plain sentence", () => {
    const after = applyV2TodayTimeConstraint(plan(DH_90), result({ availableMinutes: 15, action: "rest", before, after: { decision: "REST", kind: "REST" } }, "none"));
    expect([after.decision, after.final_session, after.training.active, after.dh_or_technical.active]).toEqual(["REST", { kind: "REST" }, false, false]);
    expect(after.training.objective).toBe("Tu as 15 min aujourd'hui : aucune séance ne tient honnêtement dans ce temps, repos aujourd'hui.");
  });
});

// SPORT-SAFE-01R.3 (HPM option B) — A04's refusal kept beside A10's active-recovery alternative.
describe("SPORT-SAFE-01R.3 — A10 after an A04 modify_not_supported refusal", () => {
  const ENDURANCE_LIGHT_45: TrainingIntervention = { kind: "AEROBIC_BASE", load_profile: "LIGHT", duration_min: 45 };
  const refusedBefore = { decision: "MODIFY" as const, kind: "AEROBIC_BASE", loadProfile: "LIGHT" as const, durationMin: 45 };
  const refusal = { code: "final_prescription_adaptation_not_defined" as const, detail: { reason: "modify_not_supported", planned: "MODERATE", final: "LIGHT", durationMin: 45 } };

  it("alternative selected: REPLACE active recovery; the refusal traced first (A04_MODIFY_NOT_SUPPORTED), then A10; the sentence says the planned session is not offered", () => {
    const r = { ...result({ availableMinutes: 30, action: "adapted", before: refusedBefore, after: { decision: "REPLACE", kind: "RECOVERY_ACTIVE" } }), refusedModify: refusal } as FinalPrescriptionV2Result;
    const after = applyV2TodayTimeConstraint(plan(ENDURANCE_LIGHT_45, "MODIFY"), r);
    expect([after.decision, after.final_session, after.training.active]).toEqual(["REPLACE", { kind: "RECOVERY_ACTIVE" }, true]);
    const sentence = "Tu as 30 min aujourd'hui : la séance prévue n'est pas proposée (NALYNT n'en a pas de version guidée plus légère, et elle ne tient pas dans ce temps). Autre séance à la place : récupération active.";
    expect(after.triggered_rules.slice(-2)).toEqual([
      { layer: "ARBITRATION", rule_id: A04_MODIFY_NOT_SUPPORTED_RULE_ID, detail: "Séance décidée refusée : MODIFY AEROBIC_BASE LIGHT 45 min. Aucune version guidée plus légère que la séance de référence (modify_not_supported).", signals_used: [] },
      { layer: "ARBITRATION", rule_id: V2_TODAY_TIME_CONSTRAINT_RULE_ID, detail: "Temps disponible : 30 min. Avant : MODIFY AEROBIC_BASE LIGHT 45 min. Action : adapted → REPLACE RECOVERY_ACTIVE.", signals_used: ["available_minutes_today"] },
    ]);
    expect([after.training.objective, after.decision_reasoning!.map((x) => x.detail)]).toEqual([sentence, ["Fatigue générale.", sentence]]);
  });

  it("no admissible alternative: the refusal stands, a trace only (« no_alternative »), nothing athlete-facing changes", () => {
    const p = plan(ENDURANCE_LIGHT_45, "MODIFY");
    const after = applyV2TodayTimeConstraint(p, result({ availableMinutes: 15, action: "no_alternative", before: refusedBefore, after: refusedBefore }));
    expect(after.triggered_rules.at(-1)!.detail).toBe("Temps disponible : 15 min. Avant : MODIFY AEROBIC_BASE LIGHT 45 min. Action : no_alternative.");
    expect({ ...after, triggered_rules: p.triggered_rules }).toEqual(p);
  });

  it("an ordinary A10 recovery (no refusal): the existing sentence, no A04 trace (unchanged)", () => {
    const after = applyV2TodayTimeConstraint(plan(ENDURANCE_LIGHT_45, "MODIFY"), result({ availableMinutes: 30, action: "adapted", before: refusedBefore, after: { decision: "REPLACE", kind: "RECOVERY_ACTIVE" } }));
    expect(after.training.objective).toBe("Tu as 30 min aujourd'hui : la séance prévue ne tient pas dans ce temps, récupération active à la place.");
    expect(after.triggered_rules.some((t) => t.rule_id === A04_MODIFY_NOT_SUPPORTED_RULE_ID)).toBe(false);
  });
});
