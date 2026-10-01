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
import { projectTrainingPlan, type ProjectionReport } from "../../src/supabase/projectTrainingPlan.js";
import {
  resolveTrainingPlanProjectionWindow,
  type TrainingPlanProjectionWindowConfig,
} from "../../src/supabase/trainingPlanProjectionConfig.js";
import {
  getDailyRunInputVersions,
  getProjectedGeneratedSessionIdForDate,
  type DailyRunInputVersions,
} from "../../src/supabase/repositories/plannedSessionsRepo.js";
import {
  getPlannedPrescriptionForGeneratedSession,
  type PlannedPrescriptionRead,
} from "../../src/supabase/repositories/trainingPlanPlannedPrescriptionsRepo.js";
import type { DailyPlan, RawContext } from "../../src/types/index.js";
import type { PlannedPrescription } from "planning-engine";

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

/** V0.4_015 default: disabled, matching the deployable-dark default (ADR V0.4_015A) — every existing test (written before this step existed) must keep seeing byte-for-byte unchanged behavior unless it opts in. */
const PROJECTION_DISABLED: TrainingPlanProjectionWindowConfig = { enabled: false };

const PROJECTION_NO_CANDIDATES: ProjectionReport = {
  plannedSessions: [],
  trainingBlock: { outcome: "no_candidate" },
};

/** V0.5_047/048 default: no lineage found — every existing test (written before this step existed) must keep seeing byte-for-byte unchanged behavior (executablePrescription: null, no new warning). */
const NO_LINEAGE: string | null = null;
const NO_PRESCRIPTION: PlannedPrescription | null = null;

/** PILOT_022 — default input versions: today's check-in exists, no planned session. */
const INPUT_VERSIONS: DailyRunInputVersions = {
  checkin: { id: "checkin-1", updated_at: "2026-08-13T07:00:00.123456+00:00" },
  plannedSession: null,
};

