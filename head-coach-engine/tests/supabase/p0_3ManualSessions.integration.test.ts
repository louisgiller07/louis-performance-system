/**
 * P0-3 (HPM 2026-10-13) — manual sessions on a V2 plan, end to end on the production schema: real generation,
 * acceptance, the web's manual write (rider JWT, RLS), check-in, real daily-run, real persistence
 * (persist_daily_run_v2) and the real guided-session RPC (record_session_execution).
 *
 *  A  manual Force haut du corps: complete prescription persisted under the manual contract; the guided session
 *     starts, a work set is recorded, it completes.
 *  B  health first: a manual DH on an A6 day (strong pain) → REST, no final prescription, nothing to start.
 *  C  locks: the planned session of a started or completed day cannot be replaced (server lock, rider JWT); a new
 *     decision of a started day cannot start a second session (active_execution_exists), the running one still
 *     completes; a completed day takes no new session (session_already_completed); a superseded decision's
 *     prescription cannot start (final_prescription_not_current); a double start of the same execution is idempotent.
 *  D  replay: two daily-runs on the same inputs → the same sport content; earlier prescriptions are never rewritten.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, getAthleteAuthClient, insertCheckin, isLoopbackSupabaseUrl, resolveTestSupabaseUrl, setAthleteDiscipline } from "./testDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { generateAndPersistTrainingPlanV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { runDailyFor } from "../../src/supabase/runDailyFor.js";
import { sportFingerprint } from "planning-engine/session-model-v2";
import { SESSION_EXERCISE_CATALOG_V2 } from "planning-engine";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const ENABLED = process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" && !!SERVER_KEY && isLoopbackSupabaseUrl(resolveTestSupabaseUrl());
const EDGE = ENABLED && process.env.RUN_LOCAL_P0_EDGE === "1";
const EQUIPMENT = ["dumbbells", "bench", "barbell", "squat_rack"];

type Item = { kind: string; prescriptionItemId: string; exerciseId?: string; measure: { type: string } };
type Structure = { family: string; sessionKind: string; blocks: { role: string; items: Item[] }[] };

describe.skipIf(!ENABLED)("P0-3 — manual sessions on a V2 plan (local, production schema)", { timeout: 240_000 }, () => {
  let admin: SupabaseClient;
  let athleteId: string;
  let rider: SupabaseClient;
  let dhDays: string[];

  const record = async (payload: unknown) => {
    const { data, error } = await admin.rpc("record_session_execution", { p_athlete_id: athleteId, p_payload: payload });
    if (error) return { status: "error", code: (error as { message?: string }).message };
    return data as { status: string; code?: string };
  };
  function execution(fpId: string, day: string) {
    const id = randomUUID();
    return {
      id,
      start: { execution: { id, session_date: day, started_at: `${day}T17:00:00Z`, final_prescription_id: fpId }, events: [{ id: randomUUID(), execution_id: id, event_type: "started", occurred_at: `${day}T17:00:00Z` }] },
      complete: (sets: unknown[] = []) => ({ sets, events: [{ id: randomUUID(), execution_id: id, event_type: "completed", occurred_at: `${day}T18:00:00Z` }] }),
      set: (item: Item) => ({ id: randomUUID(), execution_id: id, prescription_item_id: item.prescriptionItemId, set_number: 1, done: true, measure_type: item.measure.type, measure_value: item.measure.type === "pass" ? null : item.measure.type === "duration" ? 30 : 8, occurred_at: `${day}T17:30:00Z` }),
    };
  }
  async function manual(date: string, intervention: Record<string, unknown>, session_type: string) {
    const { error } = await rider
      .from("planned_sessions")
      .upsert({ athlete_id: athleteId, planned_date: date, session_type, intervention, planned_intent: null, source: "manual", is_committed: false, source_plan_version_id: null, source_generated_session_id: null }, { onConflict: "athlete_id,planned_date" });
    if (error) throw new Error(error.message);
  }
  async function finalOf(decisionId: string) {
    const { data } = await admin.from("decision_final_prescriptions").select("id, plan_version_id, planned_prescription_id, active_session_origin, reconciliation_action, adaptation_rule_ids, structure").eq("decision_id", decisionId);
    return data as { id: string; plan_version_id: string | null; planned_prescription_id: string | null; active_session_origin: string; reconciliation_action: string; adaptation_rule_ids: string[]; structure: Structure }[];
  }
  const work = (st: Structure) => st.blocks.filter((b) => b.role === "main" || b.role === "complementary").flatMap((b) => b.items).filter((i) => i.kind === "exercise");

  beforeAll(async () => {
    admin = createTestClient();
    athleteId = (await createTestAthlete(admin, `P0-3 manual ${randomUUID().slice(0, 6)}`)).athleteId;
    await setAthleteDiscipline(admin, athleteId, "Downhill");
    await upsertPerformanceProfileFor(admin, athleteId, {
      strength_experience_tier: "intermediate",
      equipment: EQUIPMENT,
      terrain_access: ["flow_trail", "bermed_trail", "technical_trail", "full_dh_track"],
      declared_limitations: [],
      technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
      dh_technical_tier: "intermediate",
    });
    for (const d of [0, 1, 2, 3, 4, 5, 6]) await insertAvailabilityWindow(admin, athleteId, { day_of_week: d, start_time: "08:00:00", end_time: "20:00:00" });
    const persisted = await generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 2, today: "2026-10-04" });
    if (persisted.status !== "persisted") throw new Error("plan");
    await acceptTrainingPlanVersion(admin, athleteId, persisted.planVersionId, "2026-10-05", "2026-10-18");
    rider = await getAthleteAuthClient(athleteId);
    const { data } = await admin.from("planned_sessions").select("planned_date, intervention").eq("athlete_id", athleteId).eq("source", "generated").order("planned_date");
    dhDays = (data as { planned_date: string; intervention: { kind: string } | null }[]).filter((r) => r.intervention?.kind === "DH_TECHNICAL").map((r) => r.planned_date);
    expect(dhDays.length).toBeGreaterThanOrEqual(4);
  }, 120_000);

  it("A — manual Force haut du corps: complete, persisted under the manual contract; the guided session starts and completes", async () => {
    const day = dhDays[0]!;
    await manual(day, { kind: "STRENGTH_UPPER", load_profile: "MODERATE" }, "STRENGTH_B");
    await insertCheckin(admin, athleteId, day);
    const r = await runDailyFor(admin, athleteId, day);
    expect([r.dailyPlan.decision, r.dailyPlan.final_session.kind, r.finalPrescriptionStatus]).toEqual(["KEEP", "STRENGTH_UPPER", "created"]);
    const [f] = await finalOf(r.persistence.decision_id);
    // HPM P1 — the action mirrors M1's KEEP; a keep carries no adaptation rule; no planned prescription.
    expect([f!.active_session_origin, f!.reconciliation_action, f!.planned_prescription_id, f!.plan_version_id !== null]).toEqual(["manual_override_new_kind", "keep", null, true]);
    expect(f!.adaptation_rule_ids).toEqual([]);
    expect([f!.structure.family, f!.structure.sessionKind]).toEqual(["strength", "STRENGTH_UPPER"]);
    const items = work(f!.structure);
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) expect(SESSION_EXERCISE_CATALOG_V2[i.exerciseId!]!.requiredEquipment.every((x) => EQUIPMENT.includes(x)), i.exerciseId).toBe(true);
    // Guided session: starts, a work set (F-6C), completes.
    const e = execution(f!.id, day);
    expect(await record(e.start)).toMatchObject({ status: "ok" });
    expect(await record(e.complete([e.set(items[0]!)]))).toMatchObject({ status: "ok" });
  });

  it("B — health first: a manual DH on an A6 day (8/10, not new), then a manual Force while the signal is open (A7) → REST, no final prescription", async () => {
    const day = dhDays[1]!;
    await manual(day, { kind: "DH_TECHNICAL", load_profile: "MODERATE", duration_min: 90 }, "DH_TECHNICAL");
    await insertCheckin(admin, athleteId, day, { pain: true, pain_intensity: 8, pain_new: false, pain_location_code: "knee_R", pain_traumatic: false, pain_function_loss: false, pain_getting_worse: false });
    const r = await runDailyFor(admin, athleteId, day);
    expect([r.dailyPlan.decision, r.finalPrescriptionStatus]).toEqual(["REST", "not_required"]);
    expect(r.dailyPlan.triggered_rules.map((x) => x.rule_id)).toContain("A6");
    expect(await finalOf(r.persistence.decision_id)).toEqual([]);
    // A7 — the signal is still open on a later day: a manual Force there is not executable either.
    const used = new Set(dhDays.slice(0, 4));
    const later = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"].find((d) => d > day && !used.has(d))!;
    await manual(later, { kind: "STRENGTH_UPPER", load_profile: "MODERATE" }, "STRENGTH_B");
    await insertCheckin(admin, athleteId, later);
    const a7 = await runDailyFor(admin, athleteId, later);
    expect([a7.dailyPlan.decision, a7.finalPrescriptionStatus]).toEqual(["REST", "not_required"]);
    expect(a7.dailyPlan.triggered_rules.map((x) => x.rule_id)).toContain("A7");
    expect(await finalOf(a7.persistence.decision_id)).toEqual([]);
    // Close the signal opened by A6 so the next days are not suspended (A7): never touched by the manual path.
    await admin.from("health_flags").update({ status: "resolved", resolved_at: day }).eq("athlete_id", athleteId).in("status", ["active", "monitoring"]);
  });

  it("C — locks: a started or completed day is never replaced (server lock); no second session starts; stale decisions cannot start", async () => {
    const day = dhDays[2]!;
    await insertCheckin(admin, athleteId, day);
    const generated = await runDailyFor(admin, athleteId, day);
    const [g] = await finalOf(generated.persistence.decision_id);
    const running = execution(g!.id, day);
    expect(await record(running.start)).toMatchObject({ status: "ok" });
    expect(await record(running.start)).toMatchObject({ status: "ok" }); // double launch of the same execution: idempotent

    // The rider replaces the day by hand anyway (direct write under their JWT; the web refuses it first): the server
    // refuses it too (P0-3 lock, migration 20261013140000).
    await expect(manual(day, { kind: "STRENGTH_UPPER", load_profile: "MODERATE" }, "STRENGTH_B")).rejects.toThrow("planned_session_day_locked");
    // A new daily-run on the same inputs: its prescription cannot start a second session; the earlier one is no longer the day's.
    const rerun = await runDailyFor(admin, athleteId, day);
    const [r] = await finalOf(rerun.persistence.decision_id);
    expect(await record(execution(r!.id, day).start)).toMatchObject({ code: "active_execution_exists" });
    expect(await record(execution(g!.id, day).start)).toMatchObject({ code: "final_prescription_not_current" });
    // The running session still completes (passes are its own prescription's items).
    const pass = (g!.structure.blocks.find((b) => b.role === "main")!.items[0]!) as Item;
    expect(await record(running.complete([running.set(pass)]))).toMatchObject({ status: "ok" });

    // Completed day (A): its planned session cannot be replaced, and no second session starts.
    const doneDay = dhDays[0]!;
    await expect(manual(doneDay, { kind: "STRENGTH_LOWER", load_profile: "LIGHT" }, "STRENGTH_B")).rejects.toThrow("planned_session_day_locked");
    const again = await runDailyFor(admin, athleteId, doneDay);
    const [n] = await finalOf(again.persistence.decision_id);
    expect(await record(execution(n!.id, doneDay).start)).toMatchObject({ code: "session_already_completed" });
  });

  it("D — replay: same inputs → same sport content; earlier prescriptions never rewritten", async () => {
    const day = dhDays[3]!;
    await manual(day, { kind: "STRENGTH_LOWER", load_profile: "MODERATE" }, "STRENGTH_A");
    await insertCheckin(admin, athleteId, day);
    const first = await runDailyFor(admin, athleteId, day);
    const [a] = await finalOf(first.persistence.decision_id);
    const second = await runDailyFor(admin, athleteId, day);
    const [b] = await finalOf(second.persistence.decision_id);
    expect(first.persistence.decision_id).not.toBe(second.persistence.decision_id); // append-only decisions
    expect(sportFingerprint(b!.structure)).toBe(sportFingerprint(a!.structure));
    const [aAgain] = await finalOf(first.persistence.decision_id);
    expect(aAgain).toEqual(a); // the earlier prescription is untouched
    expect(await record(execution(a!.id, day).start)).toMatchObject({ code: "final_prescription_not_current" });
  });
});

describe.skipIf(!EDGE)("P0-3 — over the local Edge runtime with the rider's JWT", { timeout: 240_000 }, () => {
  it("daily-run and session-execution: a manual Force is created and its guided session starts; DH 90 + 30 min is adapted", async () => {
    const admin = createTestClient();
    const { athleteId } = await createTestAthlete(admin, `P0-3 edge ${randomUUID().slice(0, 6)}`);
    await setAthleteDiscipline(admin, athleteId, "Downhill");
    await upsertPerformanceProfileFor(admin, athleteId, {
      strength_experience_tier: "intermediate",
      equipment: EQUIPMENT,
      terrain_access: ["flow_trail", "bermed_trail", "technical_trail", "full_dh_track"],
      declared_limitations: [],
      technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
      dh_technical_tier: "intermediate",
    });
    for (const d of [0, 1, 2, 3, 4, 5, 6]) await insertAvailabilityWindow(admin, athleteId, { day_of_week: d, start_time: "08:00:00", end_time: "20:00:00" });
    const persisted = await generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 2, today: "2026-10-04" });
    if (persisted.status !== "persisted") throw new Error("plan");
    await acceptTrainingPlanVersion(admin, athleteId, persisted.planVersionId, "2026-10-05", "2026-10-18");
    const client = await getAthleteAuthClient(athleteId);
    const { data } = await admin.from("planned_sessions").select("planned_date, intervention").eq("athlete_id", athleteId).order("planned_date");
    const days = (data as { planned_date: string; intervention: { kind: string } | null }[]).filter((r) => r.intervention?.kind === "DH_TECHNICAL").map((r) => r.planned_date);
    const invoke = async (name: string, body: unknown) => {
      const { data: out, error } = await client.functions.invoke(name, { body });
      if (!error) return { status: 200, body: out as Record<string, unknown> };
      const res = (error as FunctionsHttpError).context as Response;
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    };
    const write = async (date: string, intervention: Record<string, unknown>, session_type: string) => {
      const { error } = await client.from("planned_sessions").upsert({ athlete_id: athleteId, planned_date: date, session_type, intervention, planned_intent: null, source: "manual", is_committed: false, source_plan_version_id: null, source_generated_session_id: null }, { onConflict: "athlete_id,planned_date" });
      if (error) throw new Error(error.message);
    };

    await write(days[0]!, { kind: "STRENGTH_UPPER", load_profile: "MODERATE" }, "STRENGTH_B");
    await insertCheckin(admin, athleteId, days[0]!);
    const force = await invoke("daily-run", { date: days[0] });
    expect([force.status, force.body.finalPrescriptionStatus]).toEqual([200, "created"]);
    const fp = force.body.finalPrescription as { id: string; structure: Structure };
    expect(fp.structure.sessionKind).toBe("STRENGTH_UPPER");
    const execId = randomUUID();
    const started = await invoke("session-execution", { execution: { id: execId, session_date: days[0], started_at: `${days[0]}T17:00:00Z`, final_prescription_id: fp.id }, events: [{ id: randomUUID(), execution_id: execId, event_type: "started", occurred_at: `${days[0]}T17:00:00Z` }] });
    expect(started.status).toBe(200);

    await write(days[1]!, { kind: "DH_TECHNICAL", load_profile: "MODERATE", duration_min: 90 }, "DH_TECHNICAL");
    await insertCheckin(admin, athleteId, days[1]!, { available_minutes_today: 30 });
    const timed = await invoke("daily-run", { date: days[1] });
    const plan = timed.body.dailyPlan as { final_session: { kind: string }; triggered_rules: { rule_id: string; detail: string }[] };
    expect([timed.status, timed.body.finalPrescriptionStatus, plan.final_session.kind]).toEqual([200, "created", "RECOVERY_ACTIVE"]);
    expect(plan.triggered_rules.find((x) => x.rule_id === "V2_TODAY_TIME_CONSTRAINT")!.detail).toBe("Temps disponible : 30 min. Avant : KEEP DH_TECHNICAL MODERATE 90 min. Action : adapted → REPLACE RECOVERY_ACTIVE.");
  });
});
