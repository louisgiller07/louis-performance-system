/**
 * A10 — the rider's time today, end to end (local Supabase, real M1, real
 * reconciliation, real persist_daily_run_v2 and record_session_execution).
 *
 * Contract: with `daily_checkins.available_minutes_today` = X, no executable
 * final prescription asks for more than X minutes; the decision says the
 * same session (A07); the choice is traced (V2_TODAY_TIME_CONSTRAINT).
 * Plan: 6 weeks generated the eve of 2026-10-05, all-day windows, no
 * history (introduction, then MODERATE weeks). Days are picked by kind,
 * load and duration from the generated plan, never hard-coded.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, insertCheckin, isLoopbackSupabaseUrl, resolveTestSupabaseUrl, setAthleteDiscipline, type CheckinFixture } from "./testDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { generateAndPersistTrainingPlanV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { runDailyFor } from "../../src/supabase/runDailyFor.js";
import { V2_TODAY_TIME_CONSTRAINT_RULE_ID } from "../../src/supabase/dailyV2/applyV2TodayTimeConstraint.js";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const INTEGRATION_ENABLED = process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" && !!SERVER_KEY && isLoopbackSupabaseUrl(resolveTestSupabaseUrl());

const SYSTEMIC_RED: CheckinFixture = { sleep_hours: 4, sleep_quality: 2, sleep_wake_ups: 4, energy: 2 };

type Rule = { rule_id: string; detail: string };
type StoredPlan = {
  decision: string;
  final_session: { kind: string; load_profile?: string; duration_min?: number };
  training: { duration_min?: number; objective?: string };
  triggered_rules: Rule[];
  decision_reasoning?: Rule[];
  dh_or_technical: { active: boolean };
};
type Structure = { family: string; sessionKind: string; blocks: { role: string; durationMinutes?: { min: number; max: number }; items: { kind: string; measure: { count?: number } }[] }[] };
type Generated = { id: string; date: string; kind: string; load_profile: string | null; duration_min: number | null };

describe.skipIf(!INTEGRATION_ENABLED)("A10 — the rider's time today (local Supabase)", () => {
  let admin: SupabaseClient;
  let athleteId: string;
  let sessions: Generated[];
  const used = new Set<string>();

  /** The first unused generated session matching, its date reserved for one scenario. */
  function day(kind: string | ((k: string) => boolean), load: string | null, minDuration = 0): string {
    const s = sessions.find((g) => (typeof kind === "string" ? g.kind === kind : kind(g.kind)) && (load === null || g.load_profile === load) && (g.duration_min ?? 0) >= minDuration && !used.has(g.date));
    if (!s) throw new Error(`no free ${String(kind)} ${load} ≥${minDuration}`);
    used.add(s.date);
    return s.date;
  }
  const isForce = (k: string) => k === "STRENGTH_LOWER" || k === "STRENGTH_UPPER";

  async function decisions(d: string) {
    const { data } = await admin.from("decisions").select("id, daily_plan, final_prescription_status").eq("athlete_id", athleteId).eq("decision_date", d).order("created_at", { ascending: false });
    return data as { id: string; daily_plan: StoredPlan; final_prescription_status: string }[];
  }
  async function finalOf(decisionId: string) {
    const { data } = await admin.from("decision_final_prescriptions").select("id, reconciliation_action, adaptation_rule_ids, structure").eq("decision_id", decisionId);
    return (data as { id: string; reconciliation_action: string; adaptation_rule_ids: string[]; structure: Structure }[])[0];
  }
  async function setTime(d: string, minutes: number | null) {
    const { error } = await admin.from("daily_checkins").update({ available_minutes_today: minutes }).eq("athlete_id", athleteId).eq("checkin_date", d);
    if (error) throw new Error(error.message);
  }
  async function currency(decisionId: string) {
    const { data } = await admin.from("daily_decision_currency").select("is_current").eq("decision_id", decisionId).single();
    return (data as { is_current: boolean }).is_current;
  }
  const record = async (payload: unknown) => {
    const { data, error } = await admin.rpc("record_session_execution", { p_athlete_id: athleteId, p_payload: payload });
    if (error) throw new Error(error.message);
    return data as { status: string; code?: string };
  };
  function start(fpId: string, d: string) {
    const id = randomUUID();
    return { id, payload: { execution: { id, session_date: d, started_at: `${d}T17:00:00Z`, final_prescription_id: fpId }, events: [{ id: randomUUID(), execution_id: id, event_type: "started", occurred_at: `${d}T17:00:00Z` }] } };
  }

  /** The contract, on what was persisted: the decision and its prescription ask for at most X minutes. */
  async function assertWithin(d: string, x: number) {
    const [latest] = await decisions(d);
    const plan = latest!.daily_plan;
    if (plan.final_session.duration_min !== undefined) expect(plan.final_session.duration_min).toBeLessThanOrEqual(x);
    const fp = await finalOf(latest!.id);
    if (fp !== undefined) {
      const blocksMax = fp.structure.blocks.every((b) => b.durationMinutes) ? fp.structure.blocks.reduce((s, b) => s + b.durationMinutes!.max, 0) : null;
      expect(blocksMax ?? plan.final_session.duration_min!).toBeLessThanOrEqual(x);
      expect(fp.structure.sessionKind).toBe(plan.final_session.kind);
    }
    return { latest: latest!, plan, fp };
  }

  beforeAll(async () => {
    admin = createTestClient();
    athleteId = (await createTestAthlete(admin, "A10 today time")).athleteId;
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
    const persisted = await generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 6, today: "2026-10-04" });
    if (persisted.status !== "persisted") throw new Error("plan");
    await acceptTrainingPlanVersion(admin, athleteId, persisted.planVersionId, "2026-10-05", "2026-11-15");
    const { data } = await admin.from("training_plan_generated_sessions").select("id, date, kind, load_profile, duration_min").eq("plan_version_id", persisted.planVersionId).order("date");
    sessions = data as Generated[];
  }, 120_000);

  it("A — no time given: historical behaviour (KEEP, no time trace)", async () => {
    const d = day(isForce, "MODERATE");
    await insertCheckin(admin, athleteId, d);
    const r = await runDailyFor(admin, athleteId, d);
    expect(r.dailyPlan.decision).toBe("KEEP");
    expect(r.dailyPlan.triggered_rules.some((t) => t.rule_id === V2_TODAY_TIME_CONSTRAINT_RULE_ID)).toBe(false);
  });

  it("B then C — 90 min for a 60-min Force: KEEP (traced « fits »); the rider changes to 45 and recalculates: MODIFY → real LIGHT Force 45 everywhere", async () => {
    const d = day(isForce, "MODERATE");
    await insertCheckin(admin, athleteId, d, { available_minutes_today: 90 });
    const b = await runDailyFor(admin, athleteId, d);
    expect([b.dailyPlan.decision, b.dailyPlan.final_session.duration_min]).toEqual(["KEEP", 60]);
    expect(b.dailyPlan.triggered_rules.find((t) => t.rule_id === V2_TODAY_TIME_CONSTRAINT_RULE_ID)?.detail).toMatch(/90 min.*Action : fits/);
    expect(b.dailyPlan.decision_reasoning?.some((t) => t.rule_id === V2_TODAY_TIME_CONSTRAINT_RULE_ID)).toBe(false);

    await setTime(d, 45);
    const c = await runDailyFor(admin, athleteId, d);
    expect(c.dailyPlan.decision).toBe("MODIFY");
    const { plan, fp } = await assertWithin(d, 45);
    expect(plan.final_session).toMatchObject({ load_profile: "LIGHT", duration_min: 45 });
    expect(plan.training.duration_min).toBe(45);
    expect(fp).toMatchObject({ reconciliation_action: "modify", adaptation_rule_ids: ["v2.modify.strength_light_dose", "v2.time.today_limit"] });
    expect(plan.decision_reasoning?.find((t) => t.rule_id === V2_TODAY_TIME_CONSTRAINT_RULE_ID)?.detail).toBe("Tu as 45 min aujourd'hui : la séance a été allégée pour tenir dans ce temps.");
    expect(plan.training.objective).toBe("Tu as 45 min aujourd'hui : la séance a été allégée pour tenir dans ce temps.");
    expect(plan.triggered_rules.find((t) => t.rule_id === V2_TODAY_TIME_CONSTRAINT_RULE_ID)?.detail).toMatch(/45 min\. Avant : KEEP STRENGTH_\w+ MODERATE 60 min\. Action : adapted → MODIFY STRENGTH_\w+ LIGHT 45 min\./);
  });

  it("D — Force 60 + 30 min: no « 30-min Force »; active recovery inside 30 min (REPLACE)", async () => {
    const d = day(isForce, "MODERATE");
    await insertCheckin(admin, athleteId, d, { available_minutes_today: 30 });
    const r = await runDailyFor(admin, athleteId, d);
    expect(r.dailyPlan.decision).toBe("REPLACE");
    const { plan, fp } = await assertWithin(d, 30);
    expect([plan.final_session.kind, fp!.structure.family]).toEqual(["RECOVERY_ACTIVE", "recovery"]);
    expect(plan.training.objective).toBe("Tu as 30 min aujourd'hui : la séance prévue ne tient pas dans ce temps, récupération active à la place.");
  });

  it("E — endurance 60 + 45 min: MODIFY → the same protocol at 45 min", async () => {
    const d = day("AEROBIC_BASE", null, 60);
    await insertCheckin(admin, athleteId, d, { available_minutes_today: 45 });
    await runDailyFor(admin, athleteId, d);
    const { plan, fp } = await assertWithin(d, 45);
    expect([plan.decision, plan.final_session.duration_min, fp!.structure.family, fp!.structure.blocks.reduce((s, b) => s + b.durationMinutes!.max, 0)]).toEqual(["MODIFY", 45, "endurance", 45]);
    expect(plan.training.objective).toBe("Tu as 45 min aujourd'hui : la séance a été raccourcie pour tenir dans ce temps.");
  });

  it("F — DH 90 + 60 min: the planner's 60-min window, same drill, ≤ 5 passages; DH 90 + 30: no DH, recovery and the DH section off", async () => {
    const d60 = day("DH_TECHNICAL", "MODERATE", 90);
    await insertCheckin(admin, athleteId, d60, { available_minutes_today: 60 });
    await runDailyFor(admin, athleteId, d60);
    const a = await assertWithin(d60, 60);
    expect([a.plan.decision, a.plan.final_session.duration_min, a.plan.dh_or_technical.active]).toEqual(["MODIFY", 60, true]);
    expect(a.fp!.structure.blocks.flatMap((b) => b.items).filter((i) => i.kind === "drill").every((i) => i.measure.count! <= 5)).toBe(true);

    const d30 = day("DH_TECHNICAL", "MODERATE", 90);
    await insertCheckin(admin, athleteId, d30, { available_minutes_today: 30 });
    await runDailyFor(admin, athleteId, d30);
    const b = await assertWithin(d30, 30);
    expect([b.plan.final_session.kind, b.plan.dh_or_technical.active]).toEqual(["RECOVERY_ACTIVE", false]);
  });

  it("H — 15 min: REST, no prescription, nothing invented", async () => {
    const d = day(() => true, null);
    await insertCheckin(admin, athleteId, d, { available_minutes_today: 15 });
    const r = await runDailyFor(admin, athleteId, d);
    expect([r.dailyPlan.decision, r.finalPrescriptionStatus]).toEqual(["REST", "not_required"]);
    const { latest, fp } = await assertWithin(d, 15);
    expect([latest.daily_plan.final_session.kind, fp]).toEqual(["REST", undefined]);
    expect(latest.daily_plan.training.objective).toBe("Tu as 15 min aujourd'hui : aucune séance ne tient honnêtement dans ce temps, repos aujourd'hui.");
  });

  it("I / J — 60 then 30 and recalculation: a new decision D2 (≤ 30), D1 stale and its prescription no longer startable; a reload reads D2 again", async () => {
    const d = day(isForce, "MODERATE");
    await insertCheckin(admin, athleteId, d, { available_minutes_today: 60 });
    await runDailyFor(admin, athleteId, d);
    const [d1] = await decisions(d);
    const fp1 = await finalOf(d1!.id);
    expect(await currency(d1!.id)).toBe(true);

    await setTime(d, 30);
    expect(await currency(d1!.id)).toBe(false);
    await runDailyFor(admin, athleteId, d);
    const all = await decisions(d);
    expect(all).toHaveLength(2);
    const { latest, fp: fp2 } = await assertWithin(d, 30);
    expect(latest.id).not.toBe(d1!.id);
    expect(await currency(latest.id)).toBe(true);
    expect((await record(start(fp1!.id, d).payload)).code).toBe("final_prescription_not_current");

    // J — a reload (fresh reads) finds the same current decision and prescription.
    const [again] = await decisions(d);
    expect([again!.id, (await finalOf(again!.id))!.id]).toEqual([latest.id, fp2!.id]);
  });

  it("K — an execution already started keeps its frozen prescription: the new time makes D2, D1's execution stays and completes, no second main session", async () => {
    const d = day(isForce, "MODERATE");
    await insertCheckin(admin, athleteId, d);
    await runDailyFor(admin, athleteId, d);
    const [d1] = await decisions(d);
    const fp1 = await finalOf(d1!.id);
    const exec = start(fp1!.id, d);
    expect((await record(exec.payload)).status).toBe("ok");

    await setTime(d, 30);
    await runDailyFor(admin, athleteId, d);
    const [d2] = await decisions(d);
    const fp2 = await finalOf(d2!.id);
    expect(fp2!.structure.family).toBe("recovery");
    expect((await record(start(fp2!.id, d).payload)).code).toBe("active_execution_exists");

    const { data: row } = await admin.from("session_executions").select("final_prescription_id, decision_id").eq("id", exec.id).single();
    expect(row).toEqual({ final_prescription_id: fp1!.id, decision_id: d1!.id });
    const work = fp1!.structure.blocks.filter((b) => b.role === "main" || b.role === "complementary").flatMap((b) => b.items)[0] as unknown as { prescriptionItemId: string; measure: { type: string } };
    const done = await record({
      sets: [{ id: randomUUID(), execution_id: exec.id, prescription_item_id: work.prescriptionItemId, set_number: 1, done: true, measure_type: work.measure.type, measure_value: work.measure.type === "duration" ? 30 : 8, occurred_at: `${d}T17:30:00Z` }],
      events: [{ id: randomUUID(), execution_id: exec.id, event_type: "completed", occurred_at: `${d}T18:00:00Z` }],
    });
    expect(done.status).toBe("ok");
  });

  it("L — M1 MODIFY (systemic RED, Force LIGHT 45) + 30 min: recovery, the load never goes back up, both reasons kept", async () => {
    const d = day(isForce, "MODERATE");
    await insertCheckin(admin, athleteId, d, { ...SYSTEMIC_RED, available_minutes_today: 30 });
    const r = await runDailyFor(admin, athleteId, d);
    expect(r.dailyPlan.decision).toBe("REPLACE");
    const { plan } = await assertWithin(d, 30);
    expect(plan.final_session.kind).toBe("RECOVERY_ACTIVE");
    expect(plan.triggered_rules.map((t) => t.rule_id)).toEqual(expect.arrayContaining(["C3.3", V2_TODAY_TIME_CONSTRAINT_RULE_ID]));
    expect(plan.triggered_rules.find((t) => t.rule_id === V2_TODAY_TIME_CONSTRAINT_RULE_ID)?.detail).toMatch(/Avant : MODIFY STRENGTH_\w+ LIGHT 45 min/);
  });

  it("an M1 MODIFY (systemic RED) + 60 min: the LIGHT Force fits, nothing else changes", async () => {
    const d = day(isForce, "MODERATE");
    await insertCheckin(admin, athleteId, d, { ...SYSTEMIC_RED, available_minutes_today: 60 });
    const r = await runDailyFor(admin, athleteId, d);
    expect([r.dailyPlan.decision, r.dailyPlan.final_session.load_profile, r.dailyPlan.final_session.duration_min]).toEqual(["MODIFY", "LIGHT", 45]);
  });

  it("the DB refuses a non-positive time", async () => {
    const d = day(() => true, null);
    const { error } = await admin.from("daily_checkins").insert({ athlete_id: athleteId, checkin_date: d, sleep_hours: 8, available_minutes_today: 0 });
    expect(error?.message).toMatch(/daily_checkins_available_minutes_today_check/);
  });
});