function buildDeps(
  dailyPlan: DailyPlan,
  persistResult: PersistDailyRunResult,
  athleteContext: AthleteCoachingContext | (() => Promise<AthleteCoachingContext>) = NO_CONTEXT,
  projectionConfig: TrainingPlanProjectionWindowConfig = PROJECTION_DISABLED,
  generatedSessionId: string | null | (() => Promise<string | null>) = NO_LINEAGE,
  prescription: PlannedPrescription | PlannedPrescriptionRead | null | (() => Promise<PlannedPrescription | null>) = NO_PRESCRIPTION,
  inputVersions: DailyRunInputVersions = INPUT_VERSIONS
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
  const projectTrainingPlanMock = vi.fn<typeof projectTrainingPlan>(async (): Promise<ProjectionReport> => PROJECTION_NO_CANDIDATES);
  const resolveTrainingPlanProjectionWindowMock = vi.fn<typeof resolveTrainingPlanProjectionWindow>(() => projectionConfig);
  const getProjectedGeneratedSessionIdForDateMock = vi.fn<typeof getProjectedGeneratedSessionIdForDate>(async () =>
    typeof generatedSessionId === "function" ? generatedSessionId() : generatedSessionId
  );
  // UX-11A.5b.1 — the repository now returns a read result; a plain v1
  // PlannedPrescription fixture is wrapped as "supported v1", a read result
  // (e.g. "unsupported_by_reader") is passed through unchanged.
  const getPlannedPrescriptionForGeneratedSessionMock = vi.fn<typeof getPlannedPrescriptionForGeneratedSession>(async () => {
    const value = typeof prescription === "function" ? await prescription() : prescription;
    if (value === null) return null;
    return "status" in value ? value : { status: "supported", schemaVersion: "v1", prescription: value };
  });

  const getDailyRunInputVersionsMock = vi.fn<typeof getDailyRunInputVersions>(async () => inputVersions);

  const deps: RunDailyForDeps = {
    computeDailyFor: computeDailyForMock,
    persistDailyRun: persistDailyRunMock,
    getAthleteCoachingContext: getAthleteCoachingContextMock,
    projectTrainingPlan: projectTrainingPlanMock,
    resolveTrainingPlanProjectionWindow: resolveTrainingPlanProjectionWindowMock,
    getProjectedGeneratedSessionIdForDate: getProjectedGeneratedSessionIdForDateMock,
    getPlannedPrescriptionForGeneratedSession: getPlannedPrescriptionForGeneratedSessionMock,
    getDailyRunInputVersions: getDailyRunInputVersionsMock,
    // UX-11A.5c.3 — these tests exercise the V1 daily path: no current plan
    // version (V1 by definition). The V2 seams throw if ever touched.
    resolveDailyPrescriptionModel: vi.fn(async () => ({ model: "v1" as const, planVersionId: null })),
    reconcileFinalPrescriptionV2: vi.fn(async () => {
      throw new Error("the V1 daily path must never reconcile a V2 final prescription");
    }),
    persistDailyRunV2: vi.fn(async () => {
      throw new Error("the V1 daily path must never call persist_daily_run_v2");
    }),
    mintId: vi.fn(() => {
      throw new Error("the V1 daily path never mints a decision id");
    }),
  };

  return {
    deps,
    computeDailyForMock,
    persistDailyRunMock,
    getAthleteCoachingContextMock,
    projectTrainingPlanMock,
    resolveTrainingPlanProjectionWindowMock,
    getProjectedGeneratedSessionIdForDateMock,
    getPlannedPrescriptionForGeneratedSessionMock,
    getDailyRunInputVersionsMock,
  };
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

  it("passes a decisionRow that is exactly mapDailyPlanToDecisionRow's output plus the PILOT_022 input provenance", async () => {
    const dailyPlan = buildFixtureDailyPlan({ reasoning: "Custom reasoning for this test" });
    const { deps, persistDailyRunMock } = buildDeps(dailyPlan, { decision_id: "d1", health_flag_id: null });

    await runDailyFor(FAKE_CLIENT, ATHLETE_ID, TODAY, deps);

    const [, , , decisionRowArg] = persistDailyRunMock.mock.calls[0]!;
    expect(decisionRowArg).toEqual({
      ...mapDailyPlanToDecisionRow(dailyPlan, ATHLETE_ID),
      source_checkin_id: "checkin-1",
      source_checkin_updated_at: "2026-08-13T07:00:00.123456+00:00",
      source_planned_session_id: null,
      source_planned_session_updated_at: null,
    });
  });

  it("PILOT_022 — records the planned session version read before computing, after projection", async () => {
    const dailyPlan = buildFixtureDailyPlan();
    const versions: DailyRunInputVersions = {
      checkin: { id: "checkin-9", updated_at: "2026-08-13T06:00:00+00:00" },
      plannedSession: { id: "planned-9", updated_at: "2026-08-13T05:00:00+00:00" },
    };
    const { deps, persistDailyRunMock, getDailyRunInputVersionsMock, projectTrainingPlanMock, computeDailyForMock } = buildDeps(
      dailyPlan,
      { decision_id: "d1", health_flag_id: null },
      NO_CONTEXT,
      { enabled: true, windowDays: 14 },
      NO_LINEAGE,
      NO_PRESCRIPTION,
      versions
    );

    await runDailyFor(FAKE_CLIENT, ATHLETE_ID, TODAY, deps);

    expect(getDailyRunInputVersionsMock).toHaveBeenCalledWith(FAKE_CLIENT, ATHLETE_ID, TODAY);
    const versionsOrder = getDailyRunInputVersionsMock.mock.invocationCallOrder[0]!;
    expect(projectTrainingPlanMock.mock.invocationCallOrder[0]!).toBeLessThan(versionsOrder);
    expect(versionsOrder).toBeLessThan(computeDailyForMock.mock.invocationCallOrder[0]!);
    const [, , , decisionRowArg] = persistDailyRunMock.mock.calls[0]!;
    expect(decisionRowArg).toMatchObject({
      source_checkin_id: "checkin-9",
      source_checkin_updated_at: "2026-08-13T06:00:00+00:00",
      source_planned_session_id: "planned-9",
      source_planned_session_updated_at: "2026-08-13T05:00:00+00:00",
    });
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

describe("V0.4_015 — projection pre-compute step (best-effort, never blocking)", () => {
  it("disabled: projectTrainingPlan is never called; computeDailyFor and persistDailyRun still run normally", async () => {
    const dailyPlan = buildFixtureDailyPlan();
    const { deps, projectTrainingPlanMock, computeDailyForMock, persistDailyRunMock } = buildDeps(
      dailyPlan,
      { decision_id: "d1", health_flag_id: null },
      NO_CONTEXT,
      { enabled: false }
    );

    await runDailyFor(FAKE_CLIENT, ATHLETE_ID, TODAY, deps);

    expect(projectTrainingPlanMock).not.toHaveBeenCalled();
    expect(computeDailyForMock).toHaveBeenCalledTimes(1);
    expect(persistDailyRunMock).toHaveBeenCalledTimes(1);
  });

  it("enabled: projectTrainingPlan is called with athleteId, today, and today + windowDays", async () => {
    const dailyPlan = buildFixtureDailyPlan();
    const { deps, projectTrainingPlanMock } = buildDeps(
      dailyPlan,
      { decision_id: "d1", health_flag_id: null },
      NO_CONTEXT,
      { enabled: true, windowDays: 14 }
    );

    await runDailyFor(FAKE_CLIENT, ATHLETE_ID, TODAY, deps);

    // TODAY = "2026-08-16" + 14 days = "2026-08-30".
    expect(projectTrainingPlanMock).toHaveBeenCalledWith(FAKE_CLIENT, ATHLETE_ID, TODAY, "2026-08-30");
  });

  it("ordering: projection runs before computeDailyFor", async () => {
    const order: string[] = [];
    const dailyPlan = buildFixtureDailyPlan();
    const { deps } = buildDeps(dailyPlan, { decision_id: "d1", health_flag_id: null }, NO_CONTEXT, {
      enabled: true,
      windowDays: 7,
    });

    deps.projectTrainingPlan = vi.fn(async (): Promise<ProjectionReport> => {
      order.push("projection");
      return PROJECTION_NO_CANDIDATES;
    });
    deps.computeDailyFor = vi.fn(async (): Promise<ComputeDailyForResult> => {
      order.push("compute");
      return { rawContext: FAKE_RAW_CONTEXT, dailyPlan, warnings: [] };
    });

    await runDailyFor(FAKE_CLIENT, ATHLETE_ID, TODAY, deps);

    expect(order).toEqual(["projection", "compute"]);
  });

  it("projection failure: runDailyFor still resolves, computeDailyFor and persistDailyRun still execute, warnings contains the failure message", async () => {
    const dailyPlan = buildFixtureDailyPlan();
    const { deps, computeDailyForMock, persistDailyRunMock } = buildDeps(
      dailyPlan,
      { decision_id: "d1", health_flag_id: null },
      NO_CONTEXT,
      { enabled: true, windowDays: 7 }
    );
    deps.projectTrainingPlan = vi.fn(async () => {
      throw new Error("projection failed");
    });

    const result = await runDailyFor(FAKE_CLIENT, ATHLETE_ID, TODAY, deps);

    expect(computeDailyForMock).toHaveBeenCalledTimes(1);
    expect(persistDailyRunMock).toHaveBeenCalledTimes(1);
    expect(result.warnings.some((w) => w.includes("projection failed"))).toBe(true);
  });

  it("preserves other warning sources: a projection warning and the existing V0.3_011 personalization warning both appear together", async () => {
    const dailyPlan = buildFixtureDailyPlan({ reasoning: "Séance maintenue." });
    const { deps } = buildDeps(
      dailyPlan,
      { decision_id: "d1", health_flag_id: null },
      () => Promise.reject(new Error("connection reset")),
      { enabled: false, warning: "TRAINING_PLAN_PROJECTION_WINDOW_DAYS is invalid" }
    );

    const result = await runDailyFor(FAKE_CLIENT, ATHLETE_ID, TODAY, deps);

    expect(result.warnings.some((w) => w.includes("TRAINING_PLAN_PROJECTION_WINDOW_DAYS is invalid"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("V0.3_011"))).toBe(true);
  });
});

describe("V0.5_047/048 — executable prescription lookup (best-effort, KEEP-only gate)", () => {
  const SAMPLE_PRESCRIPTION: PlannedPrescription = {
    id: "prescription-1",
    generatedPlanSessionId: "session-1",
    schemaVersion: "v1",
    catalogVersion: "v1",
    structure: { domain: "strength", schemaVersion: "v1", blocks: [] },
  };

  // Acceptance matrix (V0.5_048 §26):
  // decision | source_generated_session_id | prescription | result
  it("KEEP + lineage present + prescription present -> prescription attached, no warning", async () => {
    const dailyPlan = buildFixtureDailyPlan({ decision: "KEEP" });
    const { deps } = buildDeps(dailyPlan, { decision_id: "d1", health_flag_id: null }, NO_CONTEXT, PROJECTION_DISABLED, "session-1", SAMPLE_PRESCRIPTION);

    const result = await runDailyFor(FAKE_CLIENT, ATHLETE_ID, TODAY, deps);

    expect(result.executablePrescription).toEqual(SAMPLE_PRESCRIPTION);
    expect(result.warnings).toEqual([]);
  });

  it("KEEP + lineage present + prescription absent -> no prescription, warning present", async () => {
    const dailyPlan = buildFixtureDailyPlan({ decision: "KEEP" });
    const { deps } = buildDeps(dailyPlan, { decision_id: "d1", health_flag_id: null }, NO_CONTEXT, PROJECTION_DISABLED, "session-1", null);

    const result = await runDailyFor(FAKE_CLIENT, ATHLETE_ID, TODAY, deps);

    expect(result.executablePrescription).toBeNull();
    expect(result.warnings.some((w) => w.includes("V0.5_048"))).toBe(true);
  });

  it("KEEP + no lineage (manual/legacy session) -> graceful degradation, NO warning (a legitimate state, not a failure)", async () => {
    const dailyPlan = buildFixtureDailyPlan({ decision: "KEEP" });
    const { deps, getPlannedPrescriptionForGeneratedSessionMock } = buildDeps(
      dailyPlan,
      { decision_id: "d1", health_flag_id: null },
      NO_CONTEXT,
      PROJECTION_DISABLED,
      null
    );

    const result = await runDailyFor(FAKE_CLIENT, ATHLETE_ID, TODAY, deps);

    expect(result.executablePrescription).toBeNull();
    expect(result.warnings).toEqual([]);
    // No lineage -> the prescription lookup itself must never even be attempted.
    expect(getPlannedPrescriptionForGeneratedSessionMock).not.toHaveBeenCalled();
  });

  it("KEEP + lookup error -> Daily Plan still succeeds, warning present, persistDailyRun still called", async () => {
    const dailyPlan = buildFixtureDailyPlan({ decision: "KEEP" });
    const { deps, persistDailyRunMock } = buildDeps(
      dailyPlan,
      { decision_id: "d1", health_flag_id: null },
      NO_CONTEXT,
      PROJECTION_DISABLED,
      () => Promise.reject(new Error("connection reset"))
    );

    const result = await runDailyFor(FAKE_CLIENT, ATHLETE_ID, TODAY, deps);

    expect(result.executablePrescription).toBeNull();
    expect(result.warnings.some((w) => w.includes("V0.5_048") && w.includes("connection reset"))).toBe(true);
    expect(persistDailyRunMock).toHaveBeenCalledTimes(1);
  });

  it.each(["MODIFY", "REPLACE"] as const)(
    "%s + lineage present + prescription present -> lookup NEVER executed, no prescription",
    async (decision) => {
      const dailyPlan = buildFixtureDailyPlan({ decision });
      const { deps, getProjectedGeneratedSessionIdForDateMock, getPlannedPrescriptionForGeneratedSessionMock } = buildDeps(
        dailyPlan,
        { decision_id: "d1", health_flag_id: null },
        NO_CONTEXT,
        PROJECTION_DISABLED,
        "session-1",
        SAMPLE_PRESCRIPTION
      );

      const result = await runDailyFor(FAKE_CLIENT, ATHLETE_ID, TODAY, deps);

      expect(result.executablePrescription).toBeNull();
      expect(getProjectedGeneratedSessionIdForDateMock).not.toHaveBeenCalled();
      expect(getPlannedPrescriptionForGeneratedSessionMock).not.toHaveBeenCalled();
    }
  );

  it("REST + lineage/prescription would be present -> no prescription, no lookup attempted", async () => {
    const dailyPlan = buildFixtureDailyPlan({ decision: "REST", final_session: { kind: "REST" } });
    const { deps, getProjectedGeneratedSessionIdForDateMock, getPlannedPrescriptionForGeneratedSessionMock } = buildDeps(
      dailyPlan,
      { decision_id: "d1", health_flag_id: "f1" },
      NO_CONTEXT,
      PROJECTION_DISABLED,
      "session-1",
      SAMPLE_PRESCRIPTION
    );

    const result = await runDailyFor(FAKE_CLIENT, ATHLETE_ID, TODAY, deps);

    expect(result.executablePrescription).toBeNull();
    expect(getProjectedGeneratedSessionIdForDateMock).not.toHaveBeenCalled();
    expect(getPlannedPrescriptionForGeneratedSessionMock).not.toHaveBeenCalled();
  });

  // V0.5_048 §27 — supersession/reprojection. A full "plan A projected, then
  // plan B supersedes it and reprojects" sequence needs a real Supabase
  // instance (the lineage column is only ever mutated by the real
  // project_training_plan RPC) — out of reach for this mocked unit-test
  // file per the ticket's own scope limit. What IS verified here, honestly,
  // with mocks: the lookup always uses whatever id
  // getProjectedGeneratedSessionIdForDate returns AT CALL TIME, never a
  // cached/earlier value — which is the exact property that makes
  // correctness under reprojection possible (runProjectionBestEffort
  // already runs before this lookup, step 0 of runDailyFor). Two separate
  // runs with two different lineage ids (simulating "today, before" vs.
  // "today, after a supersession+reprojection") must each use their own id.
  it("uses whatever lineage id is current at call time, never a stale one from a previous run (supersession proxy — see note above for the real-DB limit)", async () => {
    const dailyPlanA = buildFixtureDailyPlan({ decision: "KEEP" });
    const runA = buildDeps(dailyPlanA, { decision_id: "dA", health_flag_id: null }, NO_CONTEXT, PROJECTION_DISABLED, "session-A1", {
      ...SAMPLE_PRESCRIPTION,
      id: "prescription-A1",
      generatedPlanSessionId: "session-A1",
    });

    const dailyPlanB = buildFixtureDailyPlan({ decision: "KEEP" });
    const runB = buildDeps(dailyPlanB, { decision_id: "dB", health_flag_id: null }, NO_CONTEXT, PROJECTION_DISABLED, "session-B1", {
      ...SAMPLE_PRESCRIPTION,
      id: "prescription-B1",
      generatedPlanSessionId: "session-B1",
    });

    const resultA = await runDailyFor(FAKE_CLIENT, ATHLETE_ID, TODAY, runA.deps);
    const resultB = await runDailyFor(FAKE_CLIENT, ATHLETE_ID, TODAY, runB.deps);

    expect(resultA.executablePrescription?.generatedPlanSessionId).toBe("session-A1");
    expect(resultB.executablePrescription?.generatedPlanSessionId).toBe("session-B1");
    expect(resultB.executablePrescription?.generatedPlanSessionId).not.toBe(resultA.executablePrescription?.generatedPlanSessionId);
  });

  it("never injects executablePrescription into dailyPlan/decisionRow — enrichment stays a sibling field, M1 output untouched", async () => {
    const dailyPlan = buildFixtureDailyPlan({ decision: "KEEP" });
    const { deps, persistDailyRunMock } = buildDeps(
      dailyPlan,
      { decision_id: "d1", health_flag_id: null },
      NO_CONTEXT,
      PROJECTION_DISABLED,
      "session-1",
      SAMPLE_PRESCRIPTION
    );

    const result = await runDailyFor(FAKE_CLIENT, ATHLETE_ID, TODAY, deps);

    expect(result.dailyPlan).toBe(dailyPlan);
    expect(Object.keys(result.dailyPlan)).not.toContain("executablePrescription");
    const [, , , decisionRowArg] = persistDailyRunMock.mock.calls[0]!;
    expect(decisionRowArg).not.toHaveProperty("executablePrescription");
  });
});

describe("UX-11A.5b.1 — reader guard: a prescription format this reader does not implement", () => {
  const UNSUPPORTED = (schemaVersion: string): PlannedPrescriptionRead => ({ status: "unsupported_by_reader", schemaVersion, prescriptionId: "prescription-v2" });

  it.each(["v2", "v999"])(
    "KEEP + lineage + schema_version %s: M1 decision kept and persisted, executablePrescription null, status unsupported_schema_version, stable warning",
    async (schemaVersion) => {
      const dailyPlan = buildFixtureDailyPlan({ decision: "KEEP" });
      const { deps, persistDailyRunMock } = buildDeps(
        dailyPlan,
        { decision_id: "d1", health_flag_id: null },
        NO_CONTEXT,
        PROJECTION_DISABLED,
        "session-1",
        UNSUPPORTED(schemaVersion)
      );

      const result = await runDailyFor(FAKE_CLIENT, ATHLETE_ID, TODAY, deps);

      expect(result.dailyPlan).toBe(dailyPlan);
      expect(result.dailyPlan.decision).toBe("KEEP");
      expect(persistDailyRunMock).toHaveBeenCalledTimes(1);
      expect(persistDailyRunMock.mock.calls[0]![3]).toEqual({
        ...mapDailyPlanToDecisionRow(dailyPlan, ATHLETE_ID),
        source_checkin_id: "checkin-1",
        source_checkin_updated_at: "2026-08-13T07:00:00.123456+00:00",
        source_planned_session_id: null,
        source_planned_session_updated_at: null,
      });
      expect(result.executablePrescription).toBeNull();
      expect(result.executablePrescriptionStatus).toBe("unsupported_schema_version");
      const guardWarnings = result.warnings.filter((w) => w.startsWith("prescription_schema_unsupported:"));
      expect(guardWarnings).toHaveLength(1);
      expect(guardWarnings[0]).toContain(`"${schemaVersion}"`);
    }
  );

  it("v1 stays exactly as before: delivered, attached unchanged, no warning", async () => {
    const v1: PlannedPrescription = { id: "p1", generatedPlanSessionId: "session-1", schemaVersion: "v1", catalogVersion: "v3", structure: { domain: "strength", schemaVersion: "v1", blocks: [] } };
    const dailyPlan = buildFixtureDailyPlan({ decision: "KEEP" });
    const { deps } = buildDeps(dailyPlan, { decision_id: "d1", health_flag_id: null }, NO_CONTEXT, PROJECTION_DISABLED, "session-1", v1);

    const result = await runDailyFor(FAKE_CLIENT, ATHLETE_ID, TODAY, deps);

    expect(result.executablePrescription).toEqual(v1);
    expect(result.executablePrescriptionStatus).toBe("delivered");
    expect(result.warnings).toEqual([]);
  });

  it.each([
    ["not KEEP", "REST", "session-1", "v2"],
    ["no lineage", "KEEP", null, "v2"],
  ] as const)("%s: the lookup never happens, status stays none", async (_label, decision, lineage, schemaVersion) => {
    const dailyPlan = buildFixtureDailyPlan({ decision });
    const { deps } = buildDeps(dailyPlan, { decision_id: "d1", health_flag_id: null }, NO_CONTEXT, PROJECTION_DISABLED, lineage, UNSUPPORTED(schemaVersion));

    const result = await runDailyFor(FAKE_CLIENT, ATHLETE_ID, TODAY, deps);

    expect(result.executablePrescription).toBeNull();
    expect(result.executablePrescriptionStatus).toBe("none");
    expect(result.warnings.some((w) => w.startsWith("prescription_schema_unsupported"))).toBe(false);
  });
});
