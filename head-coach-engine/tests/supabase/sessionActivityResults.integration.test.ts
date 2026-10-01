/**
 * UX-11B.2.5 — session_activity_results through record_session_execution
 * (real local Supabase): a V2 endurance final prescription offers an
 * activity choice; the rider's actual activity is recorded against the
 * execution, never as a fake prescription item.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, getAthleteAuthClient, insertCheckin, setAthleteDiscipline } from "./testDb.js";
import { assertLocalDbReady, execLocalSql, localIntegrationRequested, sqlLiteral } from "./localDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { generateAndPersistTrainingPlanV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { runDailyFor } from "../../src/supabase/runDailyFor.js";
import { computeDailyFor } from "../../src/supabase/computeDailyFor.js";

const INTEGRATION_ENABLED = localIntegrationRequested({ requirePublishableKey: true });
const TODAY = "2026-10-05";
const ENDURANCE_DAY = "2026-10-09"; // AEROBIC_BASE MODERATE 45 in the development plan
const FORCE_DAY = "2026-10-07";
const DH_DAY = "2026-10-05";

type Outcome = { status: string; code?: string; target?: string; inserted?: Record<string, string[]>; unchanged?: Record<string, string[]> };

describe.skipIf(!INTEGRATION_ENABLED)("UX-11B.2.5 — session activity results (local Supabase)", () => {
  let admin: SupabaseClient;
  let athleteId: string;
  let enduranceFp: string;

  const record = async (payload: unknown, who = athleteId): Promise<Outcome> => {
    const { data, error } = await admin.rpc("record_session_execution", { p_athlete_id: who, p_payload: payload });
    if (error) throw new Error(error.message);
    return data as Outcome;
  };
  function start(day: string, finalPrescriptionId: string | null) {
    const id = randomUUID();
    return {
      id,
      execution: { id, session_date: day, started_at: `${day}T17:00:00Z`, final_prescription_id: finalPrescriptionId },
      started: { id: randomUUID(), execution_id: id, event_type: "started", occurred_at: `${day}T17:00:00Z` },
      event: (event_type: string, minute = 50) => ({ id: randomUUID(), execution_id: id, event_type, occurred_at: `${day}T17:${String(minute).padStart(2, "0")}:00Z` }),
    };
  }
  const activity = (executionId: string, extra: Record<string, unknown> = {}) => ({
    id: randomUUID(),
    execution_id: executionId,
    activity_id: "mtb_rolling",
    duration_seconds: 2580,
    occurred_at: `${ENDURANCE_DAY}T17:45:00Z`,
    ...extra,
  });
  async function keepRun(day: string): Promise<string> {
    await insertCheckin(admin, athleteId, day);
    const result = await runDailyFor(admin, athleteId, day);
    expect(result.finalPrescriptionStatus).toBe("created");
    return result.finalPrescription!.id;
  }

  beforeAll(async () => {
    assertLocalDbReady();
    admin = createTestClient();
    ({ athleteId } = await createTestAthlete(admin, "UX-11B.2.5 activity results"));
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
    const p = await generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 2, today: TODAY });
    if (p.status !== "persisted") throw new Error("V2 plan not persisted");
    await acceptTrainingPlanVersion(admin, athleteId, p.planVersionId, TODAY, "2026-10-18");
    enduranceFp = await keepRun(ENDURANCE_DAY);
  }, 120_000);

  it("endurance: completed is refused without the activity result (whole batch rolled back), then accepted with it in the same batch", async () => {
    const { data: fp } = await admin.from("decision_final_prescriptions").select("structure").eq("id", enduranceFp).single();
    expect((fp!.structure as { activitySelection: unknown }).activitySelection).toEqual({ mode: "restricted", activityIds: ["road_bike", "mtb_rolling", "home_trainer", "running"] });

    const e = start(ENDURANCE_DAY, enduranceFp);
    expect(await record({ execution: e.execution, events: [e.started] })).toMatchObject({ status: "ok" });
    const refused = e.event("completed");
    expect(await record({ events: [refused] })).toEqual({ status: "rejected", code: "activity_result_required", target: "execution" });
    expect((await admin.from("execution_events").select("id").eq("id", refused.id)).data).toEqual([]);

    const act = activity(e.id, { distance_m: 18400, rpe_actual: 4, comment: "Boucle VTT roulante." });
    const completed = e.event("completed", 55);
    expect(await record({ events: [completed], activities: [act] })).toMatchObject({ status: "ok", inserted: { events: [completed.id], activities: [act.id] } });

    const { data: rows } = await admin.from("session_activity_results").select("*").eq("execution_id", e.id);
    expect(rows).toHaveLength(1);
    expect(rows![0]).toMatchObject({ id: act.id, athlete_id: athleteId, activity_id: "mtb_rolling", duration_seconds: 2580, distance_m: 18400, rpe_actual: 4, supersedes_id: null });
    // Lineage: activity → execution → this final prescription; never a prescription item or an exercise.
    expect(rows![0]).not.toHaveProperty("prescription_item_id");
    expect(rows![0]).not.toHaveProperty("exercise_id");
    const { data: exec } = await admin.from("session_executions").select("final_prescription_id").eq("id", e.id).single();
    expect(exec!.final_prescription_id).toBe(enduranceFp);

    // Idempotent replay; same id with other content → id_conflict.
    expect(await record({ activities: [act] })).toMatchObject({ status: "ok", unchanged: { activities: [act.id] } });
    expect(await record({ activities: [{ ...act, duration_seconds: 2581 }] })).toEqual({ status: "rejected", code: "id_conflict", target: "activities[0]" });

    // UX-11B.2.6 — e is completed: its results are frozen (no second original, no correction); a replay stays unchanged.
    expect(await record({ activities: [activity(e.id, { activity_id: "road_bike" })] })).toEqual({ status: "rejected", code: "execution_terminal", target: "activities[0]" });
    expect(await record({ activities: [activity(e.id, { duration_seconds: 2640, supersedes_id: act.id })] })).toEqual({ status: "rejected", code: "execution_terminal", target: "activities[0]" });

    // One activity per session (on an open execution): a second original is refused; a correction replaces it; never a correction of a correction.
    const e2 = start(ENDURANCE_DAY, enduranceFp);
    expect(await record({ execution: e2.execution, events: [e2.started] })).toMatchObject({ status: "ok" });
    const act2 = activity(e2.id);
    expect(await record({ activities: [act2] })).toMatchObject({ status: "ok" });
    expect(await record({ activities: [activity(e2.id, { activity_id: "road_bike" })] })).toEqual({ status: "rejected", code: "activity_result_exists", target: "activities[0]" });
    const correction = activity(e2.id, { duration_seconds: 2640, supersedes_id: act2.id });
    expect(await record({ activities: [correction] })).toMatchObject({ status: "ok", inserted: { activities: [correction.id] } });
    expect(await record({ activities: [activity(e2.id, { supersedes_id: correction.id })] })).toEqual({ status: "rejected", code: "invalid_correction", target: "activities[0]" });
    expect(await record({ activities: [activity(e2.id, { supersedes_id: act2.id })] })).toEqual({ status: "rejected", code: "invalid_correction", target: "activities[0]" });

    // Active result = the row nobody supersedes (the original stays as history).
    const { data: all } = await admin.from("session_activity_results").select("id, supersedes_id, duration_seconds").eq("execution_id", e2.id);
    const superseded = new Set(all!.map((r) => r.supersedes_id).filter(Boolean));
    const active = all!.filter((r) => !superseded.has(r.id));
    expect(all).toHaveLength(2);
    expect(active).toEqual([{ id: correction.id, supersedes_id: act2.id, duration_seconds: 2640 }]);
    expect(await record({ events: [e2.event("abandoned", 59)] })).toMatchObject({ status: "ok" });

    // Append-only, even for the database owner.
    expect(() => execLocalSql(`update public.session_activity_results set duration_seconds = 1 where id = ${sqlLiteral(act.id)};`)).toThrow();
    expect(() => execLocalSql(`delete from public.session_activity_results where id = ${sqlLiteral(act.id)};`)).toThrow();
  });

  it("an activity outside the prescription's own list is refused, even if it is a known catalogue activity", async () => {
    // A hand-made v2 final prescription allowing road_bike only (owner-level fixture: no planner produces a 1-item list).
    const day = "2026-10-11";
    await insertCheckin(admin, athleteId, day);
    const decisionId = randomUUID();
    const fpId = randomUUID();
    execLocalSql(`
insert into public.decisions (id, athlete_id, decision_date, final_session, reason, engine_version, final_prescription_status, source_checkin_id, source_checkin_updated_at)
  select ${sqlLiteral(decisionId)}, ${sqlLiteral(athleteId)}, ${sqlLiteral(day)}, 'AEROBIC_BASE', 'test fixture', 'test', 'created', c.id, c.updated_at
    from public.daily_checkins c where c.athlete_id = ${sqlLiteral(athleteId)} and c.checkin_date = ${sqlLiteral(day)};
insert into public.decision_final_prescriptions (id, decision_id, athlete_id, active_session_origin, reconciliation_action, schema_version, catalog_version, structure)
  values (${sqlLiteral(fpId)}, ${sqlLiteral(decisionId)}, ${sqlLiteral(athleteId)}, 'no_canonical_plan', 'keep', 'v2', 'test',
          '{"schemaVersion":"v2","family":"endurance","activitySelection":{"mode":"restricted","activityIds":["road_bike"]},"blocks":[]}'::jsonb);`);
    const e = start(day, fpId);
    expect(await record({ execution: e.execution, events: [e.started] })).toMatchObject({ status: "ok" });
    const at = { occurred_at: `${day}T17:30:00Z` };
    expect(await record({ activities: [activity(e.id, { activity_id: "mtb_rolling", ...at })] })).toEqual({ status: "rejected", code: "activity_not_allowed_by_prescription", target: "activities[0]" });
    expect(await record({ activities: [activity(e.id, { activity_id: "swimming", ...at })] })).toEqual({ status: "rejected", code: "activity_not_allowed_by_prescription", target: "activities[0]" });
    expect(await record({ activities: [activity(e.id, { activity_id: "road_bike", ...at })] })).toMatchObject({ status: "ok" });
  });

  it("Force and DH: no activity result (no activitySelection); sets and passes unchanged; completion without activity still allowed", async () => {
    const forceFp = await keepRun(FORCE_DAY);
    const f = start(FORCE_DAY, forceFp);
    expect(await record({ execution: f.execution, events: [f.started] })).toMatchObject({ status: "ok" });
    expect(await record({ activities: [activity(f.id, { occurred_at: `${FORCE_DAY}T17:30:00Z` })] })).toEqual({ status: "rejected", code: "activity_not_allowed_by_prescription", target: "activities[0]" });
    const { data: forceFpRow } = await admin.from("decision_final_prescriptions").select("structure").eq("id", forceFp).single();
    const main = (forceFpRow!.structure as { blocks: Array<{ role: string; items: Array<{ prescriptionItemId: string }> }> }).blocks.find((b) => b.role === "main")!.items[0]!;
    const set = { id: randomUUID(), execution_id: f.id, prescription_item_id: main.prescriptionItemId, set_number: 1, done: true, measure_type: "reps", measure_value: 7, rpe_actual: 7, occurred_at: `${FORCE_DAY}T17:20:00Z` };
    expect(await record({ sets: [set], events: [f.event("completed")] })).toMatchObject({ status: "ok", inserted: { sets: [set.id] } });

    const dhFp = await keepRun(DH_DAY);
    const d = start(DH_DAY, dhFp);
    const { data: dhFpRow } = await admin.from("decision_final_prescriptions").select("structure").eq("id", dhFp).single();
    const drill = (dhFpRow!.structure as { blocks: Array<{ role: string; items: Array<{ prescriptionItemId: string }> }> }).blocks.find((b) => b.role === "main")!.items[0]!;
    const pass = { id: randomUUID(), execution_id: d.id, prescription_item_id: drill.prescriptionItemId, set_number: 1, done: true, measure_type: "pass", measure_value: null, occurred_at: `${DH_DAY}T17:20:00Z` };
    expect(await record({ execution: d.execution, events: [d.started], sets: [pass] })).toMatchObject({ status: "ok" });
    expect(await record({ activities: [activity(d.id, { occurred_at: `${DH_DAY}T17:30:00Z` })] })).toEqual({ status: "rejected", code: "activity_not_allowed_by_prescription", target: "activities[0]" });
    expect(await record({ events: [d.event("completed")] })).toMatchObject({ status: "ok" });
    const { data: noActivity } = await admin.from("session_activity_results").select("id").in("execution_id", [f.id, d.id]);
    expect(noActivity).toEqual([]);
  });

  it("an activity added to an execution that started before a newer decision is still accepted (the execution is never interrupted)", async () => {
    const day = "2026-10-16"; // AEROBIC_BASE in week 2
    const fp = await keepRun(day);
    const e = start(day, fp);
    expect(await record({ execution: e.execution, events: [e.started] })).toMatchObject({ status: "ok" });
    // A new daily run: fp is no longer the day's current final prescription.
    await runDailyFor(admin, athleteId, day);
    const act = activity(e.id, { activity_id: "running", occurred_at: `${day}T17:40:00Z` });
    expect(await record({ activities: [act], events: [e.event("completed")] })).toMatchObject({ status: "ok", inserted: { activities: [act.id] } });
  });

  it("RLS: the rider reads their own activity results; no direct insert for any API role", async () => {
    const owner = await getAthleteAuthClient(athleteId);
    const { data } = await owner.from("session_activity_results").select("activity_id").eq("athlete_id", athleteId);
    expect(data!.length).toBeGreaterThan(0);
    const row = { id: randomUUID(), execution_id: randomUUID(), athlete_id: athleteId, activity_id: "running", duration_seconds: 60, occurred_at: "2026-10-09T17:00:00Z" };
    expect((await owner.from("session_activity_results").insert(row)).error).not.toBeNull();
    expect((await admin.from("session_activity_results").insert(row)).error).not.toBeNull();
  });

  it("M1 recent-history bridge unchanged: the completed endurance session counts from its decision's final_session, activity details are not read", async () => {
    await insertCheckin(admin, athleteId, "2026-10-17");
    const { rawContext } = await computeDailyFor(admin, athleteId, "2026-10-17");
    const endurance = rawContext.recent_sessions.find((s) => s.date === "2026-10-16");
    expect(endurance).toEqual({ date: "2026-10-16", intervention: expect.objectContaining({ kind: "AEROBIC_BASE", load_profile: "MODERATE" }), completion_status: "done" });
  });
});
