/**
 * PHYS-03 — the power (explosiveness) session end to end on the LOCAL Supabase (real tables, real RPCs, the Node
 * path of the daily run): plan with the power option → check-in → the day's adaptation → the complete session →
 * the sets performed → history (M1 reads the completed power session the next day). Riders: intermediate with
 * dumbbells, advanced without equipment, beginner, limited time, legs fatigue, short night, blocking health signal.
 *
 * Plan (fresh rider, 2026-10-05 → 2026-11-15, deterministic): power on 10-14 and 11-04 (build weeks, the day after a
 * DH technique day), the lower-body Force sessions of the other weeks unchanged.
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
import { computeDailyFor } from "../../src/supabase/computeDailyFor.js";
// V2-PHYS-INTEGRATION-01 — these PHYS rules run with every PHYS switch ON (performance guidance included); every
// switch off is the production behaviour (the production tests kept unchanged, phys00FlagsOffEquivalence).
const PHYS_ON_DEPS = { ...DEFAULT_RUN_DAILY_FOR_DEPS, physSwitches: { daily: true, performanceGuidance: true, intervals: true, power: true, mobility: true } };

const ENABLED = localIntegrationRequested();
const SYSTEMIC_RED: CheckinFixture = { sleep_hours: 4, sleep_quality: 2, sleep_wake_ups: 4, energy: 2 };

type Item = { kind: string; prescriptionItemId: string; exerciseId: string; role: string; sets: number; measure: { type: string; min?: number; max?: number }; restSeconds?: { min: number; max: number } };
type Structure = { family: string; sessionKind: string; blocks: { role: string; items: Item[] }[] };
const explosive = (s: Structure) => s.blocks.filter((b) => b.role === "main").map((b) => b.items[0]!);

describe.skipIf(!ENABLED)("PHYS-03 — power session end to end (local Supabase)", { timeout: 300_000 }, () => {
  let admin: SupabaseClient;
  beforeAll(() => {
    admin = createTestClient();
  });

  async function rider(name: string, tier: "beginner" | "intermediate" | "advanced", equipment: string[]) {
    const { athleteId } = await createTestAthlete(admin, `PHYS-03 ${name}`);
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
      { planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 6, today: "2026-10-04", powerSessions: true },
      { buildPlanInputSnapshotV2, callRpc: generateTrainingPlanVersionRpcV2, mintId: () => randomUUID() }
    );
    if (persisted.status !== "persisted") throw new Error("plan");
    await acceptTrainingPlanVersion(admin, athleteId, persisted.planVersionId, "2026-10-05", "2026-11-15");
    const { data } = await admin.from("training_plan_generated_sessions").select("date, kind, load_profile, duration_min").eq("plan_version_id", persisted.planVersionId).in("kind", ["POWER", "STRENGTH_LOWER"]).order("date");
    return { athleteId, sessions: (data ?? []) as { date: string; kind: string; load_profile: string; duration_min: number }[] };
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

  it("A — intermediate with dumbbells: plan → check-in → the complete power session → every explosive set recorded → history (M1 reads it)", async () => {
    const r = await rider("A", "intermediate", ["dumbbells", "bench"]);
    expect(r.sessions.map((s) => [s.date, s.kind, s.duration_min, s.load_profile])).toEqual([
      ["2026-10-07", "STRENGTH_LOWER", 45, "LIGHT"],
      ["2026-10-14", "POWER", 60, "MODERATE"],
      ["2026-10-21", "STRENGTH_LOWER", 60, "MODERATE"],
      ["2026-10-27", "STRENGTH_LOWER", 45, "LIGHT"],
      ["2026-11-04", "POWER", 60, "MODERATE"],
      ["2026-11-11", "STRENGTH_LOWER", 60, "MODERATE"],
    ]);
    await insertCheckin(admin, r.athleteId, "2026-10-14");
    const d = await runDailyFor(admin, r.athleteId, "2026-10-14", PHYS_ON_DEPS);
    // The decision says the realistic duration (A07: the content's estimate).
    expect([d.dailyPlan.decision, d.dailyPlan.final_session, d.finalPrescriptionStatus]).toEqual(["KEEP", { kind: "POWER", load_profile: "MODERATE", duration_min: 59 }, "created"]);
    const f = (await finalOf(d.persistence.decision_id))!;
    expect([f.structure.family, f.reconciliation_action, f.structure.blocks.map((b) => b.role)]).toEqual(["power", "keep", ["warm_up", "main", "main", "main", "main", "cool_down"]]);
    expect(explosive(f.structure).map((i) => [i.exerciseId, i.sets, i.restSeconds])).toEqual([
      ["squat_jump", 3, { min: 120, max: 180 }],
      ["broad_jump", 3, { min: 120, max: 180 }],
      ["skater_jump", 3, { min: 120, max: 180 }],
      ["dumbbell_swing", 3, { min: 120, max: 180 }],
    ]);

    // The rider does the session: every explosive set, reps only (no load), the last set of the skater jumps stopped (quality).
    const id = randomUUID();
    await record(r.athleteId, { execution: { id, session_date: "2026-10-14", started_at: "2026-10-14T17:00:00Z", final_prescription_id: f.id }, events: [{ id: randomUUID(), execution_id: id, event_type: "started", occurred_at: "2026-10-14T17:00:00Z" }] });
    const sets = explosive(f.structure).flatMap((item) =>
      Array.from({ length: item.sets }, (_, i) => ({
        id: randomUUID(),
        execution_id: id,
        prescription_item_id: item.prescriptionItemId,
        set_number: i + 1,
        done: !(item.exerciseId === "skater_jump" && i === 2),
        measure_type: "reps",
        measure_value: item.exerciseId === "skater_jump" && i === 2 ? null : item.measure.max,
        occurred_at: `2026-10-14T17:${String(10 + i).padStart(2, "0")}:00Z`,
      }))
    );
    await record(r.athleteId, { sets, events: [{ id: randomUUID(), execution_id: id, event_type: "completed", occurred_at: "2026-10-14T17:59:00Z" }] });
    const { data: rows } = await admin.from("exercise_set_results").select("done, load_kg").eq("execution_id", id);
    expect([rows!.length, rows!.filter((x) => x.done).length, rows!.every((x) => x.load_kg === null)]).toEqual([12, 11, true]);

    // History: the next day, M1 reads the completed power session.
    await insertCheckin(admin, r.athleteId, "2026-10-15");
    const next = await computeDailyFor(admin, r.athleteId, "2026-10-15");
    expect(next.rawContext.recent_sessions.find((s) => s.date === "2026-10-14")).toMatchObject({ intervention: { kind: "POWER", load_profile: "MODERATE" }, completion_status: "done" });
  });

  it("B — advanced without equipment: the plyometric push-up instead of the swing", async () => {
    const r = await rider("B", "advanced", []);
    await insertCheckin(admin, r.athleteId, "2026-10-14");
    const f = (await finalOf((await runDailyFor(admin, r.athleteId, "2026-10-14", PHYS_ON_DEPS)).persistence.decision_id))!;
    expect(explosive(f.structure).map((i) => i.exerciseId)).toEqual(["squat_jump", "broad_jump", "skater_jump", "plyo_pushup"]);
  });

  it("C — beginner: no explosive exercise at the tier — no power session in the plan, the lower-body Force sessions stay", async () => {
    const r = await rider("C", "beginner", ["dumbbells"]);
    expect(r.sessions.map((s) => s.kind)).toEqual(["STRENGTH_LOWER", "STRENGTH_LOWER", "STRENGTH_LOWER", "STRENGTH_LOWER", "STRENGTH_LOWER", "STRENGTH_LOWER"]);
  });

  it("D — limited equipment and limited time: 3 jumps; 55 min fits (51), 45 min → active recovery (never below three); with dumbbells 55 min drops the swing", async () => {
    const limited = await rider("D", "intermediate", []);
    await insertCheckin(admin, limited.athleteId, "2026-10-14", { available_minutes_today: 55 });
    const d55 = await runDailyFor(admin, limited.athleteId, "2026-10-14", PHYS_ON_DEPS);
    expect([d55.dailyPlan.decision, d55.dailyPlan.final_session.duration_min, explosive((await finalOf(d55.persistence.decision_id))!.structure).map((i) => i.exerciseId)]).toEqual(["KEEP", 51, ["squat_jump", "broad_jump", "skater_jump"]]);
    await insertCheckin(admin, limited.athleteId, "2026-11-04", { available_minutes_today: 45 });
    const d45 = await runDailyFor(admin, limited.athleteId, "2026-11-04", PHYS_ON_DEPS);
    expect([d45.dailyPlan.decision, d45.dailyPlan.final_session.kind]).toEqual(["REPLACE", "RECOVERY_ACTIVE"]);
    const full = await rider("D2", "intermediate", ["dumbbells"]);
    await insertCheckin(admin, full.athleteId, "2026-10-14", { available_minutes_today: 55 });
    const s55 = await runDailyFor(admin, full.athleteId, "2026-10-14", PHYS_ON_DEPS);
    const f55 = (await finalOf(s55.persistence.decision_id))!;
    expect([s55.dailyPlan.decision, f55.adaptation_rule_ids, explosive(f55.structure).map((i) => i.exerciseId), s55.dailyPlan.final_session.duration_min]).toEqual([
      "MODIFY",
      ["v2.time.power_shortened", "v2.time.today_limit"],
      ["squat_jump", "broad_jump", "skater_jump"],
      51,
    ]);
  });

  it("E — tired legs (C3.6): M1 keeps the power session; NALYNT does not prescribe it — decision kept, traced, no document", async () => {
    const r = await rider("E", "intermediate", ["dumbbells"]);
    await insertCheckin(admin, r.athleteId, "2026-10-14", { leg_fatigue: 8 });
    const d = await runDailyFor(admin, r.athleteId, "2026-10-14", PHYS_ON_DEPS);
    expect([d.dailyPlan.decision, d.dailyPlan.final_session.kind, d.finalPrescriptionStatus, d.finalPrescriptionStatusDetail]).toEqual(["KEEP", "POWER", "blocked", { reason: "power_fatigue_not_cleared", rules: ["C3.6"] }]);
    expect(d.dailyPlan.triggered_rules.at(-1)!.rule_id).toBe("V2_POWER_FATIGUE_HOLD");
    expect(await finalOf(d.persistence.decision_id)).toBeNull();
  });

  it("F — short night (C3.3 → LIGHT): no lighter power session — decision kept, reason traced", async () => {
    const r = await rider("F", "intermediate", ["dumbbells"]);
    await insertCheckin(admin, r.athleteId, "2026-10-14", SYSTEMIC_RED);
    const d = await runDailyFor(admin, r.athleteId, "2026-10-14", PHYS_ON_DEPS);
    expect([d.dailyPlan.decision, d.dailyPlan.final_session.kind, d.finalPrescriptionStatus, d.finalPrescriptionStatusDetail?.reason]).toEqual(["MODIFY", "POWER", "blocked", "power_load_not_supported"]);
  });

  it("G — health first (P0-SAFE): a traumatic pain, or a strong pain still open from the day before → REST, no power session", async () => {
    const r = await rider("G", "intermediate", ["dumbbells"]);
    await insertCheckin(admin, r.athleteId, "2026-10-14", { pain: true, pain_intensity: 6, pain_new: false, pain_location_code: "ankle_R", pain_traumatic: true, pain_function_loss: false, pain_getting_worse: false });
    const d = await runDailyFor(admin, r.athleteId, "2026-10-14", PHYS_ON_DEPS);
    expect([d.dailyPlan.decision, d.dailyPlan.final_session.kind, await finalOf(d.persistence.decision_id)]).toEqual(["REST", "REST", null]);
    const r2 = await rider("G2", "intermediate", ["dumbbells"]);
    await insertCheckin(admin, r2.athleteId, "2026-11-03", { pain: true, pain_intensity: 7, pain_new: false, pain_location_code: "knee_L", pain_traumatic: false, pain_function_loss: false, pain_getting_worse: false });
    expect((await runDailyFor(admin, r2.athleteId, "2026-11-03", PHYS_ON_DEPS)).dailyPlan.decision).toBe("REST");
    await insertCheckin(admin, r2.athleteId, "2026-11-04");
    const d2 = await runDailyFor(admin, r2.athleteId, "2026-11-04", PHYS_ON_DEPS);
    expect([d2.dailyPlan.decision, d2.dailyPlan.final_session.kind, await finalOf(d2.persistence.decision_id)]).toEqual(["REST", "REST", null]);
  });
});
