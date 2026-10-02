/**
 * UX-11R.2 — server-side V2 rollout (global switch + athlete assignment) on
 * the local Supabase stack, through the single server generation entry the
 * Edge Function calls (generateTrainingPlanForAthlete).
 *
 * A = internal V2 pilot (assignment v2), B = V1 control (no assignment).
 * Both have V2-ready profiles: the profile never triggers V2.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, getAthleteAuthClient, insertCheckin, setAthleteDiscipline, type TestAthlete } from "./testDb.js";
import { assertLocalDbReady, execLocalSql, localIntegrationRequested, sqlLiteral } from "./localDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { runDailyFor } from "../../src/supabase/runDailyFor.js";
import { computeDailyFor } from "../../src/supabase/computeDailyFor.js";
import { generateTrainingPlanForAthlete } from "../../src/generation/generateTrainingPlanForAthlete.js";
import { purgeAthleteAccount } from "../../src/supabase/purgeAthleteAccount.js";

const INTEGRATION_ENABLED = localIntegrationRequested({ requirePublishableKey: true });
const TODAY = "2026-10-05";

describe.skipIf(!INTEGRATION_ENABLED)("UX-11R.2 — server-side V2 rollout flag (local Supabase)", () => {
  let admin: SupabaseClient;
  let a: TestAthlete;
  let b: TestAthlete;

  async function v2ReadyAthlete(label: string): Promise<TestAthlete> {
    const athlete = await createTestAthlete(admin, `R2 rollout ${label}`);
    await setAthleteDiscipline(admin, athlete.athleteId, "Downhill");
    await upsertPerformanceProfileFor(admin, athlete.athleteId, {
      strength_experience_tier: "intermediate",
      equipment: ["dumbbells", "bench"],
      terrain_access: ["flow_trail", "bermed_trail"],
      declared_limitations: [],
      technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
      dh_technical_tier: "intermediate",
    });
    for (const d of [0, 1, 2, 3, 4, 5, 6]) await insertAvailabilityWindow(admin, athlete.athleteId, { day_of_week: d, start_time: "08:00:00", end_time: "20:00:00" });
    return athlete;
  }
  const assign = (athleteId: string, model: "v1" | "v2" | null) =>
    model === null
      ? execLocalSql(`delete from public.training_plan_model_assignments where athlete_id = ${sqlLiteral(athleteId)};`)
      : execLocalSql(`insert into public.training_plan_model_assignments (athlete_id, planning_model, note) values (${sqlLiteral(athleteId)}, '${model}', 'R2 test')
  on conflict (athlete_id) do update set planning_model = excluded.planning_model;`);
  const generate = (athleteId: string, globalV2Enabled: boolean, generationRequestId = randomUUID()) =>
    generateTrainingPlanForAthlete({ client: admin, athleteId, generationRequestId, durationWeeks: 2, today: TODAY, globalV2Enabled });
  const schemaOf = async (planVersionId: string) =>
    ((await admin.from("training_plan_versions").select("prescription_schema_version").eq("id", planVersionId).single()).data as { prescription_schema_version: string }).prescription_schema_version;
  const versionsSnapshot = (athleteId: string) =>
    execLocalSql(`select coalesce(string_agg(md5(to_jsonb(v)::text), ',' order by v.id), '') from public.training_plan_versions v where athlete_id = ${sqlLiteral(athleteId)};`).trim();

  beforeAll(async () => {
    assertLocalDbReady();
    admin = createTestClient();
    a = await v2ReadyAthlete("A pilot");
    b = await v2ReadyAthlete("B control");
    assign(a.athleteId, "v2");
  }, 120_000);

  it("the migration assigns nobody: B has no row; A's row exists only because the operator inserted it", () => {
    expect(execLocalSql(`select count(*) from public.training_plan_model_assignments where athlete_id = ${sqlLiteral(b.athleteId)};`).trim()).toBe("0");
  });

  it("global OFF: A (assigned v2) → V1, B → V1", async () => {
    for (const athlete of [a, b]) {
      const r = await generate(athlete.athleteId, false);
      expect(r).toMatchObject({ planningModel: "v1", reason: "global_v2_disabled", status: "persisted" });
      if (r.status === "persisted") expect(await schemaOf(r.planVersionId)).toBe("v1");
    }
  }, 120_000);

  it("global ON: A → V2 (persisted V2 plan), B → V1 (V2-ready profile never triggers V2)", async () => {
    const ra = await generate(a.athleteId, true);
    expect(ra).toMatchObject({ planningModel: "v2", reason: "assigned_v2", status: "persisted" });
    if (ra.status === "persisted") expect(await schemaOf(ra.planVersionId)).toBe("v2");
    const rb = await generate(b.athleteId, true);
    expect(rb).toMatchObject({ planningModel: "v1", reason: "default_v1", status: "persisted" });
    if (rb.status === "persisted") expect(await schemaOf(rb.planVersionId)).toBe("v1");
  }, 120_000);

  it("replays: same request id in the same environment → the same version (V1 and V2)", async () => {
    const r2 = randomUUID();
    const first = await generate(a.athleteId, true, r2);
    const replay = await generate(a.athleteId, true, r2);
    expect(first.status === "persisted" && replay.status === "persisted" && replay.planVersionId === first.planVersionId && replay.idempotentReplay).toBe(true);
    const r1 = randomUUID();
    const v1 = await generate(b.athleteId, true, r1);
    const v1Replay = await generate(b.athleteId, true, r1);
    expect(v1.status === "persisted" && v1Replay.status === "persisted" && v1Replay.planVersionId === v1.planVersionId && v1Replay.idempotentReplay).toBe(true);
  }, 120_000);

  it("the model changes between two calls with the same request id → refused (different generation environment), nothing rewritten", async () => {
    const r = randomUUID();
    const v1 = await generate(a.athleteId, false, r);
    expect(v1).toMatchObject({ planningModel: "v1", status: "persisted" });
    const before = versionsSnapshot(a.athleteId);
    await expect(generate(a.athleteId, true, r)).rejects.toThrow(/different generation environment/);
    expect(versionsSnapshot(a.athleteId)).toBe(before);

    const r2 = randomUUID();
    expect(await generate(a.athleteId, true, r2)).toMatchObject({ planningModel: "v2", status: "persisted" });
    const before2 = versionsSnapshot(a.athleteId);
    await expect(generate(a.athleteId, false, r2)).rejects.toThrow(/different generation environment/);
    expect(versionsSnapshot(a.athleteId)).toBe(before2);
  }, 120_000);

  it("global rollback after a real V2 plan: A's Daily and guided session stay V2, A's NEW generation is V1, B stays V1", async () => {
    const v2 = await generate(a.athleteId, true);
    if (v2.status !== "persisted") throw new Error("V2 plan expected");
    await acceptTrainingPlanVersion(admin, a.athleteId, v2.planVersionId, TODAY, "2026-10-18");

    // Daily on the V2 plan, then a guided execution completed on a created final prescription.
    let executed: string | null = null;
    for (const day of ["2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]) {
      await insertCheckin(admin, a.athleteId, day);
      const run = await runDailyFor(admin, a.athleteId, day);
      expect(run.finalPrescriptionStatus, day).toBeDefined(); // V2 daily path
      if (run.finalPrescriptionStatus !== "created" || executed) continue;
      const { data: fp } = await admin.from("decision_final_prescriptions").select("id, structure").eq("decision_id", run.persistence.decision_id).single();
      const structure = fp!.structure as { family: string; activitySelection?: { activityIds: string[] }; blocks: Array<{ role: string; items: Array<{ prescriptionItemId: string; measure: { type: string } }> }> };
      const exec = randomUUID();
      const main = structure.blocks.find((bl) => bl.role === "main")!.items[0];
      const results =
        structure.family === "endurance"
          ? { activities: [{ id: randomUUID(), execution_id: exec, activity_id: structure.activitySelection!.activityIds[0], duration_seconds: 2400, occurred_at: `${day}T17:30:00Z` }] }
          : { sets: [{ id: randomUUID(), execution_id: exec, prescription_item_id: main!.prescriptionItemId, set_number: 1, done: true, measure_type: main!.measure.type, measure_value: main!.measure.type === "pass" ? null : 8, occurred_at: `${day}T17:30:00Z` }] };
      const { data, error } = await admin.rpc("record_session_execution", {
        p_athlete_id: a.athleteId,
        p_payload: {
          execution: { id: exec, session_date: day, started_at: `${day}T17:00:00Z`, final_prescription_id: fp!.id },
          events: [{ id: randomUUID(), execution_id: exec, event_type: "started", occurred_at: `${day}T17:00:00Z` }, { id: randomUUID(), execution_id: exec, event_type: "completed", occurred_at: `${day}T18:00:00Z` }],
          ...results,
        },
      });
      expect(error).toBeNull();
      expect((data as { status: string }).status).toBe("ok");
      executed = day;
    }
    expect(executed).not.toBeNull();

    // Global OFF: a NEW generation of A is V1; the V2 plan stays current → Daily stays V2.
    const v1 = await generate(a.athleteId, false);
    expect(v1).toMatchObject({ planningModel: "v1", reason: "global_v2_disabled", status: "persisted" });
    await insertCheckin(admin, a.athleteId, "2026-10-10");
    const after = await runDailyFor(admin, a.athleteId, "2026-10-10");
    expect(after.finalPrescriptionStatus).toBeDefined();
    const current = (await admin.from("training_plan_current_version").select("plan_version_id").eq("athlete_id", a.athleteId).single()).data!.plan_version_id;
    expect(current).toBe(v2.planVersionId);
    // M1 feedback: the completed guided execution counts in the next Daily.
    const { rawContext } = await computeDailyFor(admin, a.athleteId, "2026-10-10");
    expect(rawContext.recent_sessions.some((s) => s.date === executed && s.completion_status === "done")).toBe(true);
    // B stays V1.
    expect(await generate(b.athleteId, false)).toMatchObject({ planningModel: "v1" });
  }, 240_000);

  it("individual rollback: global ON, A reassigned to v1 → V1; earlier V2 versions untouched", async () => {
    const before = versionsSnapshot(a.athleteId);
    assign(a.athleteId, "v1");
    const r = await generate(a.athleteId, true);
    expect(r).toMatchObject({ planningModel: "v1", reason: "assigned_v1", status: "persisted" });
    // Every earlier version (V1 and V2) is still there, byte for byte; only the new V1 version was added.
    const after = versionsSnapshot(a.athleteId).split(",");
    for (const hash of before.split(",")) expect(after).toContain(hash);
    expect(after).toHaveLength(before.split(",").length + 1);
    assign(a.athleteId, "v2");
  }, 120_000);

  it("security: an authenticated rider can neither read nor write any assignment (own or other)", async () => {
    const rider = await getAthleteAuthClient(a.athleteId);
    const select = await rider.from("training_plan_model_assignments").select("*");
    expect(select.error?.code).toBe("42501");
    expect((await rider.from("training_plan_model_assignments").insert({ athlete_id: b.athleteId, planning_model: "v2" })).error?.code).toBe("42501");
    expect((await rider.from("training_plan_model_assignments").insert({ athlete_id: a.athleteId, planning_model: "v1" })).error?.code).toBe("42501");
    expect((await rider.from("training_plan_model_assignments").update({ planning_model: "v1" }).eq("athlete_id", a.athleteId)).error?.code).toBe("42501");
    expect((await rider.from("training_plan_model_assignments").delete().eq("athlete_id", a.athleteId)).error?.code).toBe("42501");
    expect(execLocalSql(`select planning_model from public.training_plan_model_assignments where athlete_id = ${sqlLiteral(a.athleteId)};`).trim()).toBe("v2");
  });

  it("purge: A (assignment v2 + V2 plan + executions) leaves nothing; B (with an assignment) is intact", async () => {
    assign(b.athleteId, "v1");
    const bBefore = execLocalSql(`select planning_model || ':' || created_at from public.training_plan_model_assignments where athlete_id = ${sqlLiteral(b.athleteId)};`).trim();
    const result = await purgeAthleteAccount(admin, a.athleteId);
    expect(result.deleted.training_plan_model_assignments).toBe(1);
    expect(execLocalSql(`select count(*) from public.training_plan_model_assignments where athlete_id = ${sqlLiteral(a.athleteId)};`).trim()).toBe("0");
    expect(execLocalSql(`select count(*) from public.athletes where id = ${sqlLiteral(a.athleteId)};`).trim()).toBe("0");
    expect(execLocalSql(`select planning_model || ':' || created_at from public.training_plan_model_assignments where athlete_id = ${sqlLiteral(b.athleteId)};`).trim()).toBe(bBefore);
  }, 120_000);
});
