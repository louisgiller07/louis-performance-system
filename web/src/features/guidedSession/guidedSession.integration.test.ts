/**
 * UX-11C.1 — guided-session lifecycle end to end on the real local Supabase
 * (opt-in, local only): a real V2 daily run (head-coach runDailyFor, test-only
 * cross import) writes D1/F1; the web loader and the web client, signed in as
 * the rider, go through RLS and the real `session-execution` Edge Function
 * (local edge runtime) into record_session_execution. Scratch athletes stay in
 * the local database (append-only rows).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, insertCheckin, setAthleteDiscipline } from "../../../../head-coach-engine/tests/supabase/testDb.js";
import { runDailyFor } from "../../../../head-coach-engine/src/supabase/runDailyFor.js";
import { upsertPerformanceProfileFor } from "../../../../head-coach-engine/src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../../../head-coach-engine/src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { generateAndPersistTrainingPlanV2 } from "../../../../head-coach-engine/src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { acceptTrainingPlanVersion } from "../../../../head-coach-engine/src/supabase/acceptTrainingPlanVersion.js";
import type { SessionExecutionBatch } from "./sessionExecutionClient";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const LOCAL_ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
const LOCAL_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const INTEGRATION_ENABLED =
  process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" && !!SERVER_KEY && !!LOCAL_ANON_KEY && /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(LOCAL_URL);

const TODAY = "2026-10-05";
const DAY = "2026-10-07";

describe.skipIf(!INTEGRATION_ENABLED)("UX-11C.1 — guided session lifecycle (real local Supabase + Edge session-execution)", () => {
  let admin: SupabaseClient;
  let userClient: SupabaseClient;
  let loader: typeof import("./guidedSessionLoader");
  let client: typeof import("./sessionExecutionClient");
  let athleteId: string;

  beforeAll(async () => {
    admin = createTestClient();
    vi.stubEnv("VITE_SUPABASE_URL", LOCAL_URL);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", LOCAL_ANON_KEY!);
    vi.resetModules();
    ({ supabase: userClient } = await import("../../lib/supabase"));
    loader = await import("./guidedSessionLoader");
    client = await import("./sessionExecutionClient");

    const athlete = await createTestAthlete(admin, "11C.1 guided session");
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
  }, 60_000);

  afterAll(async () => {
    await userClient?.auth.signOut();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const startBatch = (fpId: string): SessionExecutionBatch => {
    const id = randomUUID();
    const at = `${DAY}T17:00:00.000Z`;
    return { execution: { id, session_date: DAY, started_at: at, final_prescription_id: fpId, comment: null }, events: [{ id: randomUUID(), execution_id: id, event_type: "started", occurred_at: at }] };
  };
  const eventBatch = (executionId: string, event_type: "paused" | "resumed" | "abandoned", minute: number): SessionExecutionBatch => ({
    events: [{ id: randomUUID(), execution_id: executionId, event_type, occurred_at: `${DAY}T17:${String(minute).padStart(2, "0")}:00.000Z` }],
  });
  const dbEvents = async (executionId: string) => {
    const { data, error } = await admin.from("execution_events").select("event_type").eq("execution_id", executionId).order("event_seq");
    if (error) throw error;
    return data.map((e) => e.event_type);
  };

  it("start → started event → reader finds E1; replay and second start never create E2; pause → resume → abandon; a newer decision never replaces E1's prescription; a stale start is refused", async () => {
    await insertCheckin(admin, athleteId, DAY);
    const d1 = await runDailyFor(admin, athleteId, DAY);
    expect(d1.finalPrescriptionStatus).toBe("created");

    const ready = await loader.loadGuidedSession(athleteId, DAY);
    if (ready.kind !== "ready_to_start") throw new Error(`expected ready_to_start, got ${JSON.stringify(ready)}`);
    const f1 = ready.finalPrescriptionId;

    // Start: execution + started in ONE batch, on the current F1.
    const start = startBatch(f1);
    const e1 = start.execution!.id;
    const first = await client.postSessionExecutionBatch(start);
    expect(first).toEqual({ ok: true, value: expect.objectContaining({ inserted: expect.objectContaining({ executions: [e1], events: [start.events[0]!.id] }) }) });
    expect(await dbEvents(e1)).toEqual(["started"]);

    // Retry of the same logical action (same ids): unchanged, no duplicate.
    const replay = await client.postSessionExecutionBatch(start);
    expect(replay).toEqual({ ok: true, value: expect.objectContaining({ unchanged: expect.objectContaining({ executions: [e1], events: [start.events[0]!.id] }) }) });
    // Second tab / new logical start: the backend is the authority.
    const secondTab = await client.postSessionExecutionBatch(startBatch(f1));
    expect(secondTab).toEqual({ ok: false, error: { code: "active_execution_exists", status: 409, retryable: false } });
    const { count } = await admin.from("session_executions").select("id", { count: "exact", head: true }).eq("athlete_id", athleteId).eq("session_date", DAY);
    expect(count).toBe(1);

    // Refresh: the reader finds E1, active, with F1.
    expect(await loader.loadGuidedSession(athleteId, DAY)).toMatchObject({ kind: "execution", phase: "active", execution: { id: e1, final_prescription_id: f1 }, prescription: { kind: "created", prescription: { id: f1 } } });

    // Pause, refresh while paused.
    expect((await client.postSessionExecutionBatch(eventBatch(e1, "paused", 10))).ok).toBe(true);
    expect(await loader.loadGuidedSession(athleteId, DAY)).toMatchObject({ kind: "execution", phase: "paused", execution: { id: e1 } });

    // A newer daily decision D2 during E1: E1 keeps ITS prescription.
    const d2 = await runDailyFor(admin, athleteId, DAY);
    expect(d2.persistence.decision_id).not.toBe(d1.persistence.decision_id);
    expect(await loader.loadGuidedSession(athleteId, DAY)).toMatchObject({ kind: "execution", phase: "paused", execution: { id: e1, final_prescription_id: f1 }, prescription: { kind: "created", prescription: { id: f1 } } });

    // Resume then abandon (the linked F1 is no longer current: lifecycle events are still accepted).
    expect((await client.postSessionExecutionBatch(eventBatch(e1, "resumed", 20))).ok).toBe(true);
    expect(await loader.loadGuidedSession(athleteId, DAY)).toMatchObject({ kind: "execution", phase: "active", execution: { id: e1 } });
    expect((await client.postSessionExecutionBatch(eventBatch(e1, "abandoned", 30))).ok).toBe(true);
    expect(await dbEvents(e1)).toEqual(["started", "paused", "resumed", "abandoned"]);
    // Terminal: no further lifecycle event.
    const afterTerminal = await client.postSessionExecutionBatch(eventBatch(e1, "resumed", 40));
    expect(afterTerminal).toMatchObject({ ok: false, error: { code: "invalid_transition", retryable: false } });

    // A new start on the stale F1 is refused; nothing is created.
    const stale = await client.postSessionExecutionBatch(startBatch(f1));
    expect(stale).toEqual({ ok: false, error: { code: "final_prescription_not_current", status: 409, retryable: false } });
    const { count: after } = await admin.from("session_executions").select("id", { count: "exact", head: true }).eq("athlete_id", athleteId).eq("session_date", DAY);
    expect(after).toBe(1);

    // The Daily state, re-read, now offers D2's own prescription (never F1).
    const refreshed = await loader.loadGuidedSession(athleteId, DAY);
    if (d2.finalPrescriptionStatus === "created") {
      expect(refreshed).toMatchObject({ kind: "ready_to_start" });
      expect(refreshed.kind === "ready_to_start" && refreshed.finalPrescriptionId).not.toBe(f1);
    } else {
      expect(refreshed.kind).toBe("unavailable");
    }
  }, 60_000);

  it("REST day: the loader is unavailable, nothing to start, no execution", async () => {
    const day = "2026-10-08";
    await insertCheckin(admin, athleteId, day);
    const { error } = await admin.from("daily_checkins").update({ suspected_concussion: true }).eq("athlete_id", athleteId).eq("checkin_date", day);
    expect(error).toBeNull();
    const rest = await runDailyFor(admin, athleteId, day);
    expect(rest.dailyPlan.decision).toBe("REST");
    expect(await loader.loadGuidedSession(athleteId, day)).toEqual({ kind: "unavailable", reason: "rest" });
    const { count } = await admin.from("session_executions").select("id", { count: "exact", head: true }).eq("athlete_id", athleteId).eq("session_date", day);
    expect(count).toBe(0);
  }, 60_000);
});
