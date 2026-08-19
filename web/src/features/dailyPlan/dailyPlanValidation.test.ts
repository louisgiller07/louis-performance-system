import { describe, expect, it } from "vitest";
import { isValidDailyRunResponse } from "./dailyPlanValidation";

const VALID_DAILY_PLAN = {
  active_mode: "IN_SEASON",
  training: { active: true, session_type: { kind: "AEROBIC_BASE", load_profile: "MODERATE" }, objective: "Base aérobie" },
  dh_or_technical: { active: false },
  mental: { active: false },
  recovery: { active: true, actions: ["Étirements 10 min"] },
  nutrition: { active: false },
  sleep: { active: true, target_hours: 8 },
  protection: { do_not_do: [] },
  monitoring: { observe: [] },
  reasoning: "Tout va bien.",
  confidence: "MEDIUM",
  triggered_rules: [],
  planned_session_before: { kind: "AEROBIC_BASE", load_profile: "MODERATE" },
  final_session: { kind: "AEROBIC_BASE", load_profile: "MODERATE" },
  decision: "KEEP",
  overrode_race_protocol: false,
  engine_version: "1.0.0",
};

const VALID_RESPONSE = {
  dailyPlan: VALID_DAILY_PLAN,
  decisionId: "11111111-1111-1111-1111-111111111111",
  healthFlagId: null,
  warnings: [],
};

describe("isValidDailyRunResponse", () => {
  it("accepts a real, well-formed response", () => {
    expect(isValidDailyRunResponse(VALID_RESPONSE)).toBe(true);
  });

  it("accepts a non-null healthFlagId and a non-empty warnings array", () => {
    expect(
      isValidDailyRunResponse({
        ...VALID_RESPONSE,
        healthFlagId: "33333333-3333-3333-3333-333333333333",
        warnings: ["une alerte"],
      })
    ).toBe(true);
  });

  it("accepts a null planned_session_before (no prior planned session)", () => {
    expect(
      isValidDailyRunResponse({
        ...VALID_RESPONSE,
        dailyPlan: { ...VALID_DAILY_PLAN, planned_session_before: null },
      })
    ).toBe(true);
  });

  it("rejects null/undefined/non-object payloads", () => {
    expect(isValidDailyRunResponse(null)).toBe(false);
    expect(isValidDailyRunResponse(undefined)).toBe(false);
    expect(isValidDailyRunResponse("not an object")).toBe(false);
    expect(isValidDailyRunResponse(42)).toBe(false);
  });

  it("rejects a missing/non-string decisionId", () => {
    expect(isValidDailyRunResponse({ ...VALID_RESPONSE, decisionId: undefined })).toBe(false);
    expect(isValidDailyRunResponse({ ...VALID_RESPONSE, decisionId: 123 })).toBe(false);
  });

  it("rejects a healthFlagId that is neither null nor a string", () => {
    expect(isValidDailyRunResponse({ ...VALID_RESPONSE, healthFlagId: 123 })).toBe(false);
  });

  it("rejects a non-array or non-string-array warnings", () => {
    expect(isValidDailyRunResponse({ ...VALID_RESPONSE, warnings: "not an array" })).toBe(false);
    expect(isValidDailyRunResponse({ ...VALID_RESPONSE, warnings: [1, 2] })).toBe(false);
  });

  it("rejects a missing dailyPlan", () => {
    expect(isValidDailyRunResponse({ ...VALID_RESPONSE, dailyPlan: undefined })).toBe(false);
  });

  it("rejects an out-of-enum decision/confidence/active_mode", () => {
    expect(isValidDailyRunResponse({ ...VALID_RESPONSE, dailyPlan: { ...VALID_DAILY_PLAN, decision: "INVENT" } })).toBe(false);
    expect(isValidDailyRunResponse({ ...VALID_RESPONSE, dailyPlan: { ...VALID_DAILY_PLAN, confidence: "SUPER_HIGH" } })).toBe(false);
    expect(isValidDailyRunResponse({ ...VALID_RESPONSE, dailyPlan: { ...VALID_DAILY_PLAN, active_mode: "MADE_UP" } })).toBe(false);
  });

  it("rejects a non-string reasoning", () => {
    expect(isValidDailyRunResponse({ ...VALID_RESPONSE, dailyPlan: { ...VALID_DAILY_PLAN, reasoning: 42 } })).toBe(false);
  });

  it("rejects a missing section (e.g. recovery) or a section missing its required array", () => {
    expect(isValidDailyRunResponse({ ...VALID_RESPONSE, dailyPlan: { ...VALID_DAILY_PLAN, recovery: undefined } })).toBe(false);
    expect(isValidDailyRunResponse({ ...VALID_RESPONSE, dailyPlan: { ...VALID_DAILY_PLAN, recovery: { active: true } } })).toBe(false);
    expect(isValidDailyRunResponse({ ...VALID_RESPONSE, dailyPlan: { ...VALID_DAILY_PLAN, protection: { do_not_do: "not an array" } } })).toBe(false);
  });

  it("rejects a final_session missing a kind, or a malformed triggered_rules entry", () => {
    expect(isValidDailyRunResponse({ ...VALID_RESPONSE, dailyPlan: { ...VALID_DAILY_PLAN, final_session: {} } })).toBe(false);
    expect(
      isValidDailyRunResponse({
        ...VALID_RESPONSE,
        dailyPlan: { ...VALID_DAILY_PLAN, triggered_rules: [{ layer: "A", rule_id: "A1" }] },
      })
    ).toBe(false);
  });
});
