import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runDailyFor, DailyPlanDateMismatchError, type RunDailyForDeps } from "../../src/supabase/runDailyFor.js";
import { mapDailyPlanToDecisionRow } from "../../src/supabase/mapping/dailyPlanToDecisionRow.js";
import { computeDailyFor, type ComputeDailyForResult } from "../../src/supabase/computeDailyFor.js";
import { persistDailyRun, type PersistDailyRunResult } from "../../src/supabase/persistDailyRun.js";
import type { DailyPlan, RawContext } from "../../src/types/index.js";

const ATHLETE_ID = "athlete-1";
const TODAY = "2026-08-16";

function buildFixtureDailyPlan(overrides: Partial<DailyPlan> = {}): DailyPlan {
  return {
    date: TODAY,
    active_mode: "IN_SEASON",
    training: { active: true, session_type: { kind: "AEROBIC_BASE", load_profile: "MODERATE" } },
    dh_or_technical: { active: false },
    mental: { active: false },
    recovery: { active: false, actions: [] },
    nutrition: { active: false },
    sleep: { active: false },
    protection: { do_not_do: [] },
    monitoring: { observe: [] },
    reasoning: "Aucun signal particulier.",
    confidence: "MEDIUM",
    triggered_rules: [],
    planned_session_before: null,
    final_session: { kind: "AEROBIC_BASE", load_profile: "MODERATE" },
    decision: "KEEP",
    overrode_race_protocol: false,
    engine_version: "v0.2",
    ...overrides,
  };
}

const FAKE_RAW_CONTEXT = {} as RawContext;
const FAKE_CLIENT = {} as SupabaseClient;

function buildDeps(dailyPlan: DailyPlan, persistResult: PersistDailyRunResult) {
  const computeDailyForMock = vi.fn<typeof computeDailyFor>(
    async (): Promise<ComputeDailyForResult> => ({
      rawContext: FAKE_RAW_CONTEXT,
      dailyPlan,
      warnings: [],
    })
  );
  const persistDailyRunMock = vi.fn<typeof persistDailyRun>(
    async (): Promise<PersistDailyRunResult> => persistResult
  );

  const deps: RunDailyForDeps = {
    computeDailyFor: computeDailyForMock,
    persistDailyRun: persistDailyRunMock,
  };

  return { deps, computeDailyForMock, persistDailyRunMock };
}

describe("M2 write path — runDailyFor orchestration (mocked deps, no live DB)", () => {
  it("calls computeDailyFor exactly once and persistDailyRun exactly once", async () => {
    const dailyPlan = buildFixtureDailyPlan();
    const { deps, computeDailyForMock, persistDailyRunMock } = buildDeps(dailyPlan, {
      decision_id: "d1",
      health_flag_id: null,
    });

    await runDailyFor(FAKE_CLIENT, ATHLETE_ID, TODAY, deps);

    expect(computeDailyForMock).toHaveBeenCalledTimes(1);
    expect(persistDailyRunMock).toHaveBeenCalledTimes(1);
  });

  it("passes p_health_flag = null when DailyPlan has no health_flag_to_create", async () => {
    const dailyPlan = buildFixtureDailyPlan({ health_flag_to_create: undefined });
    const { deps, persistDailyRunMock } = buildDeps(dailyPlan, { decision_id: "d1", health_flag_id: null });

    await runDailyFor(FAKE_CLIENT, ATHLETE_ID, TODAY, deps);

    const [, , healthFlagArg] = persistDailyRunMock.mock.calls[0]!;
    expect(healthFlagArg).toBeNull();
  });

  it("maps DailyPlan.health_flag_to_create to the persistence payload when present", async () => {
    const dailyPlan = buildFixtureDailyPlan({
      health_flag_to_create: { type: "concussion_suspect", reason: "Suspicion de commotion" },
      decision: "REST",
      final_session: { kind: "REST" },
    });
    const { deps, persistDailyRunMock } = buildDeps(dailyPlan, { decision_id: "d1", health_flag_id: "f1" });

    await runDailyFor(FAKE_CLIENT, ATHLETE_ID, TODAY, deps);

    const [, , healthFlagArg] = persistDailyRunMock.mock.calls[0]!;
    expect(healthFlagArg).toEqual({
      flag_type: "concussion_suspect",
      flag_date: TODAY,
      description: "Suspicion de commotion",
    });
  });

  it("passes a decisionRow that is exactly mapDailyPlanToDecisionRow's output", async () => {
    const dailyPlan = buildFixtureDailyPlan({ reasoning: "Custom reasoning for this test" });
    const { deps, persistDailyRunMock } = buildDeps(dailyPlan, { decision_id: "d1", health_flag_id: null });

    await runDailyFor(FAKE_CLIENT, ATHLETE_ID, TODAY, deps);

    const [, , , decisionRowArg] = persistDailyRunMock.mock.calls[0]!;
    expect(decisionRowArg).toEqual(mapDailyPlanToDecisionRow(dailyPlan, ATHLETE_ID));
  });

  it("returns computeDailyFor's result plus the persistence result", async () => {
    const dailyPlan = buildFixtureDailyPlan();
    const { deps } = buildDeps(dailyPlan, { decision_id: "d1", health_flag_id: null });

    const result = await runDailyFor(FAKE_CLIENT, ATHLETE_ID, TODAY, deps);

    expect(result.dailyPlan).toBe(dailyPlan);
    expect(result.persistence).toEqual({ decision_id: "d1", health_flag_id: null });
  });

  it("rejects and never calls persistDailyRun when DailyPlan.date does not match today", async () => {
    const dailyPlan = buildFixtureDailyPlan({ date: "2026-08-17" });
    const { deps, persistDailyRunMock } = buildDeps(dailyPlan, { decision_id: "d1", health_flag_id: null });

    await expect(runDailyFor(FAKE_CLIENT, ATHLETE_ID, TODAY, deps)).rejects.toThrow(DailyPlanDateMismatchError);
    expect(persistDailyRunMock).not.toHaveBeenCalled();
  });
});
