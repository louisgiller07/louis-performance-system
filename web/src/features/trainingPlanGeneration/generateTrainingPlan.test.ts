import { describe, expect, it, vi, beforeEach } from "vitest";
import { generateTrainingPlan } from "./generateTrainingPlan";

vi.mock("../../lib/supabase", () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));

import { supabase } from "../../lib/supabase";

const mockedInvoke = supabase.functions.invoke as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetAllMocks();
});

const GENERATION_REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const SUCCESS_RESPONSE = { planVersionId: "22222222-2222-4222-8222-222222222222", idempotentReplay: false };

describe("generateTrainingPlan — success", () => {
  it("invokes generate-training-plan with exactly { generationRequestId, durationWeeks } as the body — no other field", async () => {
    mockedInvoke.mockResolvedValue({ data: SUCCESS_RESPONSE, error: null });

    await generateTrainingPlan({ generationRequestId: GENERATION_REQUEST_ID, durationWeeks: 6 });

    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    expect(mockedInvoke).toHaveBeenCalledWith("generate-training-plan", {
      body: { generationRequestId: GENERATION_REQUEST_ID, durationWeeks: 6 },
    });
    const [, options] = mockedInvoke.mock.calls[0];
    expect(Object.keys(options.body)).toEqual(["generationRequestId", "durationWeeks"]);
    expect(options.body.block).toBeUndefined();
    expect(options.body.athleteId).toBeUndefined();
    expect(options.body.today).toBeUndefined();
    expect(options.body.plannerVersion).toBeUndefined();
    expect(options.body.catalogVersion).toBeUndefined();
    expect(options.body.inputSnapshot).toBeUndefined();
    expect(options.body.generationTrigger).toBeUndefined();
  });

  it("returns the success response unchanged", async () => {
    mockedInvoke.mockResolvedValue({ data: SUCCESS_RESPONSE, error: null });

    const result = await generateTrainingPlan({ generationRequestId: GENERATION_REQUEST_ID, durationWeeks: 6 });

    expect(result).toEqual({ ok: true, data: SUCCESS_RESPONSE });
  });
});

