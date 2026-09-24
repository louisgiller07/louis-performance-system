/**
 * V0.5_053 — full generated-plan E2E against real local Supabase:
 *   athlete config in DB -> generateAndPersistTrainingPlan -> canonical draft
 *   -> acceptTrainingPlanVersion (accept RPC + projection RPC)
 *   -> planned_sessions / training_blocks -> runDailyFor -> KEEP
 *   -> executablePrescription (V0.5_048) traced back to the canonical row.
 * Every layer runs with its real production code and default deps — no mocks.
 *
 * Seeding never writes planned_sessions/training_blocks directly (service_role
 * has no write grant on either since V0.4_002D — projection RPC only), so this
 * suite deliberately avoids testDb.ts's insertTrainingBlock/insertPlannedSession.
 *
 * OPT-IN ONLY, hard-bound to loopback — same gate as every other V0.4+
 * integration suite (see testDb.ts's createTestClient()).
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createTestClient,
  createTestAthlete,
  deleteTestAthlete,
  insertCheckin,
  insertRace,
  isLoopbackSupabaseUrl,
  resolveTestSupabaseUrl,
  setAthleteDiscipline,
  type CheckinFixture,
  type TestAthlete,
} from "./testDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { generateAndPersistTrainingPlan } from "../../src/supabase/generateAndPersistTrainingPlan.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { runDailyFor } from "../../src/supabase/runDailyFor.js";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESOLVED_ADMIN_URL = resolveTestSupabaseUrl();
const INTEGRATION_ENABLED =
  process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" && !!SERVER_KEY && isLoopbackSupabaseUrl(RESOLVED_ADMIN_URL);

const TODAY = "2026-10-05"; // Monday — generated weeks run Mon..Sun
const DURATION_WEEKS = 6; // horizon 2026-10-05 .. 2026-11-15
const RACE_DATE = "2026-11-04"; // J+30, beyond M1's short race window, inside the plan horizon
const RACE_WEEK_START = "2026-11-02";
const TAPER_WEEK_START = "2026-10-26";
// Same window the accept-training-plan Edge Function uses when
// TRAINING_PLAN_PROJECTION_WINDOW_DAYS is unset (FALLBACK_PROJECTION_WINDOW_DAYS = 14).
const PROJECTION_WINDOW_END = "2026-10-19";

/** Same full-equipment/full-terrain baseline already proven by generationPersistence.integration.test.ts to yield strength + DH + aerobic sessions. */
async function seedAthleteConfig(admin: SupabaseClient, athleteId: string): Promise<void> {
  await setAthleteDiscipline(admin, athleteId, "Downhill");
  await upsertPerformanceProfileFor(admin, athleteId, {
    strength_experience_tier: "beginner",
    equipment: ["barbell", "squat_rack", "dumbbells", "bench", "pull_up_bar", "cable_machine", "resistance_bands"],
    terrain_access: ["flow_trail", "bermed_trail", "technical_trail", "rock_garden", "root_rock_trail", "bike_park_jump_line", "full_dh_track"],
    declared_limitations: [],
    technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering"] },
  });
  for (const dayOfWeek of [0, 1, 2, 3, 4, 5, 6]) {
    await insertAvailabilityWindow(admin, athleteId, { day_of_week: dayOfWeek, start_time: "16:00:00", end_time: "20:00:00" });
  }
  await insertRace(admin, athleteId, { event_name: "V0.5_053 E2E race", start_date: RACE_DATE, end_date: RACE_DATE, priority: "A" });
}

async function latestLifecycleState(admin: SupabaseClient, planVersionId: string): Promise<string> {
  const { data, error } = await admin
    .from("training_plan_version_lifecycle_transitions")
    .select("state, transition_number")
    .eq("plan_version_id", planVersionId)
    .order("transition_number", { ascending: false })
    .limit(1)
    .single();
  if (error) throw new Error(`lifecycle query failed: ${error.message}`);
  return data.state as string;
}

async function countRows(admin: SupabaseClient, table: string, planVersionId: string): Promise<number> {
  const { count, error } = await admin.from(table).select("id", { count: "exact", head: true }).eq("plan_version_id", planVersionId);
  if (error) throw new Error(`${table} count failed: ${error.message}`);
  return count ?? 0;
}

interface SelectedSession {
  date: string;
  generatedSessionId: string;
  kind: string;
  loadProfile: string | null;
}

/**
 * The first projected date whose planned_session traces back to a generated
 * session that has a canonical prescription — never assumed to be TODAY.
 */
