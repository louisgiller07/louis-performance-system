import { describe, expect, it } from "vitest";
import {
  InvalidSourceRowError,
  mapCompletedSessionRow,
  mapDailyCheckinRow,
  mapDecisionOutcomeRow,
  mapDecisionRow,
  mapHealthFlagRow,
} from "../../src/supabase/rowMapping.js";

describe("mapDailyCheckinRow", () => {
  const FULL_ROW = {
    id: "c1", athlete_id: "a1", checkin_date: "2026-08-19", submitted_at: "2026-08-19T07:00:00Z",
    sleep_hours: 7.5, sleep_quality: 8, sleep_wake_ups: 1,
    energy: 6, leg_fatigue: 3, grip_fatigue: 2, motivation: 7, work_stress: 4,
    pain: true, pain_intensity: 5, pain_new: false, pain_location_code: "knee_L",
    pain_traumatic: false, pain_function_loss: false, pain_getting_worse: true,
    suspected_concussion: false, fever_or_illness: false, free_comment: "sore knee",
  };

  it("maps a full, valid row exactly", () => {
    expect(mapDailyCheckinRow(FULL_ROW)).toEqual({
      id: "c1", athleteId: "a1", checkinDate: "2026-08-19", submittedAt: "2026-08-19T07:00:00Z",
      sleepHours: 7.5, sleepQuality: 8, sleepWakeUps: 1,
      energy: 6, legFatigue: 3, gripFatigue: 2, motivation: 7, workStress: 4,
      pain: true, painIntensity: 5, painNew: false, painLocationCode: "knee_L",
      painTraumatic: false, painFunctionLoss: false, painGettingWorse: true,
      suspectedConcussion: false, feverOrIllness: false, freeComment: "sore knee",
    });
  });

  it("preserves nullable fields as null, never fabricating a default", () => {
    const row = {
      ...FULL_ROW, pain: false, pain_intensity: null, pain_new: null, pain_location_code: null,
      pain_traumatic: null, pain_function_loss: null, pain_getting_worse: null,
      sleep_hours: null, free_comment: null,
    };
    const mapped = mapDailyCheckinRow(row);
    expect(mapped.painIntensity).toBeNull();
    expect(mapped.painNew).toBeNull();
    expect(mapped.painLocationCode).toBeNull();
    expect(mapped.painTraumatic).toBeNull();
    expect(mapped.sleepHours).toBeNull();
    expect(mapped.freeComment).toBeNull();
    // pain itself is NOT NULL in the DB — false is a real, distinct value from null.
    expect(mapped.pain).toBe(false);
  });

  it("rejects an unrecognized pain_location_code instead of coercing it", () => {
    expect(() => mapDailyCheckinRow({ ...FULL_ROW, pain_location_code: "not_a_real_location" })).toThrow(InvalidSourceRowError);
  });

  it("rejects a missing required field", () => {
    const { id: _id, ...withoutId } = FULL_ROW;
    expect(() => mapDailyCheckinRow(withoutId)).toThrow(InvalidSourceRowError);
  });

  it("rejects a wrong-typed required boolean", () => {
    expect(() => mapDailyCheckinRow({ ...FULL_ROW, pain: "yes" })).toThrow(InvalidSourceRowError);
  });
});

describe("mapDecisionRow", () => {
  const FULL_ROW = {
    id: "d1", athlete_id: "a1", decision_date: "2026-08-19", computed_at: "2026-08-19T08:00:00Z",
    final_session: "DH_TECHNICAL", planned_session_before: "AEROBIC_BASE",
    active_mode: "IN_SEASON", confidence_level: "MEDIUM",
    daily_plan: { decision: "KEEP", reasoning: "fine" },
    engine_version: "1.0.0", overridden_by_user: false, override_reason: null,
    source_checkin_id: "c1",
  };

  it("maps a full, valid row exactly", () => {
    expect(mapDecisionRow(FULL_ROW)).toEqual({
      id: "d1", athleteId: "a1", decisionDate: "2026-08-19", computedAt: "2026-08-19T08:00:00Z",
      finalSession: "DH_TECHNICAL", plannedSessionBefore: "AEROBIC_BASE",
      activeMode: "IN_SEASON", confidenceLevel: "MEDIUM",
      dailyPlan: { decision: "KEEP", reasoning: "fine" },
      engineVersion: "1.0.0", overriddenByUser: false, overrideReason: null,
      sourceCheckinId: "c1",
    });
  });

  it("preserves daily_plan JSON verbatim (object identity of content, not just presence)", () => {
    const complexPlan = { nested: { array: [1, 2, 3], flag: true }, note: "édge cases: unicode, \"quotes\"" };
    const mapped = mapDecisionRow({ ...FULL_ROW, daily_plan: complexPlan });
    expect(mapped.dailyPlan).toEqual(complexPlan);
  });

  it("treats a pre-M2 row (active_mode/confidence_level/daily_plan all null) as valid, not an error", () => {
    const legacyRow = { ...FULL_ROW, active_mode: null, confidence_level: null, daily_plan: null };
    const mapped = mapDecisionRow(legacyRow);
    expect(mapped.activeMode).toBeNull();
    expect(mapped.confidenceLevel).toBeNull();
    expect(mapped.dailyPlan).toBeNull();
  });

  it("rejects an unrecognized final_session enum value", () => {
    expect(() => mapDecisionRow({ ...FULL_ROW, final_session: "NOT_A_REAL_SESSION_TYPE" })).toThrow(InvalidSourceRowError);
  });

  it("rejects an unrecognized non-null active_mode", () => {
    expect(() => mapDecisionRow({ ...FULL_ROW, active_mode: "MADE_UP_MODE" })).toThrow(InvalidSourceRowError);
  });

  it("rejects an unrecognized non-null confidence_level", () => {
    expect(() => mapDecisionRow({ ...FULL_ROW, confidence_level: "SUPER_HIGH" })).toThrow(InvalidSourceRowError);
  });
});

