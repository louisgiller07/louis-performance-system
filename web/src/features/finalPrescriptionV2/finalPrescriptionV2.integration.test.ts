/**
 * UX-11A.5c.4 — end to end on the real local Supabase (opt-in, local only):
 * a real V2 daily run (head-coach runDailyFor, test-only cross import, same
 * practice as athleteBootstrapRepo.integration.test.ts) writes D1/F1; the
 * in-memory state is dropped; the web repositories, signed in as the rider
 * (real RLS), restore exactly the same state. Then a newer decision replaces
 * it. Scratch athletes stay in the local database (append-only rows).
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

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const LOCAL_ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
const LOCAL_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const INTEGRATION_ENABLED =
  process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" && !!SERVER_KEY && !!LOCAL_ANON_KEY && /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(LOCAL_URL);

const TODAY = "2026-10-05";
const GENERATED_ON = "2026-10-04"; // BUG-V2-3 — a plan starts the day after its generation: generated the eve, its first day is TODAY

describe.skipIf(!INTEGRATION_ENABLED)("UX-11A.5c.4 — V2 final prescription restore after refresh (real local Supabase)", () => {
  let admin: SupabaseClient;
  let userClient: SupabaseClient;
  let history: typeof import("../history/historyRepo");
  let currency: typeof import("../dailyPlan/decisionCurrencyRepo");
  let v2: typeof import("./finalPrescriptionV2State");
  let athleteId: string;

  beforeAll(async () => {
    admin = createTestClient();
    vi.stubEnv("VITE_SUPABASE_URL", LOCAL_URL);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", LOCAL_ANON_KEY!);
    vi.resetModules();
    ({ supabase: userClient } = await import("../../lib/supabase"));
    history = await import("../history/historyRepo");
    currency = await import("../dailyPlan/decisionCurrencyRepo");
    v2 = await import("./finalPrescriptionV2State");

    const athlete = await createTestAthlete(admin, "5c.4 web restore");
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
    const persisted = await generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 2, today: GENERATED_ON });
    if (persisted.status !== "persisted") throw new Error("V2 plan not persisted");
    await acceptTrainingPlanVersion(admin, athleteId, persisted.planVersionId, TODAY, "2026-10-18");

    // Sign in as the rider: every web read below goes through RLS.
    const { data: user } = await admin.auth.admin.getUserById(athlete.userId);
    const password = `Sc${randomUUID().replace(/-/g, "").slice(0, 20)}Aa1!`;
    await admin.auth.admin.updateUserById(athlete.userId, { password });
    const { error } = await userClient.auth.signInWithPassword({ email: user.user!.email!, password });
    if (error) throw new Error(`sign-in failed: ${error.message}`);
  });

  afterAll(async () => {
    await userClient?.auth.signOut();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  /** What the daily-run response carries, mapped exactly as the Edge Function does. */
  function liveState(result: Awaited<ReturnType<typeof runDailyFor>>) {
    return v2.finalPrescriptionV2StateFromResponse({
      decisionId: result.persistence.decision_id,
      finalPrescriptionStatus: result.finalPrescriptionStatus,
      finalPrescriptionStatusCode: result.finalPrescriptionStatusCode,
      finalPrescriptionStatusDetail: result.finalPrescriptionStatusDetail,
      finalPrescription: result.finalPrescription === undefined ? undefined : JSON.parse(JSON.stringify(result.finalPrescription)),
    });
  }

  /** The Today restore path: latest valid decision, currency, then its V2 state. */
  async function restore(day: string) {
    const row = await history.loadLatestDecisionForDate(athleteId, day);
    if (row === null) throw new Error("no decision restored");
    const c = await currency.loadDecisionCurrency(row.id);
    return { row, isCurrent: c.isCurrent, state: await v2.loadFinalPrescriptionV2State(row) };
  }

  it("KEEP created: after losing the in-memory state, the restored state equals the live one (same document)", async () => {
    const day = "2026-10-07";
    await insertCheckin(admin, athleteId, day);
    const live = liveState(await runDailyFor(admin, athleteId, day));
    expect(live?.kind).toBe("created");
    const restored = await restore(day);
    expect(restored.isCurrent).toBe(true);
    expect(restored.state).toEqual(live);
  });

  it("KEEP without planned session (blocked) and REST (not_required) restore identically", async () => {
    await insertCheckin(admin, athleteId, "2026-10-10");
    const blocked = liveState(await runDailyFor(admin, athleteId, "2026-10-10"));
    expect(blocked).toEqual({ kind: "blocked", code: "final_prescription_no_lineage", detail: { reason: "no_planned_session" } });
    expect((await restore("2026-10-10")).state).toEqual(blocked);
  });

  it("a newer decision D2 (REST) replaces D1/F1 after refresh; F1 is never restored", async () => {
    const day = "2026-10-08";
    await insertCheckin(admin, athleteId, day);
    const d1 = await runDailyFor(admin, athleteId, day);
    expect(d1.finalPrescriptionStatus).toBe("created");

    const { error } = await admin.from("daily_checkins").update({ suspected_concussion: true }).eq("athlete_id", athleteId).eq("checkin_date", day);
    expect(error).toBeNull();
    const d2 = await runDailyFor(admin, athleteId, day);
    expect(d2.dailyPlan.decision).toBe("REST");

    const restored = await restore(day);
    expect(restored.row.id).toBe(d2.persistence.decision_id);
    expect(restored.isCurrent).toBe(true);
    expect(restored.state).toEqual({ kind: "not_required" });
    expect(restored.state).toEqual(liveState(d2));
  });
});
