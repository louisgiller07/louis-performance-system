/**
 * P0-2 — DH TERRAIN COMPATIBILITY (HPM 2026-10-13): the five mandate profiles on the real first-generation path
 * (local Supabase): onboarding rows → snapshot → V2 planner → persisted plan → read back → idempotent replay.
 *
 * Same content rules as the P0 matrix (contentViolations): every drill ridden on a declared compatible terrain,
 * never above the rider's DH level; equipment owned; sessions inside the declared windows; no duplicate.
 * Plus, per profile: generated at the FIRST attempt, every declared priority worked, the exact drills expected.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, getAthleteAuthClient, setAthleteDiscipline } from "./testDb.js";
import { localIntegrationRequested } from "./localDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow, type AthleteAvailabilityWindowInsert } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { generateAndPersistTrainingPlanV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { SESSION_DRILL_CATALOG_V2 } from "planning-engine";
import { REVIEW_PROFILE, REVIEW_WINDOWS } from "./p0FirstGeneration.integration.test.js";
import { contentViolations, type MatrixProfile } from "./p0FirstGenerationMatrix.integration.test.js";

const INTEGRATION_ENABLED = localIntegrationRequested();
/** Opt-in, like the P0 Edge suite: RUN_LOCAL_P0_EDGE=1 with the runtime served (NALYNT_V2_PLAN_GENERATION_ENABLED=true). */
const EDGE_ENABLED = localIntegrationRequested({ requirePublishableKey: true }) && process.env.RUN_LOCAL_P0_EDGE === "1";
const TODAY = "2026-10-12";
const w = (day: number, start: string, end: string, activity: "physical" | "riding"): AthleteAvailabilityWindowInsert => ({ day_of_week: day, start_time: start, end_time: end, activity });
const FULL_GYM = ["barbell", "squat_rack", "dumbbells", "bench", "pull_up_bar", "resistance_bands", "cable_machine"];

