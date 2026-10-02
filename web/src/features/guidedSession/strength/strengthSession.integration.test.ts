/**
 * UX-11C.2 — guided Force sets end to end on the real local Supabase
 * (opt-in, local only): real V2 daily runs (head-coach, test-only cross
 * import) write Force final prescriptions; the web loader and the web client,
 * signed in as the rider, go through RLS and the real `session-execution`
 * Edge Function into record_session_execution. The M1 recent-history bridge
 * (UX-11B.2.4, unchanged) is read with head-coach computeDailyFor. Scratch
 * athletes stay in the local database (append-only rows).
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
import type { ForceSetInput, SessionExecutionBatch } from "../sessionExecutionClient";
import type { FinalPrescriptionV2View } from "../../finalPrescriptionV2/finalPrescriptionV2Types";
import { activeResultsBySlot, slotKey, strengthProgress, workItems } from "./strengthSets";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const LOCAL_ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
const LOCAL_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const INTEGRATION_ENABLED =
  process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" && !!SERVER_KEY && !!LOCAL_ANON_KEY && /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(LOCAL_URL);

const TODAY = "2026-10-05";

describe.skipIf(!INTEGRATION_ENABLED)("UX-11C.2 — guided Force sets (real local Supabase + Edge session-execution)", () => {
  let admin: SupabaseClient;
  let userClient: SupabaseClient;
  let loader: typeof import("../guidedSessionLoader");
  let client: typeof import("../sessionExecutionClient");
  let athleteId: string;
  /** The first two days of the accepted V2 plan whose current final prescription is a guided Force session. */
  const forceDays: Array<{ day: string; prescription: FinalPrescriptionV2View }> = [];

  beforeAll(async () => {
    await assertSessionExecutionServing(LOCAL_URL);
    admin = createTestClient();
    vi.stubEnv("VITE_SUPABASE_URL", LOCAL_URL);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", LOCAL_ANON_KEY!);
    vi.resetModules();
    ({ supabase: userClient } = await import("../../../lib/supabase"));
    loader = await import("../guidedSessionLoader");
    client = await import("../sessionExecutionClient");

    const athlete = await createTestAthlete(admin, "11C.2 guided strength");
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

    for (const day of ["2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12"]) {
      if (forceDays.length === 2) break;
      await insertCheckin(admin, athleteId, day);
      await runDailyFor(admin, athleteId, day);
      const snapshot = await loader.loadGuidedSession(athleteId, day);
      if (snapshot.kind === "ready_to_start" && snapshot.prescription.family === "strength") forceDays.push({ day, prescription: snapshot.prescription });
    }
    if (forceDays.length < 2) throw new Error(`expected two Force days in the plan, found ${forceDays.length}`);
  }, 120_000);

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
  const set = (executionId: string, itemId: string, setNumber: number, value: number, extra: Partial<ForceSetInput> = {}): ForceSetInput => ({
    id: randomUUID(),
    execution_id: executionId,
    prescription_item_id: itemId,
    set_number: setNumber,
    done: true,
    measure_type: "reps",
    measure_value: value,
    load_kg: null,
    rpe_actual: null,
    supersedes_id: null,
    occurred_at: `2026-10-01T17:${String(10 + setNumber).padStart(2, "0")}:00.000Z`,
    ...extra,
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

  it("E1: start → sets (reps, RPE, load) → replay → correction → active results → completed with the last set in the same batch → terminal → M1 bridge counts it", async () => {
    const { day, prescription } = forceDays[0]!;
    const [main, second] = workItems(prescription).map((w) => w.item);
    const start = startBatch(day, prescription.id);
    const e1 = start.execution!.id;
    await ok(start);

    const s1 = set(e1, main!.prescriptionItemId, 1, 8, { rpe_actual: 7.5, load_kg: 22.5 });
    const s2 = set(e1, main!.prescriptionItemId, 2, 7);
    expect((await ok({ events: [], sets: [s1, s2] })).inserted.sets).toEqual([s1.id, s2.id]);
    // Same id + same content → replay; same id + other content → conflict (not retryable).
    expect((await ok({ events: [], sets: [s1] })).unchanged.sets).toEqual([s1.id]);
    expect(await client.postSessionExecutionBatch({ events: [], sets: [{ ...s1, measure_value: 9 }] })).toEqual({ ok: false, error: { code: "id_conflict", status: 409, retryable: false } });

    // Correction = new row superseding the original; at most once; never a correction of a correction.
    const c2 = set(e1, main!.prescriptionItemId, 2, 6, { supersedes_id: s2.id });
    await ok({ events: [], sets: [c2] });
    expect(await client.postSessionExecutionBatch({ events: [], sets: [set(e1, main!.prescriptionItemId, 2, 5, { supersedes_id: s2.id })] })).toMatchObject({ ok: false, error: { code: "invalid_correction" } });
    expect(await client.postSessionExecutionBatch({ events: [], sets: [set(e1, main!.prescriptionItemId, 2, 5, { supersedes_id: c2.id })] })).toMatchObject({ ok: false, error: { code: "invalid_correction" } });

    // Refresh: same execution, active results only, numbers as numbers, progression rebuilt.
    let snapshot = await executionSnapshot(day);
    expect(snapshot.execution.id).toBe(e1);
    expect(snapshot.execution.exercise_set_results).toHaveLength(3);
    const active = activeResultsBySlot(snapshot.execution.exercise_set_results);
    expect(active.get(slotKey(main!.prescriptionItemId, 1))).toMatchObject({ id: s1.id, measure_value: 8, rpe_actual: 7.5, load_kg: 22.5 });
    expect(active.get(slotKey(main!.prescriptionItemId, 2))).toMatchObject({ id: c2.id, measure_value: 6, supersedes_id: s2.id });
    const progress = strengthProgress(prescription, snapshot.execution.exercise_set_results);
    expect(progress).toMatchObject({ recorded: 2, canComplete: true, completionNeedsConfirmation: true });
    expect(progress.current).toMatchObject({ setNumber: 3 });

    // Completion with the last typed set in the SAME batch (one transaction).
    const last = set(e1, second!.prescriptionItemId, 1, 10);
    const done = await ok({ events: [{ id: randomUUID(), execution_id: e1, event_type: "completed", occurred_at: at(day, 50) }], sets: [last] });
    expect(done.inserted.sets).toEqual([last.id]);
    snapshot = await executionSnapshot(day);
    expect(snapshot.phase).toBe("completed");
    expect(snapshot).not.toHaveProperty("restartFinalPrescriptionId");
    expect(snapshot.execution.exercise_set_results).toHaveLength(4);
    // Terminal for the lifecycle.
    expect(await client.postSessionExecutionBatch({ events: [{ id: randomUUID(), execution_id: e1, event_type: "paused", occurred_at: at(day, 55) }] })).toMatchObject({ ok: false, error: { code: "invalid_transition" } });

    // M1 recent-history bridge (UX-11B.2.4 contract, unchanged): the completed Force execution counts as done.
    const later = forceDays[1]!.day;
    const { rawContext } = await computeDailyFor(admin, athleteId, later);
    expect(rawContext.recent_sessions.filter((s) => s.date === day)).toEqual([{ date: day, intervention: expect.objectContaining({ kind: prescription.sessionKind }), completion_status: "done" }]);
  }, 60_000);

  it("UX-11B.2.6 — the backend refuses any new set result after `completed` (frozen terminal results)", async () => {
    const { day, prescription } = forceDays[0]!;
    const e1 = (await executionSnapshot(day)).execution.id;
    const late = set(e1, workItems(prescription)[0]!.item.prescriptionItemId, 4, 8);
    expect(await client.postSessionExecutionBatch({ events: [], sets: [late] })).toEqual({ ok: false, error: { code: "execution_terminal", status: 409, retryable: false } });
  });

  it("E2: one set → abandoned (not counted as completed) → restart E3 while the prescription is current (new execution, E2 kept)", async () => {
    const { day, prescription } = forceDays[1]!;
    const main = workItems(prescription)[0]!.item;
    const start = startBatch(day, prescription.id);
    const e2 = start.execution!.id;
    await ok(start);
    await ok({ events: [], sets: [set(e2, main.prescriptionItemId, 1, 8)] });
    await ok({ events: [{ id: randomUUID(), execution_id: e2, event_type: "abandoned", occurred_at: at(day, 20) }] });

    const abandoned = await executionSnapshot(day);
    expect(abandoned).toMatchObject({ phase: "abandoned", execution: { id: e2 }, restartFinalPrescriptionId: prescription.id });
    expect(abandoned.execution.exercise_set_results).toHaveLength(1);
    const { rawContext } = await computeDailyFor(admin, athleteId, day);
    expect(rawContext.recent_sessions.filter((s) => s.date === day)).toEqual([]);

    const restart = startBatch(day, abandoned.restartFinalPrescriptionId!);
    const e3 = restart.execution!.id;
    expect(e3).not.toBe(e2);
    await ok(restart);
    const resumed = await executionSnapshot(day);
    expect(resumed).toMatchObject({ phase: "active", execution: { id: e3, final_prescription_id: prescription.id } });
    expect(resumed.execution.exercise_set_results).toEqual([]);
    const { data: rows } = await admin.from("session_executions").select("id").eq("athlete_id", athleteId).eq("session_date", day).order("recorded_at");
    expect(rows!.map((r) => r.id)).toEqual([e2, e3]);
  }, 60_000);
});
