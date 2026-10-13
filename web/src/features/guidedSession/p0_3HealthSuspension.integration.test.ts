/**
 * P0-3 (HPM 2026-10-13) — the guided session under a health suspension, end to end on the real local Supabase
 * (opt-in, local only): the web loader (/today/session, every call = a reload / direct navigation), Today's entry
 * rule and the web client signed in as the rider (RLS, real `session-execution` Edge Function, real
 * record_session_execution with migration 20261013160000). Daily runs through head-coach runDailyFor (test-only
 * cross import), the check-in edited by the rider under RLS.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertSessionExecutionServing } from "../../test/edgeRuntime";
import { createTestAthlete, createTestClient, insertCheckin, setAthleteDiscipline } from "../../../../head-coach-engine/tests/supabase/testDb.js";
import { runDailyFor } from "../../../../head-coach-engine/src/supabase/runDailyFor.js";
import { upsertPerformanceProfileFor } from "../../../../head-coach-engine/src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../../../head-coach-engine/src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { generateAndPersistTrainingPlanV2 } from "../../../../head-coach-engine/src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { acceptTrainingPlanVersion } from "../../../../head-coach-engine/src/supabase/acceptTrainingPlanVersion.js";
import type { SessionExecutionBatch } from "./sessionExecutionClient";
import type { DailyPlan } from "../dailyPlan/dailyPlanTypes";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const LOCAL_ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
const LOCAL_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const INTEGRATION_ENABLED =
  process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" && !!SERVER_KEY && !!LOCAL_ANON_KEY && /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(LOCAL_URL);

const SEVERE_PAIN = { pain: true, pain_intensity: 8, pain_new: false, pain_location_code: "knee_R", pain_traumatic: false, pain_function_loss: false, pain_getting_worse: false };

describe.skipIf(!INTEGRATION_ENABLED)("P0-3 — guided session under a health suspension (real local Supabase + Edge session-execution)", () => {
  let admin: SupabaseClient;
  let userClient: SupabaseClient;
  let loader: typeof import("./guidedSessionLoader");
  let client: typeof import("./sessionExecutionClient");
  let executions: typeof import("./executionRepo");
  let flags: typeof import("../healthFlags/openHealthFlagsRepo");
  let history: typeof import("../history/historyRepo");
  let entry: typeof import("./daySessionEntry");
  let health: typeof import("./healthBlock");
  let athleteId: string;
  let dhDays: string[];

  beforeAll(async () => {
    await assertSessionExecutionServing(LOCAL_URL);
    admin = createTestClient();
    vi.stubEnv("VITE_SUPABASE_URL", LOCAL_URL);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", LOCAL_ANON_KEY!);
    vi.resetModules();
    ({ supabase: userClient } = await import("../../lib/supabase"));
    loader = await import("./guidedSessionLoader");
    client = await import("./sessionExecutionClient");
    executions = await import("./executionRepo");
    flags = await import("../healthFlags/openHealthFlagsRepo");
    history = await import("../history/historyRepo");
    entry = await import("./daySessionEntry");
    health = await import("./healthBlock");

    const athlete = await createTestAthlete(admin, "P0-3 web health suspension");
    athleteId = athlete.athleteId;
    await setAthleteDiscipline(admin, athleteId, "Downhill");
    await upsertPerformanceProfileFor(admin, athleteId, {
      strength_experience_tier: "intermediate",
      equipment: ["dumbbells", "bench"],
      terrain_access: ["flow_trail", "bermed_trail", "full_dh_track"],
      declared_limitations: [],
      technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering"] },
      dh_technical_tier: "intermediate",
    });
    for (const d of [0, 1, 2, 3, 4, 5, 6]) await insertAvailabilityWindow(admin, athleteId, { day_of_week: d, start_time: "08:00:00", end_time: "20:00:00" });
    const persisted = await generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 2, today: "2026-10-04" });
    if (persisted.status !== "persisted") throw new Error("V2 plan not persisted");
    await acceptTrainingPlanVersion(admin, athleteId, persisted.planVersionId, "2026-10-05", "2026-10-18");
    const { data } = await admin.from("planned_sessions").select("planned_date, intervention").eq("athlete_id", athleteId).order("planned_date");
    dhDays = (data as { planned_date: string; intervention: { kind: string } | null }[]).filter((r) => r.intervention?.kind === "DH_TECHNICAL").map((r) => r.planned_date);

    const { data: user } = await admin.auth.admin.getUserById(athlete.userId);
    const password = `Sc${randomUUID().replace(/-/g, "").slice(0, 20)}Aa1!`;
    await admin.auth.admin.updateUserById(athlete.userId, { password });
    const { error } = await userClient.auth.signInWithPassword({ email: user.user!.email!, password });
    if (error) throw new Error(`sign-in failed: ${error.message}`);
  }, 90_000);

  afterAll(async () => {
    await userClient?.auth.signOut();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  /** Today's entry, computed as TodayPage does, from the real reads. */
  async function todayEntry(day: string) {
    const [rows, open, latest] = await Promise.all([executions.loadDayExecutions(athleteId, day), flags.loadOpenHealthFlags(athleteId), history.loadLatestDecisionForDate(athleteId, day)]);
    const dailyPlan = (latest?.dailyPlan ?? null) as DailyPlan | null;
    const created = latest?.finalPrescriptionStatus === "created";
    const healthSuspended = health.healthBlockOf({ openFlagTypes: open.map((f) => f.type), family: null, latestDecision: dailyPlan ? { dailyPlan, isCurrent: true } : null }) === "health_suspended";
    return entry.daySessionEntryKind({ executions: rows, finalPrescriptionCreated: created, healthSuspended });
  }
  async function startWithOnePass(day: string) {
    await insertCheckin(admin, athleteId, day);
    expect((await runDailyFor(admin, athleteId, day)).finalPrescriptionStatus).toBe("created");
    const ready = await loader.loadGuidedSession(athleteId, day);
    if (ready.kind !== "ready_to_start") throw new Error(`expected ready_to_start, got ${ready.kind}`);
    const id = randomUUID();
    const start: SessionExecutionBatch = { execution: { id, session_date: day, started_at: `${day}T17:00:00.000Z`, final_prescription_id: ready.finalPrescriptionId, comment: null }, events: [{ id: randomUUID(), execution_id: id, event_type: "started", occurred_at: `${day}T17:00:00.000Z` }] };
    expect((await client.postSessionExecutionBatch(start)).ok).toBe(true);
    const pass = ready.prescription.blocks.find((b) => b.role === "main")!.items[0]!;
    const set = (n: number) => ({ id: randomUUID(), execution_id: id, prescription_item_id: pass.prescriptionItemId, set_number: n, done: true, measure_type: "pass" as const, measure_value: null, load_kg: null, rpe_actual: null, success: true, supersedes_id: null, occurred_at: `${day}T17:1${n}:00.000Z` });
    expect((await client.postSessionExecutionBatch({ events: [], sets: [set(1)] })).ok).toBe(true);
    const ev = (event_type: "paused" | "resumed" | "completed" | "abandoned", minute: number): SessionExecutionBatch => ({ events: [{ id: randomUUID(), execution_id: id, event_type, occurred_at: `${day}T17:${minute}:00.000Z` }] });
    return { id, set, ev };
  }
  const results = async (executionId: string) => (await admin.from("exercise_set_results").select("id", { count: "exact", head: true }).eq("execution_id", executionId)).count;

  it("started, a pass recorded → check-in edited (pain 8/10): blocked until the analysis runs again → REST A6: suspended on reload and on Today; resume and results refused; stop accepted; the stopped attempt stays readable", async () => {
    const day = dhDays[0]!;
    const s = await startWithOnePass(day);
    expect(await todayEntry(day)).toBe("resume");

    // The rider edits the check-in (RLS); no daily run yet: the day's decision is stale.
    const { error } = await userClient.from("daily_checkins").update(SEVERE_PAIN).eq("athlete_id", athleteId).eq("checkin_date", day);
    expect(error).toBeNull();
    expect(await loader.loadGuidedSession(athleteId, day)).toMatchObject({ kind: "execution", phase: "active", healthBlock: "daily_decision_not_current" });
    expect(await client.postSessionExecutionBatch({ events: [], sets: [s.set(2)] })).toEqual({ ok: false, error: { code: "daily_decision_not_current", status: 409, retryable: false } });

    // The analysis runs again: REST A6 (coaching suspended).
    const rest = await runDailyFor(admin, athleteId, day);
    expect([rest.dailyPlan.decision, rest.dailyPlan.triggered_rules.some((r) => r.rule_id === "A6")]).toEqual(["REST", true]);
    expect(await loader.loadGuidedSession(athleteId, day)).toMatchObject({ kind: "execution", phase: "active", healthBlock: "health_suspended", prescription: { kind: "created" } });
    expect(await todayEntry(day)).toBe("suspended");

    expect(await client.postSessionExecutionBatch({ events: [], sets: [s.set(2)] })).toEqual({ ok: false, error: { code: "health_suspended", status: 409, retryable: false } });
    expect((await client.postSessionExecutionBatch(s.ev("paused", 20))).ok).toBe(true); // pause stays allowed
    expect(await client.postSessionExecutionBatch(s.ev("resumed", 21))).toEqual({ ok: false, error: { code: "health_suspended", status: 409, retryable: false } });
    expect(await client.postSessionExecutionBatch(s.ev("completed", 22))).toEqual({ ok: false, error: { code: "health_suspended", status: 409, retryable: false } });
    expect(await results(s.id)).toBe(1);

    expect((await client.postSessionExecutionBatch(s.ev("abandoned", 23))).ok).toBe(true); // safe stop
    const after = await loader.loadGuidedSession(athleteId, day);
    expect(after).toMatchObject({ kind: "execution", phase: "abandoned", execution: { id: s.id } });
    expect(after).not.toHaveProperty("restartFinalPrescriptionId");
    expect(after.kind === "execution" && after.execution.exercise_set_results.length).toBe(1);
    expect(await todayEntry(day)).toBe("none");
  });

  it("a session completed before the suspension stays completed, readable on reload and on Today, never restartable", async () => {
    // The signal opened by the previous test is closed first (otherwise A7 suspends every later day).
    await admin.from("health_flags").update({ status: "resolved", resolved_at: dhDays[0] }).eq("athlete_id", athleteId).in("status", ["active", "monitoring"]);
    const day = dhDays[1]!;
    const s = await startWithOnePass(day);
    expect((await client.postSessionExecutionBatch(s.ev("completed", 30))).ok).toBe(true);
    await userClient.from("daily_checkins").update(SEVERE_PAIN).eq("athlete_id", athleteId).eq("checkin_date", day);
    await runDailyFor(admin, athleteId, day);
    const snapshot = await loader.loadGuidedSession(athleteId, day);
    expect(snapshot).toMatchObject({ kind: "execution", phase: "completed", execution: { id: s.id } });
    expect(snapshot).not.toHaveProperty("healthBlock");
    expect(await todayEntry(day)).toBe("completed");
    expect(await results(s.id)).toBe(1);
  });
});
