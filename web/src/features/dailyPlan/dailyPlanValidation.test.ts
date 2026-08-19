import { describe, expect, it } from "vitest";
import { isValidDailyRunResponse } from "./dailyPlanValidation";

const VALID_RESPONSE = {
  dailyPlan: { date: "2026-08-19", active_mode: "IN_SEASON", decision: "KEEP", confidence: "MEDIUM", reasoning: "Tout va bien." },
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
    expect(isValidDailyRunResponse({ ...VALID_RESPONSE, dailyPlan: { ...VALID_RESPONSE.dailyPlan, decision: "INVENT" } })).toBe(false);
    expect(isValidDailyRunResponse({ ...VALID_RESPONSE, dailyPlan: { ...VALID_RESPONSE.dailyPlan, confidence: "SUPER_HIGH" } })).toBe(false);
    expect(isValidDailyRunResponse({ ...VALID_RESPONSE, dailyPlan: { ...VALID_RESPONSE.dailyPlan, active_mode: "MADE_UP" } })).toBe(false);
  });

  it("rejects a non-string reasoning", () => {
    expect(isValidDailyRunResponse({ ...VALID_RESPONSE, dailyPlan: { ...VALID_RESPONSE.dailyPlan, reasoning: 42 } })).toBe(false);
  });
});
