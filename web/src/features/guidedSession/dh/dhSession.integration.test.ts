/**
 * UX-11C.3 — guided DH passes end to end on the real local Supabase
 * (opt-in, local only): real V2 daily runs (head-coach, test-only cross
 * import) write DH technical final prescriptions; the web loader and the web
 * client, signed in as the rider, go through RLS and the real
 * `session-execution` Edge Function into record_session_execution (UX-11B.2.6
 * integrity included). The M1 recent-history bridge (UX-11B.2.4, unchanged)
 * is read with head-coach computeDailyFor. Scratch athletes stay in the
 * local database (append-only rows).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertSessionExecutionServing } from "../../../test/edgeRuntime";
import { createTestAthlete, createTestClient, insertCheckin, setAthleteDiscipline } from "../../../../../head-coach-engine/tests/supabase/testDb.js";
import { runDailyFor } from "../../../../../head-coach-engine/src/supabase/runDailyFor.js";
import { computeDailyFor } from "../../../../../head-coach-engine/src/supabase/computeDailyFor.js";
import { upsertPerformanceProfileFor } from "../../../../../head-coach-engine/src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../../../../head-coach-engine/src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { generateAndPersistTrainingPlanV2 } from "../../../../../head-coach-engine/src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { acceptTrainingPlanVersion } from "../../../../../head-coach-engine/src/supabase/acceptTrainingPlanVersion.js";
import type { PassResultInput, SessionExecutionBatch } from "../sessionExecutionClient";
import type { FinalPrescriptionV2View } from "../../finalPrescriptionV2/finalPrescriptionV2Types";
import { activeResultsBySlot, slotKey } from "../results/activeResults";
import { dhProgress, mainDrill } from "./dhPasses";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const LOCAL_ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
const LOCAL_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const INTEGRATION_ENABLED =
  process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" && !!SERVER_KEY && !!LOCAL_ANON_KEY && /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(LOCAL_URL);

const TODAY = "2026-10-05";

describe.skipIf(!INTEGRATION_ENABLED)("UX-11C.3 — guided DH passes (real local Supabase + Edge session-execution)", () => {
  let admin: SupabaseClient;
  let userClient: SupabaseClient;
  let loader: typeof import("../guidedSessionLoader");
  let client: typeof import("../sessionExecutionClient");
  let athleteId: string;
  /** The first two days of the accepted V2 plan whose current final prescription is a guided DH technical session. */
  const dhDays: Array<{ day: string; prescription: FinalPrescriptionV2View }> = [];

  beforeAll(async () => {
    await assertSessionExecutionServing(LOCAL_URL);
    admin = createTestClient();
    vi.stubEnv("VITE_SUPABASE_URL", LOCAL_URL);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", LOCAL_ANON_KEY!);
    vi.resetModules();
    ({ supabase: userClient } = await import("../../../lib/supabase"));
    loader = await import("../guidedSessionLoader");
    client = await import("../sessionExecutionClient");

    const athlete = await createTestAthlete(admin, "11C.3 guided DH");
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

    for (const day of ["2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14"]) {
      if (dhDays.length === 2) break;
      await insertCheckin(admin, athleteId, day);
      await runDailyFor(admin, athleteId, day);
      const snapshot = await loader.loadGuidedSession(athleteId, day);
      if (snapshot.kind === "ready_to_start" && snapshot.prescription.family === "dh_technical") dhDays.push({ day, prescription: snapshot.prescription });
    }
    if (dhDays.length < 2) throw new Error(`expected two DH technical days in the plan, found ${dhDays.length}`);
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
  const pass = (executionId: string, itemId: string, ordinal: number, success: boolean | null, supersedesId: string | null = null): PassResultInput => ({
    id: randomUUID(),
    execution_id: executionId,
    prescription_item_id: itemId,
    set_number: ordinal,
    done: true,
    measure_type: "pass",
    measure_value: null,
    success,
    supersedes_id: supersedesId,
    occurred_at: `2026-10-01T17:${String(10 + ordinal).padStart(2, "0")}:00.000Z`,
  });
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

  it("E1: passes true / false / null → correction → active results → duplicate original and out-of-range refused → partial completed → terminal → M1 bridge counts it once", async () => {
    const { day, prescription } = dhDays[0]!;
    const drill = mainDrill(prescription)!;
    expect(drill.passes).toBeGreaterThanOrEqual(4);
    expect(drill.passes).toBeLessThanOrEqual(8);
    const start = startBatch(day, prescription.id);
    const e1 = start.execution!.id;
    await ok(start);

    const p1 = pass(e1, drill.prescriptionItemId, 1, true);
    const p2 = pass(e1, drill.prescriptionItemId, 2, false);
    const p3 = pass(e1, drill.prescriptionItemId, 3, null);
    expect((await ok({ events: [], sets: [p1, p2, p3] })).inserted.sets).toEqual([p1.id, p2.id, p3.id]);
    const c2 = pass(e1, drill.prescriptionItemId, 2, true, p2.id);
    await ok({ events: [], sets: [c2] });

    // UX-11B.2.6 through the real Edge: a second original for pass 1, an ordinal beyond the planned count.
    expect(await client.postSessionExecutionBatch({ events: [], sets: [pass(e1, drill.prescriptionItemId, 1, false)] })).toEqual({ ok: false, error: { code: "result_slot_exists", status: 409, retryable: false } });
    expect(await client.postSessionExecutionBatch({ events: [], sets: [pass(e1, drill.prescriptionItemId, drill.passes + 1, true)] })).toEqual({
      ok: false,
      error: { code: "result_slot_out_of_range", status: 422, retryable: false },
    });

    let snapshot = await executionSnapshot(day);
    expect(snapshot.execution.id).toBe(e1);
    const rows = snapshot.execution.exercise_set_results;
    expect(rows).toHaveLength(4);
    const active = activeResultsBySlot(rows);
    expect(active.get(slotKey(drill.prescriptionItemId, 1))).toMatchObject({ id: p1.id, success: true, measure_type: "pass", measure_value: null });
    expect(active.get(slotKey(drill.prescriptionItemId, 2))).toMatchObject({ id: c2.id, success: true, supersedes_id: p2.id });
    expect(active.get(slotKey(drill.prescriptionItemId, 3))).toMatchObject({ id: p3.id, success: null });
    // Drill passes carry no exercise.
    const { data: stored } = await admin.from("exercise_set_results").select("exercise_id").eq("execution_id", e1);
    expect(stored!.every((r) => r.exercise_id === null)).toBe(true);
    expect(dhProgress(prescription, rows)).toMatchObject({ recorded: 3, canComplete: true, completionNeedsConfirmation: true });

    // Partial completion (confirmed on the client): the `completed` event alone.
    await ok({ events: [{ id: randomUUID(), execution_id: e1, event_type: "completed", occurred_at: at(day, 50) }] });
    snapshot = await executionSnapshot(day);
    expect(snapshot.phase).toBe("completed");
    expect(await client.postSessionExecutionBatch({ events: [], sets: [pass(e1, drill.prescriptionItemId, 4, true)] })).toEqual({ ok: false, error: { code: "execution_terminal", status: 409, retryable: false } });

    // M1 recent-history bridge, unchanged: the completed DH execution counts once (decision final_session; success never read).
    const { rawContext } = await computeDailyFor(admin, athleteId, dhDays[1]!.day);
    expect(rawContext.recent_sessions.filter((s) => s.date === day)).toEqual([{ date: day, intervention: expect.objectContaining({ kind: expect.stringMatching(/^DH_/) }), completion_status: "done" }]);
  }, 60_000);

  it("E2: one pass → abandoned (no completed history, no new pass) → restart E3 while the prescription is current", async () => {
    const { day, prescription } = dhDays[1]!;
    const drill = mainDrill(prescription)!;
    const start = startBatch(day, prescription.id);
    const e2 = start.execution!.id;
    await ok(start);
    await ok({ events: [], sets: [pass(e2, drill.prescriptionItemId, 1, false)] });
    await ok({ events: [{ id: randomUUID(), execution_id: e2, event_type: "abandoned", occurred_at: at(day, 20) }] });
    expect(await client.postSessionExecutionBatch({ events: [], sets: [pass(e2, drill.prescriptionItemId, 2, true)] })).toMatchObject({ ok: false, error: { code: "execution_terminal" } });

    const abandoned = await executionSnapshot(day);
    expect(abandoned).toMatchObject({ phase: "abandoned", execution: { id: e2 }, restartFinalPrescriptionId: prescription.id });
    const { rawContext } = await computeDailyFor(admin, athleteId, day);
    expect(rawContext.recent_sessions.filter((s) => s.date === day)).toEqual([]);

    const restart = startBatch(day, abandoned.restartFinalPrescriptionId!);
    await ok(restart);
    const resumed = await executionSnapshot(day);
    expect(resumed).toMatchObject({ phase: "active", execution: { id: restart.execution!.id } });
    expect(resumed.execution.exercise_set_results).toEqual([]);
  }, 60_000);
});
