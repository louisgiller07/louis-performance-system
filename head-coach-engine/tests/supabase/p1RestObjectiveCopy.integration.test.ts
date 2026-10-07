/**
 * P1 REST objective copy — end to end on the V2 daily path (local Supabase,
 * real M1, real runDailyFor personalization, real persist_daily_run_v2): a
 * fever day decided REST persists the SAFETY reasoning alone, never the goal
 * sentence; a KEEP day still carries it.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, insertCheckin, insertOnboardingProfile, isLoopbackSupabaseUrl, resolveTestSupabaseUrl, setAthleteDiscipline } from "./testDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { generateAndPersistTrainingPlanV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { runDailyFor } from "../../src/supabase/runDailyFor.js";
import { resolveGoalRationale } from "../../src/supabase/goalReasoning.js";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const INTEGRATION_ENABLED = process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" && !!SERVER_KEY && isLoopbackSupabaseUrl(resolveTestSupabaseUrl());
const GOAL = "Technical skills";

type Plan = { decision: string; reasoning: string; final_session: { kind: string }; training: { active: boolean }; dh_or_technical: { active: boolean } };

describe.skipIf(!INTEGRATION_ENABLED)("P1 — a REST day carries no goal sentence (local Supabase, V2 path)", () => {
  let admin: SupabaseClient;
  let athleteId: string;
  let planVersionId: string;

  async function dhDays() {
    const { data } = await admin.from("training_plan_generated_sessions").select("date").eq("plan_version_id", planVersionId).eq("kind", "DH_TECHNICAL").order("date");
    return (data as { date: string }[]).map((r) => r.date);
  }
  async function persisted(day: string) {
    const { data } = await admin.from("decisions").select("id, daily_plan, final_prescription_status").eq("athlete_id", athleteId).eq("decision_date", day).order("created_at", { ascending: false }).limit(1).single();
    const row = data as { id: string; daily_plan: Plan; final_prescription_status: string };
    const { count } = await admin.from("decision_final_prescriptions").select("id", { count: "exact", head: true }).eq("decision_id", row.id);
    return { plan: row.daily_plan, fpStatus: row.final_prescription_status, fpRows: count };
  }

  beforeAll(async () => {
    admin = createTestClient();
    athleteId = (await createTestAthlete(admin, "P1 REST objective copy")).athleteId;
    await setAthleteDiscipline(admin, athleteId, "Downhill");
    await insertOnboardingProfile(admin, athleteId, { primary_goal: GOAL });
    await upsertPerformanceProfileFor(admin, athleteId, {
      strength_experience_tier: "intermediate",
      equipment: ["dumbbells", "bench"],
      terrain_access: ["any_groomed_trail", "flow_trail", "bermed_trail", "technical_trail"],
      declared_limitations: [],
      technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering"] },
      dh_technical_tier: "intermediate",
    });
    for (const d of [0, 1, 2, 3, 4, 5, 6]) await insertAvailabilityWindow(admin, athleteId, { day_of_week: d, start_time: "08:00:00", end_time: "20:00:00" });
    const p = await generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 4, today: "2026-10-04" });
    if (p.status !== "persisted") throw new Error(`plan ${JSON.stringify(p)}`);
    planVersionId = p.planVersionId;
    await acceptTrainingPlanVersion(admin, athleteId, planVersionId, "2026-10-05", "2026-11-01");
  }, 120_000);

  it("fever on a planned DH day → REST persisted with the SAFETY reasoning only (no goal sentence), no prescription", async () => {
    const [day] = await dhDays();
    await insertCheckin(admin, athleteId, day!, { fever_or_illness: true });
    await runDailyFor(admin, athleteId, day!);
    const r = await persisted(day!);
    expect([r.plan.decision, r.plan.final_session.kind, r.plan.training.active, r.plan.dh_or_technical.active]).toEqual(["REST", "REST", false, false]);
    expect(r.plan.reasoning).toBe("Fièvre ou maladie déclarée. Repos complet jusqu'à résolution des symptômes.");
    expect(r.plan.reasoning).not.toContain(resolveGoalRationale(GOAL)!);
    expect([r.fpStatus, r.fpRows]).toEqual(["not_required", 0]);
  });

  it("a neutral day (KEEP): the goal sentence is still appended", async () => {
    const day = (await dhDays())[1]!;
    await insertCheckin(admin, athleteId, day);
    await runDailyFor(admin, athleteId, day);
    const r = await persisted(day);
    expect(r.plan.decision).toBe("KEEP");
    expect(r.plan.reasoning.endsWith(`\n\n${resolveGoalRationale(GOAL)}`)).toBe(true);
  });
});
