/**
 * PHYS-01 — the same load guidance through the deployed path: the daily-run Edge Function (Deno bundle of the
 * V2 reconciliation) on the LOCAL runtime, called with the rider's real JWT, reads the rider's completed sets
 * and persists the guidance with the day's final prescription. Local only (`npx supabase functions serve`).
 *
 * V2-PHYS-INTEGRATION-01 — PHYS01_EDGE_DAILY_SERVED = "true" when the runtime is served with
 * NALYNT_V2_PHYS_DAILY_ENABLED and NALYNT_V2_PHYS_PERFORMANCE_GUIDANCE_ENABLED exactly "true": the guidance is
 * persisted. Otherwise (the default, every PHYS secret absent): the Edge daily-run reads no history and writes no
 * guidance — the production behaviour.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, getAthleteAuthClient, insertCheckin, resolveTestSupabaseUrl, setAthleteDiscipline } from "./testDb.js";
import { localIntegrationRequested } from "./localDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { buildPlanInputSnapshotV2 } from "../../src/supabase/buildPlanInputSnapshotV2.js";
import { generateAndPersistTrainingPlanV2, generateTrainingPlanVersionRpcV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { DEFAULT_RUN_DAILY_FOR_DEPS, runDailyFor } from "../../src/supabase/runDailyFor.js";
// V2-PHYS-INTEGRATION-01 — these PHYS rules run with every PHYS switch ON (performance guidance included); every
// switch off is the production behaviour (the production tests kept unchanged, phys00FlagsOffEquivalence).
const PHYS_ON_DEPS = { ...DEFAULT_RUN_DAILY_FOR_DEPS, physSwitches: { daily: true, performanceGuidance: true, intervals: true, power: true, mobility: true } };

const ENABLED = localIntegrationRequested({ requirePublishableKey: true });
const DAILY_SERVED = process.env.PHYS01_EDGE_DAILY_SERVED === "true";

async function assertServing(fn: string) {
  let last = "";
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`${resolveTestSupabaseUrl()}/functions/v1/${fn}`, { method: "OPTIONS" });
      if (res.status === 200 || res.status === 204) return;
      last = String(res.status);
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Local Edge runtime is not serving ${fn} (last answer: ${last}). Start it: \`npx supabase functions serve\`.`);
}

async function invoke(client: SupabaseClient, fn: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const { data, error } = await client.functions.invoke(fn, { body: body as Record<string, unknown> });
  if (!error) return { status: 200, body: data as Record<string, unknown> };
  if (error instanceof FunctionsHttpError) {
    const response = error.context as Response;
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }
  throw error;
}

type Item = { prescriptionItemId: string; exerciseId: string; sets: number; measure: { min?: number; max?: number }; rpeTarget?: { max: number }; loadGuidance?: Record<string, unknown> };
type Structure = { blocks: { role: string; items: Item[] }[] };

describe.skipIf(!ENABLED)("PHYS-01 — load guidance through the daily-run Edge Function (local runtime)", { timeout: 180_000 }, () => {
  let admin: SupabaseClient;
  beforeAll(async () => {
    await assertServing("daily-run");
    admin = createTestClient();
  });

  it(`history recorded on session 1 → the Edge daily-run of session 2: ${DAILY_SERVED ? "persists the guidance read from it" : "PHYS secrets absent, no guidance (production)"}`, async () => {
    const { athleteId } = await createTestAthlete(admin, "PHYS-01 Edge");
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
    const persisted = await generateAndPersistTrainingPlanV2(
      { planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 2, today: "2026-10-04" },
      { buildPlanInputSnapshotV2, callRpc: generateTrainingPlanVersionRpcV2, mintId: () => randomUUID() }
    );
    if (persisted.status !== "persisted") throw new Error("plan");
    await acceptTrainingPlanVersion(admin, athleteId, persisted.planVersionId, "2026-10-05", "2026-10-18");
    const { data: uppers } = await admin.from("training_plan_generated_sessions").select("date").eq("plan_version_id", persisted.planVersionId).eq("kind", "STRENGTH_UPPER").order("date");
    const [u1, u2] = uppers!.map((r) => r.date as string) as [string, string];

    // Session 1 (Node path), recorded and completed with the loads used.
    await insertCheckin(admin, athleteId, u1);
    const d1 = await runDailyFor(admin, athleteId, u1, PHYS_ON_DEPS);
    const s1 = d1.finalPrescription!.structure as unknown as Structure;
    const bench = s1.blocks.find((b) => b.role === "main")!.items[0]!;
    expect(bench.exerciseId).toBe("dumbbell_bench_press");
    const id = randomUUID();
    const rpc = async (payload: unknown) => {
      const { data, error } = await admin.rpc("record_session_execution", { p_athlete_id: athleteId, p_payload: payload });
      if (error) throw new Error(error.message);
      return data as { status: string };
    };
    expect(await rpc({ execution: { id, session_date: u1, started_at: `${u1}T17:00:00Z`, final_prescription_id: d1.finalPrescription!.id }, events: [{ id: randomUUID(), execution_id: id, event_type: "started", occurred_at: `${u1}T17:00:00Z` }] })).toMatchObject({ status: "ok" });
    const sets = Array.from({ length: bench.sets }, (_, i) => ({ id: randomUUID(), execution_id: id, prescription_item_id: bench.prescriptionItemId, set_number: i + 1, done: true, measure_type: "reps", measure_value: bench.measure.max, load_kg: 18, rpe_actual: bench.rpeTarget!.max, occurred_at: `${u1}T17:1${i}:00Z` }));
    expect(await rpc({ sets, events: [{ id: randomUUID(), execution_id: id, event_type: "completed", occurred_at: `${u1}T17:50:00Z` }] })).toMatchObject({ status: "ok" });

    // Session 2 — the deployed path: the Edge daily-run, the rider's own JWT.
    await insertCheckin(admin, athleteId, u2);
    const rider = await getAthleteAuthClient(athleteId);
    const res = await invoke(rider, "daily-run", { date: u2 });
    expect(res.status).toBe(200);
    const { data: decisions } = await admin.from("decisions").select("id").eq("athlete_id", athleteId).eq("decision_date", u2);
    const { data: finals } = await admin.from("decision_final_prescriptions").select("structure").eq("decision_id", decisions![0]!.id);
    const bench2 = (finals![0]!.structure as Structure).blocks.find((b) => b.role === "main")!.items[0]!;
    if (DAILY_SERVED) {
      expect(bench2.loadGuidance).toMatchObject({ ruleVersion: "strength-load-guidance-v1", reference: { sessionDate: u1, loadKg: 18 } });
    } else {
      // Every PHYS secret absent: no guidance read or written, no PHYS cool-down — the production document.
      expect(JSON.stringify(finals![0]!.structure)).not.toMatch(/loadGuidance|repsGuidance|enduranceGuidance/);
      expect((finals![0]!.structure as Structure).blocks.map((b) => b.role)).not.toContain("cool_down");
    }
  });
});
