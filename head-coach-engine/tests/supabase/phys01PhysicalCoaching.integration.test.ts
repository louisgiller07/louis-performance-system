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
import { runDailyFor } from "../../src/supabase/runDailyFor.js";

const INTEGRATION_ENABLED = localIntegrationRequested();
const GENERATED_ON = "2026-10-04";
const FIRST_DAY = "2026-10-05";
const WINDOW_END = "2026-10-25";
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

  async function rider(name: string, tier: "beginner" | "intermediate" | "advanced", equipment: string[]) {
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
      { planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 3, today: GENERATED_ON },
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
    const result = await runDailyFor(admin, athleteId, date);
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

  it("B — advanced with a load history: calibration first, then the last load shown when the dose changes, then +1 step when every set reached the top of the range", async () => {
    const b = await rider("PHYS-01 B advanced", "advanced", FULL_GYM);
    const uppers = await datesOf(b.planVersionId, "STRENGTH_UPPER");
    expect(uppers.length).toBeGreaterThanOrEqual(3);
    const [u1, u2, u3] = uppers as [string, string, string];

    // Session 1 — no history: calibration by effort on the loaded exercises, nothing on bodyweight ones.
    const d1 = await day(b.athleteId, u1);
    const s1 = d1.structure!;
    expect(work(s1).map((i) => [i.exerciseId, i.loadGuidance?.mode ?? null, i.loadGuidance?.reason ?? null])).toEqual([
      ["barbell_bench_press", "calibrate", "no_history"],
      ["lat_pulldown", "calibrate", "no_history"],
      ["hanging_leg_raise", null, null],
    ]);
    const bench1 = byExercise(s1, "barbell_bench_press");
    const lat1 = byExercise(s1, "lat_pulldown");
    console.info("B session 1:", bench1.sets, "×", bench1.measure, bench1.loadGuidance);
    // The rider records the loads actually used: every set at the top of the range, effort within the target.
    await perform(b.athleteId, u1, d1.finalPrescriptionId!, [...sets(bench1, bench1.sets, bench1.measure.max!, 50, bench1.rpeTarget!.max), ...sets(lat1, lat1.sets, lat1.measure.max!, 40, lat1.rpeTarget!.max)]);

    // The plan's own progression: introduction (LIGHT, 3 × 8–10) → build (MODERATE, 4 × 6–8) → build+ (MODERATE_PLUS, 5 × 6–8).
    expect([bench1.sets, bench1.measure.min, bench1.measure.max]).toEqual([3, 8, 10]);

    // Session 2 — the history is read; another repetition range today → the last load is shown, never converted.
    const d2 = await day(b.athleteId, u2);
    const bench2 = byExercise(d2.structure!, "barbell_bench_press");
    const lat2 = byExercise(d2.structure!, "lat_pulldown");
    console.info("B session 2:", bench2.sets, "×", bench2.measure, bench2.loadGuidance);
    expect([bench2.sets, bench2.measure.min, bench2.measure.max]).toEqual([4, 6, 8]);
    expect(bench2.loadGuidance).toEqual({
      ruleVersion: "strength-load-guidance-v1",
      mode: "reference",
      reason: "different_dose",
      reference: { sessionDate: u1, loadKg: 50, reps: [10, 10, 10], setsPrescribed: 3, repsRange: { min: 8, max: 10 }, rpeMax: 6 },
      repsInReserve: { min: 2, max: 3 },
    });
    await perform(b.athleteId, u2, d2.finalPrescriptionId!, [
      ...sets(bench2, bench2.sets, bench2.measure.max!, 55, bench2.rpeTarget!.max),
      ...sets(lat2, lat2.sets, lat2.measure.min!, 45, lat2.rpeTarget!.max),
    ]);

    // Session 3 — same repetition range as session 2 at the top with the effort in target → one step up (barbell: 2.5 kg).
    const d3 = await day(b.athleteId, u3);
    const bench3 = byExercise(d3.structure!, "barbell_bench_press");
    console.info("B session 3:", bench3.sets, "×", bench3.measure, bench3.loadGuidance);
    expect([bench3.measure.min, bench3.measure.max]).toEqual([bench2.measure.min, bench2.measure.max]);
    expect(bench3.loadGuidance).toMatchObject({ mode: "target", reason: "top_of_range_reached", change: "increase", targetKg: 57.5, stepKg: 2.5, reference: { sessionDate: u2, loadKg: 55 } });
    // The guidance is persisted with the decision's final prescription (traceable), and validated.
    const { data: persisted } = await admin.from("decision_final_prescriptions").select("structure").eq("id", d3.finalPrescriptionId!).single();
    expect(byExercise(persisted!.structure as Structure, "barbell_bench_press").loadGuidance).toEqual(bench3.loadGuidance);
    expect([bench3.sets, bench3.measure.min, bench3.measure.max]).toEqual([5, 6, 8]);
    // The lat pulldown's range changed between build (8–12) and build+ (8–10): its last load is shown, never converted.
    const lat3 = byExercise(d3.structure!, "lat_pulldown");
    console.info("B session 3 lat:", lat3.measure, lat3.loadGuidance);
    expect(lat3.loadGuidance).toMatchObject({ mode: "reference", reason: "different_dose", reference: { sessionDate: u2, loadKg: 45, repsRange: { min: 8, max: 12 } } });
  });

  it("C — 30 minutes today, dumbbells only: the short Force (same exercises, LIGHT, principal + secondary, cool-down mobility) within 30 minutes, guided by effort", async () => {
    const c = await rider("PHYS-01 C 30 min", "intermediate", ["dumbbells"]);
    const [lower] = await datesOf(c.planVersionId, "STRENGTH_LOWER");
    const d = await day(c.athleteId, lower!, { available_minutes_today: 30 });
    expect(d.ruleIds).toContain("v2.time.strength_short");
    expect(d.result.dailyPlan.final_session).toMatchObject({ kind: "STRENGTH_LOWER", load_profile: "LIGHT" });
    expect(d.result.dailyPlan.final_session.duration_min!).toBeLessThanOrEqual(30);
    const s = d.structure!;
    expect(s.blocks.map((b) => [b.role, b.items.map((i) => i.exerciseId)])).toEqual([
      ["warm_up", ["hip_90_90", "knee_to_wall_ankle", "bird_dog"]],
      ["main", ["goblet_squat"]],
      ["complementary", ["dumbbell_romanian_deadlift"]],
      ["cool_down", ["hip_flexor_mobility"]],
    ]);
    expect(work(s).map((i) => [i.exerciseId, i.loadGuidance?.mode, i.loadGuidance?.repsInReserve])).toEqual([
      ["goblet_squat", "calibrate", { min: 4, max: 5 }],
      ["dumbbell_romanian_deadlift", "calibrate", { min: 4, max: 5 }],
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
    const after = await runDailyFor(admin, r.athleteId, upper!);
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
});
