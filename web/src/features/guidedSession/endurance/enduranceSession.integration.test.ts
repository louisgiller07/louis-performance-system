/**
 * UX-11C.4 — guided endurance end to end on the real local Supabase (opt-in,
 * local only): real V2 daily runs (head-coach, test-only cross import) write
 * endurance final prescriptions; the web loader and the web client, signed in
 * as the rider, go through RLS and the real `session-execution` Edge Function
 * into record_session_execution (activities). The M1 recent-history bridge
 * (UX-11B.2.4, unchanged) is read with head-coach computeDailyFor. Scratch
 * athletes stay in the local database (append-only rows).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, insertCheckin, setAthleteDiscipline } from "../../../../../head-coach-engine/tests/supabase/testDb.js";
import { runDailyFor } from "../../../../../head-coach-engine/src/supabase/runDailyFor.js";
import { computeDailyFor } from "../../../../../head-coach-engine/src/supabase/computeDailyFor.js";
import { upsertPerformanceProfileFor } from "../../../../../head-coach-engine/src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../../../../head-coach-engine/src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { generateAndPersistTrainingPlanV2 } from "../../../../../head-coach-engine/src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { acceptTrainingPlanVersion } from "../../../../../head-coach-engine/src/supabase/acceptTrainingPlanVersion.js";
import type { ActivityResultInput, SessionExecutionBatch } from "../sessionExecutionClient";
import type { FinalPrescriptionV2View } from "../../finalPrescriptionV2/finalPrescriptionV2Types";
import { activeActivityResult } from "../results/activeResults";
import { allowedActivities, validateActivityForm, type ActivityFormValues } from "./enduranceActivity";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const LOCAL_ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
const LOCAL_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const INTEGRATION_ENABLED =
  process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" && !!SERVER_KEY && !!LOCAL_ANON_KEY && /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(LOCAL_URL);

const TODAY = "2026-10-05";

describe.skipIf(!INTEGRATION_ENABLED)("UX-11C.4 — guided endurance (real local Supabase + Edge session-execution)", () => {
  let admin: SupabaseClient;
  let userClient: SupabaseClient;
  let loader: typeof import("../guidedSessionLoader");
  let client: typeof import("../sessionExecutionClient");
  let athleteId: string;
  /** The first two days of the accepted V2 plan whose current final prescription is a guided endurance session. */
  const enduranceDays: Array<{ day: string; prescription: FinalPrescriptionV2View; decisionId: string }> = [];

  beforeAll(async () => {
    admin = createTestClient();
    vi.stubEnv("VITE_SUPABASE_URL", LOCAL_URL);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", LOCAL_ANON_KEY!);
    vi.resetModules();
    ({ supabase: userClient } = await import("../../../lib/supabase"));
    loader = await import("../guidedSessionLoader");
    client = await import("../sessionExecutionClient");

    const athlete = await createTestAthlete(admin, "11C.4 guided endurance");
    athleteId = athlete.athleteId;
    await setAthleteDiscipline(admin, athleteId, "Downhill");
    await upsertPerformanceProfileFor(admin, athleteId, {
      strength_experience_tier: "intermediate",
      equipment: ["dumbbells", "bench"],
      terrain_access: ["flow_trail", "bermed_trail"],
      declared_limitations: [],
      technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
      dh_technical_tier: "intermediate",
    });
    for (const d of [0, 1, 2, 3, 4, 5, 6]) await insertAvailabilityWindow(admin, athleteId, { day_of_week: d, start_time: "08:00:00", end_time: "20:00:00" });
    const persisted = await generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 2, today: TODAY });
    if (persisted.status !== "persisted") throw new Error("V2 plan not persisted");
    await acceptTrainingPlanVersion(admin, athleteId, persisted.planVersionId, TODAY, "2026-10-18");

    const { data: user } = await admin.auth.admin.getUserById(athlete.userId);
    const password = `Sc${randomUUID().replace(/-/g, "").slice(0, 20)}Aa1!`;
    await admin.auth.admin.updateUserById(athlete.userId, { password });
    const { error } = await userClient.auth.signInWithPassword({ email: user.user!.email!, password });
    if (error) throw new Error(`sign-in failed: ${error.message}`);

    for (const day of ["2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]) {
      if (enduranceDays.length === 2) break;
      await insertCheckin(admin, athleteId, day);
      const run = await runDailyFor(admin, athleteId, day);
      const snapshot = await loader.loadGuidedSession(athleteId, day);
      if (snapshot.kind === "ready_to_start" && snapshot.prescription.family === "endurance") enduranceDays.push({ day, prescription: snapshot.prescription, decisionId: run.persistence.decision_id });
    }
    if (enduranceDays.length < 2) throw new Error(`expected two endurance days in the plan, found ${enduranceDays.length}`);
  }, 180_000);

  afterAll(async () => {
    await userClient?.auth.signOut();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const at = (day: string, minute: number) => `${day}T17:${String(minute).padStart(2, "0")}:00.000Z`;
  const startBatch = (day: string, fpId: string): SessionExecutionBatch => {
    const id = randomUUID();
    return { execution: { id, session_date: day, started_at: at(day, 0), final_prescription_id: fpId, comment: null }, events: [{ id: randomUUID(), execution_id: id, event_type: "started", occurred_at: at(day, 0) }] };
  };
  /** The real form → payload path (validation + unit conversion), as the module does. */
  const activity = (prescription: FinalPrescriptionV2View, executionId: string, values: ActivityFormValues, supersedesId: string | null = null): ActivityResultInput => {
    const v = validateActivityForm(allowedActivities(prescription)!, values);
    if (!v.ok) throw new Error(`invalid form: ${JSON.stringify(v.errors)}`);
    return { id: randomUUID(), execution_id: executionId, ...v.value, comment: null, supersedes_id: supersedesId, occurred_at: "2026-10-01T18:00:00.000Z" };
  };
  const ok = async (batch: SessionExecutionBatch) => {
    const r = await client.postSessionExecutionBatch(batch);
    if (!r.ok) throw new Error(`refused: ${r.error.code}`);
    return r.value;
  };
  const executionSnapshot = async (day: string) => {
    const s = await loader.loadGuidedSession(athleteId, day);
    if (s.kind !== "execution") throw new Error(`expected an execution, got ${s.kind}`);
    return s;
  };

  it("E1: mtb_rolling 43 min / 18.4 km / RPE 4 → DB units → correction → second original refused → completed → terminal → M1 bridge counts it once (decision mapping unchanged)", async () => {
    const { day, prescription, decisionId } = enduranceDays[0]!;
    expect(allowedActivities(prescription)!.map((a) => a.id)).toContain("mtb_rolling");
    const start = startBatch(day, prescription.id);
    const e1 = start.execution!.id;
    await ok(start);

    const a1 = activity(prescription, e1, { activityId: "mtb_rolling", minutes: "43", km: "18.4", rpe: "4" });
    expect((await ok({ events: [], activities: [a1] })).inserted.activities).toEqual([a1.id]);
    const { data: stored } = await admin.from("session_activity_results").select("activity_id, duration_seconds, distance_m, rpe_actual, comment").eq("id", a1.id).single();
    expect(stored).toEqual({ activity_id: "mtb_rolling", duration_seconds: 2580, distance_m: 18400, rpe_actual: 4, comment: null });

    // Correction toward another allowed activity and duration; a second original is refused.
    const c1 = activity(prescription, e1, { activityId: "road_bike", minutes: "50", km: "18.4", rpe: "4" }, a1.id);
    await ok({ events: [], activities: [c1] });
    expect(await client.postSessionExecutionBatch({ events: [], activities: [activity(prescription, e1, { activityId: "running", minutes: "30", km: "", rpe: "" })] })).toEqual({
      ok: false,
      error: { code: "activity_result_exists", status: 409, retryable: false },
    });

    let snapshot = await executionSnapshot(day);
    expect(snapshot.execution.id).toBe(e1);
    expect(snapshot.execution.session_activity_results).toHaveLength(2);
    expect(activeActivityResult(snapshot.execution.session_activity_results)).toMatchObject({ id: c1.id, activity_id: "road_bike", duration_seconds: 3000, distance_m: 18400, rpe_actual: 4, supersedes_id: a1.id });

    await ok({ events: [{ id: randomUUID(), execution_id: e1, event_type: "completed", occurred_at: at(day, 50) }] });
    snapshot = await executionSnapshot(day);
    expect(snapshot.phase).toBe("completed");
    expect(await client.postSessionExecutionBatch({ events: [], activities: [activity(prescription, e1, { activityId: "running", minutes: "20", km: "", rpe: "" }, c1.id)] })).toEqual({
      ok: false,
      error: { code: "execution_terminal", status: 409, retryable: false },
    });

    // M1 bridge: counted once, with the decision's own final_session (actual duration / distance / RPE never read).
    const { data: decision } = await admin.from("decisions").select("daily_plan").eq("id", decisionId).single();
    const finalSession = (decision!.daily_plan as { final_session: Record<string, unknown> }).final_session;
    const { rawContext } = await computeDailyFor(admin, athleteId, enduranceDays[1]!.day);
    expect(rawContext.recent_sessions.filter((s) => s.date === day)).toEqual([{ date: day, intervention: finalSession, completion_status: "done" }]);
  }, 60_000);

  it("E2: activity → abandoned (no completed history, frozen) → restart E3 while the prescription is current", async () => {
    const { day, prescription } = enduranceDays[1]!;
    const start = startBatch(day, prescription.id);
    const e2 = start.execution!.id;
    await ok(start);
    await ok({ events: [], activities: [activity(prescription, e2, { activityId: "home_trainer", minutes: "40", km: "", rpe: "3" })] });
    await ok({ events: [{ id: randomUUID(), execution_id: e2, event_type: "abandoned", occurred_at: at(day, 20) }] });

    const abandoned = await executionSnapshot(day);
    expect(abandoned).toMatchObject({ phase: "abandoned", execution: { id: e2 }, restartFinalPrescriptionId: prescription.id });
    expect(abandoned.execution.session_activity_results).toHaveLength(1);
    const { rawContext } = await computeDailyFor(admin, athleteId, day);
    expect(rawContext.recent_sessions.filter((s) => s.date === day)).toEqual([]);

    const restart = startBatch(day, abandoned.restartFinalPrescriptionId!);
    await ok(restart);
    const resumed = await executionSnapshot(day);
    expect(resumed).toMatchObject({ phase: "active", execution: { id: restart.execution!.id } });
    expect(resumed.execution.session_activity_results).toEqual([]);
    // Completing E3 without its activity is refused by the backend (activity_result_required).
    expect(await client.postSessionExecutionBatch({ events: [{ id: randomUUID(), execution_id: restart.execution!.id, event_type: "completed", occurred_at: at(day, 55) }] })).toMatchObject({
      ok: false,
      error: { code: "activity_result_required" },
    });
  }, 60_000);
});
