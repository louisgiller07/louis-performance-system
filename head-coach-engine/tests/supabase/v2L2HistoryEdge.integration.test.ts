/**
 * V2-L2-01a — the V2 history switch through the deployed path, on the LOCAL Deno Edge runtime with the rider's real
 * JWT: generate-training-plan reads the guided V2 history only when the Edge secret NALYNT_V2_L2_HISTORY_ENABLED is
 * exactly "true". The window is the server's own today (productToday, Europe/Zurich), never a date from the request.
 *
 * Opt-in: RUN_LOCAL_P0_EDGE=1, the runtime served with NALYNT_V2_PLAN_GENERATION_ENABLED=true, and
 * V2_L2_EDGE_HISTORY_SERVED = "true" | "false" saying how NALYNT_V2_L2_HISTORY_ENABLED was served (run once per value).
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, getAthleteAuthClient, insertCheckin, setAthleteDiscipline } from "./testDb.js";
import { localIntegrationRequested } from "./localDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { runDailyFor } from "../../src/supabase/runDailyFor.js";
import { generateAndPersistTrainingPlanV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { addCalendarDays, productToday } from "../../src/supabase/productCalendar.js";

const SERVED = process.env.V2_L2_EDGE_HISTORY_SERVED;
const ENABLED = localIntegrationRequested({ requirePublishableKey: true }) && process.env.RUN_LOCAL_P0_EDGE === "1" && (SERVED === "true" || SERVED === "false");

type Item = { kind: string; prescriptionItemId: string; sets?: number; measure: { type: string; min?: number; max?: number; count?: number } };
type Structure = { family: string; blocks: { role: string; items: Item[] }[]; activitySelection?: { activityIds: string[] } };

async function invoke(client: SupabaseClient, fn: string, body: unknown): Promise<{ status: number; body: Record<string, any> }> {
  const { data, error } = await client.functions.invoke(fn, { body: body as Record<string, unknown> });
  if (!error) return { status: 200, body: data as Record<string, any> };
  if (error instanceof FunctionsHttpError) {
    const response = error.context as Response;
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  }
  throw error;
}

describe.skipIf(!ENABLED)(`V2-L2-01a — generate-training-plan over HTTP (local Edge runtime, NALYNT_V2_L2_HISTORY_ENABLED served = ${SERVED})`, { timeout: 300_000 }, () => {
  let admin: SupabaseClient;
  beforeAll(() => {
    admin = createTestClient();
  });

  async function record(athleteId: string, payload: unknown) {
    const { data, error } = await admin.rpc("record_session_execution", { p_athlete_id: athleteId, p_payload: payload });
    if (error) throw new Error(error.message);
    if ((data as { status: string }).status !== "ok") throw new Error(JSON.stringify(data));
  }

  it(`a V2 rider with ≥ 180 guided minutes in the server's window → week 1 ${SERVED === "true" ? "build (recent_training_history)" : "introduction (the previous behaviour)"}`, async () => {
    const today = productToday();
    const { athleteId } = await createTestAthlete(admin, `V2-L2-01a Edge ${randomUUID().slice(0, 6)}`);
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
    const { error: assignment } = await admin.from("training_plan_model_assignments").insert({ athlete_id: athleteId, planning_model: "v2", note: "V2-L2-01a edge test" });
    if (assignment) throw new Error(assignment.message);

    // Plan A from today − 7; its first days performed in full through record_session_execution until ≥ 180 min.
    const a = await generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 2, today: addCalendarDays(today, -8) });
    if (a.status !== "persisted") throw new Error("plan A");
    await acceptTrainingPlanVersion(admin, athleteId, a.planVersionId, addCalendarDays(today, -7), addCalendarDays(today, 6));
    const { data: planned } = await admin.from("training_plan_generated_sessions").select("date").eq("plan_version_id", a.planVersionId).lt("date", today).order("date");
    let minutes = 0;
    for (const { date } of (planned ?? []) as { date: string }[]) {
      if (minutes >= 180) break;
      await insertCheckin(admin, athleteId, date);
      const run = await runDailyFor(admin, athleteId, date);
      const { data: fp } = await admin.from("decision_final_prescriptions").select("id, structure").eq("decision_id", run.persistence.decision_id).single();
      const s = (fp as { structure: Structure }).structure;
      const exec = randomUUID();
      await record(athleteId, { execution: { id: exec, session_date: date, started_at: `${date}T17:00:00Z`, final_prescription_id: (fp as { id: string }).id }, events: [{ id: randomUUID(), execution_id: exec, event_type: "started", occurred_at: `${date}T17:00:00Z` }] });
      const work = s.blocks.filter((b) => b.role === "main" || b.role === "complementary").flatMap((b) => b.items);
      const result = (i: Item, n: number) => ({ id: randomUUID(), execution_id: exec, prescription_item_id: i.prescriptionItemId, set_number: n, done: true, measure_type: i.measure.type, measure_value: i.measure.type === "pass" ? null : i.measure.type === "duration" ? 30 : (i.measure.max ?? 8), occurred_at: `${date}T17:30:00Z` });
      const sets =
        s.family === "dh_technical"
          ? Array.from({ length: work[0]!.measure.count! }, (_, k) => result(work[0]!, k + 1))
          : s.family === "endurance"
            ? []
            : work.filter((i) => i.kind === "exercise").flatMap((i) => Array.from({ length: i.sets! }, (_, k) => result(i, k + 1)));
      const activities = s.family === "endurance" ? [{ id: randomUUID(), execution_id: exec, activity_id: s.activitySelection!.activityIds[0], duration_seconds: 45 * 60, occurred_at: `${date}T17:50:00Z` }] : [];
      await record(athleteId, { sets, activities, events: [{ id: randomUUID(), execution_id: exec, event_type: "completed", occurred_at: `${date}T18:00:00Z` }] });
      minutes += s.family === "endurance" ? 45 : ((run.dailyPlan.final_session as { duration_min?: number }).duration_min ?? 0);
    }
    expect(minutes).toBeGreaterThanOrEqual(180);

    const rider = await getAthleteAuthClient(athleteId);
    const generated = await invoke(rider, "generate-training-plan", { generationRequestId: randomUUID(), durationWeeks: 3 });
    expect(generated.status, JSON.stringify(generated.body)).toBe(200);
    expect(Object.keys(generated.body).sort()).toEqual(["idempotentReplay", "planVersionId"]);
    const { data: version } = await admin.from("training_plan_versions").select("input_snapshot").eq("id", generated.body.planVersionId).single();
    const { data: weeks } = await admin.from("training_plan_weeks").select("week_number, dose_summary").eq("plan_version_id", generated.body.planVersionId).order("week_number");
    const progression = ((weeks ?? []) as { dose_summary: { progression: { role: string; reasonCodes: string[] } } }[]).map((w) => [w.dose_summary.progression.role, w.dose_summary.progression.reasonCodes]);
    const recent = (version as { input_snapshot: { recentHistory: { trailingVolumeMinutes: number; recentMissedOrReplacedCount: number } } }).input_snapshot.recentHistory;
    if (SERVED === "true") {
      expect([recent.trailingVolumeMinutes, recent.recentMissedOrReplacedCount]).toEqual([minutes, 0]);
      expect(progression[0]).toEqual(["build", ["cycle_progression", "recent_training_history"]]);
    } else {
      expect([recent.trailingVolumeMinutes, recent.recentMissedOrReplacedCount]).toEqual([0, 0]);
      expect(progression[0]).toEqual(["introduction", ["block_start_baseline"]]);
    }
  });
});
