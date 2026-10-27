import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generatePlanV2InMemory, type PlanInputSnapshotV2, type PlanSessionV2InMemory } from "planning-engine/session-model-v2";
import { dhUnitRequirementFromEnv } from "../../src/supabase/dailyV2/dhUnitRequirement.js";
import { reconcileFinalPrescriptionV2 } from "../../src/supabase/dailyV2/reconcileFinalPrescriptionV2.js";
import { runDailyFor, type RunDailyForDeps } from "../../src/supabase/runDailyFor.js";
import { generateTrainingPlanForAthlete, type GenerateTrainingPlanForAthleteDeps } from "../../src/generation/generateTrainingPlanForAthlete.js";
import { generateAndPersistTrainingPlanV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { V2_PLAN_GENERATION_FLAG } from "../../src/generation/planningModelRollout.js";
import type { DailyPlan, RawContext } from "../../src/types/index.js";

// V2-DH-UNIT-01 (HPM 2026-10-26) — the DH unit requirement on the real consumers: it follows the V2 switch (generation
// always, the daily run through the same Edge secret); V2 off, both paths behave exactly as before. No drill has a
// signed unit yet, so "required" refuses every DH count.

const SNAPSHOT: PlanInputSnapshotV2 = {
  discipline: "Downhill",
  races: [],
  availability: { windows: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d as 0, startTime: "08:00", endTime: "20:00" })), exceptions: [] },
  equipment: ["dumbbells", "bench"],
  terrainAccess: ["flow_trail", "bermed_trail"],
  strengthExperienceTier: "intermediate",
  declaredLimitations: [],
  technicalPriorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
  lockedDates: [],
  recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 0 },
  dhTechnicalTier: "intermediate",
};
const BLOCK = { sequenceNumber: 1, name: "Plan", mode: "UNSPECIFIED" as const, primaryFocus: "Test", startDate: "2026-10-05", endDate: "2026-10-18" };
const plan = (() => {
  let n = 0;
  const r = generatePlanV2InMemory({ block: BLOCK, snapshot: SNAPSHOT, mintId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}` });
  if (r.status !== "generated") throw new Error("expected a plan");
  return r.plan;
})();
const session = (kind: string) => plan.weeks.flatMap((w) => w.sessions).find((s) => s.kind === kind)!;

function reconcileInput(s: PlanSessionV2InMemory) {
  return {
    client: {} as never,
    currentPlanVersionId: plan.planVersionId,
    decisionId: "decision-1",
    finalPrescriptionId: "final-1",
    dailyPlan: { decision: "KEEP", final_session: { kind: s.kind, ...(s.loadProfile ? { load_profile: s.loadProfile } : {}), duration_min: s.durationMin } } as unknown as DailyPlan,
    observation: { id: "ps-1", date: s.date, updatedAt: null, source: "generated", sourcePlanVersionId: plan.planVersionId, sourceGeneratedSessionId: s.generatedPlanSessionId, plannedSession: null },
    mintId: (() => {
      let n = 0;
      return () => `10000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    })(),
  };
}
function reads(s: PlanSessionV2InMemory) {
  return {
    getGeneratedSessionOfVersion: async () => ({ id: s.generatedPlanSessionId, kind: s.kind, load_profile: s.loadProfile ?? null, duration_min: s.durationMin }),
    getPlannedPrescriptionRowOfVersion: async () => ({
      id: s.plannedPrescription.id,
      generated_plan_session_id: s.generatedPlanSessionId,
      schema_version: "v2",
      catalog_version: s.plannedPrescription.catalogVersion,
      structure: JSON.parse(JSON.stringify(s.plannedPrescription.structure)),
    }),
    getPlanInputSnapshotOfVersion: async () => ({ input_snapshot: JSON.parse(JSON.stringify(SNAPSHOT)), input_snapshot_schema_version: "v2" }),
  };
}

