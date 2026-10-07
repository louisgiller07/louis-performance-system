/**
 * A11 — the after-session debrief against the REAL local Supabase and Edge
 * `completed-session`: a real network failure (fetch rejected), a server that
 * commits while the answer is lost, a retry, two sends at once, a reload.
 * One logical contribution per day, always (the server upserts on
 * unique (athlete, date)); the answers are what the rider sent.
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, insertCheckin, setAthleteDiscipline } from "../../../../head-coach-engine/tests/supabase/testDb.js";
import { runDailyFor } from "../../../../head-coach-engine/src/supabase/runDailyFor.js";
import { upsertPerformanceProfileFor } from "../../../../head-coach-engine/src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../../../head-coach-engine/src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { generateAndPersistTrainingPlanV2 } from "../../../../head-coach-engine/src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { acceptTrainingPlanVersion } from "../../../../head-coach-engine/src/supabase/acceptTrainingPlanVersion.js";
import type { CompletedSessionInput } from "../completedSession/completedSessionTypes";
import { mapTrainingInterventionToSessionType } from "../dailyPlan/trainingInterventionToSessionType";
import type { TrainingIntervention } from "../dailyPlan/dailyPlanTypes";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const LOCAL_ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
const LOCAL_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const INTEGRATION_ENABLED =
  process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" && !!SERVER_KEY && !!LOCAL_ANON_KEY && /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(LOCAL_URL);

const TODAY = "2026-10-05";

/** Waits for the completed-session function to answer (not a gateway 5xx). */
async function assertCompletedSessionServing(): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < 30_000) {
    try {
      const res = await fetch(`${LOCAL_URL}/functions/v1/completed-session?date=${TODAY}`);
      if (![502, 503, 504].includes(res.status)) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Local Edge runtime is not serving completed-session. Start it from the repository root: `npx supabase functions serve`.");
}

describe.skipIf(!INTEGRATION_ENABLED)("A11 — after-session debrief, network-safe and idempotent (real local Edge completed-session)", () => {
  let admin: SupabaseClient;
  let userClient: SupabaseClient;
  let repo: typeof import("../completedSession/completedSessionRepo");
  let athleteId: string;
  const realFetch = globalThis.fetch;

  async function rows(day: string) {
    const { data } = await admin.from("completed_sessions").select("id, completion_status, change_reason, rpe, post_leg_fatigue, decision_id").eq("athlete_id", athleteId).eq("session_date", day);
    return data as { id: string; completion_status: string; change_reason: string | null; rpe: number | null; post_leg_fatigue: number | null; decision_id: string | null }[];
  }
  /** The day's effective decision (A07) and its final session. */
  async function decisionOn(day: string): Promise<{ id: string; final: TrainingIntervention }> {
    await insertCheckin(admin, athleteId, day);
    await runDailyFor(admin, athleteId, day);
    const { data } = await admin.from("decisions").select("id, daily_plan").eq("athlete_id", athleteId).eq("decision_date", day).order("created_at", { ascending: false }).limit(1).single();
    const row = data as { id: string; daily_plan: { final_session: TrainingIntervention } };
    return { id: row.id, final: row.daily_plan.final_session };
  }
  const skipped = (day: string, decision: { id: string; final: TrainingIntervention }): CompletedSessionInput => ({
    session_date: day,
    decision_id: decision.id,
    session_type: mapTrainingInterventionToSessionType(decision.final),
    completion_status: "skipped",
    actual_duration_min: null,
    rpe: null,
    post_leg_fatigue: null,
    post_grip_fatigue: null,
    new_pain: false,
    new_pain_note: null,
    intervention: null,
    main_content: null,
    technical_outcome: null,
    change_reason: "time_life",
    change_reason_note: null,
  });

  beforeAll(async () => {
    await assertCompletedSessionServing();
    admin = createTestClient();
    vi.stubEnv("VITE_SUPABASE_URL", LOCAL_URL);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", LOCAL_ANON_KEY!);
    vi.resetModules();
    ({ supabase: userClient } = await import("../../lib/supabase"));
    repo = await import("../completedSession/completedSessionRepo");

    const athlete = await createTestAthlete(admin, "A11 after session");
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
  }, 90_000);

  afterEach(() => {
    vi.stubGlobal("fetch", realFetch);
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await userClient?.auth.signOut();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("H — the network fails before the server: a visible, retryable error, nothing written; the same send then succeeds once", async () => {
    const day = "2026-10-06";
    const payload = skipped(day, await decisionOn(day));
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));
    const failed = await repo.putCompletedSession(payload);
    expect(failed).toMatchObject({ ok: false, error: { code: "network_error", retryable: true, action: "retry" } });
    vi.stubGlobal("fetch", realFetch);
    expect(await rows(day)).toEqual([]);

    const ok = await repo.putCompletedSession(payload);
    expect(ok.ok).toBe(true);
    expect(await rows(day)).toEqual([expect.objectContaining({ completion_status: "skipped", change_reason: "time_life", decision_id: payload.decision_id })]);
  });

  it("I — the server commits but the answer is lost: the client sees an error; the retry rewrites the SAME row (one contribution)", async () => {
    const day = "2026-10-07";
    const payload = skipped(day, await decisionOn(day));
    vi.stubGlobal("fetch", vi.fn(async (...args: Parameters<typeof fetch>) => {
      await realFetch(...args);
      throw new TypeError("Failed to fetch");
    }));
    expect((await repo.putCompletedSession(payload)).ok).toBe(false);
    vi.stubGlobal("fetch", realFetch);
    const committed = await rows(day);
    expect(committed).toHaveLength(1);

    const retry = await repo.putCompletedSession(payload);
    expect(retry.ok && retry.data.completedSession.id).toBe(committed[0]!.id);
    expect(await rows(day)).toHaveLength(1);
  });

  it("J — two sends at once (double tap reaching the server): one row", async () => {
    const day = "2026-10-08";
    const payload = skipped(day, await decisionOn(day));
    const [a, b] = await Promise.all([repo.putCompletedSession(payload), repo.putCompletedSession(payload)]);
    expect([a.ok, b.ok]).toEqual([true, true]);
    expect(a.ok && b.ok && a.data.completedSession.id === b.data.completedSession.id).toBe(true);
    expect(await rows(day)).toHaveLength(1);
  });

  it("K — a reload after success reads the debrief back; going back and sending again edits it (still one row)", async () => {
    const day = "2026-10-09";
    const decision = await decisionOn(day);
    expect((await repo.putCompletedSession(skipped(day, decision))).ok).toBe(true);
    const read = await repo.getCompletedSession(day);
    expect(read).toMatchObject({ ok: true, data: { completion_status: "skipped", change_reason: "time_life" } });
    expect((await repo.putCompletedSession({ ...skipped(day, decision), change_reason: "weather_terrain" })).ok).toBe(true);
    expect(await rows(day)).toEqual([expect.objectContaining({ change_reason: "weather_terrain" })]);
  });

  it("A11 server contract — a performed session without post-session fatigue is accepted (null), the effort kept", async () => {
    const day = "2026-10-10";
    const decision = await decisionOn(day);
    expect(decision.final.kind).not.toBe("REST");
    const done: CompletedSessionInput = {
      ...skipped(day, decision),
      completion_status: "done",
      intervention: { kind: decision.final.kind, ...(decision.final.load_profile ? { load_profile: decision.final.load_profile } : {}) } as CompletedSessionInput["intervention"],
      actual_duration_min: 45,
      rpe: 7,
      change_reason: null,
    };
    const r = await repo.putCompletedSession(done);
    expect(r.ok ? null : r.error).toBeNull();
    expect(await rows(day)).toEqual([expect.objectContaining({ completion_status: "done", rpe: 7, post_leg_fatigue: null })]);
  });
});
