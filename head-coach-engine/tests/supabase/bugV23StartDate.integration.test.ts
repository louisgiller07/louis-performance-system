/**
 * BUG-V2-3 — plan start date on the real local stack.
 *
 * - DB: a plan generated on D starts on D + 1 (horizon, generated sessions,
 *   week 1 = introduction); regenerating on D a day already used keeps that
 *   day as it is, and the new plan never puts a session on D.
 * - Edge (`npx supabase functions serve`, local runtime): generate-training-plan
 *   and accept-training-plan use the product calendar's today (Europe/Zurich).
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, getAthleteAuthClient, insertCompletedSession, resolveTestSupabaseUrl, setAthleteDiscipline } from "./testDb.js";
import { assertLocalDbReady, localIntegrationRequested } from "./localDb.js";
import { upsertPerformanceProfileFor, type AthletePerformanceProfileWriteFields } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { generateAndPersistTrainingPlanV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { addCalendarDays, productToday } from "../../src/supabase/productCalendar.js";

const INTEGRATION_ENABLED = localIntegrationRequested({ requirePublishableKey: true });

const D = "2026-10-06"; // generation day of the DB scenarios (Tuesday)
const PROFILE: AthletePerformanceProfileWriteFields = {
  strength_experience_tier: "intermediate",
  equipment: ["dumbbells", "bench"],
  terrain_access: ["flow_trail", "bermed_trail"],
  declared_limitations: [],
  technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
  dh_technical_tier: "intermediate",
};
const ALL_DAY = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, start_time: "08:00:00", end_time: "20:00:00" }));

describe.skipIf(!INTEGRATION_ENABLED)("BUG-V2-3 — plan start date (local Supabase)", () => {
  let admin: SupabaseClient;

  beforeAll(() => {
    assertLocalDbReady();
    admin = createTestClient();
  });

  async function seed(name: string): Promise<string> {
    const athlete = await createTestAthlete(admin, name);
    await setAthleteDiscipline(admin, athlete.athleteId, "Downhill");
    await upsertPerformanceProfileFor(admin, athlete.athleteId, PROFILE);
    for (const w of ALL_DAY) await insertAvailabilityWindow(admin, athlete.athleteId, w);
    return athlete.athleteId;
  }

  async function generateOn(athleteId: string, today: string): Promise<string> {
    const p = await generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 2, today });
    if (p.status !== "persisted") throw new Error(`expected a persisted plan, got ${JSON.stringify(p)}`);
    return p.planVersionId;
  }

  async function plannedOn(athleteId: string, date: string) {
    const { data, error } = await admin.from("planned_sessions").select("planned_date, source, source_plan_version_id").eq("athlete_id", athleteId).eq("planned_date", date);
    if (error) throw new Error(error.message);
    return data!;
  }

  it("A / B — generated on D: horizon, generated sessions and week 1 all start on D + 1 (introduction week)", async () => {
    const athleteId = await seed("BUG-V2-3 start D+1");
    const planVersionId = await generateOn(athleteId, D);
    const { data: version } = await admin.from("training_plan_versions").select("horizon_start_date, horizon_end_date").eq("id", planVersionId).single();
    expect(version).toEqual({ horizon_start_date: "2026-10-07", horizon_end_date: "2026-10-20" });
    const { data: sessions } = await admin.from("training_plan_generated_sessions").select("date").eq("plan_version_id", planVersionId).order("date");
    expect(sessions!.some((s) => s.date <= D)).toBe(false);
    expect(sessions![0]!.date).toBe("2026-10-07");
    const { data: weeks } = await admin.from("training_plan_weeks").select("week_number, start_date, dose_summary").eq("plan_version_id", planVersionId).order("week_number");
    expect(weeks!.map((w) => [w.week_number, w.start_date, (w.dose_summary as { progression: { role: string } }).progression.role])).toEqual([
      [1, "2026-10-07", "introduction"],
      [2, "2026-10-14", "build"],
    ]);
  });

  it("C — a day already done (legacy completion on D): regenerating and accepting on D keeps D as it is, the new plan adds nothing on D", async () => {
    const athleteId = await seed("BUG-V2-3 day already used");
    // Plan 1, generated the eve: starts on D with a session on D, accepted.
    const first = await generateOn(athleteId, addCalendarDays(D, -1));
    await acceptTrainingPlanVersion(admin, athleteId, first, D, addCalendarDays(D, 13));
    expect((await plannedOn(athleteId, D)).map((p) => p.source_plan_version_id)).toEqual([first]);
    // The rider trains on D, then regenerates on D.
    await insertCompletedSession(admin, athleteId, D, "STRENGTH_A", { kind: "DH_TECHNICAL", load_profile: "MODERATE" }, { actualDurationMin: 90 });
    const second = await generateOn(athleteId, D);
    const outcome = await acceptTrainingPlanVersion(admin, athleteId, second, D, addCalendarDays(D, 13));

    const onD = outcome.projection!.plannedSessions.filter((s) => s.date === D);
    expect(onD.map((s) => s.outcome)).toEqual(["skipped_completed"]);
    expect((await plannedOn(athleteId, D)).map((p) => p.source_plan_version_id)).toEqual([first]); // the used day keeps its own planned row
    const { data: done } = await admin.from("completed_sessions").select("session_date, completion_status").eq("athlete_id", athleteId);
    expect(done).toEqual([{ session_date: D, completion_status: "done" }]);
    const next = await plannedOn(athleteId, addCalendarDays(D, 1));
    expect(next.map((p) => p.source_plan_version_id)).toEqual([second]);
  });

  it("B — regenerating late on D with nothing done: no session is left or added on D; the first one is D + 1", async () => {
    const athleteId = await seed("BUG-V2-3 late regeneration");
    const first = await generateOn(athleteId, addCalendarDays(D, -1));
    await acceptTrainingPlanVersion(admin, athleteId, first, D, addCalendarDays(D, 13));
    const second = await generateOn(athleteId, D);
    const outcome = await acceptTrainingPlanVersion(admin, athleteId, second, D, addCalendarDays(D, 13));
    expect(outcome.projection!.plannedSessions.filter((s) => s.date === D).map((s) => s.outcome)).toEqual(["removed_superseded"]);
    expect(await plannedOn(athleteId, D)).toEqual([]);
    expect((await plannedOn(athleteId, addCalendarDays(D, 1))).map((p) => p.source_plan_version_id)).toEqual([second]);
  });

  describe("Edge Functions (local runtime) — product calendar", () => {
    async function invoke(client: SupabaseClient, fn: string, body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
      const { data, error } = await client.functions.invoke(fn, { body, method: "POST" });
      if (!error) return { status: 200, body: data as Record<string, unknown> };
      if (error instanceof FunctionsHttpError) {
        const response = error.context as Response;
        return { status: response.status, body: (await response.json()) as Record<string, unknown> };
      }
      throw error;
    }

    async function assertServing(fn: string): Promise<void> {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        try {
          const res = await fetch(`${resolveTestSupabaseUrl()}/functions/v1/${fn}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
          if (![502, 503, 504].includes(res.status)) return;
        } catch {
          // runtime starting
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error(`Local Edge runtime is not serving ${fn}. Start it from the repository root: \`npx supabase functions serve\`.`);
    }

    it("generate-training-plan starts the plan the day after the Zurich date; accept-training-plan projects nothing on today", async () => {
      await assertServing("generate-training-plan");
      await assertServing("accept-training-plan");
      const athleteId = await seed("BUG-V2-3 Edge");
      const rider = await getAthleteAuthClient(athleteId);
      const before = productToday();
      const generated = await invoke(rider, "generate-training-plan", { generationRequestId: randomUUID(), durationWeeks: 2 });
      const after = productToday();
      expect(generated.status).toBe(200);
      const planVersionId = generated.body.planVersionId as string;
      const { data: version } = await admin.from("training_plan_versions").select("horizon_start_date").eq("id", planVersionId).single();
      expect([addCalendarDays(before, 1), addCalendarDays(after, 1)]).toContain(version!.horizon_start_date);

      const accepted = await invoke(rider, "accept-training-plan", { planVersionId });
      expect(accepted.status).toBe(200);
      const { data: planned } = await admin.from("planned_sessions").select("planned_date").eq("athlete_id", athleteId).order("planned_date");
      expect(planned!.length).toBeGreaterThan(0);
      expect(planned!.some((p) => p.planned_date <= before)).toBe(false);
    });
  });
});