export const P0_2_PROFILES: (MatrixProfile & { expectedDrills: string[] })[] = [
  {
    name: "A — national advanced, bike park + full DH track (cornering, braking, race execution)",
    profile: { strength_experience_tier: "advanced", equipment: FULL_GYM, terrain_access: ["bike_park_jump_line", "full_dh_track"], declared_limitations: [], technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking", "race_execution"] }, dh_technical_tier: "advanced" },
    // Review A: physical Mon 90 / Wed 90 / Thu 75; riding Sat + Sun half-day.
    windows: [w(1, "17:00", "18:30", "physical"), w(3, "17:00", "18:30", "physical"), w(4, "17:00", "18:15", "physical"), w(6, "08:00", "12:00", "riding"), w(0, "08:00", "12:00", "riding")],
    weeks: 6,
    // HPM option E: no off-camber section declared → the general advanced cornering alternative.
    expectedDrills: ["braking_marked_zone_at_speed", "cornering_advanced_line_exit", "race_execution_full_run_sim"],
  },
  {
    name: "B — beginner, full DH track only (braking, cornering, line choice)",
    profile: { strength_experience_tier: "beginner", equipment: ["resistance_bands"], terrain_access: ["full_dh_track"], declared_limitations: [], technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["braking", "cornering", "line_choice"] }, dh_technical_tier: "beginner" },
    windows: [w(2, "18:00", "18:30", "physical"), w(4, "18:00", "18:45", "physical"), w(6, "09:00", "11:00", "riding")],
    weeks: 6,
    expectedDrills: ["braking_progressive_control", "cornering_flat_turn_precision", "line_choice_two_line_scan"],
  },
  {
    name: "C — beginner, flow trail only (braking, cornering, race execution)",
    profile: { strength_experience_tier: "beginner", equipment: ["resistance_bands"], terrain_access: ["flow_trail"], declared_limitations: [], technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["braking", "cornering", "race_execution"] }, dh_technical_tier: "beginner" },
    windows: [w(2, "18:00", "18:30", "physical"), w(4, "18:00", "18:45", "physical"), w(6, "09:00", "11:00", "riding")],
    weeks: 6,
    expectedDrills: ["braking_progressive_control", "cornering_flat_turn_precision", "race_execution_section_consistency"],
  },
  {
    name: "D — amateur, the exact 9 October profile",
    profile: REVIEW_PROFILE(["technical_trail", "root_rock_trail", "full_dh_track"], ["cornering", "braking"]),
    windows: REVIEW_WINDOWS,
    weeks: 6,
    expectedDrills: ["braking_late_entry", "cornering_berm_speed"],
  },
  {
    name: "E — national, the Astra review profile (5 terrains)",
    // Astra review §7: national, advanced DH, intermediate strength; priorities cornering, braking, roots/rocks; Mon 75 / Tue 90 / Thu 75 physical, Sat 240 / Sun 180 riding.
    profile: { strength_experience_tier: "intermediate", equipment: ["barbell", "squat_rack", "dumbbells", "bench", "cable_machine", "resistance_bands"], terrain_access: ["bermed_trail", "technical_trail", "root_rock_trail", "bike_park_jump_line", "full_dh_track"], declared_limitations: [], technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking", "roots_rocks"] }, dh_technical_tier: "advanced" },
    windows: [w(1, "18:00", "19:15", "physical"), w(2, "18:00", "19:30", "physical"), w(4, "18:00", "19:15", "physical"), w(6, "08:00", "12:00", "riding"), w(0, "09:00", "12:00", "riding")],
    weeks: 6,
    // Documented difference (P0-2): a technical trail alone no longer confirms an off-camber section.
    expectedDrills: ["braking_marked_zone_at_speed", "cornering_advanced_line_exit", "roots_rocks_committed"],
  },
  {
    name: "E' — the Astra profile with the off-camber section declared",
    profile: { strength_experience_tier: "intermediate", equipment: ["barbell", "squat_rack", "dumbbells", "bench", "cable_machine", "resistance_bands"], terrain_access: ["bermed_trail", "technical_trail", "root_rock_trail", "bike_park_jump_line", "full_dh_track", "off_camber_section"], declared_limitations: [], technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking", "roots_rocks"] }, dh_technical_tier: "advanced" },
    windows: [w(1, "18:00", "19:15", "physical"), w(2, "18:00", "19:30", "physical"), w(4, "18:00", "19:15", "physical"), w(6, "08:00", "12:00", "riding"), w(0, "09:00", "12:00", "riding")],
    weeks: 6,
    expectedDrills: ["braking_marked_zone_at_speed", "cornering_off_camber", "roots_rocks_committed"],
  },
];

type Item = { kind: string; drillId?: string };
const drillsOf = (plan: { weeks: { sessions: { plannedPrescription: { structure: unknown } }[] }[] }): string[] =>
  [...new Set(plan.weeks.flatMap((wk) => wk.sessions.flatMap((s) => ((s.plannedPrescription.structure as { blocks?: { items?: Item[] }[] }).blocks ?? []).flatMap((b) => b.items ?? []).filter((i) => i.kind === "drill").map((i) => i.drillId!))))].sort();

describe.skipIf(!INTEGRATION_ENABLED)("P0-2 — DH terrain compatibility, profiles A–E (local DB)", { timeout: 240_000 }, () => {
  let admin: SupabaseClient;
  beforeAll(() => {
    admin = createTestClient();
  });

  it("every profile generates at the first attempt, works every declared priority on a declared terrain, persists and replays", async () => {
    const report: Record<string, unknown> = {};
    for (const p of P0_2_PROFILES) {
      const athlete = await createTestAthlete(admin, `P0-2 ${randomUUID().slice(0, 6)}`);
      await setAthleteDiscipline(admin, athlete.athleteId, "Downhill");
      await upsertPerformanceProfileFor(admin, athlete.athleteId, p.profile);
      for (const win of p.windows) await insertAvailabilityWindow(admin, athlete.athleteId, win);
      const requestId = randomUUID();
      const first = await generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId: athlete.athleteId, generationRequestId: requestId, durationWeeks: p.weeks, today: TODAY });
      if (first.status !== "persisted") {
        report[p.name] = { outcome: `blocked:${first.code}`, detail: first.detail };
        continue;
      }
      const { count } = await admin.from("training_plan_generated_sessions").select("id", { count: "exact", head: true }).eq("plan_version_id", first.planVersionId);
      const generated = first.plan.weeks.reduce((n, wk) => n + wk.sessions.length, 0);
      const replay = await generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId: athlete.athleteId, generationRequestId: requestId, durationWeeks: p.weeks, today: TODAY });
      const plan = first.plan as unknown as Parameters<typeof contentViolations>[0];
      report[p.name] = {
        outcome: "persisted",
        sessions: generated,
        dhSessions: first.plan.weeks.flatMap((wk) => wk.sessions).filter((s) => s.kind === "DH_TECHNICAL").length,
        readBack: count === generated,
        replay: replay.status === "persisted" && replay.idempotentReplay && replay.planVersionId === first.planVersionId,
        drills: drillsOf(first.plan as never),
        drillTerrains: Object.fromEntries(drillsOf(first.plan as never).map((id) => [id, SESSION_DRILL_CATALOG_V2[id]!.compatibleTerrains.filter((t) => (p.profile.terrain_access as string[]).includes(t))])),
        violations: contentViolations(plan, p),
      };
    }
    console.info(JSON.stringify(report, null, 2));
    for (const p of P0_2_PROFILES) {
      const r = report[p.name] as { outcome: string; drills: string[]; violations: string[]; readBack: boolean; replay: boolean };
      expect(r.outcome, p.name).toBe("persisted");
      expect(r.violations, p.name).toEqual([]);
      expect([r.readBack, r.replay], p.name).toEqual([true, true]);
      // Every declared priority is worked; LIGHT weeks may add the catalogue regression of a race-intensity drill.
      const canonical = r.drills.filter((id) => SESSION_DRILL_CATALOG_V2[id]!.technicalTier === (p.profile.dh_technical_tier as string));
      expect(canonical, p.name).toEqual(p.expectedDrills);
    }
  });
});

