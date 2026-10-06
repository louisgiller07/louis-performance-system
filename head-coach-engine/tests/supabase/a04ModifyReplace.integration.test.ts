/**
 * A04 — every daily decision of a V2 athlete ends in something executable
 * (local Supabase, real M1, real reconciliation, real persist_daily_run_v2 and
 * record_session_execution).
 *
 * Plan (generated the eve of 2026-10-05, all-day windows, no history):
 * week 1 = introduction (LIGHT): DH 10-05/06, LOWER 10-07, UPPER 10-08, AEROBIC 10-09;
 * week 2 = build (MODERATE): DH 10-12/13, LOWER 10-14, UPPER 10-15, AEROBIC 10-16.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, insertCheckin, insertRace, isLoopbackSupabaseUrl, resolveTestSupabaseUrl, setAthleteDiscipline, type CheckinFixture } from "./testDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { generateAndPersistTrainingPlanV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { runDailyFor } from "../../src/supabase/runDailyFor.js";
import { computeDailyFor } from "../../src/supabase/computeDailyFor.js";
import { V2_SYSTEMIC_FLOOR_RULE_ID } from "../../src/supabase/dailyV2/applyV2SystemicFloor.js";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const INTEGRATION_ENABLED = process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" && !!SERVER_KEY && isLoopbackSupabaseUrl(resolveTestSupabaseUrl());

const SYSTEMIC_RED: CheckinFixture = { sleep_hours: 4, sleep_quality: 2, sleep_wake_ups: 4, energy: 2 };
const GRIP_RED: CheckinFixture = { grip_fatigue: 9 };
const UNSAFE: CheckinFixture = { fever_or_illness: true };

type Structure = {
  family: string;
  sessionKind: string;
  blocks: { role: string; items: { kind: string; prescriptionItemId: string; derivedFromItemId?: string; sets?: number; rpeTarget?: { max: number }; drillId?: string; measure: { type: string; count?: number } }[] }[];
};

describe.skipIf(!INTEGRATION_ENABLED)("A04 — MODIFY / REPLACE executable prescriptions (local Supabase)", () => {
  let admin: SupabaseClient;
  let athleteId: string;
  let planVersionId: string;

  const record = async (payload: unknown) => {
    const { data, error } = await admin.rpc("record_session_execution", { p_athlete_id: athleteId, p_payload: payload });
    if (error) throw new Error(error.message);
    return data as { status: string; code?: string };
  };
  function execution(fpId: string, day: string) {
    const id = randomUUID();
    return {
      id,
      start: { execution: { id, session_date: day, started_at: `${day}T17:00:00Z`, final_prescription_id: fpId }, events: [{ id: randomUUID(), execution_id: id, event_type: "started", occurred_at: `${day}T17:00:00Z` }] },
      complete: (sets: unknown[] = []) => ({ sets, events: [{ id: randomUUID(), execution_id: id, event_type: "completed", occurred_at: `${day}T18:00:00Z` }] }),
      set: (item: Structure["blocks"][number]["items"][number], n = 1) => ({
        id: randomUUID(),
        execution_id: id,
        prescription_item_id: item.prescriptionItemId,
        set_number: n,
        done: true,
        measure_type: item.measure.type,
        measure_value: item.measure.type === "pass" ? null : item.measure.type === "duration" ? 30 : 8,
        occurred_at: `${day}T17:30:00Z`,
      }),
    };
  }
  async function decisionOn(day: string) {
    const { data } = await admin.from("decisions").select("id, daily_plan, final_prescription_status, final_prescription_status_code").eq("athlete_id", athleteId).eq("decision_date", day).order("created_at", { ascending: false });
    return data![0]!;
  }
  async function finalOf(decisionId: string) {
    const { data } = await admin.from("decision_final_prescriptions").select("id, reconciliation_action, adaptation_rule_ids, planned_prescription_id, structure").eq("decision_id", decisionId);
    return data!;
  }
  async function plannedStructure(day: string): Promise<Structure> {
    const { data: s } = await admin.from("training_plan_generated_sessions").select("id").eq("plan_version_id", planVersionId).eq("date", day).single();
    const { data: p } = await admin.from("training_plan_planned_prescriptions").select("structure").eq("generated_plan_session_id", s!.id).single();
    return p!.structure as Structure;
  }
  const work = (st: Structure) => st.blocks.filter((b) => b.role === "main" || b.role === "complementary").flatMap((b) => b.items);

  beforeAll(async () => {
    admin = createTestClient();
    athleteId = (await createTestAthlete(admin, "A04 modify replace")).athleteId;
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
    planVersionId = persisted.planVersionId;
    await acceptTrainingPlanVersion(admin, athleteId, planVersionId, "2026-10-05", "2026-10-18");
  }, 90_000);

  it("A — KEEP: the planned prescription, verbatim, executable", async () => {
    const day = "2026-10-12";
    await insertCheckin(admin, athleteId, day);
    const r = await runDailyFor(admin, athleteId, day);
    expect([r.dailyPlan.decision, r.finalPrescriptionStatus]).toEqual(["KEEP", "created"]);
    const [f] = await finalOf((await decisionOn(day)).id);
    expect(f).toMatchObject({ reconciliation_action: "keep", adaptation_rule_ids: [] });
    expect(f!.structure).toEqual(await plannedStructure(day));
  });

  it("B — REST: not_required, no final prescription (nothing to start)", async () => {
    const day = "2026-10-11";
    await insertCheckin(admin, athleteId, day, UNSAFE);
    const r = await runDailyFor(admin, athleteId, day);
    expect([r.dailyPlan.decision, r.finalPrescriptionStatus]).toEqual(["REST", "not_required"]);
    expect(await finalOf((await decisionOn(day)).id)).toEqual([]);
  });

  it("C — MODIFY DH (systemic RED, MODERATE → LIGHT): same drill, 4 passages, lineage; started, a pass recorded on the adapted item, completed", async () => {
    const day = "2026-10-13";
    await insertCheckin(admin, athleteId, day, SYSTEMIC_RED);
    const r = await runDailyFor(admin, athleteId, day);
    expect([r.dailyPlan.decision, r.dailyPlan.final_session.kind, r.dailyPlan.final_session.load_profile, r.finalPrescriptionStatus]).toEqual(["MODIFY", "DH_TECHNICAL", "LIGHT", "created"]);
    const [f] = await finalOf((await decisionOn(day)).id);
    const planned = await plannedStructure(day);
    const st = f!.structure as Structure;
    const drill = st.blocks.find((b) => b.role === "main")!.items[0]!;
    const plannedDrill = planned.blocks.find((b) => b.role === "main")!.items[0]!;
    expect(f).toMatchObject({ reconciliation_action: "modify", adaptation_rule_ids: ["v2.modify.dh_light_passes"] });
    expect(f!.planned_prescription_id).not.toBeNull();
    expect([drill.drillId, drill.measure.count, drill.derivedFromItemId]).toEqual([plannedDrill.drillId, 4, plannedDrill.prescriptionItemId]);
    const e = execution(f!.id, day);
    expect(await record(e.start)).toMatchObject({ status: "ok" });
    expect(await record(e.complete([e.set(drill)]))).toMatchObject({ status: "ok" });
  });

  it("D — MODIFY Force (systemic RED, MODERATE → LIGHT): the planned exercises at the LIGHT dose; F-6C applies on the adapted items", async () => {
    const day = "2026-10-15";
    await insertCheckin(admin, athleteId, day, SYSTEMIC_RED);
    const r = await runDailyFor(admin, athleteId, day);
    expect([r.dailyPlan.decision, r.dailyPlan.final_session.kind, r.dailyPlan.final_session.load_profile]).toEqual(["MODIFY", "STRENGTH_UPPER", "LIGHT"]);
    const [f] = await finalOf((await decisionOn(day)).id);
    const st = f!.structure as Structure;
    const planned = await plannedStructure(day);
    expect(f!.adaptation_rule_ids).toEqual(["v2.modify.strength_light_dose"]);
    expect(work(st).map((i) => [i.sets, i.rpeTarget!.max <= 6])).toEqual(work(planned).map(() => [expect.any(Number), true]));
    expect(work(st)[0]!.sets).toBeLessThan(work(planned)[0]!.sets!);
    const e = execution(f!.id, day);
    expect(await record(e.start)).toMatchObject({ status: "ok" });
    expect(await record(e.complete())).toMatchObject({ status: "rejected", code: "strength_set_required" });
    expect(await record(e.complete([e.set(work(st)[0]!)]))).toMatchObject({ status: "ok" });
  });

  it("F — REPLACE DH technical → DH light (grip RED, M1 C3.5): the same drill at 4 passages, executable", async () => {
    const day = "2026-10-06";
    await insertCheckin(admin, athleteId, day, GRIP_RED);
    const r = await runDailyFor(admin, athleteId, day);
    expect([r.dailyPlan.decision, r.dailyPlan.final_session.kind, r.finalPrescriptionStatus]).toEqual(["REPLACE", "DH_LIGHT", "created"]);
    const [f] = await finalOf((await decisionOn(day)).id);
    const st = f!.structure as Structure;
    expect(f).toMatchObject({ reconciliation_action: "replace", planned_prescription_id: null, adaptation_rule_ids: ["v2.replace.dh"] });
    expect([st.family, st.sessionKind, st.blocks.find((b) => b.role === "main")!.items[0]!.measure.count]).toEqual(["dh_technical", "DH_LIGHT", 4]);
    const e = execution(f!.id, day);
    expect(await record(e.start)).toMatchObject({ status: "ok" });
    expect(await record(e.complete([e.set(st.blocks.find((b) => b.role === "main")!.items[0]!)]))).toMatchObject({ status: "ok" });
  });

  it("G — SYSTEMIC RED on a LIGHT Force day: never the same Force kept; REPLACE → active recovery, traced, executable without results", async () => {
    const day = "2026-10-07"; // week 1: STRENGTH_LOWER LIGHT
    await insertCheckin(admin, athleteId, day, SYSTEMIC_RED);
    const r = await runDailyFor(admin, athleteId, day);
    expect([r.dailyPlan.decision, r.dailyPlan.final_session.kind, r.finalPrescriptionStatus]).toEqual(["REPLACE", "RECOVERY_ACTIVE", "created"]);
    const decision = await decisionOn(day);
    const plan = decision.daily_plan as { decision: string; triggered_rules: { rule_id: string }[]; decision_reasoning: { rule_id: string }[]; reasoning: string };
    expect(plan.decision).toBe("REPLACE");
    expect(plan.triggered_rules.map((t) => t.rule_id)).toEqual(expect.arrayContaining(["C3.3", V2_SYSTEMIC_FLOOR_RULE_ID]));
    expect(plan.decision_reasoning.map((t) => t.rule_id)).toContain(V2_SYSTEMIC_FLOOR_RULE_ID);
    expect(plan.reasoning).toMatch(/récupération active à la place/);
    const [f] = await finalOf(decision.id);
    expect(f).toMatchObject({ reconciliation_action: "replace", adaptation_rule_ids: ["v2.replace.recovery_active"] });
    expect((f!.structure as Structure).family).toBe("recovery");
    const e = execution(f!.id, day);
    expect(await record(e.start)).toMatchObject({ status: "ok" });
    expect(await record(e.complete())).toMatchObject({ status: "ok" });
  });

  it("H — an adapted prescription of a superseded decision is no longer executable; the new decision's one is", async () => {
    const day = "2026-10-14"; // week 2: STRENGTH_LOWER MODERATE
    await insertCheckin(admin, athleteId, day, SYSTEMIC_RED);
    const run1 = await runDailyFor(admin, athleteId, day);
    expect(run1.finalPrescription!.reconciliationAction).toBe("modify");
    const { error } = await admin.from("daily_checkins").update({ sleep_hours: 8, sleep_quality: 8, sleep_wake_ups: 0, energy: 8 }).eq("athlete_id", athleteId).eq("checkin_date", day);
    expect(error).toBeNull();
    const run2 = await runDailyFor(admin, athleteId, day);
    expect([run2.dailyPlan.decision, run2.finalPrescription!.reconciliationAction]).toEqual(["KEEP", "keep"]);
    expect(await record(execution(run1.finalPrescription!.id, day).start)).toMatchObject({ status: "rejected", code: "final_prescription_not_current" });
    expect(await record(execution(run2.finalPrescription!.id, day).start)).toMatchObject({ status: "ok" });
  });

  it("I — reload: the stored document is exactly the one the run returned (Today and Guided read that row)", async () => {
    const day = "2026-10-16"; // AEROBIC_BASE MODERATE
    await insertCheckin(admin, athleteId, day, SYSTEMIC_RED);
    const r = await runDailyFor(admin, athleteId, day);
    const [f] = await finalOf((await decisionOn(day)).id);
    expect(f!.id).toBe(r.finalPrescription!.id);
    expect(f!.structure).toEqual(JSON.parse(JSON.stringify(r.finalPrescription!.structure)));
  });

  it("J — after the session: the execution is attached to the ADAPTED prescription and its decision; M1 counts the decision's final session", async () => {
    const { data: execs } = await admin.from("session_executions").select("session_date, decision_id, final_prescription_id").eq("athlete_id", athleteId).eq("session_date", "2026-10-07");
    const decision = await decisionOn("2026-10-07");
    const [f] = await finalOf(decision.id);
    expect(execs).toEqual([{ session_date: "2026-10-07", decision_id: decision.id, final_prescription_id: f!.id }]);
    await insertCheckin(admin, athleteId, "2026-10-08");
    const { rawContext } = await computeDailyFor(admin, athleteId, "2026-10-08");
    expect(rawContext.recent_sessions.find((s) => s.date === "2026-10-07")).toMatchObject({ intervention: { kind: "RECOVERY_ACTIVE" }, completion_status: "done" });
  });

  it("K — §6 reachable on a normal V2 path: the T-6 race protocol (DH_TECHNICAL MODERATE) over a planned taper DH LIGHT → MODIFY upward → blocked upward_modify_not_supported (M1 logic ticket, not fixed here)", async () => {
    const { athleteId: rider } = await createTestAthlete(admin, "A04 upward modify T-6");
    await setAthleteDiscipline(admin, rider, "Downhill");
    await upsertPerformanceProfileFor(admin, rider, {
      strength_experience_tier: "intermediate",
      equipment: ["dumbbells", "bench"],
      terrain_access: ["flow_trail", "bermed_trail"],
      declared_limitations: [],
      technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
      dh_technical_tier: "intermediate",
    });
    // Physical Monday–Thursday evenings, riding on Sunday only.
    for (const d of [1, 2, 3, 4]) await insertAvailabilityWindow(admin, rider, { day_of_week: d, start_time: "18:00:00", end_time: "19:30:00", activity: "physical" });
    await insertAvailabilityWindow(admin, rider, { day_of_week: 0, start_time: "08:00:00", end_time: "18:00:00", activity: "riding" });
    await insertRace(admin, rider, { event_name: "Hot Trail", start_date: "2026-10-24", end_date: "2026-10-25", priority: "A", race_format: "HOT_TRAIL_2DAY" });
    // Generated on Monday 10-05 → starts 10-06: race_specific, taper (10-13..10-19), race week.
    const p = await generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId: rider, generationRequestId: randomUUID(), durationWeeks: 3, today: "2026-10-05" });
    if (p.status !== "persisted") throw new Error("plan");
    await acceptTrainingPlanVersion(admin, rider, p.planVersionId, "2026-10-06", "2026-10-26");
    const { data: dh } = await admin.from("training_plan_generated_sessions").select("kind, load_profile").eq("plan_version_id", p.planVersionId).eq("date", "2026-10-18").single();
    expect(dh).toEqual({ kind: "DH_TECHNICAL", load_profile: "LIGHT" }); // the taper DH falls on T-6

    await insertCheckin(admin, rider, "2026-10-18");
    const r = await runDailyFor(admin, rider, "2026-10-18");
    expect([r.dailyPlan.decision, r.dailyPlan.final_session.kind, r.dailyPlan.final_session.load_profile]).toEqual(["MODIFY", "DH_TECHNICAL", "MODERATE"]);
    expect(r.finalPrescriptionStatus).toBe("blocked");
    expect(r.finalPrescriptionStatusCode).toBe("final_prescription_adaptation_not_defined");
    expect(r.finalPrescriptionStatusDetail).toMatchObject({ reason: "upward_modify_not_supported", planned: "LIGHT", final: "MODERATE" });
  });
});
