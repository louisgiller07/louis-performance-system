/**
 * SPORT-RACE-01 (HPM 2026-10-19) — the race week through the real paths (local Supabase): a real V2 plan built around
 * an A race, accepted and projected, a check-in, runDailyFor (production daily path, PHYS off).
 *
 * Executable record of the CURRENT contract, characterized and not changed by SPORT-RACE-01 (its report proposes the
 * contract change; nothing here is a validated sport choice):
 * - V2 plan (docs/03 §6 "Politique de dose du plan V2", PROVISIONAL): race_specific → taper → race week WITHOUT any
 *   session → introduction; at most one session per day;
 * - M1 (frozen, docs/04 §3): a T-X pre-event table for HOT_TRAIL_2DAY and IXS_3DAY only; every other format (OTHER,
 *   SWISS_CUP, UCI_WC, no format → OTHER) gets the default recovery (INFERENCE_FALLBACK) before the race;
 * - V2 daily (docs/03 §6, ADR UX-11A.5c.0): a day without a planned session has no daily prescription, whatever M1
 *   recommends ("aucune séance n'est inventée": blocked final_prescription_no_lineage / no_planned_session);
 *   a planned session in the T-X window is kept, capped or replaced through the existing builders;
 * - Safety first; no duplicate session, prescription or execution.
 * When the race-week contract changes (HPM decision), these expectations change with it, explicitly.
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
const FEVER: CheckinFixture = { fever_or_illness: true };

type Race = { start_date: string; end_date: string; race_format?: string | null };

describe.skipIf(!INTEGRATION_ENABLED)("SPORT-RACE-01 — the race week on the real V2 paths (current contract, local Supabase)", () => {
  let admin: SupabaseClient;
  beforeAll(() => {
    admin = createTestClient();
  });

  /** SPORT-VALIDATION-01's rider C: intermediate Force, advanced DH, full gym, four terrains, weekday evenings "physical", weekends "riding". */
  async function rider(name: string, race: Race | null, raceAfterPlan = false) {
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
    for (const d of [1, 2, 3, 4, 5]) await insertAvailabilityWindow(admin, athleteId, { day_of_week: d, start_time: "18:00:00", end_time: "20:00:00", activity: "physical" });
    for (const d of [6, 0]) await insertAvailabilityWindow(admin, athleteId, { day_of_week: d, start_time: "09:00:00", end_time: "17:00:00", activity: "riding" });
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
      rules: plan.triggered_rules.map((t) => t.rule_id).filter((id) => !id.startsWith("C3.")),
    };
  }
  const NO_LINEAGE = ["blocked", "final_prescription_no_lineage", "no_planned_session"];

  it("the V2 plan around an A race: race_specific → taper → race week without any session → introduction; one session per day at most", async () => {
    const r = await rider("plan", { ...WEEKEND_RACE, race_format: "HOT_TRAIL_2DAY" });
    const w = await weeks(r.planVersionId);
    expect(w.map((x) => x.role)).toEqual(["race_specific", "taper", "race", "introduction"]);
    expect(w[1]!.sessions).toEqual(["2026-11-09 STRENGTH_LOWER LIGHT 45", "2026-11-10 AEROBIC_BASE LIGHT 45", "2026-11-14 DH_TECHNICAL LIGHT 60"]);
    expect(w[2]!.sessions).toEqual([]);
    const dates = w.flatMap((x) => x.sessions.map((s) => s.slice(0, 10)));
    expect(new Set(dates).size).toBe(dates.length);
  });

  it("IXS_3DAY (a T-X table): the planned taper DH in the window is kept LIGHT and executable; every T-X day without a planned session has no daily prescription; T+1 replaces the planned Force with an executable active recovery", async () => {
    const r = await rider("ixs", { ...IXS_RACE, race_format: "IXS_3DAY" });
    const t7 = await day(r.athleteId, "2026-11-13");
    expect(t7.summary).toEqual(["KEEP", "STRENGTH_UPPER", "LIGHT", null]);
    expect(t7.rules).toContain("RACE_PROTOCOL_TX");
    expect(t7.status).toEqual(NO_LINEAGE);
    const t6 = await day(r.athleteId, "2026-11-14");
    expect(t6.summary).toEqual(["KEEP", "DH_TECHNICAL", "LIGHT", 60]);
    expect(t6.rules).toEqual(expect.arrayContaining(["RACE_PROTOCOL_TX", "PLANNED_LOAD_CAP"]));
    expect(t6.status).toEqual(["created", null, null]);
    expect(t6.finals).toHaveLength(1);
    const expected: [string, unknown[]][] = [
      ["2026-11-15", ["KEEP", "AEROBIC_BASE", "LIGHT", 30]],
      ["2026-11-16", ["KEEP", "RECOVERY_ACTIVE", null, null]],
      ["2026-11-17", ["KEEP", "RECOVERY_ACTIVE", null, 20]],
      ["2026-11-18", ["KEEP", "REST", null, null]],
      ["2026-11-19", ["KEEP", "RACE_ACTIVITY", null, null]],
    ];
    for (const [date, summary] of expected) {
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
    expect(after.status).toEqual(["created", null, null]);
    expect(after.finals.map((f) => f.reconciliation_action)).toEqual(["replace"]);
  });

  it("formats without a T-X table (OTHER, SWISS_CUP, UCI_WC, no format): no pre-event protocol, M1's default recovery (INFERENCE_FALLBACK), no daily prescription", async () => {
    for (const race_format of ["OTHER", "SWISS_CUP", "UCI_WC", null]) {
      const r = await rider(`format ${race_format ?? "none"}`, { ...WEEKEND_RACE, race_format });
      const d = await day(r.athleteId, "2026-11-18");
      expect(d.summary).toEqual(["KEEP", "RECOVERY_ACTIVE", null, null]);
      expect(d.rules).toContain("INFERENCE_FALLBACK");
      expect(d.rules).not.toContain("RACE_PROTOCOL_TX");
      expect(d.status).toEqual(NO_LINEAGE);
    }
  });

  it("HOT_TRAIL_2DAY on a weekend: T-7 replaces the planned taper DH with an executable upper-body Force (riding-only day), T-6 recommends a 4-hour MODERATE DH without any daily prescription", async () => {
    const r = await rider("hot trail", { ...WEEKEND_RACE, race_format: "HOT_TRAIL_2DAY" });
    const t7 = await day(r.athleteId, "2026-11-14");
    expect(t7.summary).toEqual(["REPLACE", "STRENGTH_UPPER", "LIGHT", 45]);
    expect(t7.status).toEqual(["created", null, null]);
    expect(t7.finals.map((f) => f.reconciliation_action)).toEqual(["replace"]);
    const t6 = await day(r.athleteId, "2026-11-15");
    expect(t6.summary).toEqual(["KEEP", "DH_TECHNICAL", "MODERATE", 240]);
    expect(t6.status).toEqual(NO_LINEAGE);
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
