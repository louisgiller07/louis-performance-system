/**
 * PHYS-03 — the power option through the deployed path, on the LOCAL Deno Edge runtime with the rider's real JWT:
 * generate-training-plan places the power session in build weeks only when the Edge secret NALYNT_V2_POWER_ENABLED
 * is exactly "true"; whatever the secret, daily-run serves a plan that already holds power sessions (the complete
 * session with its realistic duration, the fatigue hold), and session-execution records the explosive sets.
 *
 * Opt-in: RUN_LOCAL_P0_EDGE=1, the runtime served with NALYNT_V2_PLAN_GENERATION_ENABLED=true, and
 * PHYS03_EDGE_POWER_SERVED = "true" | "false" saying how NALYNT_V2_POWER_ENABLED was served (run once per value).
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

const SERVED = process.env.PHYS03_EDGE_POWER_SERVED;
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

describe.skipIf(!ENABLED)(`PHYS-03 — the power option over HTTP (local Edge runtime, secret served = ${SERVED})`, { timeout: 240_000 }, () => {
  let admin: SupabaseClient;
  beforeAll(() => {
    admin = createTestClient();
  });

  async function profile(name: string) {
    const { athleteId } = await createTestAthlete(admin, `PHYS-03 Edge ${name}`);
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
    return { athleteId, client: await getAthleteAuthClient(athleteId) };
  }

  it(`generate-training-plan: the power session in each build week ${SERVED === "true" ? "(secret on)" : "never (secret off: the previous plans)"}`, async () => {
    const r = await profile("generation");
    const { error } = await admin.from("training_plan_model_assignments").insert({ athlete_id: r.athleteId, planning_model: "v2", note: "PHYS-03 edge test" });
    if (error) throw new Error(`assignment: ${error.message}`);
    const generated = await invoke(r.client, "generate-training-plan", { generationRequestId: randomUUID(), durationWeeks: 6 });
    expect(generated.status, JSON.stringify(generated.body)).toBe(200);
    const { data: weeks } = await admin.from("training_plan_weeks").select("id, dose_summary").eq("plan_version_id", generated.body.planVersionId).order("week_number");
    const { data: sessions } = await admin.from("training_plan_generated_sessions").select("kind, week_id").eq("plan_version_id", generated.body.planVersionId).in("kind", ["POWER", "STRENGTH_LOWER"]).order("date");
    const roleOf = (weekId: string) => (weeks as { id: string; dose_summary: { progression: { role: string } } }[]).find((w) => w.id === weekId)!.dose_summary.progression.role;
    expect((sessions as { kind: string; week_id: string }[]).map((s) => [roleOf(s.week_id), s.kind])).toEqual(
      SERVED === "true"
        ? [["introduction", "STRENGTH_LOWER"], ["build", "POWER"], ["build_plus", "STRENGTH_LOWER"], ["consolidation", "STRENGTH_LOWER"], ["build", "POWER"], ["build_plus", "STRENGTH_LOWER"]]
        : [["introduction", "STRENGTH_LOWER"], ["build", "STRENGTH_LOWER"], ["build_plus", "STRENGTH_LOWER"], ["consolidation", "STRENGTH_LOWER"], ["build", "STRENGTH_LOWER"], ["build_plus", "STRENGTH_LOWER"]]
    );
  });

  it(`an existing power plan is served over HTTP whatever the secret (${SERVED === "true" ? "on" : "off"}): the complete session, the sets recorded, the fatigue hold`, async () => {
    const r = await profile("daily");
    const persisted = await generateAndPersistTrainingPlanV2(
      { planningModel: "v2", client: admin, athleteId: r.athleteId, generationRequestId: randomUUID(), durationWeeks: 6, today: "2026-10-04", powerSessions: true },
      { buildPlanInputSnapshotV2, callRpc: generateTrainingPlanVersionRpcV2, mintId: () => randomUUID() }
    );
    if (persisted.status !== "persisted") throw new Error("plan");
    await acceptTrainingPlanVersion(admin, r.athleteId, persisted.planVersionId, "2026-10-05", "2026-11-15");

    await insertCheckin(admin, r.athleteId, "2026-10-14");
    const day = await invoke(r.client, "daily-run", { date: "2026-10-14" });
    expect([day.status, day.body.dailyPlan.final_session, day.body.finalPrescriptionStatus], JSON.stringify(day.body).slice(0, 300)).toEqual([200, { kind: "POWER", load_profile: "MODERATE", duration_min: 59 }, "created"]);
    const fp = day.body.finalPrescription as { id: string; structure: { family: string; blocks: { role: string; items: { prescriptionItemId: string; exerciseId: string; measure: { max: number } }[] }[] } };
    expect(fp.structure.family).toBe("power");
    const first = fp.structure.blocks.find((b) => b.role === "main")!.items[0]!;
    const exec = randomUUID();
    const start = await invoke(r.client, "session-execution", { execution: { id: exec, session_date: "2026-10-14", started_at: "2026-10-14T17:00:00Z", final_prescription_id: fp.id, comment: null }, events: [{ id: randomUUID(), execution_id: exec, event_type: "started", occurred_at: "2026-10-14T17:00:00Z" }] });
    const done = await invoke(r.client, "session-execution", {
      sets: [{ id: randomUUID(), execution_id: exec, prescription_item_id: first.prescriptionItemId, set_number: 1, done: true, measure_type: "reps", measure_value: first.measure.max, occurred_at: "2026-10-14T17:10:00Z" }],
      events: [{ id: randomUUID(), execution_id: exec, event_type: "completed", occurred_at: "2026-10-14T17:59:00Z" }],
    });
    expect([start.status, done.status], JSON.stringify(done.body).slice(0, 200)).toEqual([200, 200]);

    await insertCheckin(admin, r.athleteId, "2026-11-04", { leg_fatigue: 8 });
    const tired = await invoke(r.client, "daily-run", { date: "2026-11-04" });
    expect([tired.status, tired.body.dailyPlan.decision, tired.body.finalPrescriptionStatus, tired.body.finalPrescriptionStatusDetail]).toEqual([200, "KEEP", "blocked", { reason: "power_fatigue_not_cleared", rules: ["C3.6"] }]);
  });
});
