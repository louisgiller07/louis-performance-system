/**
 * PHYS-01 — the physical coaching vertical path, end to end on the LOCAL Supabase:
 * new rider → V2 plan (real generation, acceptance, projection) → check-in → the real runDailyFor (real M1)
 * → a complete upper-body Force prescription (warm-up, exercises in order, sets / reps / RPE / rest, cool-down)
 * with its load guidance → guided recording through the real record_session_execution → completion
 * → the next session's guidance read from that history. Four riders: beginner without history, advanced with
 * a load history, 30 minutes with dumbbells only, a blocking health signal. Local only.
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
import { DEFAULT_RUN_DAILY_FOR_DEPS, runDailyFor } from "../../src/supabase/runDailyFor.js";
// V2-PHYS-INTEGRATION-01 — these PHYS rules run with every PHYS switch ON (performance guidance included); every
// switch off is the production behaviour (the production tests kept unchanged, phys00FlagsOffEquivalence).
const PHYS_ON_DEPS = { ...DEFAULT_RUN_DAILY_FOR_DEPS, physSwitches: { daily: true, performanceGuidance: true, intervals: true, power: true, mobility: true } };

const INTEGRATION_ENABLED = localIntegrationRequested();
const GENERATED_ON = "2026-10-04";
const FIRST_DAY = "2026-10-05";
const WINDOW_END = "2026-11-15";
const FULL_GYM = ["barbell", "squat_rack", "dumbbells", "bench", "resistance_bands", "cable_machine", "pull_up_bar"];

type Item = {
  kind: string;
  prescriptionItemId: string;
  exerciseId: string;
  role: string;
  sets: number;
  measure: { type: string; min?: number; max?: number };
  restSeconds?: { min: number; max: number };
  rpeTarget?: { min: number; max: number };
  cueId: string;
  loadGuidance?: Record<string, unknown> & { mode: string; reason: string };
};
type Structure = { family: string; sessionKind: string; templateId: string; blocks: { role: string; instructionIds: string[]; items: Item[] }[] };

describe.skipIf(!INTEGRATION_ENABLED)("PHYS-01 — physical coaching vertical path (local Supabase)", { timeout: 240_000 }, () => {
  let admin: SupabaseClient;
  beforeAll(() => {
    admin = createTestClient();
  });

  async function rider(name: string, tier: "beginner" | "intermediate" | "advanced", equipment: string[], durationWeeks = 3) {
    const { athleteId } = await createTestAthlete(admin, name);
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
      { planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks, today: GENERATED_ON },
      { buildPlanInputSnapshotV2, callRpc: generateTrainingPlanVersionRpcV2, mintId: () => randomUUID() }
    );
    if (persisted.status !== "persisted") throw new Error(`expected a persisted V2 plan, got ${persisted.status}`);
    const accepted = await acceptTrainingPlanVersion(admin, athleteId, persisted.planVersionId, FIRST_DAY, WINDOW_END);
    expect(accepted.warnings).toEqual([]);
    return { athleteId, planVersionId: persisted.planVersionId };
  }

  async function datesOf(planVersionId: string, kind: string): Promise<string[]> {
    const { data } = await admin.from("training_plan_generated_sessions").select("date").eq("plan_version_id", planVersionId).eq("kind", kind).order("date");
    return (data ?? []).map((r) => r.date as string);
  }

  /** The day's check-in, then the real daily run; the persisted final prescription row (null when none). */
  async function day(athleteId: string, date: string, checkin: CheckinFixture = {}) {
    await insertCheckin(admin, athleteId, date, checkin);
    const result = await runDailyFor(admin, athleteId, date, PHYS_ON_DEPS);
    const { data: rows } = await admin.from("decision_final_prescriptions").select("id, structure, adaptation_rule_ids").eq("decision_id", result.persistence.decision_id);
    const row = rows?.[0] ?? null;
    return { result, finalPrescriptionId: (row?.id as string | undefined) ?? null, structure: (row?.structure as Structure | undefined) ?? null, ruleIds: (row?.adaptation_rule_ids as string[] | undefined) ?? [] };
  }

  const record = async (athleteId: string, payload: unknown) => {
    const { data, error } = await admin.rpc("record_session_execution", { p_athlete_id: athleteId, p_payload: payload });
    if (error) throw new Error(error.message);
    return data as { status: string; code?: string; target?: string };
  };

  /** A guided Force execution: started, the given work sets recorded, completed. */
  async function perform(athleteId: string, date: string, finalPrescriptionId: string, sets: { item: Item; reps: number; loadKg?: number; rpe?: number }[]) {
    const id = randomUUID();
    const at = (minute: number) => `${date}T17:${String(minute).padStart(2, "0")}:00Z`;
    expect(await record(athleteId, { execution: { id, session_date: date, started_at: at(0), final_prescription_id: finalPrescriptionId }, events: [{ id: randomUUID(), execution_id: id, event_type: "started", occurred_at: at(0) }] })).toMatchObject({ status: "ok" });
    const counters = new Map<string, number>();
    const rows = sets.map((s, i) => {
      const n = (counters.get(s.item.prescriptionItemId) ?? 0) + 1;
      counters.set(s.item.prescriptionItemId, n);
      return {
        id: randomUUID(),
        execution_id: id,
        prescription_item_id: s.item.prescriptionItemId,
        set_number: n,
        done: true,
        measure_type: "reps",
        measure_value: s.reps,
        ...(s.loadKg !== undefined ? { load_kg: s.loadKg } : {}),
        ...(s.rpe !== undefined ? { rpe_actual: s.rpe } : {}),
        occurred_at: at(5 + i),
      };
    });
    expect(await record(athleteId, { sets: rows })).toMatchObject({ status: "ok" });
    expect(await record(athleteId, { events: [{ id: randomUUID(), execution_id: id, event_type: "completed", occurred_at: at(55) }] })).toMatchObject({ status: "ok" });
  }

  const work = (s: Structure) => s.blocks.filter((b) => b.role === "main" || b.role === "complementary").flatMap((b) => b.items);
  const byExercise = (s: Structure, exerciseId: string) => s.blocks.flatMap((b) => b.items).find((i) => i.exerciseId === exerciseId)!;
  const sets = (item: Item, count: number, reps: number, loadKg?: number, rpe?: number) => Array.from({ length: count }, () => ({ item, reps, loadKg, rpe }));

  it("A — beginner without history, no equipment: a complete upper-body session (warm-up, exercises in order with sets / reps / RPE / rest, cool-down), no load invented", async () => {
    const a = await rider("PHYS-01 A beginner", "beginner", []);
    const [upper] = await datesOf(a.planVersionId, "STRENGTH_UPPER");
    const d = await day(a.athleteId, upper!);
    expect(d.result.dailyPlan.decision).toBe("KEEP");
    const s = d.structure!;
    expect(s.blocks.map((b) => [b.role, b.items.map((i) => i.exerciseId)])).toEqual([
      ["warm_up", ["thoracic_rotation_mobility", "wrist_mobility", "bear_crawl"]],
      ["main", ["pushup"]],
      ["complementary", ["floor_ytw_raise"]],
      ["complementary", ["dead_bug"]],
      ["cool_down", ["cat_cow", "breathing_long_exhale"]],
    ]);
    for (const item of work(s)) {
      expect(item.sets).toBeGreaterThanOrEqual(2);
      expect(item.measure.type).toBe("reps");
      expect(item.rpeTarget).toBeDefined();
      expect(item.restSeconds).toBeDefined();
      expect(item.cueId).toMatch(/^cue\./);
    }
    expect(s.blocks.at(-1)!.instructionIds).toEqual(["instruction.recovery.light_mobility"]);
    // Bodyweight only: no kilogram anywhere, not even a guidance.
    expect(JSON.stringify(s)).not.toMatch(/loadGuidance|Kg/);
  });

  it("B — advanced with a load history, over a 6-week block: calibration, the last load shown when the range changes, the load held when the dose already goes up, +1 step at the same range, held again on the next overload", async () => {
    const b = await rider("PHYS-01 B advanced", "advanced", FULL_GYM, 6);
    const [u1, u2, u3, u4, u5] = (await datesOf(b.planVersionId, "STRENGTH_UPPER")) as [string, string, string, string, string];
    const dose = (i: Item) => [i.sets, i.measure.min, i.measure.max, i.rpeTarget!.min, i.rpeTarget!.max];
    const benchOf = (s: Structure) => byExercise(s, "barbell_bench_press");
    const log: unknown[] = [];

    // Session 1 — introduction week (LIGHT 3 × 8–10, RPE 5–6), no history: calibration by effort, no number.
    const d1 = await day(b.athleteId, u1);
    const bench1 = benchOf(d1.structure!);
    expect(dose(bench1)).toEqual([3, 8, 10, 5, 6]);
    expect(bench1.loadGuidance).toMatchObject({ mode: "calibrate", reason: "no_history", loadBasis: "total" });
    expect(work(d1.structure!).map((i) => [i.exerciseId, i.loadGuidance?.mode ?? null])).toEqual([
      ["barbell_bench_press", "calibrate"],
      ["lat_pulldown", "calibrate"],
      ["hanging_leg_raise", null],
    ]);
    // The rider chooses 50 kg: 3 × 10, RPE 6 (the top of the range, inside the effort target).
    await perform(b.athleteId, u1, d1.finalPrescriptionId!, sets(bench1, 3, 10, 50, 6));
    log.push({ session: 1, date: u1, dose: dose(bench1), guidance: bench1.loadGuidance, recorded: "3 × 10 @ 50 kg, RPE 6" });

    // Session 2 — build week (MODERATE 4 × 6–8, RPE 7–8): no session at this range yet → the last load is shown, never converted.
    const d2 = await day(b.athleteId, u2);
    const bench2 = benchOf(d2.structure!);
    expect(dose(bench2)).toEqual([4, 6, 8, 7, 8]);
    expect(bench2.loadGuidance).toEqual({
      ruleVersion: "strength-load-guidance-v1",
      mode: "reference",
      reason: "different_dose",
      loadBasis: "total",
      reference: { sessionDate: u1, loadKg: 50, reps: [10, 10, 10], setsPrescribed: 3, repsRange: { min: 8, max: 10 }, rpeMax: 6 },
      repsInReserve: { min: 2, max: 3 },
    });
    // The rider adjusts by effort and chooses 55 kg: 4 × 8, RPE 8.
    await perform(b.athleteId, u2, d2.finalPrescriptionId!, sets(bench2, 4, 8, 55, 8));
    log.push({ session: 2, date: u2, dose: dose(bench2), guidance: bench2.loadGuidance, recorded: "4 × 8 @ 55 kg, RPE 8" });

    // Session 3 — overload week (MODERATE_PLUS 5 × 6–8, RPE 8): session 2 reached the top at RPE 8, but today the dose already goes
    // up (+1 set): one lever at a time → same load, held because of the dose.
    const d3 = await day(b.athleteId, u3);
    const bench3 = benchOf(d3.structure!);
    expect(dose(bench3)).toEqual([5, 6, 8, 8, 8]);
    expect(bench3.loadGuidance).toMatchObject({ mode: "target", reason: "top_of_range_reached", change: "keep", hold: "dose_up", targetKg: 55, reference: { sessionDate: u2, loadKg: 55 } });
    await perform(b.athleteId, u3, d3.finalPrescriptionId!, sets(bench3, 5, 8, 55, 8));
    log.push({ session: 3, date: u3, dose: dose(bench3), guidance: bench3.loadGuidance, recorded: "5 × 8 @ 55 kg, RPE 8" });

    // (Week 4 is the consolidation week: no upper-body Force.)
    // Session 4 — build week of the next cycle (MODERATE 4 × 6–8): the same-range reference is session 3 (5 × 8 @ 55, RPE 8);
    // today's dose is not heavier (4 sets ≤ 5, RPE 8 ≤ 8) → +2.5 kg = 57.5.
    const d4 = await day(b.athleteId, u4);
    const bench4 = benchOf(d4.structure!);
    expect(dose(bench4)).toEqual([4, 6, 8, 7, 8]);
    expect(bench4.loadGuidance).toMatchObject({ mode: "target", reason: "top_of_range_reached", change: "increase", targetKg: 57.5, stepKg: 2.5, reference: { sessionDate: u3, loadKg: 55, reps: [8, 8, 8, 8, 8], rpeMax: 8 } });
    expect(bench4.loadGuidance).not.toHaveProperty("hold");
    // The guidance is persisted with the decision's final prescription (traceable) and equals what was computed.
    const { data: persisted } = await admin.from("decision_final_prescriptions").select("structure").eq("id", d4.finalPrescriptionId!).single();
    expect(benchOf(persisted!.structure as Structure).loadGuidance).toEqual(bench4.loadGuidance);
    // The rider follows it: 4 × 8 @ 57.5 kg, RPE 8.
    await perform(b.athleteId, u4, d4.finalPrescriptionId!, sets(bench4, 4, 8, 57.5, 8));
    log.push({ session: 4, date: u4, dose: dose(bench4), guidance: bench4.loadGuidance, recorded: "4 × 8 @ 57.5 kg, RPE 8" });

    // Session 5 — next overload week (5 × 6–8): the top was reached again, but the dose goes up → 57.5 kg held (dose_up).
    const d5 = await day(b.athleteId, u5);
    const bench5 = benchOf(d5.structure!);
    expect(dose(bench5)).toEqual([5, 6, 8, 8, 8]);
    expect(bench5.loadGuidance).toMatchObject({ mode: "target", change: "keep", hold: "dose_up", targetKg: 57.5, reference: { sessionDate: u4, loadKg: 57.5 } });
    log.push({ session: 5, date: u5, dose: dose(bench5), guidance: bench5.loadGuidance });
    console.info("PHYS-01.1 B history:", JSON.stringify(log));
  });

  it("C — 30 minutes today, dumbbells only: the same LIGHT session, two exercises kept at their dose, full warm-up, the cool-down's mobility, within 30 minutes", async () => {
    const c = await rider("PHYS-01 C 30 min", "intermediate", ["dumbbells"]);
    const [lower] = await datesOf(c.planVersionId, "STRENGTH_LOWER");
    const d = await day(c.athleteId, lower!, { available_minutes_today: 30 });
    expect(d.ruleIds).toEqual(["v2.time.strength_shortened", "v2.time.today_limit"]);
    expect(d.result.dailyPlan.final_session).toMatchObject({ kind: "STRENGTH_LOWER", load_profile: "LIGHT" });
    expect(d.result.dailyPlan.final_session.duration_min!).toBeLessThanOrEqual(30);
    const s = d.structure!;
    expect(s.blocks.map((b) => [b.role, b.items.map((i) => i.exerciseId)])).toEqual([
      ["warm_up", ["hip_90_90", "knee_to_wall_ankle", "bird_dog"]],
      ["main", ["goblet_squat"]],
      ["complementary", ["dumbbell_romanian_deadlift"]],
      ["cool_down", ["hip_flexor_mobility"]],
    ]);
    // Same LIGHT dose as the planned session (3 × 8–10 / 2 × 10–12, RPE 5–6, planned rests).
    expect(work(s).map((i) => [i.sets, i.measure.min, i.measure.max, i.rpeTarget, i.restSeconds])).toEqual([
      [3, 8, 10, { min: 5, max: 6 }, { min: 90, max: 120 }],
      [2, 10, 12, { min: 5, max: 6 }, { min: 60, max: 90 }],
    ]);
    expect(work(s).map((i) => [i.exerciseId, i.loadGuidance?.mode, i.loadGuidance?.loadBasis, i.loadGuidance?.repsInReserve])).toEqual([
      ["goblet_squat", "calibrate", "per_dumbbell", { min: 4, max: 5 }],
      ["dumbbell_romanian_deadlift", "calibrate", "per_dumbbell", { min: 4, max: 5 }],
    ]);
  });

  it("D — a blocking health signal: no session, no guidance; the earlier Force prescription of the day can no longer be started", async () => {
    const r = await rider("PHYS-01 D health", "intermediate", ["dumbbells", "bench"]);
    const [upper] = await datesOf(r.planVersionId, "STRENGTH_UPPER");
    const before = await day(r.athleteId, upper!);
    expect(before.structure?.family).toBe("strength");
    // The rider then declares a traumatic knee pain with function loss: the day's decision becomes rest (P0-SAFE).
    const { error } = await admin
      .from("daily_checkins")
      .update({ pain: true, pain_intensity: 8, pain_new: true, pain_location_code: "knee_R", pain_traumatic: true, pain_function_loss: true, pain_getting_worse: false })
      .eq("athlete_id", r.athleteId)
      .eq("checkin_date", upper!);
    expect(error).toBeNull();
    const after = await runDailyFor(admin, r.athleteId, upper!, PHYS_ON_DEPS);
    expect([after.dailyPlan.decision, after.finalPrescriptionStatus, after.finalPrescription]).toEqual(["REST", "not_required", undefined]);
    const { data: flags } = await admin.from("health_flags").select("status").eq("athlete_id", r.athleteId);
    expect(flags!.map((f) => f.status)).toContain("active");
    // The guidance never reopens the session: starting the earlier Force prescription is refused by the server.
    const id = randomUUID();
    const refused = await record(r.athleteId, {
      execution: { id, session_date: upper!, started_at: `${upper}T17:00:00Z`, final_prescription_id: before.finalPrescriptionId! },
      events: [{ id: randomUUID(), execution_id: id, event_type: "started", occurred_at: `${upper}T17:00:00Z` }],
    });
    // The rest decision replaced it: the earlier prescription is no longer the day's (server refusal, nothing written).
    expect(refused).toMatchObject({ status: "rejected", code: "final_prescription_not_current" });
    const { data: executions } = await admin.from("session_executions").select("id").eq("athlete_id", r.athleteId);
    expect(executions).toEqual([]);
  });
  it("E — a day with a light pain (not stopping the session): the history allows +1 step, the guidance holds the load (hold: pain)", async () => {
    const e = await rider("PHYS-01 E pain", "intermediate", ["dumbbells", "bench"], 6);
    const uppers = (await datesOf(e.planVersionId, "STRENGTH_UPPER")) as string[];
    // Build week (4 × 6–8): every set at the top, inside the effort target, 20 kg per dumbbell.
    const u2 = uppers[1]!;
    const d2 = await day(e.athleteId, u2);
    const bench2 = byExercise(d2.structure!, "dumbbell_bench_press");
    expect([bench2.sets, bench2.measure.min, bench2.measure.max]).toEqual([4, 6, 8]);
    await perform(e.athleteId, u2, d2.finalPrescriptionId!, sets(bench2, 4, 8, 20, 8));
    // The next build week (same range, same dose → +1 step expected) — but the rider reports a light, known pain that day.
    const u4 = uppers[3]!;
    const d4 = await day(e.athleteId, u4, { pain: true, pain_intensity: 2, pain_new: false, pain_location_code: "knee_R", pain_traumatic: false, pain_function_loss: false, pain_getting_worse: false });
    expect(d4.result.dailyPlan.final_session.kind).toBe("STRENGTH_UPPER");
    const bench4 = byExercise(d4.structure!, "dumbbell_bench_press");
    expect(bench4.loadGuidance).toMatchObject({ mode: "target", reason: "top_of_range_reached", change: "keep", hold: "pain", targetKg: 20, loadBasis: "per_dumbbell" });
  });

});
