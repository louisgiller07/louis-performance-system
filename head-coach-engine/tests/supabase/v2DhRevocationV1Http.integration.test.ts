/**
 * V2-DH-REVOCATION (PR2-DH-REVOCATION-PREP, HPM 2026-10-27) — V1, authenticated, end to end over the real Edge runtime,
 * on a database carrying migration 20261027120000: the rider's own JWT through generate-training-plan,
 * accept-training-plan, daily-run and completed-session, then what is persisted. The revocation changes nothing for V1:
 * a V1 plan, a V1 decision without any final prescription, a V1 debrief; nothing V2 written, the revocation table
 * neither read for a refusal nor written. Opt-in: RUN_LOCAL_P0_EDGE=1, the runtime served (`supabase start` with the
 * edge runtime, or `supabase functions serve`), V2 generation off (the stack's default).
 * Since BETA-V2-TECH-01 B the rider holds an explicit, traced v1 assignment (integration S2): without it, a 403.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, getAthleteAuthClient, insertCheckin, setAthleteDiscipline } from "./testDb.js";
import { assertLocalDbReady, execLocalSql, localIntegrationRequested, sqlLiteral } from "./localDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";

const ENABLED = localIntegrationRequested({ requirePublishableKey: true }) && process.env.RUN_LOCAL_P0_EDGE === "1";

async function call(client: SupabaseClient, fn: string, body: Record<string, unknown>, method: "POST" | "PUT" = "POST"): Promise<{ status: number; body: Record<string, any> }> {
  const { data, error } = await client.functions.invoke(fn, { body, method });
  if (!error) return { status: 200, body: data as Record<string, any> };
  if (error instanceof FunctionsHttpError) {
    const response = error.context as Response;
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  }
  throw error;
}

describe.skipIf(!ENABLED)("V2-DH-REVOCATION — V1 end to end over HTTP with the rider's JWT (local Edge runtime, migration 20261027120000)", { timeout: 240_000 }, () => {
  let admin: SupabaseClient;
  let rider: SupabaseClient;
  let athleteId: string;
  let planVersionId: string;
  let day: string;
  let decisionId: string;
  const count = (sql: string) => execLocalSql(sql).trim();
  const own = (table: string, extra = "") => count(`select count(*) from public.${table} where athlete_id = ${sqlLiteral(athleteId)}${extra};`);
  let revocationsBefore: string;

  beforeAll(async () => {
    assertLocalDbReady();
    if (count("select to_regclass('public.dh_drill_revocations') is null;") === "t") throw new Error("migration 20261027120000 is not applied on this stack");
    revocationsBefore = count("select count(*) from public.dh_drill_revocations;");
    admin = createTestClient();
    athleteId = (await createTestAthlete(admin, "V2-DH-REVOCATION V1 over HTTP")).athleteId;
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
    // BETA-V2-TECH-01 B: no assignment is a 403, never V1 by default; this V1 rider is an explicit, traced exemption.
    execLocalSql(`insert into public.training_plan_model_assignments (athlete_id, planning_model, note, decided_by) values (${sqlLiteral(athleteId)}, 'v1', 'V2-DH-REVOCATION V1 test account', 'TEST operator (not a real decision)');`);
    rider = await getAthleteAuthClient(athleteId);
  }, 120_000);

  it("generate-training-plan: a V1 plan (V2 generation off), persisted for the rider", async () => {
    const r = await call(rider, "generate-training-plan", { generationRequestId: randomUUID(), durationWeeks: 2 });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    planVersionId = r.body.planVersionId;
    expect(planVersionId).toEqual(expect.any(String));
    expect(count(`select prescription_schema_version || '|' || athlete_id from public.training_plan_versions where id = ${sqlLiteral(planVersionId)};`)).toBe(`v1|${athleteId}`);
  });

  it("accept-training-plan: the V1 plan becomes current", async () => {
    const r = await call(rider, "accept-training-plan", { planVersionId });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    expect(count(`select plan_version_id from public.training_plan_current_version where athlete_id = ${sqlLiteral(athleteId)};`)).toBe(planVersionId);
  });

  it("daily-run: a V1 decision for a planned day, no final prescription (the V2 path and the revocation table are never reached)", async () => {
    day = count(`select min(date)::text from public.training_plan_generated_sessions where plan_version_id = ${sqlLiteral(planVersionId)};`);
    expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await insertCheckin(admin, athleteId, day);
    const r = await call(rider, "daily-run", { date: day });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    expect(r.body).not.toHaveProperty("finalPrescriptionStatus");
    decisionId = r.body.decisionId;
    expect(decisionId).toEqual(expect.any(String));
    expect(count(`select athlete_id || '|' || decision_date || '|' || (final_prescription_status is null) from public.decisions where id = ${sqlLiteral(decisionId)};`)).toBe(`${athleteId}|${day}|true`);
    expect(own("decisions", ` and decision_date = ${sqlLiteral(day)}`)).toBe("1");
    expect(own("decision_final_prescriptions")).toBe("0");
  });

  it("completed-session: the V1 debrief of the day is recorded", async () => {
    const r = await call(
      rider,
      "completed-session",
      {
        session_date: day,
        decision_id: null,
        session_type: "RECOVERY",
        completion_status: "done",
        actual_duration_min: 42,
        rpe: 6,
        post_leg_fatigue: 3,
        post_grip_fatigue: 2,
        new_pain: false,
        new_pain_note: null,
        intervention: { kind: "RECOVERY_ACTIVE" },
        main_content: null,
      },
      "PUT"
    );
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    expect(own("completed_sessions", ` and session_date = ${sqlLiteral(day)}`)).toBe("1");
  });

  it("nothing V2 for the rider, and the revocation table untouched", () => {
    expect(count(`select count(*) from public.training_plan_versions where athlete_id = ${sqlLiteral(athleteId)} and prescription_schema_version = 'v2';`)).toBe("0");
    expect([own("decision_final_prescriptions"), own("session_executions")]).toEqual(["0", "0"]);
    expect(count("select count(*) from public.dh_drill_revocations;")).toBe(revocationsBefore);
  });
});
