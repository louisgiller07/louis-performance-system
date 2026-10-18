/**
 * V2-L2-01a (HPM 2026-10-18, canon docs/05 « Historique de la génération V2 ») — the V2 generation history on the
 * LOCAL Supabase, through the real paths: plan A generated and accepted, real daily runs (M1, reconciliation,
 * persist_daily_run_v2), guided sessions recorded by record_session_execution, V1 debriefs by
 * persist_completed_session; then plan B generated with the switch OFF (the current behaviour) and ON.
 * Every scenario checks the GENERATED plan (week roles and reasons, kinds, loads, durations, DH passes), not a status.
 *
 * Plan A (generated the eve of 2026-10-05, all-day windows, no history) — week 2 = build (MODERATE):
 * DH 10-12 / 10-13 (90), STRENGTH_LOWER 10-14 (60), STRENGTH_UPPER 10-15 (60), AEROBIC_BASE 10-16 (45).
 * Plan B is generated on 2026-10-17 (window [10-10, 10-17]) for 3 weeks from 10-18, unless said otherwise.
 *
 * The OFF / production comparison needs PHYS011_PREVIOUS_RUNTIME_ROOT (a built checkout of production 863f3fb).
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, getAthleteAuthClient, insertCheckin, insertRace, setAthleteDiscipline, type CheckinFixture } from "./testDb.js";
import { localIntegrationRequested } from "./localDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { runDailyFor } from "../../src/supabase/runDailyFor.js";
import { generateAndPersistTrainingPlanV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { generateTrainingPlanForAthlete } from "../../src/generation/generateTrainingPlanForAthlete.js";
import { readPlanHistoryFactsV2 } from "../../src/supabase/repositories/planHistoryV2Repo.js";
import { planHistoryV2, type PlanHistoryDayV2 } from "../../src/supabase/mapping/planHistoryV2.js";

const ENABLED = localIntegrationRequested({ requirePublishableKey: true });
const PREVIOUS = process.env.PHYS011_PREVIOUS_RUNTIME_ROOT;
const TODAY_B = "2026-10-17";
const PAIN: CheckinFixture = { pain: true, pain_intensity: 3, pain_location_code: "wrist_R" };
const ILL: CheckinFixture = { fever_or_illness: true };

type Item = { kind: string; prescriptionItemId: string; sets?: number; measure: { type: string; min?: number; max?: number; count?: number } };
type Structure = { family: string; sessionKind: string; blocks: { role: string; items: Item[] }[]; activitySelection?: { activityIds: string[] } };
type Mode = "complete" | "partial" | "open" | "abandoned";
type PlanView = {
  weeks: { role: string; reasons: string[] }[];
  sessions: [string, string, string | null, number | null, number | null][];
  snapshot: { recentHistory: { trailingVolumeMinutes: number; recentMissedOrReplacedCount: number; recentSessionKinds: string[] } } & Record<string, unknown>;
  hash: string;
};

describe.skipIf(!ENABLED)("V2-L2-01a — V2 generation history, real paths (local Supabase)", { timeout: 600_000 }, () => {
  let admin: SupabaseClient;
  beforeAll(() => {
    admin = createTestClient();
  });

  // ---------------------------------------------------------------------------------------------------------------
  // Real-path helpers
  // ---------------------------------------------------------------------------------------------------------------
  async function rider(name: string): Promise<string> {
    const { athleteId } = await createTestAthlete(admin, `V2-L2-01a ${name} ${randomUUID().slice(0, 6)}`);
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
  /** Plan A: generated the eve of 2026-10-05 (OFF), 2 weeks, accepted. */
  async function withPlanA(name: string): Promise<string> {
    const athleteId = await rider(name);
    const a = await generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 2, today: "2026-10-04" });
    if (a.status !== "persisted") throw new Error(`plan A: ${a.status}`);
    await acceptTrainingPlanVersion(admin, athleteId, a.planVersionId, "2026-10-05", "2026-10-18");
    return athleteId;
  }

  async function record(athleteId: string, payload: unknown) {
    const { data, error } = await admin.rpc("record_session_execution", { p_athlete_id: athleteId, p_payload: payload });
    if (error) throw new Error(`record_session_execution: ${error.message}`);
    if ((data as { status: string }).status !== "ok") throw new Error(`record_session_execution rejected: ${JSON.stringify(data)}`);
  }
  async function finalOf(decisionId: string): Promise<{ id: string; structure: Structure }> {
    const { data, error } = await admin.from("decision_final_prescriptions").select("id, structure").eq("decision_id", decisionId).single();
    if (error) throw new Error(`no final prescription for ${decisionId}: ${error.message}`);
    return data as { id: string; structure: Structure };
  }
  /** The day's daily run (check-in written first unless `checkin: null`). */
  async function decide(athleteId: string, date: string, checkin: CheckinFixture | null = {}) {
    if (checkin !== null) await insertCheckin(admin, athleteId, date, checkin);
    return runDailyFor(admin, athleteId, date);
  }
  /** A guided session of the CURRENT decision of `date`, recorded through record_session_execution. */
  async function perform(athleteId: string, date: string, decisionId: string, mode: Mode, options: { enduranceSeconds?: number; beforeResults?: () => Promise<void> } = {}) {
    const enduranceSeconds = options.enduranceSeconds ?? 52 * 60 + 30;
    const fp = await finalOf(decisionId);
    const exec = randomUUID();
    await record(athleteId, { execution: { id: exec, session_date: date, started_at: `${date}T17:00:00Z`, final_prescription_id: fp.id }, events: [{ id: randomUUID(), execution_id: exec, event_type: "started", occurred_at: `${date}T17:00:00Z` }] });
    const s = fp.structure;
    const work = s.blocks.filter((b) => b.role === "main" || b.role === "complementary").flatMap((b) => b.items);
    let n = 0;
    const result = (item: Item, set_number: number) => ({
      id: randomUUID(),
      execution_id: exec,
      prescription_item_id: item.prescriptionItemId,
      set_number,
      done: true,
      measure_type: item.measure.type,
      measure_value: item.measure.type === "pass" ? null : item.measure.type === "duration" ? 30 : (item.measure.max ?? item.measure.min ?? 8),
      occurred_at: `${date}T17:${String(10 + (n++ % 40)).padStart(2, "0")}:00Z`,
    });
    let sets: unknown[] = [];
    let activities: unknown[] = [];
    if (s.family === "endurance") {
      if (mode !== "abandoned") activities = [{ id: randomUUID(), execution_id: exec, activity_id: s.activitySelection!.activityIds[0], duration_seconds: enduranceSeconds, occurred_at: `${date}T17:55:00Z` }];
    } else if (s.family === "dh_technical") {
      const drill = s.blocks.filter((b) => b.role === "main").flatMap((b) => b.items)[0]!;
      const passes = Array.from({ length: drill.measure.count! }, (_, i) => result(drill, i + 1));
      sets = mode === "partial" ? passes.slice(0, 1) : mode === "abandoned" ? [] : passes;
    } else {
      const slots = work.filter((i) => i.kind === "exercise").flatMap((i) => Array.from({ length: i.sets! }, (_, k) => result(i, k + 1)));
      sets = mode === "partial" ? slots.slice(0, 1) : mode === "abandoned" ? [] : slots;
    }
    const events = mode === "open" ? [] : [{ id: randomUUID(), execution_id: exec, event_type: mode === "abandoned" ? "abandoned" : "completed", occurred_at: `${date}T18:00:00Z` }];
    // What happens between the start and the results (e.g. the day's context changes: a new decision).
    if (options.beforeResults) await options.beforeResults();
    await record(athleteId, { sets, activities, events });
    return { family: s.family, structure: s };
  }
  /** A V1 « Non réalisée » (Raconter ma séance → persist_completed_session). */
  async function notDone(athleteId: string, date: string, reason: string, newPain = false) {
    const row = { session_date: date, decision_id: null, session_type: "DH_TECHNICAL", completion_status: "skipped", actual_duration_min: null, rpe: null, main_content: null, intervention: null, free_notes: null, post_leg_fatigue: null, post_grip_fatigue: null, new_pain: newPain, new_pain_note: newPain ? "Poignet" : null, change_reason: reason };
    const { error } = await admin.rpc("persist_completed_session", { p_athlete_id: athleteId, p_row: row });
    if (error) throw new Error(`persist_completed_session ${date}: ${error.message}`);
  }
  const durationOf = (run: Awaited<ReturnType<typeof runDailyFor>>) => (run.dailyPlan.final_session as { duration_min?: number }).duration_min ?? null;

  /** S2's history: DH 90 complete (10-12), Force 60 complete (10-14), endurance 52 min 30 s (10-16) = 202 min. */
  async function history202(athleteId: string) {
    const dh = await decide(athleteId, "2026-10-12");
    const force = await decide(athleteId, "2026-10-14");
    const aerobic = await decide(athleteId, "2026-10-16");
    expect([dh, force, aerobic].map((r) => [r.dailyPlan.decision, r.dailyPlan.final_session.kind, durationOf(r)])).toEqual([
      ["KEEP", "DH_TECHNICAL", 90],
      ["KEEP", "STRENGTH_LOWER", 60],
      ["KEEP", "AEROBIC_BASE", 45],
    ]);
    await perform(athleteId, "2026-10-12", dh.persistence.decision_id, "complete");
    await perform(athleteId, "2026-10-14", force.persistence.decision_id, "complete");
    await perform(athleteId, "2026-10-16", aerobic.persistence.decision_id, "complete");
  }

  async function describePlan(planVersionId: string): Promise<PlanView> {
    const { data: version } = await admin.from("training_plan_versions").select("input_snapshot, input_snapshot_hash").eq("id", planVersionId).single();
    const { data: weeks } = await admin.from("training_plan_weeks").select("id, week_number, dose_summary").eq("plan_version_id", planVersionId).order("week_number");
    const { data: sessions } = await admin.from("training_plan_generated_sessions").select("id, date, kind, load_profile, duration_min").eq("plan_version_id", planVersionId).order("date");
    const { data: prescriptions } = await admin.from("training_plan_planned_prescriptions").select("generated_plan_session_id, structure").in("generated_plan_session_id", (sessions ?? []).map((s) => s.id as string));
    const passesOf = (id: string) => {
      const s = (prescriptions ?? []).find((p) => p.generated_plan_session_id === id)?.structure as Structure | undefined;
      return s?.family === "dh_technical" ? (s.blocks.filter((b) => b.role === "main").flatMap((b) => b.items)[0]?.measure.count ?? null) : null;
    };
    return {
      weeks: (weeks ?? []).map((w) => ({ role: (w.dose_summary as any).progression.role, reasons: (w.dose_summary as any).progression.reasonCodes })),
      sessions: (sessions ?? []).map((s) => [s.date, s.kind, s.load_profile, s.duration_min, passesOf(s.id as string)]),
      snapshot: version!.input_snapshot as PlanView["snapshot"],
      hash: version!.input_snapshot_hash as string,
    };
  }
  /** Plan B (not accepted), from the real V2 generation; `v2History` = the server switch. */
  async function planB(athleteId: string, v2History: boolean, today = TODAY_B, weeks = 3, client: SupabaseClient = admin): Promise<PlanView> {
    const r = await generateAndPersistTrainingPlanV2({ planningModel: "v2", client, athleteId, generationRequestId: randomUUID(), durationWeeks: weeks, today, ...(v2History ? { v2History: true } : {}) });
    if (r.status !== "persisted") throw new Error(`plan B: ${r.status}`);
    return describePlan(r.planVersionId);
  }
  const roles = (p: PlanView) => p.weeks.map((w) => w.role);
  /** The first week's distinct doses, [kind, load, duration, passes]. */
  const week1 = (p: PlanView, from = "2026-10-18", to = "2026-10-24") =>
    [...new Map(p.sessions.filter(([d]) => d >= from && d <= to).map(([, k, l, m, passes]) => [`${k}`, [k, l, m, passes]])).values()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const INTRODUCTION_WEEK = [
    ["AEROBIC_BASE", "LIGHT", 45, null],
    ["DH_TECHNICAL", "LIGHT", 75, 5],
    ["STRENGTH_LOWER", "LIGHT", 45, null],
    ["STRENGTH_UPPER", "LIGHT", 45, null],
  ];
  const BUILD_WEEK = [
    ["AEROBIC_BASE", "MODERATE", 45, null],
    ["DH_TECHNICAL", "MODERATE", 90, 6],
    ["STRENGTH_LOWER", "MODERATE", 60, null],
    ["STRENGTH_UPPER", "MODERATE", 60, null],
  ];
  const historyOf = async (athleteId: string, today = TODAY_B) => planHistoryV2(await readPlanHistoryFactsV2(admin, athleteId, today), today);
  const dayOf = (days: PlanHistoryDayV2[], date: string) => days.find((d) => d.date === date)!;

  // ---------------------------------------------------------------------------------------------------------------
  // Scenarios (report V2_L2_01 § 8)
  // ---------------------------------------------------------------------------------------------------------------
  it("1 — V2 rider without history: ON = OFF exactly (introduction week, no hold, same snapshot hash)", async () => {
    const athleteId = await rider("no history");
    const off = await planB(athleteId, false);
    const on = await planB(athleteId, true);
    expect(roles(off)).toEqual(["introduction", "build", "build_plus"]);
    expect(week1(off)).toEqual(INTRODUCTION_WEEK);
    expect(on.sessions).toEqual(off.sessions);
    expect(on.weeks).toEqual(off.weeks);
    expect([on.snapshot, on.hash]).toEqual([off.snapshot, off.hash]);
  });

  let rider202: string;
  let off202: PlanView;
  it("2 / 9 — 202 complete minutes over 8 days (DH 90, Force 60, endurance 52): OFF introduction; ON build (recent_training_history), Force MODERATE 60, DH 6 passes", async () => {
    rider202 = await withPlanA("202 min");
    await history202(rider202);
    const h = await historyOf(rider202);
    expect([h.trailingVolumeMinutes, h.recentMissedOrReplacedCount]).toEqual([202, 0]);
    expect(h.days.filter((d) => d.fact !== "none")).toEqual([
      { date: "2026-10-12", fact: "guided_completed", family: "dh_technical", realisation: "complete", minutes: 90 },
      { date: "2026-10-14", fact: "guided_completed", family: "strength", realisation: "complete", minutes: 60 },
      { date: "2026-10-16", fact: "guided_completed", family: "endurance", realisation: null, minutes: 52 },
    ]);

    off202 = await planB(rider202, false);
    const on = await planB(rider202, true);
    // Before (the defect): the guided history is invisible, the rider restarts with an introduction week.
    expect(off202.snapshot.recentHistory).toEqual({ recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 0 });
    expect(roles(off202)).toEqual(["introduction", "build", "build_plus"]);
    expect(week1(off202)).toEqual(INTRODUCTION_WEEK);
    // After: continuity — the first week is a build week.
    expect(on.snapshot.recentHistory).toEqual({ recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 202 });
    expect(on.weeks).toEqual([
      { role: "build", reasons: ["cycle_progression", "recent_training_history"] },
      { role: "build_plus", reasons: ["cycle_progression"] },
      { role: "consolidation", reasons: ["cycle_unload"] },
    ]);
    expect(week1(on)).toEqual(BUILD_WEEK);
    // Only recentHistory differs between the two snapshots.
    expect({ ...on.snapshot, recentHistory: null }).toEqual({ ...off202.snapshot, recentHistory: null });
  });

  it("11 — determinism: the same state, ON twice → the same snapshot, the same hash, the same plan", async () => {
    const a = await planB(rider202, true);
    const b = await planB(rider202, true);
    expect([b.hash, b.sessions, b.weeks]).toEqual([a.hash, a.sessions, a.weeks]);
    expect(JSON.stringify(b.snapshot)).toBe(JSON.stringify(a.snapshot));
  });

  it.skipIf(!PREVIOUS)("OFF = production (863f3fb): the same rich state → the same snapshot and the same plan as the production runtime", async () => {
    const previous = (await import(pathToFileURL(join(PREVIOUS!, "head-coach-engine", "dist", "generation", "v2", "generateAndPersistTrainingPlanV2.js")).href)) as { generateAndPersistTrainingPlanV2: typeof generateAndPersistTrainingPlanV2 };
    const prod = await previous.generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId: rider202, generationRequestId: randomUUID(), durationWeeks: 3, today: TODAY_B });
    if (prod.status !== "persisted") throw new Error("production plan");
    const p = await describePlan(prod.planVersionId);
    const off = await planB(rider202, false);
    expect([off.hash, off.sessions, off.weeks]).toEqual([p.hash, p.sessions, p.weeks]);
    expect(JSON.stringify(off.snapshot)).toBe(JSON.stringify(p.snapshot));
    expect(off.hash).toBe(off202.hash);
  });

  it("7 — race weeks: race_specific / taper / race unchanged by the history (ON = OFF)", async () => {
    await insertRace(admin, rider202, { event_name: "V2-L2-01a race", start_date: "2026-11-07", end_date: "2026-11-07", priority: "A" });
    const off = await planB(rider202, false);
    const on = await planB(rider202, true);
    expect(roles(off)).toEqual(["race_specific", "taper", "race"]);
    expect(on.weeks).toEqual(off.weeks);
    expect(on.sessions).toEqual(off.sessions);
    expect(on.snapshot.recentHistory.trailingVolumeMinutes).toBe(202);
  });

  it("3 — partial Force and DH: 0 minute each (P0), never missed; 52 min → introduction ON as OFF", async () => {
    const athleteId = await withPlanA("partial");
    const dh = await decide(athleteId, "2026-10-12");
    const force = await decide(athleteId, "2026-10-14");
    const aerobic = await decide(athleteId, "2026-10-16");
    await perform(athleteId, "2026-10-12", dh.persistence.decision_id, "partial");
    await perform(athleteId, "2026-10-14", force.persistence.decision_id, "partial");
    await perform(athleteId, "2026-10-16", aerobic.persistence.decision_id, "complete");
    const h = await historyOf(athleteId);
    expect(h.days.filter((d) => d.fact !== "none").map((d) => [d.date, "realisation" in d ? d.realisation : null, "minutes" in d ? d.minutes : null])).toEqual([
      ["2026-10-12", "partial", 0],
      ["2026-10-14", "partial", 0],
      ["2026-10-16", null, 52],
    ]);
    const off = await planB(athleteId, false);
    const on = await planB(athleteId, true);
    expect(on.snapshot.recentHistory).toEqual({ recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 52 });
    expect(roles(on)).toEqual(["introduction", "build", "build_plus"]);
    expect([on.sessions, on.weeks]).toEqual([off.sessions, off.weeks]);
  });

  it("4 — 202 min + two « Non réalisée » (time_life, motivation) on due days: ON build, then build_plus HELD in build", async () => {
    const athleteId = await withPlanA("missed");
    await history202(athleteId);
    for (const [date, reason] of [["2026-10-13", "time_life"], ["2026-10-15", "motivation"]] as const) {
      const run = await decide(athleteId, date);
      expect([run.dailyPlan.decision, run.dailyPlan.triggered_rules.some((r) => r.layer === "A")]).toEqual(["KEEP", false]);
      await notDone(athleteId, date, reason);
    }
    const h = await historyOf(athleteId);
    expect([h.trailingVolumeMinutes, h.recentMissedOrReplacedCount]).toEqual([202, 2]);
    const off = await planB(athleteId, false);
    const on = await planB(athleteId, true);
    // Before: no volume seen, the hold lands on the 3rd week.
    expect(off.weeks.map((w) => [w.role, w.reasons.includes("recent_missed_sessions_hold")])).toEqual([["introduction", false], ["build", false], ["build", true]]);
    expect(on.weeks).toEqual([
      { role: "build", reasons: ["cycle_progression", "recent_training_history"] },
      { role: "build", reasons: ["cycle_progression", "recent_missed_sessions_hold"] },
      { role: "consolidation", reasons: ["cycle_unload"] },
    ]);
    expect(week1(on)).toEqual(BUILD_WEEK);
    expect(on.snapshot.recentHistory.recentMissedOrReplacedCount).toBe(2);
  });

  it("5 — health: pain, check-in pain, fatigue control, a safety REST with a signal, a stopped session → 0 missed, no volume, no hold (OFF counted them)", async () => {
    const athleteId = await withPlanA("health");
    const stopped = await decide(athleteId, "2026-10-12");
    await perform(athleteId, "2026-10-12", stopped.persistence.decision_id, "abandoned");
    await decide(athleteId, "2026-10-13");
    await notDone(athleteId, "2026-10-13", "pain", true);
    await decide(athleteId, "2026-10-14", PAIN);
    await notDone(athleteId, "2026-10-14", "time_life");
    await decide(athleteId, "2026-10-15");
    await notDone(athleteId, "2026-10-15", "fatigue_control");
    const rest = await decide(athleteId, "2026-10-16", ILL);
    expect([rest.dailyPlan.decision, rest.dailyPlan.triggered_rules.some((r) => r.layer === "A")]).toEqual(["REST", true]);
    await notDone(athleteId, "2026-10-16", "motivation");

    const h = await historyOf(athleteId);
    expect([h.trailingVolumeMinutes, h.recentMissedOrReplacedCount]).toEqual([0, 0]);
    expect(dayOf(h.days, "2026-10-12")).toEqual({ date: "2026-10-12", fact: "none" });
    expect(dayOf(h.days, "2026-10-13")).toMatchObject({ fact: "debrief_skipped", missed: false, why: "reason_not_eligible" });
    expect(dayOf(h.days, "2026-10-14")).toMatchObject({ fact: "debrief_skipped", missed: false });
    expect(["safety_rule", "health_not_cleared"]).toContain((dayOf(h.days, "2026-10-14") as { why: string }).why);
    expect(dayOf(h.days, "2026-10-15")).toMatchObject({ fact: "debrief_skipped", missed: false, why: "reason_not_eligible" });
    expect(dayOf(h.days, "2026-10-16")).toMatchObject({ fact: "debrief_skipped", missed: false, why: "no_training_due" });

    const off = await planB(athleteId, false);
    const on = await planB(athleteId, true);
    expect(off.snapshot.recentHistory.recentMissedOrReplacedCount).toBe(4);
    expect(off.weeks.map((w) => [w.role, w.reasons.includes("recent_missed_sessions_hold")])).toEqual([["introduction", false], ["build", false], ["build", true]]);
    expect(on.snapshot.recentHistory).toEqual({ ...off.snapshot.recentHistory, recentMissedOrReplacedCount: 0 });
    expect(on.weeks.map((w) => [w.role, w.reasons.includes("recent_missed_sessions_hold")])).toEqual([["introduction", false], ["build", false], ["build_plus", false]]);
    expect(week1(on)).toEqual(INTRODUCTION_WEEK);
  });

  it("6 — plan change in the window + a manual session: each day counted once, from its own decision", async () => {
    const athleteId = await withPlanA("plan change");
    const dh = await decide(athleteId, "2026-10-12");
    await perform(athleteId, "2026-10-12", dh.persistence.decision_id, "complete");
    // Plan A2 generated on 10-12, accepted from 10-13: the later days follow A2.
    const a2 = await generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 2, today: "2026-10-12" });
    if (a2.status !== "persisted") throw new Error("plan A2");
    await acceptTrainingPlanVersion(admin, athleteId, a2.planVersionId, "2026-10-13", "2026-10-26");
    const a2Day = await decide(athleteId, "2026-10-15");
    expect([a2Day.dailyPlan.decision, a2Day.dailyPlan.final_session.kind, durationOf(a2Day)]).toEqual(["KEEP", "STRENGTH_LOWER", 45]);
    await perform(athleteId, "2026-10-15", a2Day.persistence.decision_id, "complete");
    // A manual Force session over A2's day, completed in full.
    const rider = await getAthleteAuthClient(athleteId);
    const { error } = await rider
      .from("planned_sessions")
      .upsert({ athlete_id: athleteId, planned_date: "2026-10-16", session_type: "STRENGTH_A", intervention: { kind: "STRENGTH_LOWER", load_profile: "MODERATE" }, planned_intent: null, source: "manual", is_committed: false, source_plan_version_id: null, source_generated_session_id: null }, { onConflict: "athlete_id,planned_date" });
    if (error) throw new Error(error.message);
    const manual = await decide(athleteId, "2026-10-16");
    expect(manual.dailyPlan.final_session.kind).toBe("STRENGTH_LOWER");
    const manualMinutes = durationOf(manual)!;
    expect(manualMinutes).toBeGreaterThan(0);
    await perform(athleteId, "2026-10-16", manual.persistence.decision_id, "complete");

    const h = await historyOf(athleteId);
    expect(h.days.filter((d) => d.fact !== "none").map((d) => [d.date, "minutes" in d ? d.minutes : null])).toEqual([
      ["2026-10-12", 90],
      ["2026-10-15", 45],
      ["2026-10-16", manualMinutes],
    ]);
    const on = await planB(athleteId, true);
    expect(on.snapshot.recentHistory.trailingVolumeMinutes).toBe(135 + manualMinutes);
    expect(roles(on)).toEqual(["build", "build_plus", "consolidation"]);
  });

  it("several decisions the same day: the minutes are the EXECUTED decision's (never the latest by default); a later safety REST prevents the « missed »", async () => {
    const athleteId = await withPlanA("decisions");
    const fortyFive = async (date: string) => {
      const { error } = await admin.from("daily_checkins").update({ available_minutes_today: 45 }).eq("athlete_id", athleteId).eq("checkin_date", date);
      if (error) throw new Error(error.message);
      return decide(athleteId, date, null);
    };
    // 10-14: D1 KEEP Force 60, the session started on D1; the rider then gives 45 min → D2 (Force 45); D1's session completes.
    const d1 = await decide(athleteId, "2026-10-14");
    let d2: Awaited<ReturnType<typeof runDailyFor>> | undefined;
    await perform(athleteId, "2026-10-14", d1.persistence.decision_id, "complete", { beforeResults: async () => void (d2 = await fortyFive("2026-10-14")) });
    expect([d1.dailyPlan.decision, durationOf(d1), d2!.dailyPlan.decision, durationOf(d2!)]).toEqual(["KEEP", 60, "MODIFY", 45]);
    // 10-15: D1 KEEP Force 60; 45 min → D2 (Force 45); the rider performs D2.
    const u1 = await decide(athleteId, "2026-10-15");
    const u2 = await fortyFive("2026-10-15");
    expect([durationOf(u1), durationOf(u2)]).toEqual([60, 45]);
    await perform(athleteId, "2026-10-15", u2.persistence.decision_id, "complete");
    // 10-13 (last: the fever opens a signal): a training decision, then a fever → a safety REST; « Non réalisée » (time_life).
    await decide(athleteId, "2026-10-13");
    const { error } = await admin.from("daily_checkins").update(ILL).eq("athlete_id", athleteId).eq("checkin_date", "2026-10-13");
    if (error) throw new Error(error.message);
    const rest = await decide(athleteId, "2026-10-13", null);
    expect(rest.dailyPlan.decision).toBe("REST");
    await notDone(athleteId, "2026-10-13", "time_life");

    const h = await historyOf(athleteId);
    expect(h.days.filter((d) => d.fact !== "none")).toEqual([
      { date: "2026-10-13", fact: "debrief_skipped", missed: false, why: "no_training_due" },
      { date: "2026-10-14", fact: "guided_completed", family: "strength", realisation: "complete", minutes: 60 },
      { date: "2026-10-15", fact: "guided_completed", family: "strength", realisation: "complete", minutes: 45 },
    ]);
    const on = await planB(athleteId, true);
    expect(on.snapshot.recentHistory).toEqual({ recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 105 });
  });

  it("8 — insufficient data: decided days without fact, an open session, facts dated after today → ON = OFF (as « no history »)", async () => {
    const athleteId = await withPlanA("insufficient");
    const today = "2026-10-13";
    await decide(athleteId, "2026-10-12");
    const open = await decide(athleteId, "2026-10-13");
    await perform(athleteId, "2026-10-13", open.persistence.decision_id, "open");
    // Dated after the generation's today (a simulation clock ahead): never history.
    const later = await decide(athleteId, "2026-10-14");
    await perform(athleteId, "2026-10-14", later.persistence.decision_id, "complete");
    const { error } = await admin.rpc("persist_completed_session", {
      p_athlete_id: athleteId,
      p_row: { session_date: "2026-10-15", decision_id: null, session_type: "RECOVERY", completion_status: "done", actual_duration_min: 240, rpe: 6, main_content: null, intervention: { kind: "RECOVERY_ACTIVE" }, free_notes: null, post_leg_fatigue: 3, post_grip_fatigue: 3, new_pain: false, new_pain_note: null },
    });
    if (error) throw new Error(error.message);
    const h = await historyOf(athleteId, today);
    expect([h.trailingVolumeMinutes, h.recentMissedOrReplacedCount]).toEqual([0, 0]);
    const off = await planB(athleteId, false, today);
    const on = await planB(athleteId, true, today);
    expect([on.hash, on.sessions, on.weeks]).toEqual([off.hash, off.sessions, off.weeks]);
    expect(roles(on)).toEqual(["introduction", "build", "build_plus"]);
  });

  it("12 — a failed history read refuses the generation ON (nothing persisted); OFF never reads it", async () => {
    const athleteId = await withPlanA("read failure");
    const day = await decide(athleteId, "2026-10-12");
    await perform(athleteId, "2026-10-12", day.persistence.decision_id, "complete");
    const failing = new Proxy(admin, {
      get(target, prop) {
        if (prop === "from") return (table: string) => target.from(table === "session_executions" ? "session_executions_unavailable" : table);
        const value = Reflect.get(target, prop);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const requestId = randomUUID();
    await expect(generateAndPersistTrainingPlanV2({ planningModel: "v2", client: failing, athleteId, generationRequestId: requestId, durationWeeks: 3, today: TODAY_B, v2History: true })).rejects.toThrow(/Supabase read failed \(session_executions\)/);
    const { data } = await admin.from("training_plan_versions").select("id").eq("athlete_id", athleteId).eq("generation_request_id", requestId);
    expect(data).toEqual([]);
    const off = await planB(athleteId, false, TODAY_B, 3, failing);
    expect(roles(off)).toEqual(["introduction", "build", "build_plus"]);
  });

  it("10 — V1 rider: the V1 snapshot is identical byte for byte, switch on or off (never read)", async () => {
    const athleteId = await rider("v1");
    for (const [date, status, minutes] of [["2026-10-12", "done", 60], ["2026-10-14", "skipped", null], ["2026-10-15", "replaced", 30]] as const) {
      const { error } = await admin.rpc("persist_completed_session", {
        p_athlete_id: athleteId,
        p_row: { session_date: date, decision_id: null, session_type: "RECOVERY", completion_status: status, actual_duration_min: minutes, rpe: minutes === null ? null : 6, main_content: null, intervention: status === "skipped" ? null : { kind: "RECOVERY_ACTIVE" }, free_notes: null, post_leg_fatigue: null, post_grip_fatigue: null, new_pain: false, new_pain_note: null, change_reason: status === "done" ? null : "time_life" },
      });
      if (error) throw new Error(`${date}: ${error.message}`);
    }
    const generate = async (v2History: boolean) => {
      const r = await generateTrainingPlanForAthlete({ client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 3, today: TODAY_B, globalV2Enabled: true, ...(v2History ? { v2History: true } : {}) });
      if (r.status !== "persisted") throw new Error(r.status);
      expect(r.planningModel).toBe("v1");
      const { data } = await admin.from("training_plan_versions").select("input_snapshot, input_snapshot_hash").eq("id", r.planVersionId).single();
      return data as { input_snapshot: { recentHistory: unknown }; input_snapshot_hash: string };
    };
    const off = await generate(false);
    const on = await generate(true);
    expect(JSON.stringify(on.input_snapshot)).toBe(JSON.stringify(off.input_snapshot));
    expect(on.input_snapshot_hash).toBe(off.input_snapshot_hash);
    expect(on.input_snapshot.recentHistory).toEqual({ recentSessionKinds: ["RECOVERY_ACTIVE", "RECOVERY_ACTIVE"], recentMissedOrReplacedCount: 2, trailingVolumeMinutes: 90 });
  });
});
