/**
 * V0.4_149 — real local Supabase proof for the full generation persistence
 * branch: runGenerationEngine() -> generationResultToPersistencePayload()
 * -> generateTrainingPlanVersionRpc() -> generate_training_plan_version,
 * exercised through persistGeneratedTrainingPlan() itself (V0.4_148) —
 * never a mock, never a stub client, and deliberately NOT testDb.ts's own
 * generateTrainingPlan() fixture (a separate, ad-hoc payload builder used
 * by other tests — e.g. abandonTrainingPlanVersionRpc.integration.test.ts —
 * to set up state; it never calls this pipeline's own code at all).
 *
 * Placement: tests/supabase/, not tests/integration/ (the ticket's own
 * suggestion) — every other *.integration.test.ts in this package already
 * lives flat under tests/supabase/ (t17_planningE2E, abandonTrainingPlanVersionRpc,
 * ...); no tests/integration/ folder exists anywhere in this repo.
 *
 * OPT-IN ONLY, hard-bound to loopback — see testDb.ts's createTestClient()
 * for the actual enforcement, same gate as every other integration suite
 * in this package.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanInputSnapshot } from "planning-engine";
import { createTestClient, createTestAthlete, deleteTestAthlete, isLoopbackSupabaseUrl, resolveTestSupabaseUrl, type TestAthlete } from "./testDb.js";
import { persistGeneratedTrainingPlan, type PersistGeneratedTrainingPlanInput } from "../../src/supabase/persistGeneratedTrainingPlan.js";
import type { GenerationEngineInput } from "../../src/generation/generationEngine.js";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESOLVED_ADMIN_URL = resolveTestSupabaseUrl();
const INTEGRATION_ENABLED =
  process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" && !!SERVER_KEY && isLoopbackSupabaseUrl(RESOLVED_ADMIN_URL);

/** Same full-equipment/full-terrain baseline already proven (V0.4_142/145) to produce a real strength x2 / DH x2 / aerobic x1 development week through the real engines. */
function planInputSnapshot(): PlanInputSnapshot {
  return {
    discipline: "Downhill",
    competitionLevel: "Amateur racer",
    races: [],
    availability: {
      windows: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
        dayOfWeek: dayOfWeek as PlanInputSnapshot["availability"]["windows"][number]["dayOfWeek"],
        startTime: "16:00",
        endTime: "20:00",
      })),
      exceptions: [],
    },
    equipment: ["barbell", "squat_rack", "dumbbells", "bench", "pull_up_bar", "cable_machine", "resistance_bands"],
    terrainAccess: ["flow_trail", "bermed_trail", "technical_trail", "rock_garden", "root_rock_trail", "bike_park_jump_line", "full_dh_track"],
    strengthExperienceTier: "beginner",
    declaredLimitations: [],
    technicalPriorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering"] },
    lockedDates: [],
    recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 300 },
  };
}

function generationInput(generationRequestId: string): GenerationEngineInput {
  return {
    block: {
      sequenceNumber: 1,
      name: "V0.4_149 integration block",
      mode: "IN_SEASON",
      primaryFocus: "test",
      startDate: "2026-10-19",
      endDate: "2026-10-25",
    },
    planInputSnapshot: planInputSnapshot(),
    generationRequestId,
  };
}

function persistenceInput(client: SupabaseClient, athleteId: string, generationRequestId: string, rationale: string): PersistGeneratedTrainingPlanInput {
  return {
    client,
    generation: generationInput(generationRequestId),
    versionMetadata: {
      athleteId,
      plannerVersion: "v1",
      rulesetVersion: "v1",
      prescriptionSchemaVersion: "v1",
      generationTrigger: "initial",
      rationale,
      inputSnapshotSchemaVersion: "v1",
      inputSnapshotHash: `v0.4_149-${generationRequestId}`,
    },
  };
}