describe.skipIf(!EDGE_ENABLED)("P0-2 — generate-training-plan over HTTP (local runtime), as a new rider after onboarding", { timeout: 240_000 }, () => {
  let admin: SupabaseClient;
  beforeAll(() => {
    admin = createTestClient();
  });

  async function rider(p: MatrixProfile) {
    const a = await createTestAthlete(admin, `P0-2 edge ${randomUUID().slice(0, 6)}`);
    await setAthleteDiscipline(admin, a.athleteId, "Downhill");
    await upsertPerformanceProfileFor(admin, a.athleteId, p.profile);
    for (const win of p.windows) await insertAvailabilityWindow(admin, a.athleteId, win);
    return { athleteId: a.athleteId, client: await getAthleteAuthClient(a.athleteId) };
  }
  async function generate(client: SupabaseClient, body: Record<string, unknown>) {
    const { data, error } = await client.functions.invoke("generate-training-plan", { body });
    if (!error) return { status: 200, body: data as Record<string, unknown> };
    const response = (error as FunctionsHttpError).context as Response;
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  it("profiles A–E: 200 at the FIRST call, one plan version, the same request replays the same plan", async () => {
    const outcomes: string[] = [];
    for (const p of P0_2_PROFILES) {
      const r = await rider(p);
      const generationRequestId = randomUUID();
      const first = await generate(r.client, { generationRequestId, durationWeeks: p.weeks });
      const again = await generate(r.client, { generationRequestId, durationWeeks: p.weeks });
      const { count } = await admin.from("training_plan_versions").select("id", { count: "exact", head: true }).eq("athlete_id", r.athleteId);
      outcomes.push(`${p.name.slice(0, 1)} ${first.status} replay=${again.status === 200 && again.body.planVersionId === first.body.planVersionId && again.body.idempotentReplay === true} versions=${count}`);
    }
    expect(outcomes).toEqual(["A 200 replay=true versions=1", "B 200 replay=true versions=1", "C 200 replay=true versions=1", "D 200 replay=true versions=1", "E 200 replay=true versions=1", "E 200 replay=true versions=1"]);
  });

  it("intentionally kept: roots / rocks on a full DH track alone stays refused (422, the priority and its compatible terrain), nothing persisted", async () => {
    const p: MatrixProfile = { ...P0_2_PROFILES[1]!, profile: { ...P0_2_PROFILES[1]!.profile, dh_technical_tier: "intermediate", technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["roots_rocks"] } } };
    const r = await rider(p);
    const out = await generate(r.client, { generationRequestId: randomUUID(), durationWeeks: p.weeks });
    expect(out.status).toBe(422);
    expect((out.body as { error: unknown }).error).toMatchObject({ code: "unavailable_dh_drill_terrain", detail: { skill: "roots_rocks", requiredTerrain: "root_rock_trail", compatibleTerrains: ["root_rock_trail"] } });
    const { count } = await admin.from("training_plan_versions").select("id", { count: "exact", head: true }).eq("athlete_id", r.athleteId);
    expect(count).toBe(0);
  });
});
