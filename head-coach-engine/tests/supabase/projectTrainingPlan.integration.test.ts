/**
 * M2.7 / ADR V0.4_012 — real local Supabase proof for the projection
 * runtime: projectTrainingPlan() (repositories + mapping + RPC, the full
 * real stack) against real canonical plan trees built via the actual
 * generate/accept RPCs, never hand-inserted rows.
 *
 * OPT-IN ONLY, hard-bound to loopback — see testDb.ts's createTestClient().
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createTestClient,
  createTestAthlete,
  deleteTestAthlete,
  insertPlannedSession,
  insertCompletedSession,
  generateAndAcceptTrainingPlan,
  isLoopbackSupabaseUrl,
  resolveTestSupabaseUrl,
  type TestAthlete,
} from "./testDb.js";
import { projectTrainingPlan } from "../../src/supabase/projectTrainingPlan.js";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESOLVED_ADMIN_URL = resolveTestSupabaseUrl();
const INTEGRATION_ENABLED =
  process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" && !!SERVER_KEY && isLoopbackSupabaseUrl(RESOLVED_ADMIN_URL);

const WINDOW_START = "2026-10-19";
const WINDOW_END = "2026-10-25";

describe.skipIf(!INTEGRATION_ENABLED)("M2.7 — projectTrainingPlan (real local Supabase)", () => {
  let admin: SupabaseClient;
  let athleteA: TestAthlete;
  let athleteB: TestAthlete;

  beforeAll(() => {
    admin = createTestClient();
  });

  afterEach(async () => {
    if (athleteA) await deleteTestAthlete(admin, athleteA);
    if (athleteB) await deleteTestAthlete(admin, athleteB);
  });

  it("first projection creates rows for every date with canonical content, plus the current block", async () => {
    athleteA = await createTestAthlete(admin, "Projection — first run");
    await generateAndAcceptTrainingPlan(admin, athleteA.athleteId, {
      horizonStartDate: WINDOW_START,
      horizonEndDate: WINDOW_END,
      sessions: [
        { date: "2026-10-20", kind: "STRENGTH_LOWER", loadProfile: "MODERATE" },
        { date: "2026-10-21", kind: "REST" },
      ],
    });

    const report = await projectTrainingPlan(admin, athleteA.athleteId, WINDOW_START, WINDOW_END);

    expect(report.plannedSessions).toEqual(
      expect.arrayContaining([
        { date: "2026-10-20", outcome: "projected" },
        { date: "2026-10-21", outcome: "projected" },
      ])
    );
    expect(report.trainingBlock.outcome).toBe("updated");

    const { data: row } = await admin
      .from("planned_sessions")
      .select("session_type, source, intervention")
      .eq("athlete_id", athleteA.athleteId)
      .eq("planned_date", "2026-10-20")
      .single();
    expect(row).toMatchObject({ session_type: "STRENGTH_A", source: "generated" });

    const { data: block } = await admin
      .from("training_blocks")
      .select("source_plan_block_id, mode")
      .eq("athlete_id", athleteA.athleteId)
      .eq("is_current", true)
      .single();
    expect(block?.source_plan_block_id).not.toBeNull();
    expect(block?.mode).toBe("IN_SEASON");
  });

  it("second identical projection is a true no-op: outcomes are 'unchanged' and updated_at does not move", async () => {
    athleteA = await createTestAthlete(admin, "Projection — idempotence");
    await generateAndAcceptTrainingPlan(admin, athleteA.athleteId, {
      horizonStartDate: WINDOW_START,
      horizonEndDate: WINDOW_END,
      sessions: [{ date: "2026-10-20", kind: "STRENGTH_LOWER", loadProfile: "MODERATE" }],
    });

    await projectTrainingPlan(admin, athleteA.athleteId, WINDOW_START, WINDOW_END);
    const { data: firstRow } = await admin
      .from("planned_sessions")
      .select("updated_at")
      .eq("athlete_id", athleteA.athleteId)
      .eq("planned_date", "2026-10-20")
      .single();

    const secondReport = await projectTrainingPlan(admin, athleteA.athleteId, WINDOW_START, WINDOW_END);
    const { data: secondRow } = await admin
      .from("planned_sessions")
      .select("updated_at")
      .eq("athlete_id", athleteA.athleteId)
      .eq("planned_date", "2026-10-20")
      .single();

    expect(secondReport.plannedSessions).toContainEqual({ date: "2026-10-20", outcome: "unchanged" });
    expect(secondReport.trainingBlock.outcome).toBe("unchanged");
    expect(secondRow?.updated_at).toBe(firstRow?.updated_at);
  });

  it("a completed session is protected — never overwritten, even though it started as a projector-owned row", async () => {
    athleteA = await createTestAthlete(admin, "Projection — completed protection");
    await generateAndAcceptTrainingPlan(admin, athleteA.athleteId, {
      horizonStartDate: WINDOW_START,
      horizonEndDate: WINDOW_END,
      sessions: [{ date: "2026-10-20", kind: "STRENGTH_LOWER", loadProfile: "MODERATE" }],
    });
    await projectTrainingPlan(admin, athleteA.athleteId, WINDOW_START, WINDOW_END);
    await insertCompletedSession(admin, athleteA.athleteId, "2026-10-20", "STRENGTH_A", {
      kind: "STRENGTH_LOWER",
      load_profile: "HEAVY",
    });

    const report = await projectTrainingPlan(admin, athleteA.athleteId, WINDOW_START, WINDOW_END);

    expect(report.plannedSessions).toContainEqual({ date: "2026-10-20", outcome: "skipped_completed" });
  });

  it("a manually overridden date survives projection untouched", async () => {
    athleteA = await createTestAthlete(admin, "Projection — manual override");
    await generateAndAcceptTrainingPlan(admin, athleteA.athleteId, {
      horizonStartDate: WINDOW_START,
      horizonEndDate: WINDOW_END,
      sessions: [{ date: "2026-10-20", kind: "STRENGTH_LOWER", loadProfile: "MODERATE" }],
    });
    // Athlete manual save — source defaults to 'manual' (insertPlannedSession never sets source).
    await insertPlannedSession(admin, athleteA.athleteId, "2026-10-20", {
      session_type: "DH_TECHNICAL",
      intervention: { kind: "DH_TECHNICAL" },
    });

    const report = await projectTrainingPlan(admin, athleteA.athleteId, WINDOW_START, WINDOW_END);

    expect(report.plannedSessions).toContainEqual({ date: "2026-10-20", outcome: "skipped_manual_override" });
    const { data: row } = await admin
      .from("planned_sessions")
      .select("session_type, source")
      .eq("athlete_id", athleteA.athleteId)
      .eq("planned_date", "2026-10-20")
      .single();
    expect(row).toMatchObject({ session_type: "DH_TECHNICAL", source: "manual" });
  });

  it("cross-athlete lineage is rejected: calling the RPC for athlete A with athlete B's plan_version_id reports every candidate as skipped_stale_version and writes nothing", async () => {
    athleteA = await createTestAthlete(admin, "Projection — cross-athlete A");
    athleteB = await createTestAthlete(admin, "Projection — cross-athlete B");
    const planB = await generateAndAcceptTrainingPlan(admin, athleteB.athleteId, {
      horizonStartDate: WINDOW_START,
      horizonEndDate: WINDOW_END,
      sessions: [{ date: "2026-10-20", kind: "REST" }],
    });

    const { data, error } = await admin.rpc("project_training_plan", {
      p_athlete_id: athleteA.athleteId,
      p_plan_version_id: planB.planVersionId,
      p_planned_session_candidates: [
        {
          date: "2026-10-20",
          sessionType: "REST",
          intervention: { kind: "REST" },
          sourceGeneratedSessionId: planB.generatedSessionIds["2026-10-20"],
        },
      ],
      p_training_block_candidate: null,
    });

    expect(error).toBeNull();
    expect(data.plannedSessions).toEqual([{ date: "2026-10-20", outcome: "skipped_stale_version" }]);

    const { data: row } = await admin
      .from("planned_sessions")
      .select("id")
      .eq("athlete_id", athleteA.athleteId)
      .eq("planned_date", "2026-10-20")
      .maybeSingle();
    expect(row).toBeNull();
  });

  it("a malformed candidate (missing a required field) is rejected outright", async () => {
    athleteA = await createTestAthlete(admin, "Projection — malformed payload");
    const plan = await generateAndAcceptTrainingPlan(admin, athleteA.athleteId, {
      horizonStartDate: WINDOW_START,
      horizonEndDate: WINDOW_END,
      sessions: [{ date: "2026-10-20", kind: "REST" }],
    });

    const { error } = await admin.rpc("project_training_plan", {
      p_athlete_id: athleteA.athleteId,
      p_plan_version_id: plan.planVersionId,
      // sessionType intentionally omitted.
      p_planned_session_candidates: [{ date: "2026-10-20", intervention: { kind: "REST" }, sourceGeneratedSessionId: plan.generatedSessionIds["2026-10-20"] }],
      p_training_block_candidate: null,
    });

    expect(error).not.toBeNull();
    expect(error?.message).toContain("sessionType");
  });
});