describe("mapCompletedSessionRow", () => {
  const FULL_ROW = {
    id: "s1", athlete_id: "a1", session_date: "2026-08-19", decision_id: "d1", planned_session_id: "p1",
    session_type: "DH_PERFORMANCE", completion_status: "done",
    actual_duration_min: 90, rpe: 7, session_load: 63,
    intervention: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" }, main_content: { notes: "good" },
    post_leg_fatigue: 6, post_grip_fatigue: 5, new_pain: false, new_pain_note: null,
  };

  it("maps a full, valid row exactly", () => {
    expect(mapCompletedSessionRow(FULL_ROW)).toEqual({
      id: "s1", athleteId: "a1", sessionDate: "2026-08-19", decisionId: "d1", plannedSessionId: "p1",
      sessionType: "DH_PERFORMANCE", completionStatus: "done",
      actualDurationMin: 90, rpe: 7, sessionLoad: 63,
      intervention: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" }, mainContent: { notes: "good" },
      postLegFatigue: 6, postGripFatigue: 5, newPain: false, newPainNote: null,
    });
  });

  it("preserves nullable relationship IDs and JSON fields as null", () => {
    const row = { ...FULL_ROW, decision_id: null, planned_session_id: null, intervention: null, main_content: null };
    const mapped = mapCompletedSessionRow(row);
    expect(mapped.decisionId).toBeNull();
    expect(mapped.plannedSessionId).toBeNull();
    expect(mapped.intervention).toBeNull();
    expect(mapped.mainContent).toBeNull();
  });

  it("rejects an unrecognized completion_status", () => {
    expect(() => mapCompletedSessionRow({ ...FULL_ROW, completion_status: "finished" })).toThrow(InvalidSourceRowError);
  });

  it("rejects an unrecognized session_type", () => {
    expect(() => mapCompletedSessionRow({ ...FULL_ROW, session_type: "YOGA" })).toThrow(InvalidSourceRowError);
  });
});

describe("mapDecisionOutcomeRow", () => {
  const FULL_ROW = {
    id: "o1", athlete_id: "a1", decision_id: "d1", horizon: "J_PLUS_3",
    calculator_id: "baseline_deltas", calculator_version: "v1",
    input_snapshot: { energy_before: 6, energy_after: 8 }, outcome_signals: { energy_delta: 2 },
    calculated_at: "2026-08-22T00:00:00Z", created_at: "2026-08-22T00:00:00Z",
  };

  it("maps a full, valid row exactly", () => {
    expect(mapDecisionOutcomeRow(FULL_ROW)).toEqual({
      id: "o1", athleteId: "a1", decisionId: "d1", horizon: "J_PLUS_3",
      calculatorId: "baseline_deltas", calculatorVersion: "v1",
      inputSnapshot: { energy_before: 6, energy_after: 8 }, outcomeSignals: { energy_delta: 2 },
      calculatedAt: "2026-08-22T00:00:00Z", createdAt: "2026-08-22T00:00:00Z",
    });
  });

  it("rejects an unrecognized horizon", () => {
    expect(() => mapDecisionOutcomeRow({ ...FULL_ROW, horizon: "J_PLUS_2" })).toThrow(InvalidSourceRowError);
  });

  it("rejects input_snapshot that is not a JSON object (e.g. an array)", () => {
    expect(() => mapDecisionOutcomeRow({ ...FULL_ROW, input_snapshot: [1, 2, 3] })).toThrow(InvalidSourceRowError);
  });

  it("rejects a missing outcome_signals", () => {
    const { outcome_signals: _os, ...withoutSignals } = FULL_ROW;
    expect(() => mapDecisionOutcomeRow(withoutSignals)).toThrow(InvalidSourceRowError);
  });
});

describe("mapHealthFlagRow", () => {
  const FULL_ROW = {
    id: "h1", athlete_id: "a1", flag_date: "2026-08-15", flag_type: "pain_persistent", status: "monitoring",
    description: "Knee pain 3 days running", body_location: "knee_L", intensity: 4,
    professional_consulted: true, professional_type: "physio",
    resolved_at: null, resolution_note: null, source_checkin_id: "c1", created_at: "2026-08-15T09:00:00Z",
  };

  it("maps a full, valid row exactly", () => {
    expect(mapHealthFlagRow(FULL_ROW)).toEqual({
      id: "h1", athleteId: "a1", flagDate: "2026-08-15", flagType: "pain_persistent", status: "monitoring",
      description: "Knee pain 3 days running", bodyLocation: "knee_L", intensity: 4,
      professionalConsulted: true, professionalType: "physio",
      resolvedAt: null, resolutionNote: null, sourceCheckinId: "c1", createdAt: "2026-08-15T09:00:00Z",
    });
  });

  it("preserves resolution fields once a flag is actually resolved", () => {
    const resolvedRow = { ...FULL_ROW, status: "resolved", resolved_at: "2026-08-20", resolution_note: "Cleared by physio" };
    const mapped = mapHealthFlagRow(resolvedRow);
    expect(mapped.status).toBe("resolved");
    expect(mapped.resolvedAt).toBe("2026-08-20");
    expect(mapped.resolutionNote).toBe("Cleared by physio");
  });

  it("rejects an unrecognized flag_type", () => {
    expect(() => mapHealthFlagRow({ ...FULL_ROW, flag_type: "made_up_type" })).toThrow(InvalidSourceRowError);
  });

  it("rejects an unrecognized status", () => {
    expect(() => mapHealthFlagRow({ ...FULL_ROW, status: "closed" })).toThrow(InvalidSourceRowError);
  });
});
