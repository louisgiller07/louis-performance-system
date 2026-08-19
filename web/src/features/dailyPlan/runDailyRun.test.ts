import { describe, expect, it, vi, beforeEach } from "vitest";
import { runDailyRun } from "./runDailyRun";

vi.mock("../../lib/supabase", () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));

import { supabase } from "../../lib/supabase";

const mockedInvoke = supabase.functions.invoke as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetAllMocks();
});

const SUCCESS_RESPONSE = {
  dailyPlan: { date: "2026-08-19", active_mode: "IN_SEASON", decision: "KEEP", confidence: "MEDIUM", reasoning: "Tout va bien." },
  decisionId: "11111111-1111-1111-1111-111111111111",
  healthFlagId: null,
  warnings: [],
};

describe("runDailyRun", () => {
  it("invokes daily-run with exactly { date } as the body — no athlete_id, no other field", async () => {
    mockedInvoke.mockResolvedValue({ data: SUCCESS_RESPONSE, error: null });

    await runDailyRun("2026-08-19");

    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    expect(mockedInvoke).toHaveBeenCalledWith("daily-run", { body: { date: "2026-08-19" } });
    const [, options] = mockedInvoke.mock.calls[0];
    expect(Object.keys(options.body)).toEqual(["date"]);
    expect(options.body.athlete_id).toBeUndefined();
    expect(options.body.user_id).toBeUndefined();
  });

  it("returns the success response unchanged", async () => {
    mockedInvoke.mockResolvedValue({ data: SUCCESS_RESPONSE, error: null });

    const result = await runDailyRun("2026-08-19");

    expect(result).toEqual({ ok: true, data: SUCCESS_RESPONSE });
  });

  it("returns ok:false with a mapped error when invoke fails", async () => {
    mockedInvoke.mockResolvedValue({ data: null, error: new Error("boom") });

    const result = await runDailyRun("2026-08-19");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBeDefined();
    }
  });

  it("returns ok:false when the function responds with no data and no error", async () => {
    mockedInvoke.mockResolvedValue({ data: null, error: null });

    const result = await runDailyRun("2026-08-19");

    expect(result.ok).toBe(false);
  });

  it("returns ok:false with code=invalid_response for a malformed success payload, without crashing", async () => {
    mockedInvoke.mockResolvedValue({ data: { dailyPlan: { decision: "NOT_A_REAL_DECISION" } }, error: null });

    const result = await runDailyRun("2026-08-19");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_response");
      expect(result.error.retryable).toBe(true);
    }
  });
});
