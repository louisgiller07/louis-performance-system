import { describe, expect, it } from "vitest";
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";
import { mapDailyRunError } from "./dailyRunErrors";

function httpError(status: number, body: unknown): FunctionsHttpError {
  const response = new Response(JSON.stringify(body), { status });
  return new FunctionsHttpError(response);
}

describe("mapDailyRunError", () => {
  it("parses the canonical {error:{code,message}} body from a FunctionsHttpError", async () => {
    const mapped = await mapDailyRunError(httpError(422, { error: { code: "no_checkin_for_date", message: "No check-in." } }));
    expect(mapped.code).toBe("no_checkin_for_date");
  });

  it("maps no_checkin_for_date to a user-fixable, non-retryable error", async () => {
    const mapped = await mapDailyRunError(httpError(422, { error: { code: "no_checkin_for_date" } }));
    expect(mapped.action).toBe("user_fixable");
    expect(mapped.retryable).toBe(false);
    expect(mapped.message).toMatch(/check-in/i);
  });

  it("maps pain_criteria_missing to a user-fixable error", async () => {
    const mapped = await mapDailyRunError(httpError(422, { error: { code: "pain_criteria_missing" } }));
    expect(mapped.action).toBe("user_fixable");
    expect(mapped.retryable).toBe(false);
  });

  it("maps checkin_incomplete to a user-fixable error", async () => {
    const mapped = await mapDailyRunError(httpError(422, { error: { code: "checkin_incomplete" } }));
    expect(mapped.action).toBe("user_fixable");
    expect(mapped.retryable).toBe(false);
  });

  it("maps no_current_training_block to a config_issue", async () => {
    const mapped = await mapDailyRunError(httpError(422, { error: { code: "no_current_training_block" } }));
    expect(mapped.action).toBe("config_issue");
    expect(mapped.retryable).toBe(false);
  });

  it("maps no_athlete_for_user to a config_issue", async () => {
    const mapped = await mapDailyRunError(httpError(403, { error: { code: "no_athlete_for_user" } }));
    expect(mapped.action).toBe("config_issue");
  });

  it("maps persistence_failed to a retryable error", async () => {
    const mapped = await mapDailyRunError(httpError(500, { error: { code: "persistence_failed" } }));
    expect(mapped.retryable).toBe(true);
    expect(mapped.action).toBe("retry");
  });

  it("maps internal_error to a generic retryable error", async () => {
    const mapped = await mapDailyRunError(httpError(500, { error: { code: "internal_error" } }));
    expect(mapped.retryable).toBe(true);
    expect(mapped.action).toBe("retry");
  });

  it("maps any 401 to a session_issue, regardless of body shape (gateway body is flat {code,message})", async () => {
    const mapped = await mapDailyRunError(httpError(401, { code: "UNAUTHORIZED_NO_AUTH_HEADER", message: "Missing authorization header" }));
    expect(mapped.action).toBe("session_issue");
    expect(mapped.retryable).toBe(false);
  });

  it("maps FunctionsRelayError to a retryable network error", async () => {
    const error = new FunctionsRelayError(new Response(null, { status: 502 }));
    const mapped = await mapDailyRunError(error);
    expect(mapped.code).toBe("network_error");
    expect(mapped.retryable).toBe(true);
    expect(mapped.action).toBe("retry");
  });

  it("maps FunctionsFetchError to a retryable network error", async () => {
    const error = new FunctionsFetchError(new TypeError("Failed to fetch"));
    const mapped = await mapDailyRunError(error);
    expect(mapped.code).toBe("network_error");
    expect(mapped.retryable).toBe(true);
    expect(mapped.action).toBe("retry");
  });

  it("falls back to a generic retryable error for an unrecognized exception", async () => {
    const mapped = await mapDailyRunError(new Error("something unexpected"));
    expect(mapped.code).toBe("unknown_error");
    expect(mapped.retryable).toBe(true);
  });
});
