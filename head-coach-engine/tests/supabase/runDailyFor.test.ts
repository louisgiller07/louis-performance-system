import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runDailyFor, DailyPlanDateMismatchError, type RunDailyForDeps } from "../../src/supabase/runDailyFor.js";
import { mapDailyPlanToDecisionRow } from "../../src/supabase/mapping/dailyPlanToDecisionRow.js";
import { computeDailyFor, type ComputeDailyForResult } from "../../src/supabase/computeDailyFor.js";
import { persistDailyRun, type PersistDailyRunResult } from "../../src/supabase/persistDailyRun.js";
import {
  getAthleteCoachingContext,
  type AthleteCoachingContext,
} from "../../src/supabase/repositories/athleteCoachingContextRepo.js";
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

/** V0.3_011 default: no onboarding context at all — every existing test (written before personalization existed) must keep seeing byte-for-byte unchanged reasoning. */
const NO_CONTEXT: AthleteCoachingContext = { athlete_id: ATHLETE_ID };

function buildDeps(
  dailyPlan: DailyPlan,
  persistResult: PersistDailyRunResult,
  athleteContext: AthleteCoachingContext | (() => Promise<AthleteCoachingContext>) = NO_CONTEXT
) {
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
  const getAthleteCoachingContextMock = vi.fn<typeof getAthleteCoachingContext>(async () =>
    typeof athleteContext === "function" ? athleteContext() : athleteContext
  );

  const deps: RunDailyForDeps = {
    computeDailyFor: computeDailyForMock,
    persistDailyRun: persistDailyRunMock,
    getAthleteCoachingContext: getAthleteCoachingContextMock,
  };

  return { deps, computeDailyForMock, persistDailyRunMock, getAthleteCoachingContextMock };
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

describe("V0.3_011 — First Personalization Consumer (primary_goal -> DailyPlan.reasoning)", () => {
  const GOAL_SENTENCES: Record<string, string> = {
    "Race performance": "Ton plan reste aligné avec ton objectif de performance en course",
    Consistency: "Ton plan vise à construire une performance répétable",
    "Technical skills": "Ton plan soutient ta progression technique",
    Fitness: "Ton plan soutient ton développement physique",
    "Injury prevention": "Ton plan soutient une progression durable",
  };

  it.each(Object.entries(GOAL_SENTENCES))("goal mapping: %s produces its own reasoning addition", async (goal, expectedSentenceStart) => {
    const dailyPlan = buildFixtureDailyPlan({ reasoning: "Séance maintenue." });
    const { deps, persistDailyRunMock } = buildDeps(dailyPlan, { decision_id: "d1", health_flag_id: null }, {
      athlete_id: ATHLETE_ID,
      primary_goal: goal,
    });

    const result = await runDailyFor(FAKE_CLIENT, ATHLETE_ID, TODAY, deps);

    expect(result.dailyPlan.reasoning.startsWith("Séance maintenue.")).toBe(true);
    expect(result.dailyPlan.reasoning).toContain(expectedSentenceStart);
    const [, , , decisionRowArg] = persistDailyRunMock.mock.calls[0]!;
    expect((decisionRowArg as { reason: string }).reason).toBe(result.dailyPlan.reasoning);
  });

  it("missing onboarding (no athlete_coaching_profiles/onboarding row at all): reasoning unchanged, byte-for-byte", async () => {
    const dailyPlan = buildFixtureDailyPlan({ reasoning: "Séance maintenue." });
    const { deps } = buildDeps(dailyPlan, { decision_id: "d1", health_flag_id: null }, { athlete_id: ATHLETE_ID });

    const result = await runDailyFor(FAKE_CLIENT, ATHLETE_ID, TODAY, deps);

    expect(result.dailyPlan).toBe(dailyPlan);
    expect(result.dailyPlan.reasoning).toBe("Séance maintenue.");
  });

  it("unknown/unrecognized goal value: no personalization added, reasoning unchanged", async () => {
    const dailyPlan = buildFixtureDailyPlan({ reasoning: "Séance maintenue." });
    const { deps } = buildDeps(dailyPlan, { decision_id: "d1", health_flag_id: null }, {
      athlete_id: ATHLETE_ID,
      primary_goal: "some_legacy_or_future_value",
    });

    const result = await runDailyFor(FAKE_CLIENT, ATHLETE_ID, TODAY, deps);

    expect(result.dailyPlan).toBe(dailyPlan);
  });

  it("isolation: two athletes with different declared goals receive different reasoning from the same base plan", async () => {
    const basePlan = buildFixtureDailyPlan({ reasoning: "Séance maintenue." });

    const runA = buildDeps({ ...basePlan }, { decision_id: "dA", health_flag_id: null }, {
      athlete_id: "athlete-A",
      primary_goal: "Race performance",
    });
    const runB = buildDeps({ ...basePlan }, { decision_id: "dB", health_flag_id: null }, {
      athlete_id: "athlete-B",
      primary_goal: "Fitness",
    });

    const resultA = await runDailyFor(FAKE_CLIENT, "athlete-A", TODAY, runA.deps);
    const resultB = await runDailyFor(FAKE_CLIENT, "athlete-B", TODAY, runB.deps);

    expect(resultA.dailyPlan.reasoning).not.toBe(resultB.dailyPlan.reasoning);
    expect(resultA.dailyPlan.reasoning).toContain("performance en course");
    expect(resultB.dailyPlan.reasoning).toContain("développement physique");
  });

  it("no prescription impact: final_session/active_mode/decision are identical with and without a declared goal — only reasoning differs", async () => {
    const dailyPlan = buildFixtureDailyPlan({ reasoning: "Séance maintenue.", decision: "MODIFY" });

    const withoutGoal = buildDeps(dailyPlan, { decision_id: "d1", health_flag_id: null }, { athlete_id: ATHLETE_ID });
    const withGoal = buildDeps(dailyPlan, { decision_id: "d2", health_flag_id: null }, {
      athlete_id: ATHLETE_ID,
      primary_goal: "Race performance",
    });

    const resultWithout = await runDailyFor(FAKE_CLIENT, ATHLETE_ID, TODAY, withoutGoal.deps);
    const resultWith = await runDailyFor(FAKE_CLIENT, ATHLETE_ID, TODAY, withGoal.deps);

    const [, , , rowWithout] = withoutGoal.persistDailyRunMock.mock.calls[0]! as [unknown, unknown, unknown, { final_session: unknown; active_mode: unknown }];
    const [, , , rowWith] = withGoal.persistDailyRunMock.mock.calls[0]! as [unknown, unknown, unknown, { final_session: unknown; active_mode: unknown }];

    expect(rowWith.final_session).toEqual(rowWithout.final_session);
    expect(rowWith.active_mode).toEqual(rowWithout.active_mode);
    expect(resultWith.dailyPlan.decision).toBe(resultWithout.dailyPlan.decision);
    expect(resultWith.dailyPlan.final_session).toEqual(resultWithout.dailyPlan.final_session);
    expect(resultWith.dailyPlan.reasoning).not.toBe(resultWithout.dailyPlan.reasoning);
  });

  it("resilience: a failure resolving athlete coaching context is recorded as a warning, never thrown, reasoning stays unchanged", async () => {
    const dailyPlan = buildFixtureDailyPlan({ reasoning: "Séance maintenue." });
    const { deps, persistDailyRunMock } = buildDeps(dailyPlan, { decision_id: "d1", health_flag_id: null }, () =>
      Promise.reject(new Error("connection reset"))
    );

    const result = await runDailyFor(FAKE_CLIENT, ATHLETE_ID, TODAY, deps);

    expect(result.dailyPlan.reasoning).toBe("Séance maintenue.");
    expect(result.warnings.some((w) => w.includes("V0.3_011"))).toBe(true);
    expect(persistDailyRunMock).toHaveBeenCalledTimes(1);
  });
});
