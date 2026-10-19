/**
 * SPORT-RACE-01 / 01P (HPM 2026-10-19) — the race week through the real paths (local Supabase): a real V2 plan built
 * around an A race, accepted and projected, a check-in, runDailyFor (production daily path, PHYS off).
 *
 * SPORT-RACE-01P (option P, proposed canon `docs/release/sport-race-01/SPORT_RACE_01P_CANON_DIFFS.md`): the PLAN places
 * the pre-event sessions of a format that has a protocol (RACE_PROTOCOL_PLAN_POLICY_V2, PROVISIONAL doses: the taper's
 * Force and DH, recovery_active_v1); M1 (frozen) keeps them (same kind and load, the DH capped); the daily path still
 * never invents a session (a day without a planned session: blocked final_prescription_no_lineage / no_planned_session).
 * - A format without a protocol (OTHER, SWISS_CUP, UCI_WC, none) gets nothing new: race week without session;
 * - Safety first; no duplicate session, prescription or execution; a late race changes the plan only through an
 *   explicit regeneration and acceptance (never silently), used days and executions untouched.
 * Nothing here is a validated sport choice.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, insertCheckin, isLoopbackSupabaseUrl, resolveTestSupabaseUrl, setAthleteDiscipline, type CheckinFixture } from "./testDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { buildPlanInputSnapshotV2 } from "../../src/supabase/buildPlanInputSnapshotV2.js";
import { generateAndPersistTrainingPlanV2, generateTrainingPlanVersionRpcV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { runDailyFor } from "../../src/supabase/runDailyFor.js";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const INTEGRATION_ENABLED = process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" && !!SERVER_KEY && isLoopbackSupabaseUrl(resolveTestSupabaseUrl());

const GENERATED_ON = "2026-11-01"; // Sunday: the plan starts Monday 2026-11-02, four weeks
const FIRST_DAY = "2026-11-02";
const LAST_DAY = "2026-11-29";
const WEEKEND_RACE = { start_date: "2026-11-21", end_date: "2026-11-22" }; // Sat–Sun: race week Mon 16 – Sun 22
const IXS_RACE = { start_date: "2026-11-20", end_date: "2026-11-22" }; // Fri–Sun
const CREATED = ["created", null, null];
const FEVER: CheckinFixture = { fever_or_illness: true };

type Race = { start_date: string; end_date: string; race_format?: string | null };

describe.skipIf(!INTEGRATION_ENABLED)("SPORT-RACE-01P — the race week on the real V2 paths (local Supabase)", () => {
  let admin: SupabaseClient;
  beforeAll(() => {
    admin = createTestClient();
  });

  /** SPORT-VALIDATION-01's rider C: intermediate Force, advanced DH, full gym, four terrains, weekday evenings "physical", weekends "riding". */
  async function generateAndAccept(athleteId: string, today: string, weeks: number, windowStart: string) {
    const persisted = await generateAndPersistTrainingPlanV2(
      { planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: weeks, today },
      { buildPlanInputSnapshotV2, callRpc: generateTrainingPlanVersionRpcV2, mintId: () => randomUUID() }
    );
    if (persisted.status !== "persisted") throw new Error("expected a persisted V2 plan");
    const { data: version } = await admin.from("training_plan_versions").select("horizon_end_date").eq("id", persisted.planVersionId).single();
    const accepted = await acceptTrainingPlanVersion(admin, athleteId, persisted.planVersionId, windowStart, version!.horizon_end_date as string);
    expect(accepted.warnings).toEqual([]);
    return persisted.planVersionId;
  }
  async function plannedRow(athleteId: string, date: string) {
    const { data } = await admin.from("planned_sessions").select("source, source_plan_version_id, intervention").eq("athlete_id", athleteId).eq("planned_date", date).maybeSingle();
    if (!data) return null;
    const i = data.intervention as { kind: string; load_profile?: string; duration_min?: number };
    return `${i.kind} ${i.load_profile ?? "-"} ${i.duration_min ?? "-"}`;
  }
  async function rider(name: string, race: Race | null, raceAfterPlan = false, threeSlots = false) {
    const { athleteId } = await createTestAthlete(admin, `SPORT-RACE-01 ${name}`);
    await setAthleteDiscipline(admin, athleteId, "Downhill");
    await upsertPerformanceProfileFor(admin, athleteId, {
      strength_experience_tier: "intermediate",
      equipment: ["barbell", "squat_rack", "dumbbells", "bench", "cable_machine", "pull_up_bar"],
      terrain_access: ["flow_trail", "bermed_trail", "technical_trail", "full_dh_track"],
      declared_limitations: [],
      technical_priorities: { strengths: [], weaknesses: ["braking"], priorityAreas: ["braking", "cornering"] },
      dh_technical_tier: "advanced",
    });
    if (threeSlots) {
      // SPORT-VALIDATION-01's rider B: Tuesday and Thursday evenings "physical", Saturday morning "riding".
      for (const d of [2, 4]) await insertAvailabilityWindow(admin, athleteId, { day_of_week: d, start_time: "18:30:00", end_time: "19:45:00", activity: "physical" });
      await insertAvailabilityWindow(admin, athleteId, { day_of_week: 6, start_time: "09:00:00", end_time: "12:00:00", activity: "riding" });
    } else {
      for (const d of [1, 2, 3, 4, 5]) await insertAvailabilityWindow(admin, athleteId, { day_of_week: d, start_time: "18:00:00", end_time: "20:00:00", activity: "physical" });
      for (const d of [6, 0]) await insertAvailabilityWindow(admin, athleteId, { day_of_week: d, start_time: "09:00:00", end_time: "17:00:00", activity: "riding" });
    }
    const insertRace = async () => {
      const { error } = await admin.from("race_calendar").insert({ athlete_id: athleteId, event_name: `SPORT-RACE-01 ${name}`, priority: "A", ...race });
      expect(error).toBeNull();
    };
    if (race && !raceAfterPlan) await insertRace();
    const persisted = await generateAndPersistTrainingPlanV2(
      { planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 4, today: GENERATED_ON },
      { buildPlanInputSnapshotV2, callRpc: generateTrainingPlanVersionRpcV2, mintId: () => randomUUID() }
    );
    if (persisted.status !== "persisted") throw new Error("expected a persisted V2 plan");
    const accepted = await acceptTrainingPlanVersion(admin, athleteId, persisted.planVersionId, FIRST_DAY, LAST_DAY);
    expect(accepted.warnings).toEqual([]);
    if (race && raceAfterPlan) await insertRace();
    return { athleteId, planVersionId: persisted.planVersionId };
  }
  async function weeks(planVersionId: string) {
    const { data: w } = await admin.from("training_plan_weeks").select("id, week_number, dose_summary").eq("plan_version_id", planVersionId).order("week_number");
    const { data: s } = await admin.from("training_plan_generated_sessions").select("week_id, date, kind, load_profile, duration_min").eq("plan_version_id", planVersionId).order("date");
    return w!.map((x) => ({
      role: (x.dose_summary as { progression?: { role?: string } }).progression?.role,
      sessions: s!.filter((y) => y.week_id === x.id).map((y) => `${y.date} ${y.kind} ${y.load_profile} ${y.duration_min}`),
    }));
  }
  /** One daily run; the day's decisions (append-only) and the final prescriptions of the latest one. */
  async function day(athleteId: string, date: string, checkin: CheckinFixture = {}, withCheckin = true) {
    if (withCheckin) await insertCheckin(admin, athleteId, date, checkin);
    const result = await runDailyFor(admin, athleteId, date);
    const { data: decisions } = await admin.from("decisions").select("id, final_prescription_status, final_prescription_status_code, final_prescription_status_detail").eq("athlete_id", athleteId).eq("decision_date", date).order("created_at");
    const latest = decisions!.at(-1)!;
    const { data: finals } = await admin.from("decision_final_prescriptions").select("id, structure, reconciliation_action").eq("decision_id", latest.id);
    const plan = result.dailyPlan;
    return {
      decisions: decisions!,
      finals: finals!,
      summary: [plan.decision, plan.final_session.kind, plan.final_session.load_profile ?? null, plan.final_session.duration_min ?? null],
      status: [latest.final_prescription_status, latest.final_prescription_status_code, (latest.final_prescription_status_detail as { reason?: string } | null)?.reason ?? null],
      rules: plan.triggered_rules.map((t) => t.rule_id).filter((id) => id !== "C3.7"),
    };
  }
  const NO_LINEAGE = ["blocked", "final_prescription_no_lineage", "no_planned_session"];

  it("HOT_TRAIL_2DAY (Sat–Sun), weekend riding: the taper DH moves from J-7 to the protocol's DH day (J-6), active recovery at J-4 and J-3; nothing else in the race week; one session per day", async () => {
    const r = await rider("plan", { ...WEEKEND_RACE, race_format: "HOT_TRAIL_2DAY" });
    const w = await weeks(r.planVersionId);
    expect(w.map((x) => x.role)).toEqual(["race_specific", "taper", "race", "introduction"]);
    expect(w[1]!.sessions).toEqual(["2026-11-09 STRENGTH_LOWER LIGHT 45", "2026-11-10 AEROBIC_BASE LIGHT 45", "2026-11-15 DH_TECHNICAL LIGHT 60"]);
    expect(w[2]!.sessions).toEqual(["2026-11-17 RECOVERY_ACTIVE null 20", "2026-11-18 RECOVERY_ACTIVE null 20"]);
    const dates = w.flatMap((x) => x.sessions.map((s) => s.slice(0, 10)));
    expect(new Set(dates).size).toBe(dates.length);
    // Projected like any generated session (fixed-load kind, no load).
    expect(await plannedRow(r.athleteId, "2026-11-17")).toBe("RECOVERY_ACTIVE - 20");
  });

  it("IXS_3DAY (Fri–Sun): the protocol days the plan placed are executable — J-7 upper-body Force, J-6 the taper DH (capped LIGHT), J-4 and J-3 active recovery; J-5 (no V2 30-min endurance), J-2 and J-1 stay recommendations without a daily prescription; T+1 replaces the planned Force", async () => {
    const r = await rider("ixs", { ...IXS_RACE, race_format: "IXS_3DAY" });
    const planned: [string, unknown[], string[]][] = [
      ["2026-11-13", ["KEEP", "STRENGTH_UPPER", "LIGHT", 45], ["RACE_PROTOCOL_TX"]],
      ["2026-11-14", ["KEEP", "DH_TECHNICAL", "LIGHT", 60], ["RACE_PROTOCOL_TX", "PLANNED_LOAD_CAP"]],
      ["2026-11-16", ["KEEP", "RECOVERY_ACTIVE", null, 20], ["RACE_PROTOCOL_TX"]],
      ["2026-11-17", ["KEEP", "RECOVERY_ACTIVE", null, 20], ["RACE_PROTOCOL_TX"]],
    ];
    for (const [date, summary, rules] of planned) {
      const d = await day(r.athleteId, date);
      expect(d.summary).toEqual(summary);
      expect(d.rules).toEqual(expect.arrayContaining(rules));
      expect(d.status).toEqual(CREATED);
      expect(d.finals.map((f) => f.reconciliation_action)).toEqual(["keep"]);
    }
    const advice: [string, unknown[]][] = [
      ["2026-11-15", ["KEEP", "AEROBIC_BASE", "LIGHT", 30]],
      ["2026-11-18", ["KEEP", "REST", null, null]],
      ["2026-11-19", ["KEEP", "RACE_ACTIVITY", null, null]],
    ];
    for (const [date, summary] of advice) {
      const d = await day(r.athleteId, date);
      expect(d.summary).toEqual(summary);
      expect(d.rules).toContain("RACE_PROTOCOL_TX");
      expect(d.status).toEqual(NO_LINEAGE);
      expect(d.finals).toEqual([]);
    }
    const race = await day(r.athleteId, "2026-11-20");
    expect(race.summary).toEqual(["KEEP", "RACE_ACTIVITY", null, null]);
    expect(race.rules).toContain("RACE_DAY_ACTIVE");
    expect(race.status).toEqual(NO_LINEAGE);
    const after = await day(r.athleteId, "2026-11-23");
    expect(after.summary).toEqual(["REPLACE", "RECOVERY_ACTIVE", null, null]);
    expect(after.rules).toContain("POST_EVENT");
    expect(after.status).toEqual(CREATED);
    expect(after.finals.map((f) => f.reconciliation_action)).toEqual(["replace"]);
  });

  it("formats without a T-X table — a Swiss Cup over two days, a UCI race over three, OTHER, no format: never the Hot Trail or iXS protocol; race week without session; M1's default recovery (INFERENCE_FALLBACK), no daily prescription", async () => {
    const cases: [string | null, Race][] = [
      ["SWISS_CUP", { ...WEEKEND_RACE, race_format: "SWISS_CUP" }],
      ["UCI_WC", { ...IXS_RACE, race_format: "UCI_WC" }],
      ["OTHER", { ...WEEKEND_RACE, race_format: "OTHER" }],
      [null, { ...WEEKEND_RACE, race_format: null }],
    ];
    for (const [race_format, raceRow] of cases) {
      const r = await rider(`format ${race_format ?? "none"}`, raceRow);
      const w = await weeks(r.planVersionId);
      expect(w[2]!.sessions).toEqual([]);
      expect(w.flatMap((x) => x.sessions).some((x) => x.includes("RECOVERY_ACTIVE"))).toBe(false);
      const d = await day(r.athleteId, "2026-11-18");
      expect(d.summary).toEqual(["KEEP", "RECOVERY_ACTIVE", null, null]);
      expect(d.rules).toContain("INFERENCE_FALLBACK");
      expect(d.rules).not.toContain("RACE_PROTOCOL_TX");
      expect(d.status).toEqual(NO_LINEAGE);
    }
  });

  it("HOT_TRAIL_2DAY on a weekend (SPORT-RACE-01P §2): the last DH is no longer replaced by upper-body Force — J-6 (its riding day) keeps it, LIGHT 60 and executable; J-7 is a recommendation without a planned session", async () => {
    const r = await rider("hot trail", { ...WEEKEND_RACE, race_format: "HOT_TRAIL_2DAY" });
    const t7 = await day(r.athleteId, "2026-11-14");
    expect(t7.summary).toEqual(["KEEP", "STRENGTH_UPPER", "LIGHT", null]);
    expect(t7.status).toEqual(NO_LINEAGE);
    const t6 = await day(r.athleteId, "2026-11-15");
    expect(t6.summary).toEqual(["KEEP", "DH_TECHNICAL", "LIGHT", 60]);
    expect(t6.rules).toEqual(expect.arrayContaining(["RACE_PROTOCOL_TX", "PLANNED_LOAD_CAP"]));
    expect(t6.status).toEqual(CREATED);
    expect(t6.finals.map((f) => f.reconciliation_action)).toEqual(["keep"]);
  });

  it("fatigue and pain still adapt the planned protocol session: a systemic RED on the J-6 DH, a knee pain 4/10 on the J-4 recovery", async () => {
    const r = await rider("tired", { ...WEEKEND_RACE, race_format: "HOT_TRAIL_2DAY" });
    const tired = await day(r.athleteId, "2026-11-15", { sleep_hours: 4, sleep_quality: 2, sleep_wake_ups: 4, energy: 2 });
    expect(tired.summary.slice(0, 2)).toEqual(["KEEP", "DH_TECHNICAL"]);
    expect(tired.rules).toContain("C3.3");
    const knee = await day(r.athleteId, "2026-11-17", { pain: true, pain_intensity: 4, pain_location_code: "knee_R" });
    expect(knee.summary.slice(0, 2)).toEqual(["KEEP", "RECOVERY_ACTIVE"]);
    expect(knee.rules).toContain("PAIN_NON_SAFETY");
    expect(knee.status).toEqual(CREATED);
  });

  it("AR-A — one riding slot (Saturday), HOT_TRAIL_2DAY on Saturday: the taper DH on J-7 cannot move and M1 would replace it by Force on a riding-only day — it leaves the plan, identifiably (version relaxed constraints); J-7 is advice only, never a Force session on that day", async () => {
    const r = await rider("one riding slot", { ...WEEKEND_RACE, race_format: "HOT_TRAIL_2DAY" }, false, true);
    const w = await weeks(r.planVersionId);
    expect(w[1]!.sessions).toEqual(["2026-11-10 STRENGTH_LOWER LIGHT 45", "2026-11-12 AEROBIC_BASE LIGHT 45"]);
    expect(w[2]!.sessions).toEqual(["2026-11-17 RECOVERY_ACTIVE null 20"]);
    const { data: version } = await admin.from("training_plan_versions").select("relaxed_constraints").eq("id", r.planVersionId).single();
    expect((version!.relaxed_constraints as unknown[]).filter((c) => (c as { reason: string }).reason.startsWith("race_protocol"))).toEqual([
      { constraintId: "placement_shortfall", reason: "race_protocol_incompatible_day", domain: "dh_technical", date: "2026-11-14" },
    ]);
    const t7 = await day(r.athleteId, "2026-11-14");
    expect(t7.summary).toEqual(["KEEP", "STRENGTH_UPPER", "LIGHT", null]);
    expect(t7.status).toEqual(NO_LINEAGE);
    expect(t7.finals).toEqual([]);
  });

  it("AR-C — a race on Monday: the protocol's rest at J-2 holds (the taper DH there leaves the plan, never moved), identifiably", async () => {
    const r = await rider("monday race", { start_date: "2026-11-23", end_date: "2026-11-24", race_format: "HOT_TRAIL_2DAY" });
    expect(await plannedRow(r.athleteId, "2026-11-21")).toBeNull();
    const { data: version } = await admin.from("training_plan_versions").select("relaxed_constraints").eq("id", r.planVersionId).single();
    expect((version!.relaxed_constraints as { reason: string; date?: string }[]).filter((c) => c.reason === "race_protocol_rest_day")).toEqual([
      { constraintId: "placement_shortfall", reason: "race_protocol_rest_day", domain: "dh_technical", date: "2026-11-21" },
    ]);
    const t2 = await day(r.athleteId, "2026-11-21");
    expect(t2.summary).toEqual(["KEEP", "REST", null, null]);
    expect(t2.rules).toContain("RACE_PROTOCOL_TX");
  });

  it("health first in the race week: a fever at J-2 is a Safety REST (not_required), never a race-protocol decision", async () => {
    const r = await rider("fever", { ...WEEKEND_RACE, race_format: "HOT_TRAIL_2DAY" });
    const d = await day(r.athleteId, "2026-11-19", FEVER);
    expect(d.summary).toEqual(["REST", "REST", null, null]);
    expect(d.rules).toContain("A3");
    expect(d.status).toEqual(["not_required", null, null]);
  });

  it("a race added after the plan (OTHER): no regeneration, the normal sessions stay at full load in the race week; race days replace them with RACE_ACTIVITY, which has no daily prescription", async () => {
    const r = await rider("added late", { ...WEEKEND_RACE, race_format: "OTHER" }, true);
    const w = await weeks(r.planVersionId);
    expect(w.map((x) => x.role)).toEqual(["introduction", "build", "build_plus", "consolidation"]);
    const j5 = await day(r.athleteId, "2026-11-16");
    expect(j5.summary).toEqual(["KEEP", "STRENGTH_LOWER", "MODERATE", 60]);
    expect(j5.status).toEqual(["created", null, null]);
    const race = await day(r.athleteId, "2026-11-21");
    expect(race.summary).toEqual(["REPLACE", "RACE_ACTIVITY", null, null]);
    expect(race.status).toEqual(["blocked", "final_prescription_adaptation_not_defined", "replace_target_not_supported"]);
  });

  it("a late race changes the plan only through an explicit regeneration and acceptance: before it the race week keeps its normal sessions; after it the protocol days are planned; the used day, its execution and its decision are untouched", async () => {
    const r = await rider("late", null);
    // The rider completes Monday 9's Force session (a used day), then adds a close race.
    const monday = await day(r.athleteId, "2026-11-09");
    expect(monday.status).toEqual(CREATED);
    const exec = randomUUID();
    const at = (min: number) => `2026-11-09T17:${String(min).padStart(2, "0")}:00Z`;
    type Item = { kind: string; prescriptionItemId: string; measure: { type: string; max?: number; maxSeconds?: number } };
    const prescription = monday.finals[0]! as unknown as { id: string; structure: { blocks: { role: string; items: Item[] }[] } };
    const work = prescription.structure.blocks.filter((b) => b.role === "main").flatMap((b) => b.items).filter((i) => i.kind === "exercise");
    const sets = work.slice(0, 1).map((i) => ({ id: randomUUID(), execution_id: exec, prescription_item_id: i.prescriptionItemId, set_number: 1, done: true, measure_type: i.measure.type, measure_value: i.measure.max ?? i.measure.maxSeconds ?? 8, rpe_actual: 6, occurred_at: at(10) }));
    const recorded = await admin.rpc("record_session_execution", {
      p_athlete_id: r.athleteId,
      p_payload: { execution: { id: exec, session_date: "2026-11-09", started_at: at(0), final_prescription_id: prescription.id }, events: [{ id: randomUUID(), execution_id: exec, event_type: "started", occurred_at: at(0) }, { id: randomUUID(), execution_id: exec, event_type: "completed", occurred_at: at(50) }], sets },
    });
    expect(recorded.error).toBeNull();
    expect((recorded.data as { status: string }).status).toBe("ok");
    const { error } = await admin.from("race_calendar").insert({ athlete_id: r.athleteId, event_name: "SPORT-RACE-01P late", priority: "A", ...WEEKEND_RACE, race_format: "HOT_TRAIL_2DAY" });
    expect(error).toBeNull();
    // No silent change: the race week still holds the normal build_plus sessions.
    expect(await plannedRow(r.athleteId, "2026-11-16")).toBe("STRENGTH_LOWER MODERATE 60");
    expect(await plannedRow(r.athleteId, "2026-11-17")).toBe("STRENGTH_UPPER MODERATE 60");
    // The explicit re-evaluation: a new version generated on Tue 10 and accepted from that day.
    await generateAndAccept(r.athleteId, "2026-11-10", 4, "2026-11-10");
    expect(await plannedRow(r.athleteId, "2026-11-09")).toBe("STRENGTH_LOWER MODERATE 60");
    expect(await plannedRow(r.athleteId, "2026-11-15")).toBe("DH_TECHNICAL LIGHT 60");
    expect(await plannedRow(r.athleteId, "2026-11-16")).toBeNull();
    expect(await plannedRow(r.athleteId, "2026-11-17")).toBe("RECOVERY_ACTIVE - 20");
    expect(await plannedRow(r.athleteId, "2026-11-18")).toBe("RECOVERY_ACTIVE - 20");
    expect(await plannedRow(r.athleteId, "2026-11-20")).toBeNull();
    const { data: executions } = await admin.from("session_executions").select("final_prescription_id").eq("athlete_id", r.athleteId);
    expect(executions).toEqual([{ final_prescription_id: prescription.id }]);
    const { data: decisions } = await admin.from("decisions").select("id").eq("athlete_id", r.athleteId).eq("decision_date", "2026-11-09");
    expect(decisions).toHaveLength(1);
  });

  it("a race cancelled after the plan: M1 ignores it, the protocol sessions already planned stay ordinary light sessions until the plan is regenerated", async () => {
    const r = await rider("cancelled", { ...WEEKEND_RACE, race_format: "HOT_TRAIL_2DAY" });
    const { error } = await admin.from("race_calendar").update({ status: "cancelled" }).eq("athlete_id", r.athleteId);
    expect(error).toBeNull();
    const dh = await day(r.athleteId, "2026-11-15");
    expect(dh.summary).toEqual(["KEEP", "DH_TECHNICAL", "LIGHT", 60]);
    expect(dh.rules).not.toContain("RACE_PROTOCOL_TX");
    expect(dh.status).toEqual(CREATED);
    const recovery = await day(r.athleteId, "2026-11-17");
    expect(recovery.summary.slice(0, 2)).toEqual(["KEEP", "RECOVERY_ACTIVE"]);
    expect(recovery.status).toEqual(CREATED);
  });

  it("no duplicate: a completed session on a T-X day, then a second daily run the same day — one execution, still on its frozen prescription, one prescription per decision", async () => {
    const r = await rider("rerun", { ...IXS_RACE, race_format: "IXS_3DAY" });
    const first = await day(r.athleteId, "2026-11-14");
    expect(first.finals).toHaveLength(1);
    const prescription = first.finals[0]!;
    const drill = (prescription.structure as { blocks: { role: string; items: { prescriptionItemId: string; measure: { count: number } }[] }[] }).blocks.filter((b) => b.role === "main").flatMap((b) => b.items)[0]!;
    const exec = randomUUID();
    const at = (min: number) => `2026-11-14T10:${String(min).padStart(2, "0")}:00Z`;
    const sets = Array.from({ length: drill.measure.count }, (_, k) => ({ id: randomUUID(), execution_id: exec, prescription_item_id: drill.prescriptionItemId, set_number: k + 1, done: true, measure_type: "pass", measure_value: null, success: true, occurred_at: at(10 + k) }));
    const recorded = await admin.rpc("record_session_execution", {
      p_athlete_id: r.athleteId,
      p_payload: { execution: { id: exec, session_date: "2026-11-14", started_at: at(0), final_prescription_id: prescription.id }, events: [{ id: randomUUID(), execution_id: exec, event_type: "started", occurred_at: at(0) }, { id: randomUUID(), execution_id: exec, event_type: "completed", occurred_at: at(40) }], sets },
    });
    expect(recorded.error).toBeNull();
    expect((recorded.data as { status: string }).status).toBe("ok");
    const second = await day(r.athleteId, "2026-11-14", {}, false);
    expect(second.decisions).toHaveLength(2);
    expect(second.finals).toHaveLength(1);
    const { data: executions } = await admin.from("session_executions").select("final_prescription_id").eq("athlete_id", r.athleteId).eq("session_date", "2026-11-14");
    expect(executions).toEqual([{ final_prescription_id: prescription.id }]);
  });
});
