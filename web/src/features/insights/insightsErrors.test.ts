import { describe, expect, it } from "vitest";
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";
import { mapInsightsError, mapParsedInsightsError, parseFunctionsHttpError } from "./insightsErrors";

function httpError(status: number, body: unknown): FunctionsHttpError {
  const response = new Response(JSON.stringify(body), { status });
  return new FunctionsHttpError(response);
}

describe("mapInsightsError", () => {
  it("parses the canonical {error:{code,message}} body from a FunctionsHttpError", async () => {
    const mapped = await mapInsightsError(httpError(500, { error: { code: "internal_error", message: "..." } }));
    expect(mapped.code).toBe("internal_error");
    expect(mapped.retryable).toBe(true);
    expect(mapped.action).toBe("retry");
  });

  it("maps no_athlete_for_user to a config_issue", async () => {
    const mapped = await mapInsightsError(httpError(403, { error: { code: "no_athlete_for_user" } }));
    expect(mapped.action).toBe("config_issue");
    expect(mapped.retryable).toBe(false);
  });

  it("maps invalid_request to a retryable error", async () => {
    const mapped = await mapInsightsError(httpError(400, { error: { code: "invalid_request" } }));
    expect(mapped.retryable).toBe(true);
    expect(mapped.action).toBe("retry");
  });

  it("maps unsupported_insight_projector to a generic retryable server error", async () => {
    const mapped = await mapInsightsError(httpError(500, { error: { code: "unsupported_insight_projector" } }));
    expect(mapped.retryable).toBe(true);
    expect(mapped.action).toBe("retry");
  });

  it("maps any 401 to a session_issue, regardless of body shape", async () => {
    const mapped = await mapInsightsError(httpError(401, { code: "UNAUTHORIZED_NO_AUTH_HEADER" }));
    expect(mapped.action).toBe("session_issue");
    expect(mapped.retryable).toBe(false);
  });

  it("falls back to a generic error for an unrecognized code", async () => {
    const mapped = await mapInsightsError(httpError(500, { error: { code: "something_new" } }));
    expect(mapped.action).toBe("retry");
    expect(mapped.retryable).toBe(true);
  });

  it("maps FunctionsRelayError to a retryable network error", async () => {
    const mapped = await mapInsightsError(new FunctionsRelayError(new Response(null, { status: 502 })));
    expect(mapped.code).toBe("network_error");
    expect(mapped.retryable).toBe(true);
  });

  it("maps FunctionsFetchError to a retryable network error", async () => {
    const mapped = await mapInsightsError(new FunctionsFetchError(new TypeError("Failed to fetch")));
    expect(mapped.code).toBe("network_error");
    expect(mapped.retryable).toBe(true);
  });

  it("falls back to a generic retryable error for an unrecognized exception", async () => {
    const mapped = await mapInsightsError(new Error("something unexpected"));
    expect(mapped.code).toBe("unknown_error");
    expect(mapped.retryable).toBe(true);
  });

  it("never surfaces a raw error message in the mapped result", async () => {
    const mapped = await mapInsightsError(httpError(500, { error: { code: "internal_error", message: "permission denied for table pattern_insight_reviews" } }));
    expect(mapped.message).not.toMatch(/permission denied/);
    expect(mapped.message).not.toMatch(/pattern_insight_reviews/);
  });
});

describe("parseFunctionsHttpError + mapParsedInsightsError — used by insightsRepo.submitReview to read the body exactly once", () => {
  it("extracts status, code, and rawBody from a stale_candidate response", async () => {
    const candidate = { snapshot: { detectorRuleId: "x" }, reviewState: "unreviewed", currentReview: null };
    const error = httpError(409, { error: { code: "stale_candidate", message: "..." }, candidate });
    const parsed = await parseFunctionsHttpError(error);
    expect(parsed.status).toBe(409);
    expect(parsed.code).toBe("stale_candidate");
    expect((parsed.rawBody as { candidate: unknown }).candidate).toEqual(candidate);
  });

  it("mapParsedInsightsError produces the same mapping as mapInsightsError, without a second body read", async () => {
    const error = httpError(404, { error: { code: "candidate_not_found", message: "..." } });
    const parsed = await parseFunctionsHttpError(error);
    const mapped = mapParsedInsightsError(parsed);
    expect(mapped.code).toBe("candidate_not_found");
  });

  it("handles a non-JSON body gracefully (code undefined, generic mapping)", async () => {
    const response = new Response("not json", { status: 500 });
    const error = new FunctionsHttpError(response);
    const parsed = await parseFunctionsHttpError(error);
    expect(parsed.code).toBeUndefined();
    const mapped = mapParsedInsightsError(parsed);
    expect(mapped.action).toBe("retry");
  });
});
