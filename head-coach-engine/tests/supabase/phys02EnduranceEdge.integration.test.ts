/**
 * PHYS-02 — the intervals option through the deployed path, on the LOCAL Deno Edge runtime with the rider's
 * real JWT: generate-training-plan places the intervals session in each overload week only when the Edge
 * secret NALYNT_V2_ENDURANCE_INTERVALS_ENABLED is exactly "true"; whatever the secret, daily-run serves a plan
 * that already holds intervals sessions (intervals day, PHYS-02.1 LIGHT fallback), session-execution records
 * the activity, the next intervals day's guidance reads it, and the plan's rows are never modified.
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
import { buildPlanInputSnapshotV2 } from "../../src/supabase/buildPlanInputSnapshotV2.js";
import { generateAndPersistTrainingPlanV2, generateTrainingPlanVersionRpcV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";

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

  /** A rider whose CURRENT plan already holds intervals sessions (generated with the option, accepted): 10-23 and 11-13. */
  async function riderWithIntervalsPlan(name: string) {
    const { athleteId } = await createTestAthlete(admin, `PHYS-02.1 Edge ${name}`);
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
      { planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 6, today: "2026-10-04", enduranceIntervals: true },
      { buildPlanInputSnapshotV2, callRpc: generateTrainingPlanVersionRpcV2, mintId: () => randomUUID() }
    );
    if (persisted.status !== "persisted") throw new Error("plan");
    await acceptTrainingPlanVersion(admin, athleteId, persisted.planVersionId, "2026-10-05", "2026-11-15");
    return { athleteId, planVersionId: persisted.planVersionId, client: await getAthleteAuthClient(athleteId) };
  }
  /** The plan's own rows (sessions and planned prescriptions) and the rider's current version: what deactivating the option must never touch. */
  async function planState(athleteId: string, planVersionId: string): Promise<string> {
    const { data: sessions } = await admin.from("training_plan_generated_sessions").select("*").eq("plan_version_id", planVersionId).order("date");
    const { data: prescriptions } = await admin.from("training_plan_planned_prescriptions").select("*").eq("plan_version_id", planVersionId).order("id");
    const { data: current } = await admin.from("training_plan_current_version").select("plan_version_id").eq("athlete_id", athleteId).single();
    return JSON.stringify([sessions, prescriptions, current]);
  }

  it(`an existing intervals plan is served over HTTP whatever the secret (${SERVED === "true" ? "on" : "off"}), and never modified: intervals day, LIGHT fallback, activity recorded, the next intervals day reads it`, async () => {
    const a = await riderWithIntervalsPlan("A");
    const b = await riderWithIntervalsPlan("B");
    const before = [await planState(a.athleteId, a.planVersionId), await planState(b.athleteId, b.planVersionId)];

    // A — 10-23: the intervals session (KEEP), recorded through session-execution.
    await insertCheckin(admin, a.athleteId, "2026-10-23");
    const day1 = await invoke(a.client, "daily-run", { date: "2026-10-23" });
    expect([day1.status, day1.body.finalPrescriptionStatus], JSON.stringify(day1.body).slice(0, 300)).toEqual([200, "created"]);
    const fp = day1.body.finalPrescription as { id: string; structure: { protocolId: string; blocks: { durationMinutes: { max: number } }[]; enduranceGuidance?: unknown } };
    expect([fp.structure.protocolId, fp.structure.blocks.map((x) => x.durationMinutes.max), fp.structure.enduranceGuidance]).toEqual(["endurance_intervals_3min", [15, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 10], undefined]);
    const exec = randomUUID();
    const start = await invoke(a.client, "session-execution", { execution: { id: exec, session_date: "2026-10-23", started_at: "2026-10-23T17:00:00Z", final_prescription_id: fp.id, comment: null }, events: [{ id: randomUUID(), execution_id: exec, event_type: "started", occurred_at: "2026-10-23T17:00:00Z" }] });
    const done = await invoke(a.client, "session-execution", {
      activities: [{ id: randomUUID(), execution_id: exec, activity_id: "home_trainer", duration_seconds: 3180, distance_m: null, rpe_actual: 7, comment: null, supersedes_id: null, occurred_at: "2026-10-23T18:00:00Z" }],
      events: [{ id: randomUUID(), execution_id: exec, event_type: "completed", occurred_at: "2026-10-23T18:01:00Z" }],
    });
    expect([start.status, done.status], JSON.stringify(done.body).slice(0, 200)).toEqual([200, 200]);
    // A — 11-13: the next intervals day reads it.
    await insertCheckin(admin, a.athleteId, "2026-11-13");
    const day2 = await invoke(a.client, "daily-run", { date: "2026-11-13" });
    expect(day2.body.finalPrescription.structure.enduranceGuidance).toEqual({
      ruleVersion: "endurance-guidance-v1",
      reference: { sessionDate: "2026-10-23", activityId: "home_trainer", durationSeconds: 3180, distanceM: null, rpeActual: 7 },
    });

    // B — 10-23 after a short night (C3.3): PHYS-02.1's LIGHT fallback through the deployed path.
    await insertCheckin(admin, b.athleteId, "2026-10-23", { sleep_hours: 4, sleep_quality: 2, sleep_wake_ups: 4, energy: 2 });
    const light = await invoke(b.client, "daily-run", { date: "2026-10-23" });
    expect([light.status, light.body.dailyPlan.decision, light.body.dailyPlan.final_session, light.body.finalPrescriptionStatus]).toEqual([200, "MODIFY", { kind: "AEROBIC_BASE", load_profile: "LIGHT", duration_min: 45 }, "created"]);
    expect(light.body.dailyPlan.triggered_rules.map((t: { rule_id: string }) => t.rule_id)).toContain("V2_INTERVALS_LIGHT_FALLBACK");
    expect([light.body.finalPrescription.structure.protocolId, light.body.finalPrescription.structure.blocks.map((x: { durationMinutes: { max: number } }) => x.durationMinutes.max)]).toEqual(["endurance_base_continuous", [10, 30, 5]]);

    // Deactivating the option is the secret only: the existing plans are untouched by serving them.
    expect([await planState(a.athleteId, a.planVersionId), await planState(b.athleteId, b.planVersionId)]).toEqual(before);
  });
});