describe("V2-DH-UNIT-01 · the requirement follows the V2 switch", () => {
  it("daily run: required exactly when the V2 generation secret is \"true\"; absent, false or any other spelling → as before", () => {
    const env = (value: string | undefined) => (name: string) => (name === V2_PLAN_GENERATION_FLAG ? value : undefined);
    expect(dhUnitRequirementFromEnv(env("true"))).toEqual({ dhUnit: "required" });
    for (const value of [undefined, "", "false", "TRUE", "1", " true"]) expect(dhUnitRequirementFromEnv(env(value)), String(value)).toEqual({});
  });

  it("generation: a V2 plan is always generated with the requirement; V2 off never reaches it", async () => {
    const fake = (assignment: "v1" | "v2") => ({
      getPlanningModelAssignment: vi.fn(async () => assignment),
      generateAndPersistTrainingPlan: vi.fn(async () => ({ planVersionId: "v1-plan", idempotentReplay: false })) as unknown as GenerateTrainingPlanForAthleteDeps["generateAndPersistTrainingPlan"],
      generateAndPersistTrainingPlanV2: vi.fn(async () => ({ status: "persisted" as const, planVersionId: "v2-plan", idempotentReplay: false, plan: {} as never })),
    });
    const input = (globalV2Enabled: boolean) => ({ client: {} as never, athleteId: "a", generationRequestId: "r", durationWeeks: 2, today: "2026-10-05", globalV2Enabled });
    const on = fake("v2");
    await generateTrainingPlanForAthlete(input(true), on);
    expect(on.generateAndPersistTrainingPlanV2).toHaveBeenCalledWith(expect.objectContaining({ planningModel: "v2", dhUnit: "required" }));
    for (const assignment of ["v1", "v2"] as const) {
      const off = fake(assignment);
      await generateTrainingPlanForAthlete(input(false), off);
      expect(off.generateAndPersistTrainingPlanV2).not.toHaveBeenCalled();
    }
  });

  it("generation with the requirement: no drill has a signed unit → blocked before any write (zero RPC); without it, the previous plan", async () => {
    const callRpc = vi.fn(async () => ({ planVersionId: "p", idempotentReplay: false }));
    let n = 0;
    const deps = { buildPlanInputSnapshotV2: vi.fn(async () => SNAPSHOT), callRpc, mintId: () => `20000000-0000-4000-8000-${String(++n).padStart(12, "0")}` };
    const base = { planningModel: "v2" as const, client: {} as SupabaseClient, athleteId: "a", generationRequestId: "r", durationWeeks: 2, today: "2026-10-04" };
    expect(await generateAndPersistTrainingPlanV2({ ...base, dhUnit: "required" }, deps)).toMatchObject({ status: "blocked", code: "dh_repetition_unit_unknown" });
    expect(callRpc).not.toHaveBeenCalled();
    expect(await generateAndPersistTrainingPlanV2(base, deps)).toMatchObject({ status: "persisted" });
    expect(callRpc).toHaveBeenCalledTimes(1);
  });
});

describe("V2-DH-UNIT-01 · daily reconciliation", () => {
  it("a historical DH KEEP: executable as before without the requirement; with it, no document (the planned row is only read)", async () => {
    const dh = session("DH_TECHNICAL");
    const before = await reconcileFinalPrescriptionV2(reconcileInput(dh), reads(dh));
    expect(before.status).toBe("created");
    expect(await reconcileFinalPrescriptionV2({ ...reconcileInput(dh), dhUnit: "required" }, reads(dh))).toMatchObject({
      status: "blocked",
      code: "final_prescription_adaptation_not_defined",
      detail: { reason: "dh_repetition_unit_unknown" },
    });
    // Another family is untouched by the requirement.
    const force = session("STRENGTH_LOWER");
    expect(await reconcileFinalPrescriptionV2({ ...reconcileInput(force), dhUnit: "required" }, reads(force))).toEqual(await reconcileFinalPrescriptionV2(reconcileInput(force), reads(force)));
  });

  it("runDailyFor hands the requirement to the reconciliation only when the Edge gives it", async () => {
    const dailyPlan: DailyPlan = {
      date: "2026-10-07",
      active_mode: "UNSPECIFIED",
      training: { active: true, session_type: { kind: "STRENGTH_LOWER", load_profile: "MODERATE" } },
      dh_or_technical: { active: false },
      mental: { active: false },
      recovery: { active: false, actions: [] },
      nutrition: { active: false },
      sleep: { active: false },
      protection: { do_not_do: [] },
      monitoring: { observe: [] },
      reasoning: "M1 reasoning.",
      confidence: "MEDIUM",
      triggered_rules: [],
      planned_session_before: { kind: "STRENGTH_LOWER", load_profile: "MODERATE" },
      final_session: { kind: "STRENGTH_LOWER", load_profile: "MODERATE" },
      decision: "KEEP",
      overrode_race_protocol: false,
      engine_version: "v0.2",
    } as DailyPlan;
    const run = async (extra: Partial<RunDailyForDeps>) => {
      let n = 0;
      const reconcile = vi.fn(async (_input: unknown) => ({ status: "none" as const, reason: "rest" as const }));
      const deps = {
        computeDailyFor: vi.fn(async () => ({ rawContext: {} as RawContext, dailyPlan, warnings: [], plannedSessionObservation: null })),
        persistDailyRun: vi.fn(),
        getAthleteCoachingContext: vi.fn(async () => ({ athlete_id: "a" })),
        projectTrainingPlan: vi.fn(),
        resolveTrainingPlanProjectionWindow: vi.fn(() => ({ enabled: false as const })),
        getProjectedGeneratedSessionIdForDate: vi.fn(),
        getPlannedPrescriptionForGeneratedSession: vi.fn(),
        getDailyRunInputVersions: vi.fn(async () => ({ checkin: null, plannedSession: null })),
        resolveDailyPrescriptionModel: vi.fn(async () => ({ model: "v2" as const, planVersionId: "plan-v2" })),
        reconcileFinalPrescriptionV2: reconcile,
        persistDailyRunV2: vi.fn(async (_c: unknown, _a: unknown, _h: unknown, row: { id: string }, outcome: { status: string }) => ({ decision_id: row.id, health_flag_id: null, final_prescription_id: null, final_prescription_status: outcome.status })),
        mintId: vi.fn(() => `id-${++n}`),
        ...extra,
      } as unknown as RunDailyForDeps;
      await runDailyFor({} as SupabaseClient, "a", "2026-10-07", deps);
      return reconcile.mock.calls[0]![0] as Record<string, unknown>;
    };
    expect(await run({ dhUnit: "required" })).toMatchObject({ dhUnit: "required" });
    expect(await run({})).not.toHaveProperty("dhUnit");
  });
});
