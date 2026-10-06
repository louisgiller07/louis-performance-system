/**
 * BUG-V2-1 — physical vs riding availability, end to end on the LOCAL Supabase:
 * athlete_availability_windows.activity → buildPlanInputSnapshotV2 → V2 planner →
 * generate_training_plan_version (persisted plan) → read back from the DB.
 * Never production, never the public Edge Function.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, isLoopbackSupabaseUrl, resolveTestSupabaseUrl, setAthleteDiscipline } from "./testDb.js";
import { upsertPerformanceProfileFor, type AthletePerformanceProfileWriteFields } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow, type AthleteAvailabilityWindowInsert } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { generateAndPersistTrainingPlanV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const INTEGRATION_ENABLED = process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" && !!SERVER_KEY && isLoopbackSupabaseUrl(resolveTestSupabaseUrl());

const TODAY = "2026-10-05"; // Monday

const PROFILE: AthletePerformanceProfileWriteFields = {
  strength_experience_tier: "intermediate",
  equipment: ["dumbbells", "bench"],
  terrain_access: ["flow_trail", "bermed_trail"],
  declared_limitations: [],
  technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
  dh_technical_tier: "intermediate",
};

/** Case A — physical Mon 1 h 20, Tue 1 h 30, Thu 1 h 20 (evenings); riding Saturday and Sunday (full days). */
const CASE_A: AthleteAvailabilityWindowInsert[] = [
  { day_of_week: 1, start_time: "18:00", end_time: "19:20", activity: "physical" },
  { day_of_week: 2, start_time: "18:00", end_time: "19:30", activity: "physical" },
  { day_of_week: 4, start_time: "18:00", end_time: "19:20", activity: "physical" },
  { day_of_week: 6, start_time: "08:00", end_time: "18:00", activity: "riding" },
  { day_of_week: 0, start_time: "08:00", end_time: "18:00", activity: "riding" },
];
/** Case E — a legacy athlete: windows written without any activity (DB default 'any'). */
const LEGACY: AthleteAvailabilityWindowInsert[] = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, start_time: "08:00", end_time: "20:00" }));

const dow = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();

describe.skipIf(!INTEGRATION_ENABLED)("BUG-V2-1 — availability reaches the V2 planner and constrains the persisted plan (local Supabase)", () => {
  let admin: SupabaseClient;
  beforeAll(() => {
    admin = createTestClient();
  });

  async function seed(name: string, windows: AthleteAvailabilityWindowInsert[]): Promise<string> {
    const athlete = await createTestAthlete(admin, name);
    await setAthleteDiscipline(admin, athlete.athleteId, "Downhill");
    await upsertPerformanceProfileFor(admin, athlete.athleteId, PROFILE);
    for (const w of windows) await insertAvailabilityWindow(admin, athlete.athleteId, w);
    return athlete.athleteId;
  }

  async function persisted(athleteId: string) {
    const result = await generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 2, today: TODAY });
    if (result.status !== "persisted") throw new Error(`expected a persisted plan, got ${JSON.stringify(result)}`);
    const { data: version, error: vErr } = await admin.from("training_plan_versions").select("input_snapshot, relaxed_constraints").eq("id", result.planVersionId).single();
    if (vErr) throw new Error(vErr.message);
    const { data: sessions, error: sErr } = await admin.from("training_plan_generated_sessions").select("id, date, kind").eq("plan_version_id", result.planVersionId).order("date");
    if (sErr) throw new Error(sErr.message);
    const { data: prescriptions, error: pErr } = await admin
      .from("training_plan_planned_prescriptions")
      .select("generated_plan_session_id, structure")
      .in("generated_plan_session_id", sessions!.map((s) => s.id));
    if (pErr) throw new Error(pErr.message);
    const structureOf = new Map(prescriptions!.map((p) => [p.generated_plan_session_id as string, p.structure as { activitySelection?: { activityIds: string[] } }]));
    return { version: version!, sessions: sessions! as { id: string; date: string; kind: string }[], structureOf };
  }

  it("Case A: the persisted snapshot carries the activity; DH only Sat/Sun, strength only Mon/Tue/Thu, nothing Wed/Fri", async () => {
    const athleteId = await seed("BUG-V2-1 case A", CASE_A);
    const { version, sessions, structureOf } = await persisted(athleteId);

    const windows = (version.input_snapshot as { availability: { windows: { dayOfWeek: number; activity?: string }[] } }).availability.windows;
    expect(windows.map((w) => [w.dayOfWeek, w.activity])).toEqual([
      [0, "riding"],
      [1, "physical"],
      [2, "physical"],
      [4, "physical"],
      [6, "riding"],
    ]);

    expect(sessions.length).toBeGreaterThan(0);
    for (const s of sessions) {
      expect([3, 5]).not.toContain(dow(s.date));
      if (s.kind === "DH_TECHNICAL") expect([6, 0]).toContain(dow(s.date));
      if (s.kind.startsWith("STRENGTH")) expect([1, 2, 4]).toContain(dow(s.date));
      if (s.kind === "AEROBIC_BASE") expect(structureOf.get(s.id)?.activitySelection?.activityIds).toEqual(["home_trainer", "running"]);
    }
    expect(sessions.filter((s) => s.kind === "DH_TECHNICAL").length).toBeGreaterThan(0);
  });

  it("Case E: a legacy athlete (DB default 'any') still generates, with no activity in its snapshot and every endurance option", async () => {
    const athleteId = await seed("BUG-V2-1 legacy", LEGACY);
    const { data: rows } = await admin.from("athlete_availability_windows").select("activity").eq("athlete_id", athleteId);
    expect(new Set(rows!.map((r) => r.activity))).toEqual(new Set(["any"]));

    const { version, sessions, structureOf } = await persisted(athleteId);
    const windows = (version.input_snapshot as { availability: { windows: Record<string, unknown>[] } }).availability.windows;
    expect(windows.every((w) => !("activity" in w))).toBe(true);
    expect(sessions.length).toBeGreaterThan(0);
    for (const s of sessions.filter((x) => x.kind === "AEROBIC_BASE")) {
      expect(structureOf.get(s.id)?.activitySelection?.activityIds).toEqual(["road_bike", "mtb_rolling", "home_trainer", "running"]);
    }
  });

  it("the DB refuses an unknown activity value", async () => {
    const athleteId = await seed("BUG-V2-1 check", []);
    await expect(insertAvailabilityWindow(admin, athleteId, { day_of_week: 1, start_time: "18:00", end_time: "19:00", activity: "swimming" as never })).rejects.toThrow();
  });
});
