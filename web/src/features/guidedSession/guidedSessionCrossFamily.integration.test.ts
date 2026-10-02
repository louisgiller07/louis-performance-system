/**
 * UX-11C.5 — cross-family closure audit on the real local Supabase (opt-in,
 * local only), through the web loader and the real `session-execution` Edge
 * Function, for Force, DH and endurance on the same rider:
 * - atomicity: `completed` + an INVALID last result is refused as a whole
 *   (the execution stays active, nothing is written); `completed` + a valid
 *   last result commits both;
 * - loader cost: 2 REST requests for an open execution, whatever the number
 *   of results (no N+1);
 * - terminal immutability: no new result and no correction after `completed`;
 * - M1 feedback: each completed family counts once, with its decision's own
 *   final_session (actual RPE / success / duration / distance never read).
 * Scratch athletes stay in the local database (append-only rows).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertSessionExecutionServing } from "../../test/edgeRuntime";
import { createTestAthlete, createTestClient, insertCheckin, setAthleteDiscipline } from "../../../../head-coach-engine/tests/supabase/testDb.js";
import { runDailyFor } from "../../../../head-coach-engine/src/supabase/runDailyFor.js";
import { computeDailyFor } from "../../../../head-coach-engine/src/supabase/computeDailyFor.js";
import { upsertPerformanceProfileFor } from "../../../../head-coach-engine/src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../../../head-coach-engine/src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { generateAndPersistTrainingPlanV2 } from "../../../../head-coach-engine/src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { acceptTrainingPlanVersion } from "../../../../head-coach-engine/src/supabase/acceptTrainingPlanVersion.js";
import type { ActivityResultInput, SessionExecutionBatch, SetResultInput } from "./sessionExecutionClient";
import type { FinalPrescriptionV2View } from "../finalPrescriptionV2/finalPrescriptionV2Types";
import { workItems } from "./strength/strengthSets";
import { mainDrill } from "./dh/dhPasses";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const LOCAL_ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
const LOCAL_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const INTEGRATION_ENABLED =
  process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" && !!SERVER_KEY && !!LOCAL_ANON_KEY && /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(LOCAL_URL);

const TODAY = "2026-10-05";
type Family = "strength" | "dh_technical" | "endurance";

describe.skipIf(!INTEGRATION_ENABLED)("UX-11C.5 — guided sessions cross-family closure (real local Supabase + Edge)", () => {
  let admin: SupabaseClient;
  let userClient: SupabaseClient;
  let loader: typeof import("./guidedSessionLoader");
  let client: typeof import("./sessionExecutionClient");
  let athleteId: string;
  const days = new Map<Family, { day: string; prescription: FinalPrescriptionV2View; decisionId: string }>();

  beforeAll(async () => {
    await assertSessionExecutionServing(LOCAL_URL);
    admin = createTestClient();
    vi.stubEnv("VITE_SUPABASE_URL", LOCAL_URL);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", LOCAL_ANON_KEY!);
    vi.resetModules();
    ({ supabase: userClient } = await import("../../lib/supabase"));
    loader = await import("./guidedSessionLoader");
    client = await import("./sessionExecutionClient");

    const athlete = await createTestAthlete(admin, "11C.5 cross-family closure");
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
      if (days.size === 3) break;
      await insertCheckin(admin, athleteId, day);
      const run = await runDailyFor(admin, athleteId, day);
      const snapshot = await loader.loadGuidedSession(athleteId, day);
      if (snapshot.kind !== "ready_to_start") continue;
      const family = snapshot.prescription.family as Family;
      if (["strength", "dh_technical", "endurance"].includes(family) && !days.has(family)) days.set(family, { day, prescription: snapshot.prescription, decisionId: run.persistence.decision_id });
    }
    if (days.size < 3) throw new Error(`expected Force, DH and endurance days within the first week, found ${[...days.keys()].join(", ")}`);
  }, 180_000);

  afterAll(async () => {
    await userClient?.auth.signOut();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const at = (day: string, minute: number) => `${day}T17:${String(minute).padStart(2, "0")}:00.000Z`;
  const post = (batch: SessionExecutionBatch) => client.postSessionExecutionBatch(batch);
  const event = (executionId: string, day: string, type: "completed", minute = 50) => ({ id: randomUUID(), execution_id: executionId, event_type: type, occurred_at: at(day, minute) });

  type Part = { sets?: SetResultInput[]; activities?: ActivityResultInput[] };
  interface Builders {
    valid: (n: number) => Part;
    invalid: () => Part;
    correction: (id: string) => Part;
    count: number;
  }

  /** A valid result, an invalid one (refused by the server) and a correction builder, per family. */
  function results(family: Family, prescription: FinalPrescriptionV2View, executionId: string): Builders {
    const occurred_at = "2026-10-01T18:00:00.000Z";
    if (family === "strength") {
      const item = workItems(prescription)[0]!.item;
      const set = (n: number, value = 8, supersedes: string | null = null): SetResultInput => ({ id: randomUUID(), execution_id: executionId, prescription_item_id: item.prescriptionItemId, set_number: n, done: true, measure_type: "reps", measure_value: value, load_kg: 20, rpe_actual: 8, supersedes_id: supersedes, occurred_at });
      return { valid: (n: number) => ({ sets: [set(n)] }), invalid: () => ({ sets: [set(item.sets + 1)] }), correction: (id: string) => ({ sets: [set(1, 6, id)] }), count: item.sets };
    }
    if (family === "dh_technical") {
      const drill = mainDrill(prescription)!;
      const pass = (n: number, success: boolean | null = true, supersedes: string | null = null): SetResultInput => ({ id: randomUUID(), execution_id: executionId, prescription_item_id: drill.prescriptionItemId, set_number: n, done: true, measure_type: "pass", measure_value: null, success, supersedes_id: supersedes, occurred_at });
      return { valid: (n: number) => ({ sets: [pass(n, n % 2 === 0 ? false : null)] }), invalid: () => ({ sets: [pass(drill.passes + 1)] }), correction: (id: string) => ({ sets: [pass(1, true, id)] }), count: drill.passes };
    }
    const allowed = prescription.activityOptions!.map((a) => a.id);
    const activity = (activity_id: string, supersedes: string | null = null): ActivityResultInput => ({ id: randomUUID(), execution_id: executionId, activity_id, duration_seconds: 2580, distance_m: 18400, rpe_actual: 4, comment: null, supersedes_id: supersedes, occurred_at });
    return { valid: () => ({ activities: [activity(allowed[0]!)] }), invalid: () => ({ activities: [activity("not_an_allowed_activity")] }), correction: (id: string) => ({ activities: [activity(allowed[0]!, id)] }), count: 1 };
  }

  it.each(["strength", "dh_technical", "endurance"] as const)("%s: invalid last result + completed → nothing committed; valid last result + completed → both; then frozen", async (family) => {
    const { day, prescription } = days.get(family)!;
    const executionId = randomUUID();
    expect((await post({ execution: { id: executionId, session_date: day, started_at: at(day, 0), final_prescription_id: prescription.id, comment: null }, events: [{ id: randomUUID(), execution_id: executionId, event_type: "started", occurred_at: at(day, 0) }] })).ok).toBe(true);
    const r = results(family, prescription, executionId);

    // Several results first (Force / DH), so the loader cost is measured with data.
    const firstIds: string[] = [];
    for (let n = 1; n < Math.min(r.count, 3); n += 1) {
      const batch: SessionExecutionBatch = { events: [], ...r.valid(n) };
      firstIds.push(...(batch.sets ?? []).map((x) => x.id));
      expect((await post(batch)).ok).toBe(true);
    }

    // Atomicity: completed + an invalid result → the whole batch is refused.
    const refused = await post({ events: [event(executionId, day, "completed")], ...r.invalid() });
    expect(refused.ok).toBe(false);
    let snapshot = await loader.loadGuidedSession(athleteId, day);
    expect(snapshot).toMatchObject({ kind: "execution", phase: "active", execution: { id: executionId } });

    // Loader cost for an open execution: 2 REST requests, whatever the number of results.
    const realFetch = globalThis.fetch;
    const restCalls: string[] = [];
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/rest/v1/")) restCalls.push(new URL(url).pathname);
      return realFetch(input, init);
    }) as typeof fetch;
    try {
      snapshot = await loader.loadGuidedSession(athleteId, day);
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(restCalls).toEqual(["/rest/v1/session_executions", "/rest/v1/decision_final_prescriptions"]);

    // Valid last result + completed → both committed in one batch.
    const last = family === "endurance" ? r.valid(0) : r.valid(Math.min(r.count, 3));
    const done = await post({ events: [event(executionId, day, "completed", 55)], ...last });
    expect(done.ok).toBe(true);
    snapshot = await loader.loadGuidedSession(athleteId, day);
    expect(snapshot.kind === "execution" && snapshot.phase).toBe("completed");
    const original = family === "endurance" ? (snapshot.kind === "execution" ? snapshot.execution.session_activity_results[0]!.id : "") : firstIds[0] ?? (last.sets ?? [])[0]!.id;

    // Terminal: no new result, no correction.
    expect(await post({ events: [], ...r.valid(r.count) })).toMatchObject({ ok: false, error: { code: "execution_terminal" } });
    expect(await post({ events: [], ...r.correction(original) })).toMatchObject({ ok: false, error: { code: "execution_terminal" } });
  }, 60_000);

  it("M1 feedback: each completed family counts once with its decision's own final_session (actual details never read)", async () => {
    const latest = [...days.values()].map((d) => d.day).sort().at(-1)!;
    const { rawContext } = await computeDailyFor(admin, athleteId, latest);
    for (const { day, decisionId } of days.values()) {
      const { data } = await admin.from("decisions").select("daily_plan").eq("id", decisionId).single();
      const finalSession = (data!.daily_plan as { final_session: unknown }).final_session;
      expect(rawContext.recent_sessions.filter((s) => s.date === day)).toEqual([{ date: day, intervention: finalSession, completion_status: "done" }]);
    }
  }, 60_000);
});
