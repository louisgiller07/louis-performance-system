/**
 * UX-11A.5b.5b — LOCAL persistence of complete V2 plans through the existing
 * transactional RPC `generate_training_plan_version` (real local Supabase).
 * Explicit V2 path only (`planningModel: "v2"`); nothing here touches the
 * public Edge Function or production.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PLAN_DOSE_POLICY_V2 } from "planning-engine";
import {
  createTestAthlete,
  createTestClient,
  insertCompletedSession,
  insertRace,
  isLoopbackSupabaseUrl,
  resolveTestSupabaseUrl,
  setAthleteDiscipline,
} from "./testDb.js";
import { upsertPerformanceProfileFor, type AthletePerformanceProfileWriteFields } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { generateAndPersistTrainingPlan } from "../../src/supabase/generateAndPersistTrainingPlan.js";
import { generateAndPersistTrainingPlanV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { getPlannedPrescriptionForGeneratedSession } from "../../src/supabase/repositories/trainingPlanPlannedPrescriptionsRepo.js";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const INTEGRATION_ENABLED = process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" && !!SERVER_KEY && isLoopbackSupabaseUrl(resolveTestSupabaseUrl());

const TODAY = "2026-10-05"; // Monday

const PROFILE: AthletePerformanceProfileWriteFields = {
  strength_experience_tier: "intermediate",
  equipment: ["dumbbells", "bench"],
  terrain_access: ["flow_trail", "bermed_trail"],
  declared_limitations: [],
  technical_priorities: { strengths: ["jumps"], weaknesses: ["braking"], priorityAreas: ["cornering", "braking"] },
  dh_technical_tier: "intermediate",
};

type Window = { day_of_week: number; start_time: string; end_time: string };
const ALL_DAY: Window[] = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, start_time: "08:00:00", end_time: "20:00:00" }));

describe.skipIf(!INTEGRATION_ENABLED)("UX-11A.5b.5b — V2 local persistence (real local Supabase)", () => {
  let admin: SupabaseClient;

  beforeAll(() => {
    admin = createTestClient();
  });

  async function seedAthlete(name: string, profile: AthletePerformanceProfileWriteFields = PROFILE, windows: Window[] = ALL_DAY): Promise<string> {
    const athlete = await createTestAthlete(admin, name);
    await setAthleteDiscipline(admin, athlete.athleteId, "Downhill");
    await upsertPerformanceProfileFor(admin, athlete.athleteId, profile);
    for (const w of windows) await insertAvailabilityWindow(admin, athlete.athleteId, w);
    return athlete.athleteId;
  }

  const persistV2 = (athleteId: string, generationRequestId: string, durationWeeks = 2) =>
    generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId, generationRequestId, durationWeeks, today: TODAY });

  async function versionsOf(athleteId: string) {
    const { data, error } = await admin
      .from("training_plan_versions")
      .select("id, input_snapshot, input_snapshot_schema_version, prescription_schema_version, catalog_version, planner_version, relaxed_constraints, generation_request_id")
      .eq("athlete_id", athleteId);
    if (error) throw new Error(error.message);
    return data!;
  }

  async function rowsOf(planVersionId: string) {
    const [{ data: sessions }, { data: prescriptions }] = await Promise.all([
      admin.from("training_plan_generated_sessions").select("id, date, kind, load_profile, duration_min, dose_target").eq("plan_version_id", planVersionId).order("date"),
      admin.from("training_plan_planned_prescriptions").select("id, generated_plan_session_id, schema_version, catalog_version, structure").eq("plan_version_id", planVersionId),
    ]);
    return { sessions: sessions!, prescriptions: prescriptions! };
  }

  it("persists a complete development plan: v2 version, V2 snapshot, one v2 prescription per session, Force / DH / endurance contracts", async () => {
    const athleteId = await seedAthlete("V2 persistence — development");
    const result = await persistV2(athleteId, randomUUID());
    expect(result.status).toBe("persisted");
    if (result.status !== "persisted") return;

    const [version] = await versionsOf(athleteId);
    expect(version).toMatchObject({
      id: result.planVersionId,
      input_snapshot_schema_version: "v2",
      prescription_schema_version: "v2",
      catalog_version: "session-model-v2.5",
      planner_version: "v2",
      relaxed_constraints: [],
    });
    expect((version!.input_snapshot as { dhTechnicalTier: string }).dhTechnicalTier).toBe("intermediate");

    const { sessions, prescriptions } = await rowsOf(result.planVersionId);
    expect(sessions.map((s) => [s.date, s.kind, s.load_profile, s.duration_min])).toEqual([
      ["2026-10-05", "DH_TECHNICAL", "MODERATE", 90],
      ["2026-10-06", "DH_TECHNICAL", "MODERATE", 90],
      ["2026-10-07", "STRENGTH_LOWER", "MODERATE", 60],
      ["2026-10-08", "STRENGTH_UPPER", "MODERATE", 60],
      ["2026-10-09", "AEROBIC_BASE", "MODERATE", 45],
      ["2026-10-12", "DH_TECHNICAL", "MODERATE", 90],
      ["2026-10-13", "DH_TECHNICAL", "MODERATE", 90],
      ["2026-10-14", "STRENGTH_LOWER", "MODERATE", 60],
      ["2026-10-15", "STRENGTH_UPPER", "MODERATE", 60],
      ["2026-10-16", "AEROBIC_BASE", "MODERATE", 45],
    ]);
    // Load authority lock: every stored load is the plan dose policy's load for its kind.
    const policyLoad = { STRENGTH_LOWER: PLAN_DOSE_POLICY_V2.development.forceLoad, STRENGTH_UPPER: PLAN_DOSE_POLICY_V2.development.forceLoad, DH_TECHNICAL: PLAN_DOSE_POLICY_V2.development.dhLoad, AEROBIC_BASE: PLAN_DOSE_POLICY_V2.development.aerobicLoad } as Record<string, string>;
    for (const s of sessions) expect(s.load_profile, s.kind).toBe(policyLoad[s.kind as string]);
    expect(prescriptions).toHaveLength(sessions.length);
    expect(new Set(prescriptions.map((p) => p.generated_plan_session_id))).toEqual(new Set(sessions.map((s) => s.id)));
    expect(new Set(prescriptions.map((p) => `${p.schema_version}/${p.catalog_version}`))).toEqual(new Set(["v2/session-model-v2.5"]));

    // The first session of that kind by date (sessions are ordered; prescription rows are not).
    const byKind = (kind: string) => prescriptions.find((p) => p.generated_plan_session_id === sessions.find((s) => s.kind === kind)!.id)!.structure as Record<string, any>;
    expect(byKind("STRENGTH_LOWER").templateId).toBe("strength_lower_intermediate_v1");
    expect(byKind("DH_TECHNICAL").blocks.find((b: any) => b.role === "main").items[0]).toMatchObject({ kind: "drill", drillId: "cornering_berm_speed", measure: { type: "pass", count: 6 } });
    expect(byKind("DH_TECHNICAL").blocks.find((b: any) => b.role === "main").items[0].exerciseId).toBeUndefined();
    expect(byKind("AEROBIC_BASE").activitySelection).toEqual({ mode: "restricted", activityIds: ["road_bike", "mtb_rolling", "home_trainer", "running"] });

    // The stored structures are exactly the validated, identified in-memory documents.
    const inMemory = result.plan.weeks.flatMap((w) => w.sessions);
    for (const s of inMemory) expect(prescriptions.find((p) => p.id === s.plannedPrescription.id)!.structure).toEqual(s.plannedPrescription.structure);
  });

  it("same generation_request_id → idempotent replay, no second version; a new request id → a new version with the same sport content", async () => {
    const athleteId = await seedAthlete("V2 persistence — idempotence");
    const requestId = randomUUID();
    const first = await persistV2(athleteId, requestId);
    const replay = await persistV2(athleteId, requestId);
    expect(first.status === "persisted" && replay.status === "persisted").toBe(true);
    if (first.status !== "persisted" || replay.status !== "persisted") return;
    expect(replay).toMatchObject({ idempotentReplay: true, planVersionId: first.planVersionId });
    expect(replay.plan.planVersionId).not.toBe(first.planVersionId); // the replay's freshly minted ids were discarded
    expect(await versionsOf(athleteId)).toHaveLength(1);

    const fresh = await persistV2(athleteId, randomUUID());
    if (fresh.status !== "persisted") throw new Error("expected persisted");
    expect(fresh.idempotentReplay).toBe(false);
    expect(fresh.planVersionId).not.toBe(first.planVersionId);
    expect(await versionsOf(athleteId)).toHaveLength(2);
    expect(fresh.plan.planSportFingerprint).toBe(first.plan.planSportFingerprint);
  });

  it("V1 then V2 (and V2 then V1) with the same generation_request_id → explicit refusal; the first version is untouched", async () => {
    const athleteId = await seedAthlete("V2 persistence — V1/V2 collision");
    const requestId = randomUUID();
    await generateAndPersistTrainingPlan({ client: admin, athleteId, generationRequestId: requestId, durationWeeks: 2, today: TODAY });
    await expect(persistV2(athleteId, requestId)).rejects.toThrow(/different generation environment/);
    const versions = await versionsOf(athleteId);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ input_snapshot_schema_version: "v1", prescription_schema_version: "v1", catalog_version: "v3" });

    const otherRequest = randomUUID();
    await persistV2(athleteId, otherRequest);
    await expect(generateAndPersistTrainingPlan({ client: admin, athleteId, generationRequestId: otherRequest, durationWeeks: 2, today: TODAY })).rejects.toThrow(/different generation environment/);
    const v2 = (await versionsOf(athleteId)).find((v) => v.generation_request_id === otherRequest)!;
    expect(v2).toMatchObject({ input_snapshot_schema_version: "v2", prescription_schema_version: "v2" });
  });

  it("a blocked V2 plan (DH sessions, dhTechnicalTier null) writes nothing", async () => {
    const athleteId = await seedAthlete("V2 persistence — blocked", { ...PROFILE, dh_technical_tier: null });
    const result = await persistV2(athleteId, randomUUID());
    expect(result).toEqual({ status: "blocked", code: "missing_dh_technical_tier", detail: {} });
    expect(await versionsOf(athleteId)).toEqual([]);
  });

  it("race plan: taper Force LIGHT / 45, DH 4 passages / 60 min, AEROBIC_BASE 45; never 30 min nor 3 passages", async () => {
    const athleteId = await seedAthlete("V2 persistence — race");
    await insertRace(admin, athleteId, { event_name: "UX-11A.5b.5b race", start_date: "2026-10-24", end_date: "2026-10-25", priority: "A" });
    const result = await persistV2(athleteId, randomUUID(), 3);
    if (result.status !== "persisted") throw new Error(`expected persisted, got ${JSON.stringify(result)}`);
    const { sessions, prescriptions } = await rowsOf(result.planVersionId);
    const taper = sessions.filter((s) => s.date >= "2026-10-12" && s.date <= "2026-10-18");
    expect(taper.map((s) => [s.kind, s.load_profile, s.duration_min])).toEqual([
      ["DH_TECHNICAL", "LIGHT", 60],
      ["STRENGTH_LOWER", "LIGHT", 45],
      ["AEROBIC_BASE", "LIGHT", 45],
    ]);
    expect(taper.map((s) => s.load_profile)).toEqual([PLAN_DOSE_POLICY_V2.taper.dhLoad, PLAN_DOSE_POLICY_V2.taper.forceLoad, PLAN_DOSE_POLICY_V2.taper.aerobicLoad]);
    const taperDh = prescriptions.find((p) => p.generated_plan_session_id === taper[0]!.id)!.structure as Record<string, any>;
    expect(taperDh.blocks.find((b: any) => b.role === "main").items[0].measure).toEqual({ type: "pass", count: 4 });
    expect(sessions.some((s) => s.date >= "2026-10-19")).toBe(false); // race week: no session
    expect(sessions.map((s) => s.duration_min)).not.toContain(30);
    expect(JSON.stringify(prescriptions)).not.toMatch(/"count":3[,}]/);
  });

  it("taper AEROBIC_BASE that does not fit a 30-min window stays unplaced: no session, no prescription, relaxation kept on the version", async () => {
    const windows: Window[] = [
      { day_of_week: 1, start_time: "18:00:00", end_time: "19:30:00" },
      { day_of_week: 3, start_time: "18:00:00", end_time: "19:00:00" },
      { day_of_week: 5, start_time: "18:00:00", end_time: "18:30:00" },
    ];
    const athleteId = await seedAthlete("V2 persistence — unplaced", PROFILE, windows);
    await insertRace(admin, athleteId, { event_name: "UX-11A.5b.5b race", start_date: "2026-10-17", end_date: "2026-10-18", priority: "A" });
    const result = await persistV2(athleteId, randomUUID(), 2);
    if (result.status !== "persisted") throw new Error(`expected persisted, got ${JSON.stringify(result)}`);
    const { sessions, prescriptions } = await rowsOf(result.planVersionId);
    expect(sessions.map((s) => [s.date, s.kind, s.duration_min])).toEqual([
      ["2026-10-05", "DH_TECHNICAL", 60],
      ["2026-10-07", "STRENGTH_LOWER", 45],
    ]);
    expect(prescriptions).toHaveLength(2);
    const [version] = await versionsOf(athleteId);
    expect(version!.relaxed_constraints).toEqual([{ constraintId: "placement_shortfall", reason: "insufficient_available_time", domain: "aerobic" }]);
  });

  it("legacy skipped/replaced counter: two V2 generations (new request ids) have the same sport content, different snapshot hash", async () => {
    const athleteId = await seedAthlete("V2 persistence — history");
    const quiet = await persistV2(athleteId, randomUUID());
    for (const date of ["2026-10-01", "2026-10-02", "2026-10-03"]) {
      await insertCompletedSession(admin, athleteId, date, "DH_TECHNICAL", null, { completionStatus: "skipped", changeReason: "fatigue_control" });
    }
    const missed = await persistV2(athleteId, randomUUID());
    if (quiet.status !== "persisted" || missed.status !== "persisted") throw new Error("expected persisted");
    const snapshots = await versionsOf(athleteId);
    expect(snapshots.map((v) => (v.input_snapshot as { recentHistory: { recentMissedOrReplacedCount: number } }).recentHistory.recentMissedOrReplacedCount).sort()).toEqual([0, 3]);
    expect(missed.plan.planSportFingerprint).toBe(quiet.plan.planSportFingerprint);
    const a = await rowsOf(quiet.planVersionId);
    const b = await rowsOf(missed.planVersionId);
    expect(b.sessions.map((s) => [s.kind, s.load_profile, s.duration_min])).toEqual(a.sessions.map((s) => [s.kind, s.load_profile, s.duration_min]));
  });

  it("reader guard on a REAL v2 row: the V1 planned-prescription reader returns unsupported_by_reader, never a v1 cast", async () => {
    const athleteId = await seedAthlete("V2 persistence — reader guard");
    const result = await persistV2(athleteId, randomUUID());
    if (result.status !== "persisted") throw new Error("expected persisted");
    const { prescriptions } = await rowsOf(result.planVersionId);
    for (const p of prescriptions.slice(0, 3)) {
      const read = await getPlannedPrescriptionForGeneratedSession(admin, p.generated_plan_session_id as string);
      expect(read).toEqual({ status: "unsupported_by_reader", schemaVersion: "v2", prescriptionId: p.id });
    }
  });
});
