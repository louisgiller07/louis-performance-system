/**
 * PHYS-04 — the mobility option and the bodyweight guidance through the deployed path, on the LOCAL Deno Edge runtime
 * with the rider's real JWT: generate-training-plan adds the mobility session to the consolidation week only when the
 * Edge secret NALYNT_V2_MOBILITY_ENABLED is exactly "true"; whatever the secret, daily-run serves a plan that already
 * holds a mobility session (the routine, completed without results through session-execution), and the bodyweight
 * Force guidance (calibrate → the sets recorded over HTTP → the repetitions to aim for).
 *
 * Opt-in: RUN_LOCAL_P0_EDGE=1, the runtime served with NALYNT_V2_PLAN_GENERATION_ENABLED=true, and
 * PHYS04_EDGE_MOBILITY_SERVED = "true" | "false" saying how NALYNT_V2_MOBILITY_ENABLED was served (run once per value).
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, getAthleteAuthClient, insertCheckin, setAthleteDiscipline } from "./testDb.js";
import { localIntegrationRequested } from "./localDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { buildPlanInputSnapshotV2 } from "../../src/supabase/buildPlanInputSnapshotV2.js";
import { generateAndPersistTrainingPlanV2, generateTrainingPlanVersionRpcV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";

const SERVED = process.env.PHYS04_EDGE_MOBILITY_SERVED;
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

type Item = { prescriptionItemId: string; exerciseId: string; sets: number; measure: { min: number; max: number }; rpeTarget?: { max: number }; repsGuidance?: { mode: string; change?: string; targetReps?: number } };
type Structure = { family: string; protocolId?: string; blocks: { role: string; items: Item[] }[] };
const guided = (s: Structure) => s.blocks.filter((b) => b.role === "main" || b.role === "complementary").flatMap((b) => b.items).filter((i) => i.repsGuidance);

describe.skipIf(!ENABLED)(`PHYS-04 — mobility and bodyweight guidance over HTTP (local Edge runtime, secret served = ${SERVED})`, { timeout: 240_000 }, () => {
  let admin: SupabaseClient;
  beforeAll(() => {
    admin = createTestClient();
  });

  async function profile(name: string) {
    const { athleteId } = await createTestAthlete(admin, `PHYS-04 Edge ${name}`);
    await setAthleteDiscipline(admin, athleteId, "Downhill");
    await upsertPerformanceProfileFor(admin, athleteId, {
      strength_experience_tier: "beginner",
      equipment: [],
      terrain_access: ["flow_trail", "bermed_trail"],
      declared_limitations: [],
      technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
      dh_technical_tier: "intermediate",
    });
    for (const d of [0, 1, 2, 3, 4, 5, 6]) await insertAvailabilityWindow(admin, athleteId, { day_of_week: d, start_time: "08:00:00", end_time: "20:00:00" });
    return { athleteId, client: await getAthleteAuthClient(athleteId) };
  }

  it(`generate-training-plan: the mobility session ${SERVED === "true" ? "in the consolidation week (secret on)" : "never (secret off: the previous plans)"}`, async () => {
    const r = await profile("generation");
    const { error } = await admin.from("training_plan_model_assignments").insert({ athlete_id: r.athleteId, planning_model: "v2", note: "PHYS-04 edge test" });
    if (error) throw new Error(`assignment: ${error.message}`);
    const generated = await invoke(r.client, "generate-training-plan", { generationRequestId: randomUUID(), durationWeeks: 6 });
    expect(generated.status, JSON.stringify(generated.body)).toBe(200);
    const { data: weeks } = await admin.from("training_plan_weeks").select("id, dose_summary").eq("plan_version_id", generated.body.planVersionId).order("week_number");
    const { data: sessions } = await admin.from("training_plan_generated_sessions").select("kind, week_id, duration_min").eq("plan_version_id", generated.body.planVersionId).eq("kind", "MOBILITY");
    const roleOf = (weekId: string) => (weeks as { id: string; dose_summary: { progression: { role: string } } }[]).find((w) => w.id === weekId)!.dose_summary.progression.role;
    expect((sessions as { kind: string; week_id: string; duration_min: number }[]).map((s) => [roleOf(s.week_id), s.duration_min])).toEqual(SERVED === "true" ? [["consolidation", 30]] : []);
  });

  it(`an existing mobility plan is served over HTTP whatever the secret (${SERVED === "true" ? "on" : "off"}): bodyweight calibrate → sets → target; the routine completed without results`, async () => {
    const r = await profile("daily");
    const persisted = await generateAndPersistTrainingPlanV2(
      { planningModel: "v2", client: admin, athleteId: r.athleteId, generationRequestId: randomUUID(), durationWeeks: 6, today: "2026-10-04", mobilitySessions: true },
      { buildPlanInputSnapshotV2, callRpc: generateTrainingPlanVersionRpcV2, mintId: () => randomUUID() }
    );
    if (persisted.status !== "persisted") throw new Error("plan");
    await acceptTrainingPlanVersion(admin, r.athleteId, persisted.planVersionId, "2026-10-05", "2026-11-15");

    await insertCheckin(admin, r.athleteId, "2026-10-14");
    const d14 = await invoke(r.client, "daily-run", { date: "2026-10-14" });
    expect([d14.status, d14.body.dailyPlan.final_session.kind, d14.body.finalPrescriptionStatus], JSON.stringify(d14.body).slice(0, 300)).toEqual([200, "STRENGTH_LOWER", "created"]);
    const f14 = d14.body.finalPrescription as { id: string; structure: Structure };
    expect(guided(f14.structure).map((i) => [i.exerciseId, i.repsGuidance!.mode])).toEqual([
      ["bodyweight_squat", "calibrate"],
      ["glute_bridge", "calibrate"],
      ["reverse_lunge", "calibrate"],
    ]);
    const exec = randomUUID();
    const start = await invoke(r.client, "session-execution", { execution: { id: exec, session_date: "2026-10-14", started_at: "2026-10-14T17:00:00Z", final_prescription_id: f14.id, comment: null }, events: [{ id: randomUUID(), execution_id: exec, event_type: "started", occurred_at: "2026-10-14T17:00:00Z" }] });
    const sets = guided(f14.structure).flatMap((i) =>
      Array.from({ length: i.sets }, (_, k) => ({ id: randomUUID(), execution_id: exec, prescription_item_id: i.prescriptionItemId, set_number: k + 1, done: true, measure_type: "reps", measure_value: i.measure.min, rpe: i.rpeTarget?.max ?? null, occurred_at: `2026-10-14T17:${String(10 + k).padStart(2, "0")}:00Z` }))
    );
    const done = await invoke(r.client, "session-execution", { sets, events: [{ id: randomUUID(), execution_id: exec, event_type: "completed", occurred_at: "2026-10-14T17:55:00Z" }] });
    expect([start.status, done.status], JSON.stringify(done.body).slice(0, 200)).toEqual([200, 200]);

    await insertCheckin(admin, r.athleteId, "2026-10-21");
    const d21 = await invoke(r.client, "daily-run", { date: "2026-10-21" });
    const g21 = guided((d21.body.finalPrescription as { structure: Structure }).structure);
    expect(g21.map((i) => [i.exerciseId, i.repsGuidance!.change, i.repsGuidance!.targetReps])).toEqual(guided(f14.structure).map((i) => [i.exerciseId, "increase", i.measure.min + 1]));

    await insertCheckin(admin, r.athleteId, "2026-10-28");
    const d28 = await invoke(r.client, "daily-run", { date: "2026-10-28" });
    const f28 = d28.body.finalPrescription as { id: string; structure: Structure };
    expect([d28.status, d28.body.dailyPlan.final_session.kind, f28.structure.family, f28.structure.protocolId]).toEqual([200, "MOBILITY", "mobility", "mobility_routine_v1"]);
    const mob = randomUUID();
    const routine = await invoke(r.client, "session-execution", {
      execution: { id: mob, session_date: "2026-10-28", started_at: "2026-10-28T18:00:00Z", final_prescription_id: f28.id, comment: null },
      events: [
        { id: randomUUID(), execution_id: mob, event_type: "started", occurred_at: "2026-10-28T18:00:00Z" },
        { id: randomUUID(), execution_id: mob, event_type: "completed", occurred_at: "2026-10-28T18:28:00Z" },
      ],
    });
    expect(routine.status, JSON.stringify(routine.body).slice(0, 200)).toBe(200);
  });
});
