/**
 * PHYS-04 — the mobility session and the bodyweight Force progression end to end on the LOCAL Supabase (real
 * tables, real RPCs, the Node path of the daily run).
 *
 * Mobility: plan with the mobility option → check-in → the complete routine (protocol mobility_routine_v1) →
 * execution completed without any result → history (M1 reads the mobility session the next day).
 * Bodyweight: rider without equipment → first session: calibrate → the sets recorded → next session: the
 * repetitions to aim for, from those sets → missed session (no invented progress) → advanced rider at the top of
 * the range (no harder variant invented). Also: limited time, blocking health, manual mobility, option off.
 *
 * Plan (fresh rider, 2026-10-05 → 2026-11-15, deterministic): STRENGTH_LOWER on 10-07 (LIGHT), 10-14, 10-21
 * (MODERATE), 10-27 (LIGHT), 11-04, 11-11 (MODERATE); the consolidation week's mobility session on 10-28 (30 min).
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, getAthleteAuthClient, insertCheckin, setAthleteDiscipline } from "./testDb.js";
import { localIntegrationRequested } from "./localDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { buildPlanInputSnapshotV2 } from "../../src/supabase/buildPlanInputSnapshotV2.js";
import { generateAndPersistTrainingPlanV2, generateTrainingPlanVersionRpcV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { DEFAULT_RUN_DAILY_FOR_DEPS, runDailyFor } from "../../src/supabase/runDailyFor.js";
import { computeDailyFor } from "../../src/supabase/computeDailyFor.js";
// V2-PHYS-INTEGRATION-01 — these PHYS rules run with every PHYS switch ON (performance guidance included); every
// switch off is the production behaviour (the production tests kept unchanged, phys00FlagsOffEquivalence).
const PHYS_ON_DEPS = { ...DEFAULT_RUN_DAILY_FOR_DEPS, physSwitches: { daily: true, performanceGuidance: true, intervals: true, power: true, mobility: true } };

const ENABLED = localIntegrationRequested();
const BODYWEIGHT = ["bodyweight_squat", "glute_bridge", "reverse_lunge"];
const MOBILITY = ["hip_90_90", "hip_flexor_mobility", "deep_squat_hold", "knee_to_wall_ankle", "cat_cow", "thoracic_rotation_mobility", "wrist_mobility", "breathing_long_exhale"];

type Guidance = { mode: string; reason: string; change?: string; targetReps?: number; nextStep?: string; reference?: { sessionDate: string; reps: number[] } };
type Item = { kind: string; prescriptionItemId: string; exerciseId: string; sets: number; measure: { type: string; min: number; max: number; minSeconds?: number }; rpeTarget?: { min: number; max: number }; repsGuidance?: Guidance; loadGuidance?: unknown };
type Structure = { family: string; sessionKind: string; protocolId?: string; blocks: { role: string; durationMinutes?: { min: number; max: number }; items: Item[] }[] };
const items = (s: Structure) => s.blocks.flatMap((b) => b.items);
const work = (s: Structure) => s.blocks.filter((b) => b.role === "main" || b.role === "complementary").flatMap((b) => b.items);
const guidanceOf = (s: Structure) => Object.fromEntries(work(s).filter((i) => i.repsGuidance).map((i) => [i.exerciseId, i.repsGuidance!]));

describe.skipIf(!ENABLED)("PHYS-04 — mobility and bodyweight Force end to end (local Supabase)", { timeout: 300_000 }, () => {
  let admin: SupabaseClient;
  beforeAll(() => {
    admin = createTestClient();
  });

  async function rider(name: string, tier: "beginner" | "intermediate" | "advanced", equipment: string[], mobilitySessions = true) {
    const { athleteId } = await createTestAthlete(admin, `PHYS-04 ${name}`);
    await setAthleteDiscipline(admin, athleteId, "Downhill");
    await upsertPerformanceProfileFor(admin, athleteId, {
      strength_experience_tier: tier,
      equipment,
      terrain_access: ["flow_trail", "bermed_trail"],
      declared_limitations: [],
      technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
      dh_technical_tier: "intermediate",
    });
    for (const d of [0, 1, 2, 3, 4, 5, 6]) await insertAvailabilityWindow(admin, athleteId, { day_of_week: d, start_time: "08:00:00", end_time: "20:00:00" });
    const persisted = await generateAndPersistTrainingPlanV2(
      { planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 6, today: "2026-10-04", ...(mobilitySessions ? { mobilitySessions: true } : {}) },
      { buildPlanInputSnapshotV2, callRpc: generateTrainingPlanVersionRpcV2, mintId: () => randomUUID() }
    );
    if (persisted.status !== "persisted") throw new Error("plan");
    await acceptTrainingPlanVersion(admin, athleteId, persisted.planVersionId, "2026-10-05", "2026-11-15");
    const { data } = await admin.from("training_plan_generated_sessions").select("date, kind, load_profile, duration_min").eq("plan_version_id", persisted.planVersionId).in("kind", ["MOBILITY", "STRENGTH_LOWER"]).order("date");
    return { athleteId, sessions: (data ?? []) as { date: string; kind: string; load_profile: string | null; duration_min: number }[] };
  }
  const finalOf = async (decisionId: string) => {
    const { data } = await admin.from("decision_final_prescriptions").select("id, structure, reconciliation_action, adaptation_rule_ids").eq("decision_id", decisionId).maybeSingle();
    return data as { id: string; structure: Structure; reconciliation_action: string; adaptation_rule_ids: string[] } | null;
  };
  async function record(athleteId: string, payload: unknown) {
    const { data, error } = await admin.rpc("record_session_execution", { p_athlete_id: athleteId, p_payload: payload });
    if (error) throw new Error(error.message);
    expect(data).toMatchObject({ status: "ok" });
  }
  /** The rider performs the session: every work set of the bodyweight exercises at `repsOf(item)`, at the top of its RPE target. */
  async function perform(athleteId: string, date: string, f: { id: string; structure: Structure }, repsOf: (i: Item) => number) {
    const id = randomUUID();
    await record(athleteId, { execution: { id, session_date: date, started_at: `${date}T17:00:00Z`, final_prescription_id: f.id }, events: [{ id: randomUUID(), execution_id: id, event_type: "started", occurred_at: `${date}T17:00:00Z` }] });
    const sets = work(f.structure)
      .filter((i) => i.repsGuidance !== undefined)
      .flatMap((item) =>
        Array.from({ length: item.sets }, (_, k) => ({
          id: randomUUID(),
          execution_id: id,
          prescription_item_id: item.prescriptionItemId,
          set_number: k + 1,
          done: true,
          measure_type: "reps",
          measure_value: repsOf(item),
          rpe: item.rpeTarget?.max ?? null,
          occurred_at: `${date}T17:${String(10 + k).padStart(2, "0")}:00Z`,
        }))
      );
    await record(athleteId, { sets, events: [{ id: randomUUID(), execution_id: id, event_type: "completed", occurred_at: `${date}T17:55:00Z` }] });
  }

  it("A — beginner without equipment: calibrate → sets recorded → one more repetition next time → a missed session invents nothing", async () => {
    const r = await rider("A", "beginner", []);
    expect(r.sessions.map((s) => [s.date, s.kind, s.duration_min])).toEqual([
      ["2026-10-07", "STRENGTH_LOWER", 45],
      ["2026-10-14", "STRENGTH_LOWER", 60],
      ["2026-10-21", "STRENGTH_LOWER", 60],
      ["2026-10-27", "STRENGTH_LOWER", 45],
      ["2026-10-28", "MOBILITY", 30],
      ["2026-11-04", "STRENGTH_LOWER", 60],
      ["2026-11-11", "STRENGTH_LOWER", 60],
    ]);
    await insertCheckin(admin, r.athleteId, "2026-10-14");
    const d14 = await runDailyFor(admin, r.athleteId, "2026-10-14", PHYS_ON_DEPS);
    const f14 = (await finalOf(d14.persistence.decision_id))!;
    expect([d14.dailyPlan.decision, f14.structure.family, Object.keys(guidanceOf(f14.structure))]).toEqual(["KEEP", "strength", BODYWEIGHT]);
    expect(Object.values(guidanceOf(f14.structure)).map((g) => [g.mode, g.reason])).toEqual(BODYWEIGHT.map(() => ["calibrate", "no_history"]));
    expect(work(f14.structure).some((i) => i.loadGuidance !== undefined)).toBe(false);
    const squat = work(f14.structure).find((i) => i.exerciseId === "bodyweight_squat")!;
    await perform(r.athleteId, "2026-10-14", f14, (i) => i.measure.min);

    await insertCheckin(admin, r.athleteId, "2026-10-21");
    const d21 = await runDailyFor(admin, r.athleteId, "2026-10-21", PHYS_ON_DEPS);
    const g21 = guidanceOf((await finalOf(d21.persistence.decision_id))!.structure).bodyweight_squat!;
    expect(g21).toMatchObject({ mode: "target", reason: "within_range", change: "increase", targetReps: squat.measure.min + 1, reference: { sessionDate: "2026-10-14", reps: Array(squat.sets).fill(squat.measure.min) } });

    // 10-21 is missed (never started): on 11-04 the guidance still reads the last session actually done.
    await insertCheckin(admin, r.athleteId, "2026-11-04");
    const d04 = await runDailyFor(admin, r.athleteId, "2026-11-04", PHYS_ON_DEPS);
    expect(d04.dailyPlan.final_session.kind).toBe("STRENGTH_LOWER");
    const g04 = guidanceOf((await finalOf(d04.persistence.decision_id))!.structure).bodyweight_squat!;
    expect([g04.mode, g04.targetReps, g04.reference?.sessionDate]).toEqual(["target", squat.measure.min + 1, "2026-10-14"]);
  });

  it("B — advanced without equipment: every set at the top → keep the top, no harder variant invented", async () => {
    const r = await rider("B", "advanced", []);
    await insertCheckin(admin, r.athleteId, "2026-10-14");
    const f14 = (await finalOf((await runDailyFor(admin, r.athleteId, "2026-10-14", PHYS_ON_DEPS)).persistence.decision_id))!;
    // The tier picks among bodyweight exercises (single-leg RDL instead of the reverse lunge); none needs equipment.
    expect(Object.keys(guidanceOf(f14.structure))).toEqual(["bodyweight_squat", "glute_bridge", "single_leg_romanian_deadlift"]);
    await perform(r.athleteId, "2026-10-14", f14, (i) => i.measure.max);
    await insertCheckin(admin, r.athleteId, "2026-10-21");
    const f21 = (await finalOf((await runDailyFor(admin, r.athleteId, "2026-10-21", PHYS_ON_DEPS)).persistence.decision_id))!;
    expect(work(f21.structure).map((i) => i.exerciseId)).toEqual(work(f14.structure).map((i) => i.exerciseId));
    // The advanced plan itself raises the dose in week 3 (squat 5 × 6–8, glute bridge 8–10 instead of 8–12): a changed
    // range is only a reference; at the top of an unchanged range, the top is kept and no harder variant is invented.
    const g = guidanceOf(f21.structure);
    expect([g.bodyweight_squat, g.glute_bridge, g.single_leg_romanian_deadlift].map((x) => [x!.mode, x!.reason, x!.change, x!.targetReps, x!.nextStep])).toEqual([
      ["target", "top_of_range_reached", "keep", 8, "no_bodyweight_variant"],
      ["reference", "different_dose", undefined, undefined, undefined],
      ["target", "top_of_range_reached", "keep", 10, "no_bodyweight_variant"],
    ]);
  });

  it("C — mobility: check-in → the complete routine in order → completed without results → M1 reads it the next day", async () => {
    const r = await rider("C", "intermediate", ["dumbbells", "bench"]);
    await insertCheckin(admin, r.athleteId, "2026-10-28");
    const d = await runDailyFor(admin, r.athleteId, "2026-10-28", PHYS_ON_DEPS);
    const f = (await finalOf(d.persistence.decision_id))!;
    expect([d.dailyPlan.decision, d.dailyPlan.final_session.kind, d.finalPrescriptionStatus, f.structure.family, f.structure.protocolId, f.reconciliation_action]).toEqual([
      "KEEP",
      "MOBILITY",
      "created",
      "mobility",
      "mobility_routine_v1",
      "keep",
    ]);
    expect(items(f.structure).map((i) => i.exerciseId)).toEqual(MOBILITY);
    expect(items(f.structure).every((i) => i.measure.type === "duration" && i.rpeTarget === undefined)).toBe(true);
    const id = randomUUID();
    await record(r.athleteId, {
      execution: { id, session_date: "2026-10-28", started_at: "2026-10-28T18:00:00Z", final_prescription_id: f.id },
      events: [
        { id: randomUUID(), execution_id: id, event_type: "started", occurred_at: "2026-10-28T18:00:00Z" },
        { id: randomUUID(), execution_id: id, event_type: "completed", occurred_at: "2026-10-28T18:28:00Z" },
      ],
    });
    await insertCheckin(admin, r.athleteId, "2026-10-29");
    const next = await computeDailyFor(admin, r.athleteId, "2026-10-29");
    expect(next.rawContext.recent_sessions.find((s) => s.date === "2026-10-28")).toMatchObject({ intervention: { kind: "MOBILITY" }, completion_status: "done" });
  });

  it("D — the rider's time: mobility 25 min → the routine at its minimum (22); 20 min → active recovery; Force 40 min → shortened, guidance kept", async () => {
    const r25 = await rider("D25", "intermediate", []);
    await insertCheckin(admin, r25.athleteId, "2026-10-28", { available_minutes_today: 25 });
    const d25 = await runDailyFor(admin, r25.athleteId, "2026-10-28", PHYS_ON_DEPS);
    const f25 = (await finalOf(d25.persistence.decision_id))!;
    expect([d25.dailyPlan.final_session.kind, d25.dailyPlan.final_session.duration_min, f25.adaptation_rule_ids, items(f25.structure).map((i) => i.exerciseId)]).toEqual([
      "MOBILITY",
      22,
      ["v2.time.mobility_minimum", "v2.time.today_limit"],
      MOBILITY,
    ]);
    expect(f25.structure.blocks.reduce((sum, b) => sum + b.durationMinutes!.max, 0)).toBe(22);
    const r20 = await rider("D20", "intermediate", []);
    await insertCheckin(admin, r20.athleteId, "2026-10-28", { available_minutes_today: 20 });
    const d20 = await runDailyFor(admin, r20.athleteId, "2026-10-28", PHYS_ON_DEPS);
    expect([d20.dailyPlan.decision, d20.dailyPlan.final_session.kind]).toEqual(["REPLACE", "RECOVERY_ACTIVE"]);
    const rF = await rider("D40", "beginner", []);
    await insertCheckin(admin, rF.athleteId, "2026-10-14", { available_minutes_today: 40 });
    const dF = await runDailyFor(admin, rF.athleteId, "2026-10-14", PHYS_ON_DEPS);
    const fF = (await finalOf(dF.persistence.decision_id))!;
    expect([dF.dailyPlan.decision, fF.adaptation_rule_ids]).toEqual(["MODIFY", ["v2.time.strength_shortened", "v2.time.today_limit"]]);
    expect(Object.values(guidanceOf(fF.structure)).every((g) => g.mode === "calibrate")).toBe(true);
    expect(dF.dailyPlan.final_session.duration_min).toBeLessThanOrEqual(40);
  });

  it("E — health first (P0-SAFE): a traumatic pain on the mobility day → REST, no routine", async () => {
    const r = await rider("E", "intermediate", []);
    await insertCheckin(admin, r.athleteId, "2026-10-28", { pain: true, pain_intensity: 6, pain_new: false, pain_location_code: "ankle_R", pain_traumatic: true, pain_function_loss: false, pain_getting_worse: false });
    const d = await runDailyFor(admin, r.athleteId, "2026-10-28", PHYS_ON_DEPS);
    expect([d.dailyPlan.decision, d.dailyPlan.final_session.kind, await finalOf(d.persistence.decision_id)]).toEqual(["REST", "REST", null]);
  });

  it("F — a manual mobility session (the rider's own choice) is built from the same routine", async () => {
    const r = await rider("F", "intermediate", [], false);
    const { error } = await (await getAthleteAuthClient(r.athleteId))
      .from("planned_sessions")
      .upsert({ athlete_id: r.athleteId, planned_date: "2026-10-18", session_type: "RECOVERY", intervention: { kind: "MOBILITY" }, planned_intent: null, source: "manual", is_committed: false, source_plan_version_id: null, source_generated_session_id: null }, { onConflict: "athlete_id,planned_date" });
    if (error) throw new Error(error.message);
    await insertCheckin(admin, r.athleteId, "2026-10-18");
    const d = await runDailyFor(admin, r.athleteId, "2026-10-18", PHYS_ON_DEPS);
    const f = (await finalOf(d.persistence.decision_id))!;
    expect([d.finalPrescriptionStatus, f.structure.family, items(f.structure).map((i) => i.exerciseId)]).toEqual(["created", "mobility", MOBILITY]);
  });

  it("G — option off: no mobility session in the plan (the previous plans)", async () => {
    const r = await rider("G", "intermediate", [], false);
    expect(r.sessions.some((s) => s.kind === "MOBILITY")).toBe(false);
  });
});
