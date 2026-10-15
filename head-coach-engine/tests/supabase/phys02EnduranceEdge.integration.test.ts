/**
 * PHYS-02 — the intervals option through the deployed path, on the LOCAL Deno Edge runtime with the rider's
 * real JWT: generate-training-plan places the intervals session in each overload week only when the Edge
 * secret NALYNT_V2_ENDURANCE_INTERVALS_ENABLED is exactly "true"; daily-run serves the intervals day;
 * session-execution records the activity; the next intervals day's guidance reads it.
 *
 * Opt-in: RUN_LOCAL_P0_EDGE=1, the runtime served with NALYNT_V2_PLAN_GENERATION_ENABLED=true, and
 * PHYS02_EDGE_INTERVALS_SERVED = "true" | "false" saying how NALYNT_V2_ENDURANCE_INTERVALS_ENABLED was served
 * (the runtime's environment is fixed at start: run once per value). The plan starts the day after the
 * product's today (server clock): the test reads the dates from the persisted plan.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, getAthleteAuthClient, insertCheckin, setAthleteDiscipline } from "./testDb.js";
import { localIntegrationRequested } from "./localDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";

const SERVED = process.env.PHYS02_EDGE_INTERVALS_SERVED;
const ENABLED = localIntegrationRequested({ requirePublishableKey: true }) && process.env.RUN_LOCAL_P0_EDGE === "1" && (SERVED === "true" || SERVED === "false");

async function invoke(client: SupabaseClient, fn: string, body: unknown): Promise<{ status: number; body: Record<string, any> }> {
  const { data, error } = await client.functions.invoke(fn, { body: body as Record<string, unknown> });
  if (!error) return { status: 200, body: data as Record<string, any> };
  if (error instanceof FunctionsHttpError) {
    const response = error.context as Response;
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  }
  throw error;
}

describe.skipIf(!ENABLED)(`PHYS-02 — the intervals option over HTTP (local Edge runtime, secret served = ${SERVED})`, { timeout: 240_000 }, () => {
  let admin: SupabaseClient;
  beforeAll(() => {
    admin = createTestClient();
  });

  async function rider(name: string) {
    const { athleteId } = await createTestAthlete(admin, `PHYS-02 Edge ${name}`);
    const { error } = await admin.from("training_plan_model_assignments").insert({ athlete_id: athleteId, planning_model: "v2", note: "PHYS-02 edge test" });
    if (error) throw new Error(`assignment: ${error.message}`);
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
    const client = await getAthleteAuthClient(athleteId);
    const generated = await invoke(client, "generate-training-plan", { generationRequestId: randomUUID(), durationWeeks: 6 });
    expect(generated.status, JSON.stringify(generated.body)).toBe(200);
    const planVersionId = generated.body.planVersionId as string;
    const { data: sessions } = await admin.from("training_plan_generated_sessions").select("date, kind, load_profile, duration_min, week_id").eq("plan_version_id", planVersionId).order("date");
    const { data: weeks } = await admin.from("training_plan_weeks").select("id, week_number, dose_summary").eq("plan_version_id", planVersionId).order("week_number");
    return { athleteId, client, planVersionId, sessions: sessions ?? [], weeks: (weeks ?? []) as { id: string; week_number: number; dose_summary: { progression: { role: string } } }[] };
  }

  it(`generate-training-plan: the intervals session in each overload week ${SERVED === "true" ? "(secret on)" : "never (secret off: the previous plans)"}`, async () => {
    const r = await rider("generation");
    expect(r.weeks.map((w) => w.dose_summary.progression.role)).toEqual(["introduction", "build", "build_plus", "consolidation", "build", "build_plus"]);
    const roleOf = (weekId: string) => r.weeks.find((w) => w.id === weekId)!.dose_summary.progression.role;
    const aerobic = r.sessions.filter((s) => s.kind === "AEROBIC_BASE" || s.kind === "AEROBIC_INTERVALS").map((s) => [roleOf(s.week_id), s.kind, s.duration_min, s.load_profile]);
    expect(aerobic).toEqual(
      SERVED === "true"
        ? [["introduction", "AEROBIC_BASE", 45, "LIGHT"], ["build", "AEROBIC_BASE", 45, "MODERATE"], ["build_plus", "AEROBIC_INTERVALS", 53, "MODERATE"], ["build", "AEROBIC_BASE", 60, "MODERATE"], ["build_plus", "AEROBIC_INTERVALS", 53, "MODERATE"]]
        : [["introduction", "AEROBIC_BASE", 45, "LIGHT"], ["build", "AEROBIC_BASE", 45, "MODERATE"], ["build_plus", "AEROBIC_BASE", 60, "MODERATE"], ["build", "AEROBIC_BASE", 60, "MODERATE"], ["build_plus", "AEROBIC_BASE", 75, "MODERATE"]]
    );
  });

  it.runIf(SERVED === "true")("daily-run → session-execution → daily-run: the intervals day, the activity recorded, the next intervals day reads it", async () => {
    const r = await rider("daily");
    // Projected over the whole block (the HTTP accept projects a shorter horizon; acceptance is not the subject here).
    await acceptTrainingPlanVersion(admin, r.athleteId, r.planVersionId, r.sessions[0]!.date as string, r.sessions.at(-1)!.date as string);
    const [i1, i2] = r.sessions.filter((s) => s.kind === "AEROBIC_INTERVALS").map((s) => s.date as string) as [string, string];

    await insertCheckin(admin, r.athleteId, i1);
    const day1 = await invoke(r.client, "daily-run", { date: i1 });
    expect([day1.status, day1.body.finalPrescriptionStatus], JSON.stringify(day1.body).slice(0, 300)).toEqual([200, "created"]);
    const fp = day1.body.finalPrescription as { id: string; structure: { protocolId: string; blocks: { durationMinutes: { max: number } }[]; enduranceGuidance?: unknown } };
    expect([fp.structure.protocolId, fp.structure.blocks.map((b) => b.durationMinutes.max), fp.structure.enduranceGuidance]).toEqual(["endurance_intervals_3min", [15, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 10], undefined]);

    const exec = randomUUID();
    const start = await invoke(r.client, "session-execution", { execution: { id: exec, session_date: i1, started_at: `${i1}T17:00:00Z`, final_prescription_id: fp.id, comment: null }, events: [{ id: randomUUID(), execution_id: exec, event_type: "started", occurred_at: `${i1}T17:00:00Z` }] });
    const done = await invoke(r.client, "session-execution", {
      activities: [{ id: randomUUID(), execution_id: exec, activity_id: "home_trainer", duration_seconds: 3180, distance_m: null, rpe_actual: 7, comment: null, supersedes_id: null, occurred_at: `${i1}T18:00:00Z` }],
      events: [{ id: randomUUID(), execution_id: exec, event_type: "completed", occurred_at: `${i1}T18:01:00Z` }],
    });
    expect([start.status, done.status], JSON.stringify(done.body).slice(0, 200)).toEqual([200, 200]);

    await insertCheckin(admin, r.athleteId, i2);
    const day2 = await invoke(r.client, "daily-run", { date: i2 });
    expect(day2.body.finalPrescription.structure.enduranceGuidance).toEqual({
      ruleVersion: "endurance-guidance-v1",
      reference: { sessionDate: i1, activityId: "home_trainer", durationSeconds: 3180, distanceM: null, rpeActual: 7 },
    });
  });
});
