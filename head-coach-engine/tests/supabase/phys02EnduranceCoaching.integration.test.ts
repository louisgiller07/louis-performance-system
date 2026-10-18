/**
 * PHYS-02 — endurance and intervals end to end on the LOCAL Supabase (real tables, real RPCs, the Node path of
 * the daily run): plan with the intervals option → check-in → the day's endurance session → guidance → the
 * activity performed → the next session, over a 6-week block; then the day's state (sleep, mental, the
 * rider's time, health) on an intervals day. Nothing here changes M1, the schema or the Session Model manifest.
 *
 * Plan (fresh rider, 2026-10-05 → 2026-11-15, deterministic): endurance on 10-09 (base 45, LIGHT), 10-16
 * (base 45), 10-23 (INTERVALS 53, overload week), 11-06 (base 60), 11-13 (INTERVALS 53, overload week).
 */
import { randomUUID } from "node:crypto";
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
import { INTERVALS_LIGHT_FALLBACK_SENTENCE } from "../../src/supabase/dailyV2/applyV2IntervalsLightFallback.js";

const ENABLED = localIntegrationRequested();
const SYSTEMIC_RED: CheckinFixture = { sleep_hours: 4, sleep_quality: 2, sleep_wake_ups: 4, energy: 2 };
// docs/10 T1.3 — mental RED, physical GREEN.
const MENTAL_RED: CheckinFixture = { work_stress: 8, motivation: 3, leg_fatigue: 2, grip_fatigue: 2, sleep_hours: 7.5 };

type Block = { role: string; durationMinutes: { min: number; max: number }; rpeTarget?: { min: number; max: number }; instructionIds: string[] };
type Structure = { sessionKind: string; protocolId: string; activitySelection: { activityIds: string[] }; blocks: Block[]; enduranceGuidance?: Record<string, unknown> };
const minutesOf = (s: Structure) => s.blocks.map((b) => b.durationMinutes.max);
const INTERVALS_MINUTES = [15, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 10];