async function selectPrescribedProjectedSession(admin: SupabaseClient, athleteId: string, planVersionId: string): Promise<SelectedSession> {
  const { data: projected, error: projectedError } = await admin
    .from("planned_sessions")
    .select("planned_date, source_generated_session_id")
    .eq("athlete_id", athleteId)
    .eq("source", "generated")
    .eq("source_plan_version_id", planVersionId)
    .order("planned_date", { ascending: true });
  if (projectedError) throw new Error(`planned_sessions query failed: ${projectedError.message}`);

  const { data: prescriptions, error: prescriptionError } = await admin
    .from("training_plan_planned_prescriptions")
    .select("generated_plan_session_id")
    .eq("plan_version_id", planVersionId);
  if (prescriptionError) throw new Error(`prescriptions query failed: ${prescriptionError.message}`);
  const prescribed = new Set(prescriptions!.map((p) => p.generated_plan_session_id as string));

  const row = projected!.find((p) => p.source_generated_session_id !== null && prescribed.has(p.source_generated_session_id as string));
  if (!row) throw new Error("no projected session with a canonical prescription in the projection window");

  const { data: generated, error: generatedError } = await admin
    .from("training_plan_generated_sessions")
    .select("kind, load_profile")
    .eq("id", row.source_generated_session_id)
    .single();
  if (generatedError) throw new Error(`generated session query failed: ${generatedError.message}`);

  return {
    date: row.planned_date as string,
    generatedSessionId: row.source_generated_session_id as string,
    kind: generated.kind as string,
    loadProfile: generated.load_profile as string | null,
  };
}

