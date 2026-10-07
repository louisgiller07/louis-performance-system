/**
 * A07 — the persisted V2 decision describes the EFFECTIVE session (local
 * Supabase, real M1, real reconciliation, real persist_daily_run_v2): the
 * decision's final session (what Today's header, History and Programme read)
 * has the final prescription's duration, traced by V2_EFFECTIVE_SESSION.
 *
 * Plan (generated the eve of 2026-10-05, all-day windows, no history):
 * week 1 = introduction (LIGHT), week 2 = build (MODERATE):
 * DH 10-12/13, LOWER 10-14, UPPER 10-15 (60 min), AEROBIC 10-16.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, insertCheckin, isLoopbackSupabaseUrl, resolveTestSupabaseUrl, setAthleteDiscipline, type CheckinFixture } from "./testDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { generateAndPersistTrainingPlanV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { runDailyFor } from "../../src/supabase/runDailyFor.js";
import { V2_EFFECTIVE_SESSION_RULE_ID } from "../../src/supabase/dailyV2/applyV2EffectiveSession.js";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const INTEGRATION_ENABLED = process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" && !!SERVER_KEY && isLoopbackSupabaseUrl(resolveTestSupabaseUrl());

const SYSTEMIC_RED: CheckinFixture = { sleep_hours: 4, sleep_quality: 2, sleep_wake_ups: 4, energy: 2 };
const LEGS_RED: CheckinFixture = { leg_fatigue: 9 };
const UNSAFE: CheckinFixture = { fever_or_illness: true };

type StoredPlan = { decision: string; final_session: { kind: string; load_profile?: string; duration_min?: number }; training: { duration_min?: number }; triggered_rules: { rule_id: string; detail: string }[] };

describe.skipIf(!INTEGRATION_ENABLED)("A07 — the persisted V2 decision is the effective session (local Supabase)", () => {
  let admin: SupabaseClient;
  let athleteId: string;

  async function storedPlan(day: string): Promise<{ id: string; plan: StoredPlan }> {
    const { data } = await admin.from("decisions").select("id, daily_plan").eq("athlete_id", athleteId).eq("decision_date", day).order("created_at", { ascending: false });
    return { id: data![0]!.id as string, plan: data![0]!.daily_plan as StoredPlan };
  }
  async function finalOf(decisionId: string) {
    const { data } = await admin.from("decision_final_prescriptions").select("id, structure").eq("decision_id", decisionId);
    return data![0] as { id: string; structure: { sessionKind: string } } | undefined;
  }

  beforeAll(async () => {
    admin = createTestClient();
    athleteId = (await createTestAthlete(admin, "A07 effective session")).athleteId;
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
    const persisted = await generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 2, today: "2026-10-04" });
    if (persisted.status !== "persisted") throw new Error("plan");
    await acceptTrainingPlanVersion(admin, athleteId, persisted.planVersionId, "2026-10-05", "2026-10-18");
  }, 90_000);

  it("B — KEEP: the planned session as is (no effective-session trace when nothing differs)", async () => {
    await insertCheckin(admin, athleteId, "2026-10-12");
    const r = await runDailyFor(admin, athleteId, "2026-10-12");
    expect(r.dailyPlan.decision).toBe("KEEP");
    const { plan } = await storedPlan("2026-10-12");
    expect(plan.final_session).toMatchObject({ kind: "DH_TECHNICAL", load_profile: "MODERATE", duration_min: 90 });
    expect(plan.triggered_rules.some((t) => t.rule_id === V2_EFFECTIVE_SESSION_RULE_ID)).toBe(false);
  });

  it("C — MODIFY Force 60 → LIGHT: the stored decision says 45 min (final session and training), traced; its final prescription is that Force", async () => {
    await insertCheckin(admin, athleteId, "2026-10-15", SYSTEMIC_RED);
    const r = await runDailyFor(admin, athleteId, "2026-10-15");
    expect([r.dailyPlan.decision, r.dailyPlan.final_session.duration_min]).toEqual(["MODIFY", 45]);
    const { id, plan } = await storedPlan("2026-10-15");
    expect(plan.final_session).toMatchObject({ kind: "STRENGTH_UPPER", load_profile: "LIGHT", duration_min: 45 });
    expect(plan.training.duration_min).toBe(45);
    expect(plan.triggered_rules.find((t) => t.rule_id === V2_EFFECTIVE_SESSION_RULE_ID)?.detail).toMatch(/45 min/);
    expect((await finalOf(id))!.structure.sessionKind).toBe("STRENGTH_UPPER");
  });

  it("D — MODIFY DH: the DH window M1 decided is kept (passages lowered in the prescription)", async () => {
    await insertCheckin(admin, athleteId, "2026-10-13", SYSTEMIC_RED);
    await runDailyFor(admin, athleteId, "2026-10-13");
    const { plan } = await storedPlan("2026-10-13");
    expect(plan.final_session).toMatchObject({ kind: "DH_TECHNICAL", load_profile: "LIGHT", duration_min: 90 });
  });

  it("E — REPLACE lower → upper (legs RED): the decision and its prescription are the same Force, with the Force's duration", async () => {
    await insertCheckin(admin, athleteId, "2026-10-14", LEGS_RED);
    const r = await runDailyFor(admin, athleteId, "2026-10-14");
    expect(r.dailyPlan.decision).toBe("REPLACE");
    const { id, plan } = await storedPlan("2026-10-14");
    expect(plan.final_session).toMatchObject({ kind: "STRENGTH_UPPER", load_profile: "MODERATE", duration_min: 60 });
    expect((await finalOf(id))!.structure.sessionKind).toBe("STRENGTH_UPPER");
  });

  it("endurance MODIFY: 45 min in the decision, like its prescription", async () => {
    await insertCheckin(admin, athleteId, "2026-10-16", SYSTEMIC_RED);
    await runDailyFor(admin, athleteId, "2026-10-16");
    const { plan } = await storedPlan("2026-10-16");
    expect(plan.final_session).toMatchObject({ kind: "AEROBIC_BASE", load_profile: "LIGHT", duration_min: 45 });
  });

  it("G — REST: no final prescription, the decision is REST (no duration invented)", async () => {
    await insertCheckin(admin, athleteId, "2026-10-17", UNSAFE);
    const r = await runDailyFor(admin, athleteId, "2026-10-17");
    expect([r.dailyPlan.decision, r.finalPrescriptionStatus]).toEqual(["REST", "not_required"]);
    const { id, plan } = await storedPlan("2026-10-17");
    expect(plan.final_session.kind).toBe("REST");
    expect(await finalOf(id)).toBeUndefined();
  });
});