describe.skipIf(!ENABLED)("PHYS-02 — endurance and intervals end to end (local Supabase)", { timeout: 300_000 }, () => {
  let admin: SupabaseClient;
  beforeAll(() => {
    admin = createTestClient();
  });

  async function rider(name: string, enduranceIntervals: boolean) {
    const { athleteId } = await createTestAthlete(admin, `PHYS-02 ${name}`);
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
    const { data } = await admin
      .from("training_plan_generated_sessions")
      .select("date, kind, load_profile, duration_min")
      .eq("plan_version_id", persisted.planVersionId)
      .in("kind", ["AEROBIC_BASE", "AEROBIC_INTERVALS"])
      .order("date");
    return { athleteId, planVersionId: persisted.planVersionId, aerobic: (data ?? []) as { date: string; kind: string; load_profile: string; duration_min: number }[] };
  }

  const finalOf = async (decisionId: string) => {
    const { data } = await admin.from("decision_final_prescriptions").select("id, structure, reconciliation_action, adaptation_rule_ids").eq("decision_id", decisionId).single();
    return data as { id: string; structure: Structure; reconciliation_action: string; adaptation_rule_ids: string[] };
  };
  async function record(athleteId: string, payload: unknown) {
    const { data, error } = await admin.rpc("record_session_execution", { p_athlete_id: athleteId, p_payload: payload });
    if (error) throw new Error(error.message);
    expect(data).toMatchObject({ status: "ok" });
  }
  /** The rider starts the day's session, records the activity actually performed, and completes it. */
  async function perform(athleteId: string, date: string, finalPrescriptionId: string, activity: { activity_id: string; minutes: number; distance_m: number | null; rpe_actual: number | null }) {
    const id = randomUUID();
    await record(athleteId, { execution: { id, session_date: date, started_at: `${date}T17:00:00Z`, final_prescription_id: finalPrescriptionId }, events: [{ id: randomUUID(), execution_id: id, event_type: "started", occurred_at: `${date}T17:00:00Z` }] });
    await record(athleteId, {
      activities: [{ id: randomUUID(), execution_id: id, activity_id: activity.activity_id, duration_seconds: activity.minutes * 60, distance_m: activity.distance_m, rpe_actual: activity.rpe_actual, comment: null, supersedes_id: null, occurred_at: `${date}T18:00:00Z` }],
      events: [{ id: randomUUID(), execution_id: id, event_type: "completed", occurred_at: `${date}T18:01:00Z` }],
    });
  }

  it("A — 6 weeks: plan → check-in → endurance session → guidance → activity performed → the next session reads it", async () => {
    const r = await rider("A", true);
    expect(r.aerobic.map((s) => [s.date, s.kind, s.duration_min, s.load_profile])).toEqual([
      ["2026-10-09", "AEROBIC_BASE", 45, "LIGHT"],
      ["2026-10-16", "AEROBIC_BASE", 45, "MODERATE"],
      ["2026-10-23", "AEROBIC_INTERVALS", 53, "MODERATE"],
      ["2026-11-06", "AEROBIC_BASE", 60, "MODERATE"],
      ["2026-11-13", "AEROBIC_INTERVALS", 53, "MODERATE"],
    ]);

    // 10-09 — introduction: base 45, no history yet → no guidance. Performed a little too hard (RPE 6).
    await insertCheckin(admin, r.athleteId, "2026-10-09");
    const d1 = await runDailyFor(admin, r.athleteId, "2026-10-09");
    const f1 = await finalOf(d1.persistence.decision_id);
    expect([d1.dailyPlan.decision, f1.reconciliation_action, f1.structure.sessionKind, minutesOf(f1.structure), f1.structure.enduranceGuidance]).toEqual(["KEEP", "keep", "AEROBIC_BASE", [10, 30, 5], undefined]);
    await perform(r.athleteId, "2026-10-09", f1.id, { activity_id: "mtb_rolling", minutes: 47, distance_m: 18400, rpe_actual: 6 });

    // 10-16 — the guidance reads 10-09 as recorded, and restates the talk test (RPE 6 for 3–4).
    await insertCheckin(admin, r.athleteId, "2026-10-16");
    const f2 = await finalOf((await runDailyFor(admin, r.athleteId, "2026-10-16")).persistence.decision_id);
    expect(f2.structure.enduranceGuidance).toEqual({
      ruleVersion: "endurance-guidance-v1",
      reference: { sessionDate: "2026-10-09", activityId: "mtb_rolling", durationSeconds: 2820, distanceM: 18400, rpeActual: 6 },
      effortAboveTarget: { rpeActual: 6, rpeTargetMax: 4 },
    });
    await perform(r.athleteId, "2026-10-16", f2.id, { activity_id: "road_bike", minutes: 45, distance_m: 24000, rpe_actual: 4 });

    // 10-23 — overload week: the intervals session, verbatim; no intervals history yet → no guidance.
    await insertCheckin(admin, r.athleteId, "2026-10-23");
    const d3 = await runDailyFor(admin, r.athleteId, "2026-10-23");
    const f3 = await finalOf(d3.persistence.decision_id);
    expect([d3.dailyPlan.decision, f3.reconciliation_action, f3.structure.protocolId, minutesOf(f3.structure), f3.structure.enduranceGuidance]).toEqual(["KEEP", "keep", "endurance_intervals_3min", INTERVALS_MINUTES, undefined]);
    expect(f3.structure.blocks.filter((b) => b.rpeTarget?.max === 8)).toHaveLength(6);
    await perform(r.athleteId, "2026-10-23", f3.id, { activity_id: "home_trainer", minutes: 53, distance_m: null, rpe_actual: 7 });

    // 11-06 — base 60: the last BASE session (10-16) is the reference (not the intervals); effort was on target.
    await insertCheckin(admin, r.athleteId, "2026-11-06");
    const f4 = await finalOf((await runDailyFor(admin, r.athleteId, "2026-11-06")).persistence.decision_id);
    expect([minutesOf(f4.structure), f4.structure.enduranceGuidance]).toEqual([
      [10, 45, 5],
      { ruleVersion: "endurance-guidance-v1", reference: { sessionDate: "2026-10-16", activityId: "road_bike", durationSeconds: 2700, distanceM: 24000, rpeActual: 4 } },
    ]);

    // 11-13 — the second intervals session reads the first one (reference only, the session RPE never compared with RPE 8).
    await insertCheckin(admin, r.athleteId, "2026-11-13");
    const f5 = await finalOf((await runDailyFor(admin, r.athleteId, "2026-11-13")).persistence.decision_id);
    expect([minutesOf(f5.structure), f5.structure.enduranceGuidance]).toEqual([
      INTERVALS_MINUTES,
      { ruleVersion: "endurance-guidance-v1", reference: { sessionDate: "2026-10-23", activityId: "home_trainer", durationSeconds: 3180, distanceM: null, rpeActual: 7 } },
    ]);
  });

  /** PHYS-02.1 — the LIGHT fallback day as persisted: M1's MODIFY and LIGHT, the base endurance session, traced. */
  async function expectLightFallback(athleteId: string, date: string) {
    const d = await runDailyFor(admin, athleteId, date);
    expect([d.dailyPlan.decision, d.dailyPlan.final_session, d.finalPrescriptionStatus]).toEqual(["MODIFY", { kind: "AEROBIC_BASE", load_profile: "LIGHT", duration_min: 45 }, "created"]);
    const ruleIds = d.dailyPlan.triggered_rules.map((r) => r.rule_id);
    expect(ruleIds.slice(-2)).toEqual(["V2_INTERVALS_LIGHT_FALLBACK", "V2_EFFECTIVE_SESSION"]);
    expect(d.dailyPlan.training.objective).toBe(INTERVALS_LIGHT_FALLBACK_SENTENCE);
    const f = await finalOf(d.persistence.decision_id);
    expect([f.reconciliation_action, f.adaptation_rule_ids, f.structure.protocolId, minutesOf(f.structure)]).toEqual(["modify", ["v2.modify.intervals_light_to_base"], "endurance_base_continuous", [10, 30, 5]]);
    // The persisted decision row says the effective session and keeps M1's trace.
    const { data } = await admin.from("decisions").select("final_session, daily_plan").eq("id", d.persistence.decision_id).single();
    const row = data as { final_session: unknown; daily_plan: { decision: string; final_session: unknown; triggered_rules: { rule_id: string; detail: string }[] } };
    expect([row.daily_plan.decision, row.daily_plan.final_session, row.final_session]).toEqual(["MODIFY", { kind: "AEROBIC_BASE", load_profile: "LIGHT", duration_min: 45 }, "AEROBIC_BASE"]);
    expect(row.daily_plan.triggered_rules.find((r) => r.rule_id === "V2_INTERVALS_LIGHT_FALLBACK")!.detail).toContain("M1 : MODIFY AEROBIC_INTERVALS LIGHT");
    return { d, f, ruleIds };
  }

  it("B — PHYS-02.1, short night (C3.3) on an intervals day: base endurance LIGHT 45 min instead, traced; performed, it is the next base session's reference", async () => {
    const r = await rider("B", true);
    await insertCheckin(admin, r.athleteId, "2026-10-23", SYSTEMIC_RED);
    const { f, ruleIds } = await expectLightFallback(r.athleteId, "2026-10-23");
    expect(ruleIds).toContain("C3.3");
    await perform(r.athleteId, "2026-10-23", f.id, { activity_id: "road_bike", minutes: 46, distance_m: 22000, rpe_actual: 3 });
    // Next base session (11-06): the LIGHT fallback performed on 10-23 is its reference (same base protocol).
    await insertCheckin(admin, r.athleteId, "2026-11-06");
    const next = await finalOf((await runDailyFor(admin, r.athleteId, "2026-11-06")).persistence.decision_id);
    expect(next.structure.enduranceGuidance).toEqual({ ruleVersion: "endurance-guidance-v1", reference: { sessionDate: "2026-10-23", activityId: "road_bike", durationSeconds: 2760, distanceM: 22000, rpeActual: 3 } });
    // Next intervals day (11-13), rested: the intervals session again; no intervals history yet → no guidance.
    await insertCheckin(admin, r.athleteId, "2026-11-13");
    const d13 = await runDailyFor(admin, r.athleteId, "2026-11-13");
    const f13 = await finalOf(d13.persistence.decision_id);
    expect([d13.dailyPlan.decision, minutesOf(f13.structure), f13.structure.enduranceGuidance]).toEqual(["KEEP", INTERVALS_MINUTES, undefined]);
  });

  it("B2 — PHYS-02.1, tired legs (C3.6) on an intervals day: the same LIGHT fallback", async () => {
    const r = await rider("B2", true);
    await insertCheckin(admin, r.athleteId, "2026-10-23", { leg_fatigue: 8 });
    expect((await expectLightFallback(r.athleteId, "2026-10-23")).ruleIds).toContain("C3.6");
  });

  it("B3 — PHYS-02.1, a mild knee pain (non-safety, solicited by endurance): no activity proposed — M1's decision kept, a safe, explicit, traced state", async () => {
    const r = await rider("B3", true);
    await insertCheckin(admin, r.athleteId, "2026-10-23", { pain: true, pain_intensity: 3, pain_new: false, pain_location_code: "knee_R", pain_traumatic: false, pain_function_loss: false, pain_getting_worse: false });
    const d = await runDailyFor(admin, r.athleteId, "2026-10-23");
    expect([d.dailyPlan.decision, d.dailyPlan.final_session, d.finalPrescriptionStatus, d.finalPrescriptionStatusCode, d.finalPrescriptionStatusDetail]).toEqual([
      "MODIFY",
      { kind: "AEROBIC_INTERVALS", load_profile: "LIGHT", duration_min: 53 },
      "blocked",
      "final_prescription_adaptation_not_defined",
      { reason: "intervals_fallback_pain_not_cleared", zone: "lower" },
    ]);
    const rules = d.dailyPlan.triggered_rules.map((t) => t.rule_id);
    expect(rules).toContain("PAIN_NON_SAFETY");
    expect(d.dailyPlan.triggered_rules.at(-1)!.rule_id).toBe("V2_INTERVALS_LIGHT_FALLBACK");
    const { data } = await admin.from("decision_final_prescriptions").select("id").eq("decision_id", d.persistence.decision_id);
    expect(data).toEqual([]);
    // The same pain without location (the rule's cautious reading), with little time: still no activity chosen.
    await insertCheckin(admin, r.athleteId, "2026-11-13", { pain: true, pain_intensity: 2, pain_new: false, pain_traumatic: false, pain_function_loss: false, pain_getting_worse: false, available_minutes_today: 30 });
    const d2 = await runDailyFor(admin, r.athleteId, "2026-11-13");
    expect([d2.dailyPlan.decision, d2.finalPrescriptionStatus, d2.finalPrescriptionStatusDetail]).toEqual(["MODIFY", "blocked", { reason: "intervals_fallback_pain_not_cleared", zone: "unspecified" }]);
  });

  it("B4 — PHYS-02.1, a wrist pain (not solicited by endurance per the existing rule) after a short night: the fallback as without pain", async () => {
    const r = await rider("B4", true);
    await insertCheckin(admin, r.athleteId, "2026-10-23", { ...SYSTEMIC_RED, pain: true, pain_intensity: 3, pain_new: false, pain_location_code: "wrist_R", pain_traumatic: false, pain_function_loss: false, pain_getting_worse: false });
    expect((await expectLightFallback(r.athleteId, "2026-10-23")).ruleIds).toContain("C3.3");
  });

  it("C — docs/10 T1.3 (mental RED on an intervals day): MODIFY → the base endurance session at the planned 53 min", async () => {
    const r = await rider("C", true);
    await insertCheckin(admin, r.athleteId, "2026-10-23", MENTAL_RED);
    const d = await runDailyFor(admin, r.athleteId, "2026-10-23");
    expect([d.dailyPlan.decision, d.dailyPlan.final_session.kind]).toEqual(["MODIFY", "AEROBIC_BASE"]);
    const f = await finalOf(d.persistence.decision_id);
    expect([f.reconciliation_action, f.adaptation_rule_ids, f.structure.protocolId, minutesOf(f.structure)]).toEqual(["modify", ["v2.modify.intervals_to_base"], "endurance_base_continuous", [10, 38, 5]]);
  });

  it("D2 — PHYS-02.1, short night AND little time: 30 min → active recovery; 15 min → rest (never more than the time given)", async () => {
    const r = await rider("D2", true);
    await insertCheckin(admin, r.athleteId, "2026-10-23", { ...SYSTEMIC_RED, available_minutes_today: 30 });
    const d30 = await runDailyFor(admin, r.athleteId, "2026-10-23");
    expect([d30.dailyPlan.decision, d30.dailyPlan.final_session.kind]).toEqual(["REPLACE", "RECOVERY_ACTIVE"]);
    expect(d30.dailyPlan.triggered_rules.map((t) => t.rule_id)).not.toContain("V2_INTERVALS_LIGHT_FALLBACK");
    await insertCheckin(admin, r.athleteId, "2026-11-13", { ...SYSTEMIC_RED, available_minutes_today: 15 });
    const d15 = await runDailyFor(admin, r.athleteId, "2026-11-13");
    expect([d15.dailyPlan.decision, d15.dailyPlan.final_session.kind, d15.finalPrescriptionStatus]).toEqual(["REST", "REST", "not_required"]);
  });

  it("D — the rider's time (A10): 50 min → base endurance 45 min (intervals never cut); 40 min → active recovery", async () => {
    const r = await rider("D", true);
    await insertCheckin(admin, r.athleteId, "2026-10-23", { available_minutes_today: 50 });
    const d50 = await runDailyFor(admin, r.athleteId, "2026-10-23");
    const f50 = await finalOf(d50.persistence.decision_id);
    expect([d50.dailyPlan.decision, d50.dailyPlan.final_session.kind, f50.reconciliation_action, minutesOf(f50.structure)]).toEqual(["REPLACE", "AEROBIC_BASE", "replace", [10, 30, 5]]);
    await insertCheckin(admin, r.athleteId, "2026-11-13", { available_minutes_today: 40 });
    const d40 = await runDailyFor(admin, r.athleteId, "2026-11-13");
    expect([d40.dailyPlan.decision, d40.dailyPlan.final_session.kind]).toEqual(["REPLACE", "RECOVERY_ACTIVE"]);
  });

  it("E2 — health first (P0-SAFE A6 → A7): a strong pain declared the day before keeps coaching suspended on the intervals day — no session, no fallback", async () => {
    const r = await rider("E2", true);
    await insertCheckin(admin, r.athleteId, "2026-10-22", { pain: true, pain_intensity: 7, pain_new: false, pain_location_code: "knee_R", pain_traumatic: false, pain_function_loss: false, pain_getting_worse: false });
    expect((await runDailyFor(admin, r.athleteId, "2026-10-22")).dailyPlan.decision).toBe("REST");
    await insertCheckin(admin, r.athleteId, "2026-10-23");
    const d = await runDailyFor(admin, r.athleteId, "2026-10-23");
    expect([d.dailyPlan.decision, d.dailyPlan.final_session.kind]).toEqual(["REST", "REST"]);
    expect(d.dailyPlan.triggered_rules.map((t) => t.rule_id)).not.toContain("V2_INTERVALS_LIGHT_FALLBACK");
    const { data } = await admin.from("decision_final_prescriptions").select("id").eq("decision_id", d.persistence.decision_id);
    expect(data).toEqual([]);
  });

  it("E — health first (P0-SAFE unchanged): a traumatic pain on an intervals day → no session at all", async () => {
    const r = await rider("E", true);
    await insertCheckin(admin, r.athleteId, "2026-10-23", { pain: true, pain_intensity: 7, pain_new: false, pain_location_code: "knee_R", pain_traumatic: true, pain_function_loss: false, pain_getting_worse: false });
    const d = await runDailyFor(admin, r.athleteId, "2026-10-23");
    expect(d.dailyPlan.decision).toBe("REST");
    expect(d.finalPrescriptionStatus).not.toBe("created");
    const { data } = await admin.from("decision_final_prescriptions").select("id").eq("decision_id", d.persistence.decision_id);
    expect(data).toEqual([]);
  });

  it("F — without the option: the plan of the same rider profile has no intervals session (the previous plans)", async () => {
    const r = await rider("F", false);
    expect(r.aerobic.map((s) => [s.date, s.kind, s.duration_min])).toEqual([
      ["2026-10-09", "AEROBIC_BASE", 45],
      ["2026-10-16", "AEROBIC_BASE", 45],
      ["2026-10-23", "AEROBIC_BASE", 60],
      ["2026-11-06", "AEROBIC_BASE", 60],
      ["2026-11-13", "AEROBIC_BASE", 75],
    ]);
  });
});
