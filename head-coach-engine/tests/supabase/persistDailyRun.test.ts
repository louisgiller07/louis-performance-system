import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  persistDailyRun,
  parsePersistDailyRunResult,
  PersistDailyRunRpcError,
  InvalidPersistDailyRunResultError,
} from "../../src/supabase/persistDailyRun.js";
import type { DecisionInsertRow } from "../../src/supabase/mapping/dailyPlanToDecisionRow.js";
import type { HealthFlagPersistencePayload } from "../../src/supabase/mapping/healthFlagToCreatePayload.js";
import type { DailyPlan } from "../../src/types/index.js";

function fakeClient(rpcImpl: (fn: string, params: unknown) => Promise<{ data: unknown; error: unknown }>) {
  return { rpc: vi.fn(rpcImpl) } as unknown as SupabaseClient;
}

const MINIMAL_DAILY_PLAN = { date: "2026-08-16" } as unknown as DailyPlan;

const DECISION_ROW: DecisionInsertRow = {
  athlete_id: "athlete-1",
  decision_date: "2026-08-16",
  planned_session_before: null,
  final_session: "REST",
  reason: "test",
  do_not_do: [],
  override_reason: null,
  engine_version: "v0.2",
  stop_conditions: null,
  daily_plan: MINIMAL_DAILY_PLAN,
  active_mode: "IN_SEASON",
  confidence_level: "HIGH",
};

const HEALTH_FLAG: HealthFlagPersistencePayload = {
  flag_type: "concussion_suspect",
  flag_date: "2026-08-16",
  description: "test",
};

describe("M2 write path — persistDailyRun", () => {
  it("constructs exactly the three RPC parameters, in the persist_daily_run call", async () => {
    const rpcImpl = vi.fn(async () => ({
      data: { decision_id: "d1", health_flag_id: null },
      error: null,
    }));
    const client = fakeClient(rpcImpl);

    await persistDailyRun(client, "athlete-1", null, DECISION_ROW);

    expect(rpcImpl).toHaveBeenCalledTimes(1);
    expect(rpcImpl).toHaveBeenCalledWith("persist_daily_run", {
      p_athlete_id: "athlete-1",
      p_health_flag: null,
      p_decision_row: DECISION_ROW,
    });
  });

  it("passes a non-null health flag through as p_health_flag", async () => {
    const rpcImpl = vi.fn(async () => ({
      data: { decision_id: "d1", health_flag_id: "f1" },
      error: null,
    }));
    const client = fakeClient(rpcImpl);

    await persistDailyRun(client, "athlete-1", HEALTH_FLAG, DECISION_ROW);

    expect(rpcImpl).toHaveBeenCalledWith("persist_daily_run", {
      p_athlete_id: "athlete-1",
      p_health_flag: HEALTH_FLAG,
      p_decision_row: DECISION_ROW,
    });
  });

  it("returns a correctly parsed result when health_flag_id is null", async () => {
    const client = fakeClient(async () => ({ data: { decision_id: "d1", health_flag_id: null }, error: null }));

    const result = await persistDailyRun(client, "athlete-1", null, DECISION_ROW);

    expect(result).toEqual({ decision_id: "d1", health_flag_id: null });
  });

  it("returns a correctly parsed result when health_flag_id is a string", async () => {
    const client = fakeClient(async () => ({ data: { decision_id: "d1", health_flag_id: "f1" }, error: null }));

    const result = await persistDailyRun(client, "athlete-1", HEALTH_FLAG, DECISION_ROW);

    expect(result).toEqual({ decision_id: "d1", health_flag_id: "f1" });
  });

  it("propagates a Supabase client error explicitly", async () => {
    const client = fakeClient(async () => ({ data: null, error: { message: "permission denied" } }));

    await expect(persistDailyRun(client, "athlete-1", null, DECISION_ROW)).rejects.toThrow(PersistDailyRunRpcError);
  });
});

describe("M2 write path — parsePersistDailyRunResult", () => {
  it("rejects data = null", () => {
    expect(() => parsePersistDailyRunResult(null)).toThrow(InvalidPersistDailyRunResultError);
  });

  it("rejects a missing decision_id", () => {
    expect(() => parsePersistDailyRunResult({ health_flag_id: null })).toThrow(InvalidPersistDailyRunResultError);
  });

  it("rejects a non-string decision_id", () => {
    expect(() => parsePersistDailyRunResult({ decision_id: 42, health_flag_id: null })).toThrow(
      InvalidPersistDailyRunResultError
    );
  });

  it("rejects a health_flag_id that is neither a string nor null", () => {
    expect(() => parsePersistDailyRunResult({ decision_id: "d1", health_flag_id: 42 })).toThrow(
      InvalidPersistDailyRunResultError
    );
  });

  it("rejects an array", () => {
    expect(() => parsePersistDailyRunResult(["d1", null])).toThrow(InvalidPersistDailyRunResultError);
  });

  it("accepts a well-formed result", () => {
    expect(parsePersistDailyRunResult({ decision_id: "d1", health_flag_id: "f1" })).toEqual({
      decision_id: "d1",
      health_flag_id: "f1",
    });
  });
});
