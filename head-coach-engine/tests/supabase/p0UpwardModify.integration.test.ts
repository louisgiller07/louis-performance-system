/**
 * P0 — M1 UPWARD MODIFY NORMAL PATH, end to end (local Supabase, real M1,
 * real reconciliation, real persist_daily_run_v2 / record_session_execution).
 *
 * The exact Hot Trail reproduction found in A04: riding on Sunday only, Hot
 * Trail (HOT_TRAIL_2DAY, priority A) on Saturday 10-24, the taper DH
 * (DH_TECHNICAL LIGHT) planned on Sunday 10-18 = T-6, where the race
 * protocol recommends DH_TECHNICAL MODERATE.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, insertCheckin, insertRace, isLoopbackSupabaseUrl, resolveTestSupabaseUrl, setAthleteDiscipline } from "./testDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { generateAndPersistTrainingPlanV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { runDailyFor } from "../../src/supabase/runDailyFor.js";
import { PLANNED_LOAD_CAP_RULE_ID } from "../../src/rules/plannedLoadCap.js";
import { V2_TODAY_TIME_CONSTRAINT_RULE_ID } from "../../src/supabase/dailyV2/applyV2TodayTimeConstraint.js";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const INTEGRATION_ENABLED = process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" && !!SERVER_KEY && isLoopbackSupabaseUrl(resolveTestSupabaseUrl());

const T6 = "2026-10-18";

type Plan = { decision: string; final_session: { kind: string; load_profile?: string; duration_min?: number }; triggered_rules: { rule_id: string; detail: string }[]; decision_reasoning?: { rule_id: string }[] };

describe.skipIf(!INTEGRATION_ENABLED)("P0 — Hot Trail T-6: the planned taper DH is never raised (local Supabase)", () => {
  let admin: SupabaseClient;

  /** A fresh rider with the exact A04 reproduction (each test owns its day). */
  async function hotTrailRider(name: string): Promise<{ rider: string; planVersionId: string }> {
    const { athleteId: rider } = await createTestAthlete(admin, name);
    await setAthleteDiscipline(admin, rider, "Downhill");
    await upsertPerformanceProfileFor(admin, rider, {
      strength_experience_tier: "intermediate",
      equipment: ["dumbbells", "bench"],
      terrain_access: ["flow_trail", "bermed_trail"],
      declared_limitations: [],
      technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
      dh_technical_tier: "intermediate",
    });
    for (const d of [1, 2, 3, 4]) await insertAvailabilityWindow(admin, rider, { day_of_week: d, start_time: "18:00:00", end_time: "19:30:00", activity: "physical" });
    await insertAvailabilityWindow(admin, rider, { day_of_week: 0, start_time: "08:00:00", end_time: "18:00:00", activity: "riding" });
    await insertRace(admin, rider, { event_name: "Hot Trail", start_date: "2026-10-24", end_date: "2026-10-25", priority: "A", race_format: "HOT_TRAIL_2DAY" });
    const p = await generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId: rider, generationRequestId: randomUUID(), durationWeeks: 3, today: "2026-10-05" });
    if (p.status !== "persisted") throw new Error("plan");
    await acceptTrainingPlanVersion(admin, rider, p.planVersionId, "2026-10-06", "2026-10-26");
    const { data: dh } = await admin.from("training_plan_generated_sessions").select("kind, load_profile").eq("plan_version_id", p.planVersionId).eq("date", T6).single();
    expect(dh).toEqual({ kind: "DH_TECHNICAL", load_profile: "LIGHT" });
    return { rider, planVersionId: p.planVersionId };
  }
  async function stored(rider: string) {
    const { data } = await admin.from("decisions").select("id, daily_plan, final_prescription_status").eq("athlete_id", rider).eq("decision_date", T6).order("created_at", { ascending: false });
    return data as { id: string; daily_plan: Plan; final_prescription_status: string }[];
  }
  async function finalOf(decisionId: string) {
    const { data } = await admin.from("decision_final_prescriptions").select("id, reconciliation_action, structure").eq("decision_id", decisionId);
    return (data as { id: string; reconciliation_action: string; structure: { sessionKind: string; blocks: { items: { kind: string; measure: { count?: number } }[] }[] } }[])[0];
  }

  beforeAll(() => {
    admin = createTestClient();
  });

  it("A / K / L — KEEP the planned DH LIGHT, executable verbatim copy, traced and explained; a reload reads the same decision and prescription; the guided session can start", async () => {
    const { rider } = await hotTrailRider("P0 Hot Trail T-6");
    await insertCheckin(admin, rider, T6);
    const r = await runDailyFor(admin, rider, T6);
    expect([r.dailyPlan.decision, r.dailyPlan.final_session.kind, r.dailyPlan.final_session.load_profile, r.finalPrescriptionStatus]).toEqual(["KEEP", "DH_TECHNICAL", "LIGHT", "created"]);

    const [row] = await stored(rider);
    expect(row!.final_prescription_status).toBe("created");
    const cap = row!.daily_plan.triggered_rules.find((t) => t.rule_id === PLANNED_LOAD_CAP_RULE_ID);
    expect(cap?.detail).toBe("Séance planifiée DH_TECHNICAL LIGHT — proposition DH_TECHNICAL MODERATE (protocole T-X) plafonnée à la charge planifiée : DH_TECHNICAL LIGHT.");
    expect(row!.daily_plan.decision_reasoning?.map((t) => t.rule_id)).toEqual(["RACE_PROTOCOL_TX", PLANNED_LOAD_CAP_RULE_ID]);
    const fp = await finalOf(row!.id);
    expect([fp!.reconciliation_action, fp!.structure.sessionKind]).toEqual(["keep", "DH_TECHNICAL"]);

    // L — reload: same rows.
    const [again] = await stored(rider);
    expect([again!.id, (await finalOf(again!.id))!.id]).toEqual([row!.id, fp!.id]);

    const id = randomUUID();
    const { data, error } = await admin.rpc("record_session_execution", {
      p_athlete_id: rider,
      p_payload: { execution: { id, session_date: T6, started_at: `${T6}T09:00:00Z`, final_prescription_id: fp!.id }, events: [{ id: randomUUID(), execution_id: id, event_type: "started", occurred_at: `${T6}T09:00:00Z` }] },
    });
    expect(error).toBeNull();
    expect((data as { status: string }).status).toBe("ok");
  });

  it("I — A10 after the cap: 45 min available → the LIGHT DH does not fit (60-min minimum) → active recovery; never a MODERATE step on the way", async () => {
    const { rider } = await hotTrailRider("P0 Hot Trail T-6 + 45 min");
    await insertCheckin(admin, rider, T6, { available_minutes_today: 45 });
    const r = await runDailyFor(admin, rider, T6);
    expect([r.dailyPlan.decision, r.dailyPlan.final_session.kind]).toEqual(["REPLACE", "RECOVERY_ACTIVE"]);
    const [row] = await stored(rider);
    const time = row!.daily_plan.triggered_rules.find((t) => t.rule_id === V2_TODAY_TIME_CONSTRAINT_RULE_ID);
    expect(time?.detail).toMatch(/Avant : KEEP DH_TECHNICAL LIGHT/);
    expect(JSON.stringify(row!.daily_plan.final_session)).not.toContain("MODERATE");
    expect((await finalOf(row!.id))!.structure.sessionKind).toBe("RECOVERY_ACTIVE");
  });

  it("I — A10 with enough time for the planned window (75 min): the LIGHT DH, never more", async () => {
    const { rider } = await hotTrailRider("P0 Hot Trail T-6 + 75 min");
    await insertCheckin(admin, rider, T6, { available_minutes_today: 75 });
    const r = await runDailyFor(admin, rider, T6);
    expect(r.dailyPlan.final_session.load_profile).toBe("LIGHT");
    expect(r.dailyPlan.final_session.kind).toBe("DH_TECHNICAL");
    expect(r.finalPrescriptionStatus).toBe("created");
  });
});