describe.skipIf(!INTEGRATION_ENABLED)("V0.5_053 — generated plan E2E: config -> generate -> accept -> project -> daily run (real local Supabase)", () => {
  let admin: SupabaseClient;

  beforeAll(() => {
    admin = createTestClient();
  });

  async function withScratchAthlete<T>(name: string, run: (athlete: TestAthlete) => Promise<T>): Promise<T> {
    const athlete = await createTestAthlete(admin, name);
    try {
      return await run(athlete);
    } finally {
      await deleteTestAthlete(admin, athlete);
    }
  }

  /** Real generation + real acceptance/projection, shared by both scenarios. */
  async function generateAndAccept(athleteId: string, generationRequestId: string): Promise<string> {
    const generated = await generateAndPersistTrainingPlan({
      client: admin,
      athleteId,
      generationRequestId,
      durationWeeks: DURATION_WEEKS,
      today: TODAY,
    });
    const outcome = await acceptTrainingPlanVersion(admin, athleteId, generated.planVersionId, TODAY, PROJECTION_WINDOW_END);
    expect(outcome.warnings).toEqual([]);
    return generated.planVersionId;
  }

  it("nominal: KEEP on a projected generated session delivers the canonical executablePrescription", async () => {
    await withScratchAthlete("V0.5_053 E2E nominal", async (athlete) => {
      await seedAthleteConfig(admin, athlete.athleteId);
      const generationRequestId = "53053053-0530-4530-8530-530530530531";

      // --- Generation (real snapshot + planning/prescription engines + persistence RPC) ---
      const first = await generateAndPersistTrainingPlan({
        client: admin,
        athleteId: athlete.athleteId,
        generationRequestId,
        durationWeeks: DURATION_WEEKS,
        today: TODAY,
      });
      expect(first.idempotentReplay).toBe(false);
      const planVersionId = first.planVersionId;

      // --- Canonical persistence ---
      const { data: versionRow, error: versionError } = await admin
        .from("training_plan_versions")
        .select("id, athlete_id, generation_request_id, horizon_start_date, horizon_end_date, input_snapshot")
        .eq("id", planVersionId)
        .single();
      if (versionError) throw new Error(`training_plan_versions query failed: ${versionError.message}`);
      expect(versionRow.athlete_id).toBe(athlete.athleteId);
      expect(versionRow.generation_request_id).toBe(generationRequestId);
      expect(versionRow.horizon_start_date).toBe(TODAY);
      expect(versionRow.horizon_end_date).toBe("2026-11-15");
      expect(await latestLifecycleState(admin, planVersionId)).toBe("draft");

      const blockCount = await countRows(admin, "training_plan_blocks", planVersionId);
      const weekCount = await countRows(admin, "training_plan_weeks", planVersionId);
      const sessionCount = await countRows(admin, "training_plan_generated_sessions", planVersionId);
      const prescriptionCount = await countRows(admin, "training_plan_planned_prescriptions", planVersionId);
      expect(blockCount).toBe(1);
      expect(weekCount).toBe(DURATION_WEEKS);
      expect(sessionCount).toBeGreaterThan(0);
      expect(prescriptionCount).toBeGreaterThan(0);

      // --- Race horizon (V0.5_042): the J+30 race reached the persisted snapshot AND shaped the plan ---
      const snapshotRaces = (versionRow.input_snapshot as { races: Array<{ startDate: string }> }).races;
      expect(snapshotRaces.map((r) => r.startDate)).toEqual([RACE_DATE]);
      const { data: weekRows, error: weekError } = await admin
        .from("training_plan_weeks")
        .select("start_date, week_type")
        .eq("plan_version_id", planVersionId);
      if (weekError) throw new Error(`training_plan_weeks query failed: ${weekError.message}`);
      const weekTypeByStart = new Map(weekRows!.map((w) => [w.start_date as string, w.week_type as string]));
      expect(weekTypeByStart.get(RACE_WEEK_START)).toBe("race");
      expect(weekTypeByStart.get(TAPER_WEEK_START)).toBe("taper");

      // --- Idempotent replay: same request id -> same version, no duplicate canonical rows ---
      const replay = await generateAndPersistTrainingPlan({
        client: admin,
        athleteId: athlete.athleteId,
        generationRequestId,
        durationWeeks: DURATION_WEEKS,
        today: TODAY,
      });
      expect(replay.idempotentReplay).toBe(true);
      expect(replay.planVersionId).toBe(planVersionId);
      const { count: versionCount } = await admin
        .from("training_plan_versions")
        .select("id", { count: "exact", head: true })
        .eq("athlete_id", athlete.athleteId);
      expect(versionCount).toBe(1);
      expect(await countRows(admin, "training_plan_generated_sessions", planVersionId)).toBe(sessionCount);
      expect(await countRows(admin, "training_plan_planned_prescriptions", planVersionId)).toBe(prescriptionCount);

      // --- Acceptance + projection (real accept RPC, then real projection RPC) ---
      const acceptance = await acceptTrainingPlanVersion(admin, athlete.athleteId, planVersionId, TODAY, PROJECTION_WINDOW_END);
      expect(acceptance.warnings).toEqual([]);
      expect(acceptance.acceptance.planVersionId).toBe(planVersionId);
      expect(acceptance.acceptance.idempotentReplay).toBe(false);
      expect(acceptance.projection).toBeDefined();
      expect(acceptance.projection!.plannedSessions.length).toBeGreaterThan(0);
      expect(acceptance.projection!.plannedSessions.every((s) => s.outcome === "projected")).toBe(true);
      expect(await latestLifecycleState(admin, planVersionId)).toBe("accepted");

      const { data: pointer, error: pointerError } = await admin
        .from("training_plan_current_version")
        .select("plan_version_id")
        .eq("athlete_id", athlete.athleteId)
        .single();
      if (pointerError) throw new Error(`training_plan_current_version query failed: ${pointerError.message}`);
      expect(pointer.plan_version_id).toBe(planVersionId);

      // --- planned_sessions lineage: every projected row points at a generated session of THIS plan ---
      const { data: projectedRows, error: projectedError } = await admin
        .from("planned_sessions")
        .select("planned_date, source, source_plan_version_id, source_generated_session_id")
        .eq("athlete_id", athlete.athleteId);
      if (projectedError) throw new Error(`planned_sessions query failed: ${projectedError.message}`);
      expect(projectedRows!.length).toBe(acceptance.projection!.plannedSessions.length);
      const { data: generatedRows, error: generatedError } = await admin
        .from("training_plan_generated_sessions")
        .select("id")
        .eq("plan_version_id", planVersionId);
      if (generatedError) throw new Error(`training_plan_generated_sessions query failed: ${generatedError.message}`);
      const generatedIds = new Set(generatedRows!.map((g) => g.id as string));
      for (const row of projectedRows!) {
        expect(row.source).toBe("generated");
        expect(row.source_plan_version_id).toBe(planVersionId);
        expect(row.source_generated_session_id).not.toBeNull();
        expect(generatedIds.has(row.source_generated_session_id as string)).toBe(true);
        expect(row.planned_date >= TODAY && row.planned_date <= PROJECTION_WINDOW_END).toBe(true);
      }

      // --- training_blocks projection ---
      const { data: trainingBlock, error: trainingBlockError } = await admin
        .from("training_blocks")
        .select("source_plan_block_id, mode, is_current")
        .eq("athlete_id", athlete.athleteId)
        .eq("is_current", true)
        .single();
      if (trainingBlockError) throw new Error(`training_blocks query failed: ${trainingBlockError.message}`);
      const { data: planBlock } = await admin.from("training_plan_blocks").select("id").eq("plan_version_id", planVersionId).single();
      expect(trainingBlock.source_plan_block_id).toBe(planBlock!.id);
      expect(trainingBlock.mode).toBe("UNSPECIFIED");

      // --- Daily Run on a real projected, prescribed session date (never assumed to be TODAY) ---
      const selected = await selectPrescribedProjectedSession(admin, athlete.athleteId, planVersionId);
      await insertCheckin(admin, athlete.athleteId, selected.date);

      const result = await runDailyFor(admin, athlete.athleteId, selected.date);

      // The J+30 race is outside M1's own short race window from any projected date.
      expect(result.rawContext.upcoming_races).toEqual([]);
      expect(result.rawContext.planned_session?.kind).toBe(selected.kind);
      expect(result.dailyPlan.planned_session_before?.kind).toBe(selected.kind);
      expect(result.dailyPlan.decision).toBe("KEEP");
      expect(result.dailyPlan.final_session.kind).toBe(selected.kind);
      expect(result.dailyPlan.final_session.load_profile ?? null).toBe(selected.loadProfile);

      // --- executablePrescription: projected id === executable id === canonical id ---
      const { data: canonical, error: canonicalError } = await admin
        .from("training_plan_planned_prescriptions")
        .select("id, generated_plan_session_id")
        .eq("generated_plan_session_id", selected.generatedSessionId)
        .single();
      if (canonicalError) throw new Error(`canonical prescription query failed: ${canonicalError.message}`);

      const executable = result.executablePrescription;
      expect(executable).not.toBeNull();
      expect(executable!.generatedPlanSessionId).toBe(selected.generatedSessionId);
      expect(executable!.generatedPlanSessionId).toBe(canonical.generated_plan_session_id);
      expect(executable!.id).toBe(canonical.id);
      expect(result.warnings.filter((w) => w.includes("V0.5_048"))).toEqual([]);

      const structure = executable!.structure;
      if (structure.domain === "strength") {
        expect(structure.blocks.length).toBeGreaterThan(0);
        for (const block of structure.blocks) {
          expect(block.exerciseId.length).toBeGreaterThan(0);
          expect(block.sets).toBeGreaterThanOrEqual(1);
          expect(block.repScheme).toBeDefined();
        }
      } else if (structure.domain === "dh_technical") {
        expect(structure.drills.length).toBeGreaterThan(0);
        for (const drill of structure.drills) {
          expect(drill.drillId.length).toBeGreaterThan(0);
          expect(drill.runs).toBeGreaterThanOrEqual(1);
          expect(drill.executionCue.length).toBeGreaterThan(0);
          expect(drill.successCriterion.length).toBeGreaterThan(0);
        }
      } else {
        throw new Error(`unexpected prescription domain: ${(structure as { domain: string }).domain}`);
      }

      // Never leaked into the persisted decision.
      const { data: decisionRow } = await admin.from("decisions").select("daily_plan").eq("id", result.persistence.decision_id).single();
      expect(decisionRow!.daily_plan).not.toHaveProperty("executablePrescription");
    });
  });

  it("companion: same lineage + canonical prescription, but a Safety REST -> executablePrescription is null", async () => {
    await withScratchAthlete("V0.5_053 E2E safety REST", async (athlete) => {
      await seedAthleteConfig(admin, athlete.athleteId);
      const planVersionId = await generateAndAccept(athlete.athleteId, "53053053-0530-4530-8530-530530530532");
      const selected = await selectPrescribedProjectedSession(admin, athlete.athleteId, planVersionId);

      const concussion: CheckinFixture = { suspected_concussion: true };
      await insertCheckin(admin, athlete.athleteId, selected.date, concussion);

      const result = await runDailyFor(admin, athlete.athleteId, selected.date);

      // Lineage and canonical prescription genuinely exist for this date...
      expect(result.rawContext.planned_session?.kind).toBe(selected.kind);
      const { count } = await admin
        .from("training_plan_planned_prescriptions")
        .select("id", { count: "exact", head: true })
        .eq("generated_plan_session_id", selected.generatedSessionId);
      expect(count).toBe(1);

      // ...but Head Coach did not keep the session, so nothing is exposed.
      expect(result.dailyPlan.decision).toBe("REST");
      expect(result.executablePrescription).toBeNull();
    });
  });
});
