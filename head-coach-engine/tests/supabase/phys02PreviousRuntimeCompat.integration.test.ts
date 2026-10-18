/**
 * PHYS-02 — rollback / roll-forward with the PREVIOUS runtime's real code (REL-01 D), on the LOCAL Supabase.
 *
 * Enabled only when PHYS011_PREVIOUS_RUNTIME_ROOT points at a built checkout of the previous release (its
 * head-coach-engine/dist and planning-engine/dist). Nothing of that checkout is modified: its compiled
 * modules are imported read-only.
 *
 * Proves, on real data:
 *   1. intervals option OFF (the default): the previous planner and PHYS-02 produce exactly the same plan;
 *   2. option ON, daily run rolled back to D: D's KEEP of a planned intervals session works (a verbatim copy),
 *      and an intervals session performed under D is read back by PHYS-02's guidance;
 *   3. option ON, the rollback HAZARD: D cannot MODIFY a planned intervals session to LIGHT (a short night) —
 *      its daily run throws and nothing is persisted that day — while PHYS-02.1, on the same data, persists
 *      the decision with the base endurance LIGHT fallback; D blocks MENTAL_RED gracefully;
 *   4. roll-forward: base endurance sessions performed under D are read by PHYS-02's guidance;
 *   5. PHYS-02.1 — what D still does on a plan holding intervals sessions: every other day (A10 on an
 *      intervals day, a LIGHT base day, a manual intervals session) works; only an intervals day lowered to
 *      LIGHT fails — exactly what docs/release/phys02-rollback/ROLLBACK_TO_D_PRECONDITION.sql counts.
 */
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { createTestAthlete, createTestClient, getAthleteAuthClient, insertCheckin, setAthleteDiscipline, type CheckinFixture } from "./testDb.js";
import { execLocalSql, localIntegrationRequested, sqlLiteral } from "./localDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { buildPlanInputSnapshotV2 } from "../../src/supabase/buildPlanInputSnapshotV2.js";
import { generateAndPersistTrainingPlanV2, generateTrainingPlanVersionRpcV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { DEFAULT_RUN_DAILY_FOR_DEPS, runDailyFor } from "../../src/supabase/runDailyFor.js";
import * as currentV2 from "planning-engine/session-model-v2";
// V2-PHYS-INTEGRATION-01 — these PHYS rules run with every PHYS switch ON (performance guidance included); every
// switch off is the production behaviour (the production tests kept unchanged, phys00FlagsOffEquivalence).
const PHYS_ON_DEPS = { ...DEFAULT_RUN_DAILY_FOR_DEPS, physSwitches: { daily: true, performanceGuidance: true, intervals: true, power: true, mobility: true } };

const PREVIOUS = process.env.PHYS011_PREVIOUS_RUNTIME_ROOT;
const PRECONDITION_SQL = readFileSync(new URL("../../../docs/release/phys02-rollback/ROLLBACK_TO_D_PRECONDITION.sql", import.meta.url), "utf8");
/** The versioned precondition query, for one rider and a given product date (the operational query reads the whole base at today's date). */
function rollbackBlockers(athleteId: string, fromDate: string): { ahead: number; last: string | null } {
  const sql = PRECONDITION_SQL.replace("(now() at time zone 'Europe/Zurich')::date", `${sqlLiteral(fromDate)}::date`).replace(
    "where g.kind = 'AEROBIC_INTERVALS'",
    `where c.athlete_id = ${sqlLiteral(athleteId)} and g.kind = 'AEROBIC_INTERVALS'`
  );
  const [ahead, , last] = execLocalSql(sql).trim().split("|");
  return { ahead: Number(ahead), last: last === "" ? null : last! };
}
const ENABLED = localIntegrationRequested() && !!PREVIOUS;
const SYSTEMIC_RED: CheckinFixture = { sleep_hours: 4, sleep_quality: 2, sleep_wake_ups: 4, energy: 2 };
const MENTAL_RED: CheckinFixture = { work_stress: 8, motivation: 3, leg_fatigue: 2, grip_fatigue: 2, sleep_hours: 7.5 };

type Structure = { sessionKind: string; protocolId: string; blocks: { role: string; durationMinutes: { max: number } }[]; enduranceGuidance?: Record<string, unknown> };

describe.skipIf(!ENABLED)("PHYS-02 — previous runtime (D) and PHYS-02 on the same data (local Supabase)", { timeout: 300_000 }, () => {
  let admin: SupabaseClient;
  let previousRunDailyFor: typeof runDailyFor;
  let previousV2: typeof currentV2;
  beforeAll(async () => {
    admin = createTestClient();
    previousRunDailyFor = (await import(pathToFileURL(join(PREVIOUS!, "head-coach-engine", "dist", "supabase", "runDailyFor.js")).href)).runDailyFor;
    previousV2 = await import(pathToFileURL(join(PREVIOUS!, "planning-engine", "dist", "sessionModelV2", "index.js")).href);
  });

  async function rider(name: string, enduranceIntervals: boolean) {
    const { athleteId } = await createTestAthlete(admin, `PHYS-02 compat ${name}`);
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
    const persisted = await generateAndPersistTrainingPlanV2(
      { planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 6, today: "2026-10-04", ...(enduranceIntervals ? { enduranceIntervals: true } : {}) },
      { buildPlanInputSnapshotV2, callRpc: generateTrainingPlanVersionRpcV2, mintId: () => randomUUID() }
    );
    if (persisted.status !== "persisted") throw new Error("plan");
    await acceptTrainingPlanVersion(admin, athleteId, persisted.planVersionId, "2026-10-05", "2026-11-15");
    return athleteId;
  }
  const finalOf = async (decisionId: string) => {
    const { data } = await admin.from("decision_final_prescriptions").select("id, structure, reconciliation_action").eq("decision_id", decisionId).single();
    return data as { id: string; structure: Structure; reconciliation_action: string };
  };
  const decisionsOn = async (athleteId: string, date: string) => {
    const { count } = await admin.from("decisions").select("id", { count: "exact", head: true }).eq("athlete_id", athleteId).eq("decision_date", date);
    return count;
  };
  async function record(athleteId: string, payload: unknown) {
    const { data, error } = await admin.rpc("record_session_execution", { p_athlete_id: athleteId, p_payload: payload });
    if (error) throw new Error(error.message);
    expect(data).toMatchObject({ status: "ok" });
  }

  it("1 — intervals option OFF (the default): the previous planner and PHYS-02 generate exactly the same 6-week plan", () => {
    const snapshot = {
      discipline: "Downhill",
      races: [],
      availability: { windows: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d as 0, startTime: "08:00", endTime: "20:00" })), exceptions: [] },
      equipment: ["dumbbells", "bench"],
      terrainAccess: ["flow_trail", "bermed_trail"],
      strengthExperienceTier: "intermediate" as const,
      declaredLimitations: [],
      technicalPriorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
      lockedDates: [],
      recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 0 },
      dhTechnicalTier: "intermediate" as const,
    };
    const generate = (v2: typeof currentV2) => {
      let n = 0;
      const r = v2.generatePlanV2InMemory({ block: { sequenceNumber: 1, name: "P", mode: "UNSPECIFIED", primaryFocus: "T", startDate: "2026-10-05", endDate: "2026-11-15" }, snapshot, mintId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}` });
      if (r.status !== "generated") throw new Error(r.status);
      return r.plan;
    };
    // Whole plan: weeks, summaries, rationales, sessions, planned prescriptions, fingerprints.
    expect(generate(currentV2)).toEqual(generate(previousV2));
  });

  it("2 — option ON, daily run rolled back to D: D's KEEP of the planned intervals session is a verbatim copy; performed under D, it is PHYS-02's next reference", async () => {
    const athleteId = await rider("KEEP", true);
    await insertCheckin(admin, athleteId, "2026-10-23");
    const d = await previousRunDailyFor(admin, athleteId, "2026-10-23");
    expect([d.dailyPlan.decision, d.finalPrescriptionStatus]).toEqual(["KEEP", "created"]);
    const f = await finalOf(d.persistence.decision_id);
    expect([f.structure.protocolId, f.structure.blocks.map((b) => b.durationMinutes.max)]).toEqual(["endurance_intervals_3min", [15, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 10]]);
    const id = randomUUID();
    await record(athleteId, { execution: { id, session_date: "2026-10-23", started_at: "2026-10-23T17:00:00Z", final_prescription_id: f.id }, events: [{ id: randomUUID(), execution_id: id, event_type: "started", occurred_at: "2026-10-23T17:00:00Z" }] });
    await record(athleteId, {
      activities: [{ id: randomUUID(), execution_id: id, activity_id: "road_bike", duration_seconds: 3240, distance_m: 27000, rpe_actual: 7, comment: null, supersedes_id: null, occurred_at: "2026-10-23T18:00:00Z" }],
      events: [{ id: randomUUID(), execution_id: id, event_type: "completed", occurred_at: "2026-10-23T18:01:00Z" }],
    });
    await insertCheckin(admin, athleteId, "2026-11-13");
    const next = await finalOf((await runDailyFor(admin, athleteId, "2026-11-13", PHYS_ON_DEPS)).persistence.decision_id);
    expect(next.structure.enduranceGuidance).toEqual({ ruleVersion: "endurance-guidance-v1", reference: { sessionDate: "2026-10-23", activityId: "road_bike", durationSeconds: 3240, distanceM: 27000, rpeActual: 7 } });
  });

  it("3 — option ON, the rollback hazard: D's daily run throws on a LIGHT intervals day (nothing persisted); PHYS-02.1 persists M1's MODIFY LIGHT with the base endurance fallback; D blocks MENTAL_RED gracefully", async () => {
    const athleteId = await rider("hazard", true);
    await insertCheckin(admin, athleteId, "2026-10-23", SYSTEMIC_RED);
    await expect(previousRunDailyFor(admin, athleteId, "2026-10-23")).rejects.toThrow(/does not cover session kind AEROBIC_INTERVALS/);
    expect(await decisionsOn(athleteId, "2026-10-23")).toBe(0);
    const now = await runDailyFor(admin, athleteId, "2026-10-23", PHYS_ON_DEPS);
    expect([now.dailyPlan.decision, now.dailyPlan.final_session, now.finalPrescriptionStatus]).toEqual(["MODIFY", { kind: "AEROBIC_BASE", load_profile: "LIGHT", duration_min: 45 }, "created"]);
    expect(await decisionsOn(athleteId, "2026-10-23")).toBe(1);

    await insertCheckin(admin, athleteId, "2026-11-13", MENTAL_RED);
    const dMental = await previousRunDailyFor(admin, athleteId, "2026-11-13");
    expect([dMental.dailyPlan.decision, dMental.finalPrescriptionStatus, dMental.finalPrescriptionStatusDetail]).toEqual([
      "MODIFY",
      "blocked",
      { reason: "modify_kind_change_not_supported", planned: "AEROBIC_INTERVALS", final: "AEROBIC_BASE" },
    ]);
  });

  it("5 — PHYS-02.1: on a plan holding intervals sessions D serves every other day; only an intervals day lowered to LIGHT fails — what the precondition query counts", async () => {
    const athleteId = await rider("conditions", true);
    // A10 on an intervals day: D replaces it by active recovery (no crash).
    await insertCheckin(admin, athleteId, "2026-10-23", { available_minutes_today: 40 });
    const a10 = await previousRunDailyFor(admin, athleteId, "2026-10-23");
    expect([a10.dailyPlan.decision, a10.dailyPlan.final_session.kind, a10.finalPrescriptionStatus]).toEqual(["REPLACE", "RECOVERY_ACTIVE", "created"]);
    // A base day lowered to LIGHT on the same plan: D's own endurance MODIFY (45 min).
    await insertCheckin(admin, athleteId, "2026-11-06", SYSTEMIC_RED);
    const base = await previousRunDailyFor(admin, athleteId, "2026-11-06");
    expect([base.dailyPlan.decision, base.finalPrescriptionStatus, (await finalOf(base.persistence.decision_id)).structure.blocks.map((b) => b.durationMinutes.max)]).toEqual(["MODIFY", "created", [10, 30, 5]]);
    // A manual intervals session (rest day of the plan) lowered to LIGHT: D refuses it explicitly (no crash).
    // Written as the rider does it in /plan (the service role has no write access to planned_sessions).
    const { error } = await (await getAthleteAuthClient(athleteId))
      .from("planned_sessions")
      .upsert({ athlete_id: athleteId, planned_date: "2026-10-24", session_type: "AEROBIC_INTERVALS", intervention: { kind: "AEROBIC_INTERVALS", load_profile: "MODERATE" }, planned_intent: null, source: "manual", is_committed: false, source_plan_version_id: null, source_generated_session_id: null }, { onConflict: "athlete_id,planned_date" });
    if (error) throw new Error(error.message);
    await insertCheckin(admin, athleteId, "2026-10-24", SYSTEMIC_RED);
    const manual = await previousRunDailyFor(admin, athleteId, "2026-10-24");
    expect([manual.dailyPlan.decision, manual.finalPrescriptionStatus, manual.finalPrescriptionStatusDetail?.reason]).toEqual(["MODIFY", "blocked", "manual_kind_not_supported"]);
    // The precondition query: intervals sessions still ahead of a date = the days D cannot serve on a LIGHT day.
    expect([rollbackBlockers(athleteId, "2026-10-23"), rollbackBlockers(athleteId, "2026-10-24"), rollbackBlockers(athleteId, "2026-11-14")]).toEqual([
      { ahead: 2, last: "2026-11-13" },
      { ahead: 1, last: "2026-11-13" },
      { ahead: 0, last: null },
    ]);
    // After the last intervals session (blockers = 0), a LIGHT day under D is served normally.
    await insertCheckin(admin, athleteId, "2026-11-14", SYSTEMIC_RED);
    const after = await previousRunDailyFor(admin, athleteId, "2026-11-14");
    expect(after.persistence.decision_id).toBeTruthy();
    // ...whereas the last intervals day, lowered to LIGHT, still fails under D.
    await insertCheckin(admin, athleteId, "2026-11-13", SYSTEMIC_RED);
    await expect(previousRunDailyFor(admin, athleteId, "2026-11-13")).rejects.toThrow(/does not cover session kind AEROBIC_INTERVALS/);
  });

  it("4 — roll-forward: a base endurance session performed under D is the reference of PHYS-02's next base session", async () => {
    const athleteId = await rider("roll-forward", false);
    await insertCheckin(admin, athleteId, "2026-10-09");
    const d = await previousRunDailyFor(admin, athleteId, "2026-10-09");
    const f = await finalOf(d.persistence.decision_id);
    expect(f.structure.enduranceGuidance).toBeUndefined();
    const id = randomUUID();
    await record(athleteId, { execution: { id, session_date: "2026-10-09", started_at: "2026-10-09T17:00:00Z", final_prescription_id: f.id }, events: [{ id: randomUUID(), execution_id: id, event_type: "started", occurred_at: "2026-10-09T17:00:00Z" }] });
    await record(athleteId, {
      activities: [{ id: randomUUID(), execution_id: id, activity_id: "running", duration_seconds: 2700, distance_m: 8200, rpe_actual: 5, comment: null, supersedes_id: null, occurred_at: "2026-10-09T18:00:00Z" }],
      events: [{ id: randomUUID(), execution_id: id, event_type: "completed", occurred_at: "2026-10-09T18:01:00Z" }],
    });
    await insertCheckin(admin, athleteId, "2026-10-16");
    const next = await finalOf((await runDailyFor(admin, athleteId, "2026-10-16", PHYS_ON_DEPS)).persistence.decision_id);
    expect(next.structure.enduranceGuidance).toEqual({
      ruleVersion: "endurance-guidance-v1",
      reference: { sessionDate: "2026-10-09", activityId: "running", durationSeconds: 2700, distanceM: 8200, rpeActual: 5 },
      effortAboveTarget: { rpeActual: 5, rpeTargetMax: 4 },
    });
  });
});
