/**
 * UX-11B.2.4b — the M1 recent-history bridge on the real local Supabase.
 * Real V2 plan, real daily runs (KEEP → final prescriptions), real
 * record_session_execution lifecycles, then the real computeDailyFor.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, insertCheckin, insertCompletedSession, isLoopbackSupabaseUrl, resolveTestSupabaseUrl, setAthleteDiscipline } from "./testDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { generateAndPersistTrainingPlanV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { runDailyFor } from "../../src/supabase/runDailyFor.js";
import { computeDailyFor } from "../../src/supabase/computeDailyFor.js";
import { buildDailyPlan } from "../../src/engine/buildDailyPlan.js";
import { getRecentSessions } from "../../src/supabase/repositories/completedSessionsRepo.js";
import { mapCompletedSessionRow } from "../../src/supabase/mapping/completedSessionRow.js";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const INTEGRATION_ENABLED = process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" && !!SERVER_KEY && isLoopbackSupabaseUrl(resolveTestSupabaseUrl());

const TODAY = "2026-10-05";
const GENERATED_ON = "2026-10-04"; // BUG-V2-3 — a plan starts the day after its generation: generated the eve, its first day is TODAY
const MODERATE_STRENGTH = { kind: "STRENGTH_LOWER", load_profile: "MODERATE" };

describe.skipIf(!INTEGRATION_ENABLED)("UX-11B.2.4b — M1 recent-history bridge (local Supabase)", () => {
  let admin: SupabaseClient;
  beforeAll(() => {
    admin = createTestClient();
  });

  async function athlete(name: string) {
    const { athleteId } = await createTestAthlete(admin, name);
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
    return athleteId;
  }

  const record = async (athleteId: string, payload: unknown) => {
    const { data, error } = await admin.rpc("record_session_execution", { p_athlete_id: athleteId, p_payload: payload });
    if (error) throw new Error(error.message);
    expect(data).toMatchObject({ status: "ok" });
  };
  /** One execution of the day's final prescription, ending with `end` (or left in progress). */
  async function execute(athleteId: string, day: string, finalPrescriptionId: string, end: "completed" | "abandoned" | null) {
    const id = randomUUID();
    await record(athleteId, {
      execution: { id, session_date: day, started_at: `${day}T17:00:00Z`, final_prescription_id: finalPrescriptionId },
      events: [{ id: randomUUID(), execution_id: id, event_type: "started", occurred_at: `${day}T17:00:00Z` }],
    });
    if (end) await record(athleteId, { events: [{ id: randomUUID(), execution_id: id, event_type: end, occurred_at: `${day}T18:00:00Z` }] });
  }
  async function keepRun(athleteId: string, day: string): Promise<string> {
    await insertCheckin(admin, athleteId, day);
    const result = await runDailyFor(admin, athleteId, day);
    expect(result.finalPrescriptionStatus).toBe("created");
    return result.finalPrescription!.id;
  }

  it("legacy only: the DailyPlan is strictly identical to the pre-bridge mapping (same decision, final_session, rules, reasoning)", async () => {
    const athleteId = await athlete("bridge legacy only");
    for (const d of ["2026-10-01", "2026-10-02", "2026-10-03"]) await insertCompletedSession(admin, athleteId, d, "STRENGTH_A", MODERATE_STRENGTH);
    await insertCompletedSession(admin, athleteId, "2026-10-04", "REST", null, { completionStatus: "skipped" });
    await insertCheckin(admin, athleteId, TODAY);

    const withBridge = await computeDailyFor(admin, athleteId, TODAY);
    const legacyRecent = (await getRecentSessions(admin, athleteId, TODAY)).map(mapCompletedSessionRow).filter((s) => s !== null);
    const preBridge = buildDailyPlan({ ...withBridge.rawContext, recent_sessions: legacyRecent });
    expect(withBridge.dailyPlan).toEqual(preBridge);
    expect([...withBridge.rawContext.recent_sessions].sort((a, b) => (a.date < b.date ? -1 : 1))).toEqual([...legacyRecent].sort((a, b) => (a.date < b.date ? -1 : 1)));
  });

  it("V2 completions reach M1: 3 legacy + 2 completed V2 sessions → recent_load RED → existing rule C3.7; started / abandoned / retry never add load", async () => {
    const athleteId = await athlete("bridge V2 completions");
    // Legacy day summaries: 3 MODERATE sessions before the V2 sessions. Recorded before the plan is
    // generated (BUG-V2-2): 180 min of recent training up to the generation day (10-04) → the block
    // starts at build (MODERATE doses).
    for (const d of ["2026-10-03", "2026-10-04", "2026-10-05"]) await insertCompletedSession(admin, athleteId, d, "STRENGTH_A", MODERATE_STRENGTH, { actualDurationMin: 90 });
    await acceptTrainingPlanVersion(
      admin,
      athleteId,
      (await (async () => {
        const p = await generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 2, today: GENERATED_ON });
        if (p.status !== "persisted") throw new Error("plan");
        return p.planVersionId;
      })()),
      TODAY,
      "2026-10-18"
    );

    const day = "2026-10-10"; // no planned session; window 2026-10-03 .. 2026-10-10
    await insertCheckin(admin, athleteId, day);
    const before = await computeDailyFor(admin, athleteId, day);
    expect(before.rawContext.recent_sessions).toHaveLength(3);
    expect(before.dailyPlan.triggered_rules.some((r) => r.rule_id === "C3.7")).toBe(false); // AMBER only

    // 10-06 DH: started, left in progress → no load.
    await execute(athleteId, "2026-10-06", await keepRun(athleteId, "2026-10-06"), null);
    // 10-07 STRENGTH_LOWER MODERATE: abandoned attempt, then a completed retry → ONE session.
    const f07 = await keepRun(athleteId, "2026-10-07");
    await execute(athleteId, "2026-10-07", f07, "abandoned");
    await execute(athleteId, "2026-10-07", f07, "completed");
    // 10-08 STRENGTH_UPPER MODERATE: completed.
    await execute(athleteId, "2026-10-08", await keepRun(athleteId, "2026-10-08"), "completed");
    // 10-09 AEROBIC_BASE: abandoned only → no load.
    await execute(athleteId, "2026-10-09", await keepRun(athleteId, "2026-10-09"), "abandoned");

    const after = await computeDailyFor(admin, athleteId, day);
    expect(after.rawContext.recent_sessions.map((s) => [s.date, s.intervention.kind, s.intervention.load_profile, s.completion_status])).toEqual([
      ["2026-10-03", "STRENGTH_LOWER", "MODERATE", "done"],
      ["2026-10-04", "STRENGTH_LOWER", "MODERATE", "done"],
      ["2026-10-05", "STRENGTH_LOWER", "MODERATE", "done"],
      ["2026-10-07", "STRENGTH_LOWER", "MODERATE", "done"],
      ["2026-10-08", "STRENGTH_UPPER", "MODERATE", "done"],
    ]);
    // Existing M1 rule, unchanged: 5 HEAVY/MODERATE sessions in 7 days → recent_load RED → C3.7 (informational) + monitoring.
    expect(after.dailyPlan.triggered_rules.some((r) => r.rule_id === "C3.7")).toBe(true);
    expect(after.dailyPlan.monitoring.observe).toContain("Surveiller la charge cumulée sur 7 jours (très élevée)");
    // Nothing was written to completed_sessions by the bridge.
    const { data: summaries } = await admin.from("completed_sessions").select("session_date").eq("athlete_id", athleteId).order("session_date");
    expect(summaries!.map((r) => r.session_date)).toEqual(["2026-10-03", "2026-10-04", "2026-10-05"]);
    // Same database → same context.
    const again = await computeDailyFor(admin, athleteId, day);
    expect(again.rawContext.recent_sessions).toEqual(after.rawContext.recent_sessions);
  });

  it("a day with a legacy summary AND a completed V2 execution counts once (the legacy day summary)", async () => {
    const athleteId = await athlete("bridge same-day");
    const p = await generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 2, today: GENERATED_ON });
    if (p.status !== "persisted") throw new Error("plan");
    await acceptTrainingPlanVersion(admin, athleteId, p.planVersionId, TODAY, "2026-10-18");
    await execute(athleteId, "2026-10-07", await keepRun(athleteId, "2026-10-07"), "completed");
    await insertCompletedSession(admin, athleteId, "2026-10-07", "STRENGTH_A", { kind: "STRENGTH_LOWER", load_profile: "LIGHT" }, { completionStatus: "partial" });
    await insertCheckin(admin, athleteId, "2026-10-08");
    const { rawContext } = await computeDailyFor(admin, athleteId, "2026-10-08");
    expect(rawContext.recent_sessions).toEqual([{ date: "2026-10-07", intervention: { kind: "STRENGTH_LOWER", load_profile: "LIGHT" }, completion_status: "partial" }]);
  });
});
