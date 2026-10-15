/**
 * PHYS-02 — rollback / roll-forward with the PREVIOUS runtime's real code (REL-01 D), on the LOCAL Supabase.
 *
 * Enabled only when PHYS011_PREVIOUS_RUNTIME_ROOT points at a built checkout of the previous release (its
 * head-coach-engine/dist and planning-engine/dist). Nothing of that checkout is modified: its compiled
 * modules are imported read-only.
 *
 * Proves, on real data:
 *   1. intervals option OFF (the default): the previous planner and PHYS-02 produce exactly the same plan;
 *   2. option ON, Edge rolled back to D: D's KEEP of a planned intervals session works (a verbatim copy);
 *   3. option ON, the rollback HAZARD that keeps the option off: D cannot MODIFY a planned intervals session
 *      to LIGHT (a short night) — its daily run throws and nothing is persisted that day — while PHYS-02, on
 *      the same data, persists the decision with its reason; D blocks MENTAL_RED gracefully;
 *   4. roll-forward: base endurance sessions performed under D are read by PHYS-02's guidance.
 */
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, insertCheckin, setAthleteDiscipline, type CheckinFixture } from "./testDb.js";
import { localIntegrationRequested } from "./localDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { buildPlanInputSnapshotV2 } from "../../src/supabase/buildPlanInputSnapshotV2.js";
import { generateAndPersistTrainingPlanV2, generateTrainingPlanVersionRpcV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { runDailyFor } from "../../src/supabase/runDailyFor.js";
import * as currentV2 from "planning-engine/session-model-v2";

const PREVIOUS = process.env.PHYS011_PREVIOUS_RUNTIME_ROOT;
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

  it("2 — option ON, daily run rolled back to D: D's KEEP of the planned intervals session is a verbatim copy", async () => {
    const athleteId = await rider("KEEP", true);
    await insertCheckin(admin, athleteId, "2026-10-23");
    const d = await previousRunDailyFor(admin, athleteId, "2026-10-23");
    expect([d.dailyPlan.decision, d.finalPrescriptionStatus]).toEqual(["KEEP", "created"]);
    const f = await finalOf(d.persistence.decision_id);
    expect([f.structure.protocolId, f.structure.blocks.map((b) => b.durationMinutes.max)]).toEqual(["endurance_intervals_3min", [15, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 10]]);
  });

  it("3 — option ON, the rollback hazard: D's daily run throws on a LIGHT intervals day (nothing persisted); PHYS-02 persists the decision with its reason; D blocks MENTAL_RED gracefully", async () => {
    const athleteId = await rider("hazard", true);
    await insertCheckin(admin, athleteId, "2026-10-23", SYSTEMIC_RED);
    await expect(previousRunDailyFor(admin, athleteId, "2026-10-23")).rejects.toThrow(/does not cover session kind AEROBIC_INTERVALS/);
    expect(await decisionsOn(athleteId, "2026-10-23")).toBe(0);
    const now = await runDailyFor(admin, athleteId, "2026-10-23");
    expect([now.dailyPlan.decision, now.finalPrescriptionStatus, now.finalPrescriptionStatusDetail]).toEqual(["MODIFY", "blocked", { reason: "intervals_load_not_supported", planned: "MODERATE", final: "LIGHT" }]);
    expect(await decisionsOn(athleteId, "2026-10-23")).toBe(1);

    await insertCheckin(admin, athleteId, "2026-11-13", MENTAL_RED);
    const dMental = await previousRunDailyFor(admin, athleteId, "2026-11-13");
    expect([dMental.dailyPlan.decision, dMental.finalPrescriptionStatus, dMental.finalPrescriptionStatusDetail]).toEqual([
      "MODIFY",
      "blocked",
      { reason: "modify_kind_change_not_supported", planned: "AEROBIC_INTERVALS", final: "AEROBIC_BASE" },
    ]);
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
    const next = await finalOf((await runDailyFor(admin, athleteId, "2026-10-16")).persistence.decision_id);
    expect(next.structure.enduranceGuidance).toEqual({
      ruleVersion: "endurance-guidance-v1",
      reference: { sessionDate: "2026-10-09", activityId: "running", durationSeconds: 2700, distanceM: 8200, rpeActual: 5 },
      effortAboveTarget: { rpeActual: 5, rpeTargetMax: 4 },
    });
  });
});