describe.skipIf(!INTEGRATION_ENABLED)("V0.4_149 — generation persistence, full branch (real local Supabase)", () => {
  let admin: SupabaseClient;
  let athlete: TestAthlete;

  beforeAll(() => {
    admin = createTestClient();
  });

  afterEach(async () => {
    if (athlete) await deleteTestAthlete(admin, athlete);
  });

  it("persists a full generated plan: version, blocks, weeks, sessions, and prescriptions present only for strength/DH", async () => {
    athlete = await createTestAthlete(admin, "V0.4_149 generation persistence");
    const generationRequestId = "11111111-1111-4111-8111-111111111111";

    const result = await persistGeneratedTrainingPlan(persistenceInput(admin, athlete.athleteId, generationRequestId, "V0.4_149 full branch test."));
    expect(result.idempotentReplay).toBe(false);

    // TrainingPlanVersion
    const { data: versionRow, error: versionError } = await admin
      .from("training_plan_versions")
      .select("id, athlete_id, generation_request_id")
      .eq("id", result.planVersionId)
      .single();
    if (versionError) throw new Error(`training_plan_versions query failed: ${versionError.message}`);
    expect(versionRow?.athlete_id).toBe(athlete.athleteId);
    expect(versionRow?.generation_request_id).toBe(generationRequestId);

    // Blocks — linked to the version
    const { data: blockRows, error: blockError } = await admin
      .from("training_plan_blocks")
      .select("id, plan_version_id")
      .eq("plan_version_id", result.planVersionId);
    if (blockError) throw new Error(`training_plan_blocks query failed: ${blockError.message}`);
    expect(blockRows).toBeTruthy();
    expect(blockRows!.length).toBeGreaterThan(0);
    const blockIds = new Set(blockRows!.map((b) => b.id as string));

    // Weeks — linked to a block
    const { data: weekRows, error: weekError } = await admin
      .from("training_plan_weeks")
      .select("id, block_id, plan_version_id")
      .eq("plan_version_id", result.planVersionId);
    if (weekError) throw new Error(`training_plan_weeks query failed: ${weekError.message}`);
    expect(weekRows!.length).toBeGreaterThan(0);
    for (const week of weekRows!) expect(blockIds.has(week.block_id as string)).toBe(true);
    const weekIds = new Set(weekRows!.map((w) => w.id as string));

    // Sessions — linked to a week, generatedPlanSessionId conserved as their id
    const { data: sessionRows, error: sessionError } = await admin
      .from("training_plan_generated_sessions")
      .select("id, week_id, plan_version_id, kind")
      .eq("plan_version_id", result.planVersionId);
    if (sessionError) throw new Error(`training_plan_generated_sessions query failed: ${sessionError.message}`);
    expect(sessionRows!.length).toBeGreaterThan(0);
    for (const session of sessionRows!) expect(weekIds.has(session.week_id as string)).toBe(true);

    // Planned prescriptions — present only for strength/DH kinds (never POWER/STRENGTH_FULL_LIGHT
    // in real V1 output, V0.4_124 — SessionKindAssignment never produces them), absent for aerobic.
    const { data: prescriptionRows, error: prescriptionError } = await admin
      .from("training_plan_planned_prescriptions")
      .select("id, generated_plan_session_id, plan_version_id")
      .eq("plan_version_id", result.planVersionId);
    if (prescriptionError) throw new Error(`training_plan_planned_prescriptions query failed: ${prescriptionError.message}`);

    const strengthOrDhSessionIds = new Set(
      sessionRows!.filter((s) => (s.kind as string).startsWith("STRENGTH") || (s.kind as string).startsWith("DH_")).map((s) => s.id as string)
    );
    const aerobicSessionIds = new Set(sessionRows!.filter((s) => (s.kind as string).startsWith("AEROBIC")).map((s) => s.id as string));
    expect(strengthOrDhSessionIds.size).toBeGreaterThan(0);
    expect(aerobicSessionIds.size).toBeGreaterThan(0);

    const prescribedSessionIds = new Set(prescriptionRows!.map((p) => p.generated_plan_session_id as string));
    for (const id of strengthOrDhSessionIds) expect(prescribedSessionIds.has(id)).toBe(true);
    for (const id of aerobicSessionIds) expect(prescribedSessionIds.has(id)).toBe(false);
  });

  it("a second call with the same athleteId/generationRequestId is an idempotent no-op — exactly one version row exists", async () => {
    athlete = await createTestAthlete(admin, "V0.4_149 idempotence");
    const generationRequestId = "22222222-2222-4222-8222-222222222222";
    const input = persistenceInput(admin, athlete.athleteId, generationRequestId, "V0.4_149 idempotence test.");

    const first = await persistGeneratedTrainingPlan(input);
    expect(first.idempotentReplay).toBe(false);

    const second = await persistGeneratedTrainingPlan(input);
    expect(second.idempotentReplay).toBe(true);
    expect(second.planVersionId).toBe(first.planVersionId);

    const { data: versionRows, error } = await admin
      .from("training_plan_versions")
      .select("id")
      .eq("athlete_id", athlete.athleteId)
      .eq("generation_request_id", generationRequestId);
    if (error) throw new Error(`training_plan_versions query failed: ${error.message}`);
    expect(versionRows!.length).toBe(1); // never two
  });
});