describe("generateTrainingPlan — idempotence (generationRequestId ownership)", () => {
  it("transmits the caller-supplied generationRequestId exactly, unchanged", async () => {
    mockedInvoke.mockResolvedValue({ data: SUCCESS_RESPONSE, error: null });

    await generateTrainingPlan({ generationRequestId: GENERATION_REQUEST_ID, durationWeeks: 6 });

    const [, options] = mockedInvoke.mock.calls[0];
    expect(options.body.generationRequestId).toBe(GENERATION_REQUEST_ID);
  });

  it("never mints a generationRequestId itself — crypto.randomUUID is never called by this client", async () => {
    const randomUUIDSpy = vi.spyOn(crypto, "randomUUID");
    mockedInvoke.mockResolvedValue({ data: SUCCESS_RESPONSE, error: null });

    await generateTrainingPlan({ generationRequestId: GENERATION_REQUEST_ID, durationWeeks: 6 });

    expect(randomUUIDSpy).not.toHaveBeenCalled();
    randomUUIDSpy.mockRestore();
  });

  it("rejects an empty generationRequestId locally, without calling the network", async () => {
    const result = await generateTrainingPlan({ generationRequestId: "", durationWeeks: 6 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_generation_request_id");
    expect(mockedInvoke).not.toHaveBeenCalled();
  });
});

describe("generateTrainingPlan — durationWeeks local validation", () => {
  it("accepts a positive integer durationWeeks and calls the network", async () => {
    mockedInvoke.mockResolvedValue({ data: SUCCESS_RESPONSE, error: null });

    const result = await generateTrainingPlan({ generationRequestId: GENERATION_REQUEST_ID, durationWeeks: 1 });

    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
  });

  it("rejects durationWeeks: 0 locally, without calling the network", async () => {
    const result = await generateTrainingPlan({ generationRequestId: GENERATION_REQUEST_ID, durationWeeks: 0 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_duration_weeks");
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("rejects a negative durationWeeks locally, without calling the network", async () => {
    const result = await generateTrainingPlan({ generationRequestId: GENERATION_REQUEST_ID, durationWeeks: -2 });

    expect(result.ok).toBe(false);
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("rejects a non-integer durationWeeks locally, without calling the network", async () => {
    const result = await generateTrainingPlan({ generationRequestId: GENERATION_REQUEST_ID, durationWeeks: 2.5 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_duration_weeks");
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("never enforces a maximum durationWeeks — no product limit is locked, so none is invented (a large value reaches the network unchanged)", async () => {
    mockedInvoke.mockResolvedValue({ data: SUCCESS_RESPONSE, error: null });

    const result = await generateTrainingPlan({ generationRequestId: GENERATION_REQUEST_ID, durationWeeks: 1000 });

    expect(mockedInvoke).toHaveBeenCalledWith("generate-training-plan", {
      body: { generationRequestId: GENERATION_REQUEST_ID, durationWeeks: 1000 },
    });
    expect(result.ok).toBe(true);
  });
});

describe("generateTrainingPlan — Edge Function errors", () => {
  it("returns ok:false with a mapped error when invoke fails, never a raw Supabase error", async () => {
    mockedInvoke.mockResolvedValue({ data: null, error: new Error("boom") });

    const result = await generateTrainingPlan({ generationRequestId: GENERATION_REQUEST_ID, durationWeeks: 6 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBeDefined();
      expect(result.error.message).not.toMatch(/boom/);
    }
  });

  // GenerationBlockedError (422) — the 4 canonical reasons must each map to
  // a distinct, exploitable, user-fixable error via mapGenerateTrainingPlanError
  // (unit-tested directly in generateTrainingPlanErrors.test.ts); this only
  // confirms the wiring end to end through generateTrainingPlan itself.
  it.each(["missing_availability", "missing_performance_profile", "missing_discipline", "missing_strength_experience_tier"])(
    "maps a GenerationBlockedError HTTP response (%s) to a user-fixable error",
    async (reason) => {
      const { FunctionsHttpError } = await import("@supabase/supabase-js");
      const response = new Response(JSON.stringify({ error: { code: reason, message: "ignored" } }), { status: 422 });
      mockedInvoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(response) });

      const result = await generateTrainingPlan({ generationRequestId: GENERATION_REQUEST_ID, durationWeeks: 6 });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(reason);
        expect(result.error.action).toBe("user_fixable");
        expect(result.error.retryable).toBe(false);
      }
    }
  );

  it("returns ok:false when the function responds with no data and no error", async () => {
    mockedInvoke.mockResolvedValue({ data: null, error: null });

    const result = await generateTrainingPlan({ generationRequestId: GENERATION_REQUEST_ID, durationWeeks: 6 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("empty_response");
  });
});

describe("generateTrainingPlan — malformed response rejection", () => {
  it("rejects an empty object response explicitly, never a partial/fake result", async () => {
    mockedInvoke.mockResolvedValue({ data: {}, error: null });

    const result = await generateTrainingPlan({ generationRequestId: GENERATION_REQUEST_ID, durationWeeks: 6 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_response");
  });

  it("rejects a response with the wrong field types (planVersionId: null, idempotentReplay as a string)", async () => {
    mockedInvoke.mockResolvedValue({ data: { planVersionId: null, idempotentReplay: "false" }, error: null });

    const result = await generateTrainingPlan({ generationRequestId: GENERATION_REQUEST_ID, durationWeeks: 6 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_response");
  });

  it("rejects a response with an empty-string planVersionId", async () => {
    mockedInvoke.mockResolvedValue({ data: { planVersionId: "", idempotentReplay: false }, error: null });

    const result = await generateTrainingPlan({ generationRequestId: GENERATION_REQUEST_ID, durationWeeks: 6 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_response");
  });
});
