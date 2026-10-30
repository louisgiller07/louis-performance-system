/**
 * BETA-V2-TECH-01 T2 (HPM 2026-10-28, candidate) — the generation switch never lifts the DH protection of V2 plans
 * already accepted. Through the daily-run Edge Function itself (local runtime, the rider's JWT), for the runtime named
 * by NALYNT_TEST_EDGE_V2_MODE: "off" (the emergency cut: NALYNT_V2_PLAN_GENERATION_ENABLED absent) and "on_unsigned"
 * (switch on, the real bundle, nothing signed). A V2 plan accepted BEFORE the units existed (generated without
 * dhUnit: legacy unit-less passes) must never be served as an executable DH count: its DH day is blocked
 * (dh_repetition_unit_unknown), no final prescription, nothing to start. Its Force day, and a V1 rider, are unaffected.
 * Counter-proof: before T2, the "off" runtime served that DH day as created (the requirement followed the switch).
 * Opt-in: RUN_LOCAL_P0_EDGE=1 and NALYNT_TEST_EDGE_V2_MODE "off" or "on_unsigned".
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, getAthleteAuthClient, insertCheckin, setAthleteDiscipline } from "./testDb.js";
import { assertLocalDbReady, execLocalSql, localIntegrationRequested, sqlLiteral as lit } from "./localDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { generateAndPersistTrainingPlanV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { generateAndPersistTrainingPlan } from "../../src/supabase/generateAndPersistTrainingPlan.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { addCalendarDays } from "../../src/supabase/productCalendar.js";

const MODE = process.env.NALYNT_TEST_EDGE_V2_MODE;
const ENABLED = localIntegrationRequested({ requirePublishableKey: true }) && process.env.RUN_LOCAL_P0_EDGE === "1" && (MODE === "off" || MODE === "on_unsigned");
const GENERATED_ON = "2026-11-01";

describe.skipIf(!ENABLED)(`BETA-V2-TECH-01 T2 — DH protection of accepted V2 plans over HTTP, runtime "${MODE}"`, { timeout: 240_000 }, () => {
  let admin: SupabaseClient;
  beforeAll(() => {
    assertLocalDbReady();
    admin = createTestClient();
  });

  async function invoke(client: SupabaseClient, body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
    const { data, error } = await client.functions.invoke("daily-run", { body });
    if (!error) return { status: 200, body: data as Record<string, unknown> };
    if (error instanceof FunctionsHttpError) {
      const res = error.context as Response;
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    }
    throw error;
  }
  async function rider(label: string) {
    const { athleteId } = await createTestAthlete(admin, `T2 DH protection ${MODE} ${label} ${randomUUID().slice(0, 6)}`);
    await setAthleteDiscipline(admin, athleteId, "Downhill");
    await upsertPerformanceProfileFor(admin, athleteId, {
      strength_experience_tier: "intermediate",
      equipment: ["dumbbells", "bench"],
      terrain_access: ["flow_trail", "bermed_trail", "full_dh_track"],
      declared_limitations: [],
      technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering"] },
      dh_technical_tier: "intermediate",
    });
    for (const d of [0, 1, 2, 3, 4, 5, 6]) await insertAvailabilityWindow(admin, athleteId, { day_of_week: d, start_time: "08:00:00", end_time: "20:00:00" });
    return athleteId;
  }
  const firstDayOf = (athleteId: string, kinds: string[]) =>
    execLocalSql(`select min(planned_date)::text from public.planned_sessions where athlete_id = ${lit(athleteId)} and intervention->>'kind' in (${kinds.map(lit).join(", ")});`).trim();
  const prescriptionsOf = (decisionId: string) => execLocalSql(`select count(*) from public.decision_final_prescriptions where decision_id = ${lit(decisionId)};`).trim();

  it("a V2 plan accepted without units: its DH day is blocked (dh_repetition_unit_unknown), no final prescription; its Force day is served", async () => {
    const athleteId = await rider("v2 legacy");
    execLocalSql(`insert into public.training_plan_model_assignments (athlete_id, planning_model, note) values (${lit(athleteId)}, 'v2', 'T2 test account');`);
    // Generated as before V2-DH-UNIT-01 (no dhUnit): DH counts stated in unit-less passes, the case of plans already accepted.
    const plan = await generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 2, today: GENERATED_ON });
    if (plan.status !== "persisted") throw new Error(`legacy V2 plan: ${plan.status}`);
    await acceptTrainingPlanVersion(admin, athleteId, plan.planVersionId, addCalendarDays(GENERATED_ON, 1), addCalendarDays(GENERATED_ON, 14));
    const client = await getAthleteAuthClient(athleteId);

    const dhDay = firstDayOf(athleteId, ["DH_TECHNICAL"]);
    expect(dhDay).not.toBe("");
    await insertCheckin(admin, athleteId, dhDay);
    const dh = await invoke(client, { date: dhDay });
    const dhOut = { status: dh.status, finalPrescriptionStatus: dh.body.finalPrescriptionStatus, trace: JSON.stringify([dh.body.finalPrescriptionStatusCode, dh.body.finalPrescriptionStatusDetail]).includes("dh_repetition_unit_unknown") };
    expect(dhOut).toEqual({ status: 200, finalPrescriptionStatus: "blocked", trace: true });
    const dhDecision = execLocalSql(`select id from public.decisions where athlete_id = ${lit(athleteId)} and decision_date = ${lit(dhDay)} order by created_at desc limit 1;`).trim();
    expect(prescriptionsOf(dhDecision)).toBe("0");

    const forceDay = firstDayOf(athleteId, ["STRENGTH_LOWER", "STRENGTH_UPPER"]);
    await insertCheckin(admin, athleteId, forceDay);
    const force = await invoke(client, { date: forceDay });
    expect([force.status, force.body.finalPrescriptionStatus]).toEqual([200, "created"]);
  });

  it("a V1 rider is not concerned: its DH day follows the V1 path (no V2 final prescription status)", async () => {
    const athleteId = await rider("v1");
    execLocalSql(`insert into public.training_plan_model_assignments (athlete_id, planning_model, note, decided_by) values (${lit(athleteId)}, 'v1', 'T2 V1 test account', 'TEST operator (not a real decision)');`);
    const plan = await generateAndPersistTrainingPlan({ client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 2, today: GENERATED_ON });
    await acceptTrainingPlanVersion(admin, athleteId, plan.planVersionId, addCalendarDays(GENERATED_ON, 1), addCalendarDays(GENERATED_ON, 14));
    const dhDay = firstDayOf(athleteId, ["DH_TECHNICAL"]);
    expect(dhDay).not.toBe("");
    await insertCheckin(admin, athleteId, dhDay);
    const out = await invoke(await getAthleteAuthClient(athleteId), { date: dhDay });
    expect([out.status, out.body.finalPrescriptionStatus]).toEqual([200, undefined]);
  });
});
