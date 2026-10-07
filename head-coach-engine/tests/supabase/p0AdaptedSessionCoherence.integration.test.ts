/**
 * P0 adapted-session coherence, end to end (local Supabase, real M1, real
 * reconciliation, real persist_daily_run_v2). The dogfood profile shape: an
 * advanced DH rider whose priority is race_execution — planned MODERATE DH
 * = « run complet en mode course ». An adaptation to a LIGHT DH must persist
 * a LIGHT mission; a DH replaced by recovery must persist no DH advice.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, insertCheckin, isLoopbackSupabaseUrl, resolveTestSupabaseUrl, setAthleteDiscipline } from "./testDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { generateAndPersistTrainingPlanV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { runDailyFor } from "../../src/supabase/runDailyFor.js";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const INTEGRATION_ENABLED = process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" && !!SERVER_KEY && isLoopbackSupabaseUrl(resolveTestSupabaseUrl());
const RACE_DRILLS = ["braking_marked_zone_at_speed", "line_choice_fast_line_compare", "roots_rocks_committed", "race_execution_split_pace", "race_execution_full_run_sim"];

type Plan = { decision: string; final_session: { kind: string; load_profile?: string }; nutrition: { notes?: string }; recovery: { actions: string[] }; dh_or_technical: { active: boolean }; monitoring: { observe: string[] } };

describe.skipIf(!INTEGRATION_ENABLED)("P0 — adapted sessions persist a mission their load can carry (local Supabase)", () => {
  let admin: SupabaseClient;
  let athleteId: string;
  let planVersionId: string;

  async function dhDays(load: string) {
    const { data } = await admin.from("training_plan_generated_sessions").select("date, load_profile").eq("plan_version_id", planVersionId).eq("kind", "DH_TECHNICAL").eq("load_profile", load).order("date");
    return (data as { date: string }[]).map((r) => r.date);
  }
  async function persisted(day: string) {
    const { data } = await admin.from("decisions").select("id, daily_plan").eq("athlete_id", athleteId).eq("decision_date", day).order("created_at", { ascending: false }).limit(1).single();
    const row = data as { id: string; daily_plan: Plan };
    const { data: fp } = await admin.from("decision_final_prescriptions").select("reconciliation_action, structure").eq("decision_id", row.id);
    const f = (fp as { reconciliation_action: string; structure: { sessionKind: string; blocks: { items: { kind: string; drillId?: string; measure: { count?: number } }[] }[] } }[])[0];
    return { plan: row.daily_plan, fp: f, drills: f ? f.structure.blocks.flatMap((b) => b.items).filter((i) => i.kind === "drill").map((i) => i.drillId!) : [] };
  }

  beforeAll(async () => {
    admin = createTestClient();
    athleteId = (await createTestAthlete(admin, "P0 adapted session coherence")).athleteId;
    await setAthleteDiscipline(admin, athleteId, "Downhill");
    await upsertPerformanceProfileFor(admin, athleteId, {
      strength_experience_tier: "intermediate",
      equipment: ["dumbbells", "bench"],
      terrain_access: ["any_groomed_trail", "technical_trail", "full_dh_track", "flow_trail"],
      declared_limitations: [],
      technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["race_execution"] },
      dh_technical_tier: "advanced",
    });
    for (const d of [0, 1, 2, 3, 4, 5, 6]) await insertAvailabilityWindow(admin, athleteId, { day_of_week: d, start_time: "08:00:00", end_time: "20:00:00" });
    const p = await generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 6, today: "2026-10-04" });
    if (p.status !== "persisted") throw new Error(`plan ${JSON.stringify(p)}`);
    planVersionId = p.planVersionId;
    await acceptTrainingPlanVersion(admin, athleteId, planVersionId, "2026-10-05", "2026-11-15");
  }, 120_000);

  it("the planner: LIGHT DH weeks carry no race mission; MODERATE weeks keep the race drill (E)", async () => {
    const { data } = await admin.from("training_plan_generated_sessions").select("load_profile, training_plan_planned_prescriptions(structure)").eq("plan_version_id", planVersionId).eq("kind", "DH_TECHNICAL");
    for (const row of data as { load_profile: string; training_plan_planned_prescriptions: { structure: { blocks: { items: { kind: string; drillId?: string }[] }[] } }[] }[]) {
      const ids = row.training_plan_planned_prescriptions[0]!.structure.blocks.flatMap((b) => b.items).filter((i) => i.kind === "drill").map((i) => i.drillId!);
      if (row.load_profile === "LIGHT") expect(ids.some((id) => RACE_DRILLS.includes(id))).toBe(false);
      else expect(ids).toEqual(["race_execution_full_run_sim"]);
    }
  });

  it("A / C / G — legs RED on a MODERATE race-mission DH: REPLACE → DH_LIGHT LIGHT persisted with the LIGHT regression drill; a reload reads the same prescription", async () => {
    const [day] = await dhDays("MODERATE");
    await insertCheckin(admin, athleteId, day!, { leg_fatigue: 9 });
    await runDailyFor(admin, athleteId, day!);
    const first = await persisted(day!);
    expect([first.plan.decision, first.plan.final_session.kind, first.plan.final_session.load_profile]).toEqual(["REPLACE", "DH_LIGHT", "LIGHT"]);
    expect(first.drills).toEqual(["race_execution_section_consistency"]);
    expect(RACE_DRILLS.some((id) => first.drills.includes(id))).toBe(false);
    const again = await persisted(day!);
    expect(again.drills).toEqual(first.drills);
  });

  it("E — a MODERATE race-mission DH kept (neutral check-in): the planned race drill, verbatim", async () => {
    const days = await dhDays("MODERATE");
    const day = days[1]!;
    await insertCheckin(admin, athleteId, day);
    await runDailyFor(admin, athleteId, day);
    const r = await persisted(day);
    expect([r.plan.decision, r.drills]).toEqual(["KEEP", ["race_execution_full_run_sim"]]);
  });

  it("Recovery — 30 min on a DH day: active recovery persisted without DH technique, nutrition, recovery or monitoring advice", async () => {
    const day = (await dhDays("MODERATE"))[2]!;
    await insertCheckin(admin, athleteId, day, { available_minutes_today: 30 });
    await runDailyFor(admin, athleteId, day);
    const { plan } = await persisted(day);
    expect(plan.final_session.kind).toBe("RECOVERY_ACTIVE");
    expect(plan.dh_or_technical).toEqual({ active: false });
    expect([plan.nutrition.notes ?? "", ...plan.recovery.actions, ...plan.monitoring.observe].some((t) => /\bDH\b/.test(t))).toBe(false);
  });
});
