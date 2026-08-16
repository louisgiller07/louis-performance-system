import { describe, it, expect } from "vitest";
import type { DailyPlan, Confidence } from "../../src/types/index.js";
import { mapDailyPlanToDecisionRow } from "../../src/supabase/mapping/dailyPlanToDecisionRow.js";

const ATHLETE_ID = "11111111-1111-4111-8111-111111111111";

function buildFixtureDailyPlan(overrides: Partial<DailyPlan> = {}): DailyPlan {
  return {
    date: "2026-08-16",
    active_mode: "IN_SEASON",
    training: { active: true, session_type: { kind: "AEROBIC_BASE", load_profile: "MODERATE" } },
    dh_or_technical: { active: false },
    mental: { active: false },
    recovery: { active: false, actions: [] },
    nutrition: { active: false },
    sleep: { active: false },
    protection: { do_not_do: ["no_grip_heavy"] },
    monitoring: { observe: ["leg_fatigue"] },
    reasoning: "Charge modérée, aucun signal SAFETY, plan maintenu.",
    confidence: "MEDIUM",
    triggered_rules: [{ layer: "C", rule_id: "C3.3", detail: "systemic amber" }],
    planned_session_before: { kind: "REST" },
    final_session: { kind: "AEROBIC_BASE", load_profile: "MODERATE" },
    decision: "MODIFY",
    overrode_race_protocol: false,
    engine_version: "v0.2",
    ...overrides,
  };
}

describe("M2_002 — mapDailyPlanToDecisionRow", () => {
  it.each<Confidence>(["LOW", "MEDIUM", "HIGH"])(
    "persists confidence %s verbatim into confidence_level, with no transformation",
    (confidence) => {
      const plan = buildFixtureDailyPlan({ confidence });

      const row = mapDailyPlanToDecisionRow(plan, ATHLETE_ID);

      expect(row.confidence_level).toBe(confidence);
    }
  );

  it("never produces a legacy numeric `confidence` field", () => {
    const row = mapDailyPlanToDecisionRow(buildFixtureDailyPlan(), ATHLETE_ID);

    expect(row).not.toHaveProperty("confidence");
    expect(Object.keys(row)).not.toContain("confidence");
  });

  it("never produces `overridden_by_user` — a M2 decision can be prepared without it", () => {
    const row = mapDailyPlanToDecisionRow(buildFixtureDailyPlan(), ATHLETE_ID);

    expect(row).not.toHaveProperty("overridden_by_user");
  });

  it("preserves the complete DailyPlan in daily_plan", () => {
    const plan = buildFixtureDailyPlan();

    const row = mapDailyPlanToDecisionRow(plan, ATHLETE_ID);

    expect(row.daily_plan).toEqual(plan);
  });

  it("maps active_mode from the DailyPlan's active_mode", () => {
    const plan = buildFixtureDailyPlan({ active_mode: "RACE_WEEK" });

    const row = mapDailyPlanToDecisionRow(plan, ATHLETE_ID);

    expect(row.active_mode).toBe("RACE_WEEK");
  });

  it("builds the mandatory SQL fields (athlete_id, decision_date, reason, final_session) from the plan and athlete id", () => {
    const plan = buildFixtureDailyPlan({
      date: "2026-08-20",
      reasoning: "Séance maintenue, aucune adaptation nécessaire.",
      final_session: { kind: "DH_TECHNICAL", load_profile: "LIGHT" },
    });

    const row = mapDailyPlanToDecisionRow(plan, ATHLETE_ID);

    expect(row.athlete_id).toBe(ATHLETE_ID);
    expect(row.decision_date).toBe("2026-08-20");
    expect(row.reason).toBe("Séance maintenue, aucune adaptation nécessaire.");
    expect(row.final_session).toBe("DH_TECHNICAL");
  });

  it("maps planned_session_before through the deterministic TrainingIntervention → DbSessionType mapping", () => {
    const plan = buildFixtureDailyPlan({ planned_session_before: { kind: "BIKE_MAINTENANCE" } });

    const row = mapDailyPlanToDecisionRow(plan, ATHLETE_ID);

    expect(row.planned_session_before).toBe("BIKE_MAINTENANCE");
  });

  it("leaves planned_session_before null when the plan had no prior planned session", () => {
    const plan = buildFixtureDailyPlan({ planned_session_before: null });

    const row = mapDailyPlanToDecisionRow(plan, ATHLETE_ID);

    expect(row.planned_session_before).toBeNull();
  });

  it("maps do_not_do, override_reason and engine_version from the plan", () => {
    const plan = buildFixtureDailyPlan({
      override_reason: "Override RaceProtocol T-2 (strong): planned_intent justifié",
      engine_version: "v0.2",
    });

    const row = mapDailyPlanToDecisionRow(plan, ATHLETE_ID);

    expect(row.do_not_do).toEqual(["no_grip_heavy"]);
    expect(row.override_reason).toBe("Override RaceProtocol T-2 (strong): planned_intent justifié");
    expect(row.engine_version).toBe("v0.2");
  });

  it("defaults override_reason to null when the plan does not carry one", () => {
    const plan = buildFixtureDailyPlan({ override_reason: undefined });

    const row = mapDailyPlanToDecisionRow(plan, ATHLETE_ID);

    expect(row.override_reason).toBeNull();
  });

  it("always sets stop_conditions to null, overriding the DB default of '[]'", () => {
    const row = mapDailyPlanToDecisionRow(buildFixtureDailyPlan(), ATHLETE_ID);

    expect(row.stop_conditions).toBeNull();
  });
});
