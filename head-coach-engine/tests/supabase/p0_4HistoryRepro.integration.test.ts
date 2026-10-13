/**
 * P0-4 (HPM 2026-10-13) — diagnostic reproduction, production schema (66 migrations, base 92937a9), real local
 * Edge runtime with the rider's JWT: a V2 plan generated and accepted, guided sessions really recorded through
 * daily-run and session-execution (DH 7 passes completed, Force 7 sets completed, DH abandoned with results), a V1
 * legacy completed session for comparison. Writes what was persisted (and the rider's local credentials) to
 * P0_4_REPORT for the browser check of /history. Nothing is changed in the code under test.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, getAthleteAuthClient, insertCheckin, insertCompletedSession, setAthleteDiscipline } from "./testDb.js";
import { assertLocalDbReady, execLocalSql, localIntegrationRequested, sqlLiteral as lit } from "./localDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { generateAndPersistTrainingPlanV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { addCalendarDays, productToday } from "../../src/supabase/productCalendar.js";

const EDGE = localIntegrationRequested({ requirePublishableKey: true }) && process.env.RUN_LOCAL_P0_EDGE === "1";

type Item = { kind: string; prescriptionItemId: string; name?: string; exerciseId?: string; drillId?: string; sets?: number; measure: { type: string; count?: number } };
type Structure = { family: string; sessionKind: string; blocks: { role: string; items: Item[] }[] };
type Body = Record<string, unknown>;

describe.skipIf(!EDGE)("P0-4 — guided session history: reproduction on the production schema (local Edge, rider JWT)", { timeout: 300_000 }, () => {
  let admin: SupabaseClient;
  const today = productToday();
  const report: Record<string, unknown> = { today };

  beforeAll(() => {
    assertLocalDbReady();
    admin = createTestClient();
  });

  async function invoke(client: SupabaseClient, fn: string, body: unknown): Promise<{ status: number; body: Body }> {
    const { data, error } = await client.functions.invoke(fn, { body });
    if (!error) return { status: 200, body: data as Body };
    if (error instanceof FunctionsHttpError) {
      const res = error.context as Response;
      return { status: res.status, body: (await res.json()) as Body };
    }
    throw error;
  }

  /** Up to `total` results, item by item, within each item's own bound (sets or passes). */
  function plannedResults(structure: Structure, executionId: string, day: string, total: number) {
    const out: Record<string, unknown>[] = [];
    let minute = 5;
    for (const block of structure.blocks) {
      if (!["main", "complementary"].includes(block.role)) continue;
      for (const item of block.items) {
        const pass = item.measure.type === "pass";
        const bound = pass ? item.measure.count ?? 0 : item.sets ?? 0;
        if (item.kind !== "exercise" && !pass) continue;
        for (let n = 1; n <= bound && out.length < total; n += 1) {
          out.push({
            id: randomUUID(), execution_id: executionId, prescription_item_id: item.prescriptionItemId, set_number: n, done: true, measure_type: item.measure.type,
            measure_value: pass ? null : item.measure.type === "duration" ? 30 : 8, ...(pass ? { success: n % 3 !== 0 } : { load_kg: 20, rpe_actual: 7 }),
            occurred_at: `${day}T07:${String((minute += 2)).padStart(2, "0")}:00Z`,
          });
        }
      }
    }
    return out;
  }

  it("records the audit scenario and reads back what is persisted", async () => {
    const { athleteId, userId } = await createTestAthlete(admin, `P0-4 history ${randomUUID().slice(0, 6)}`);
    await setAthleteDiscipline(admin, athleteId, "Downhill");
    await upsertPerformanceProfileFor(admin, athleteId, {
      strength_experience_tier: "intermediate",
      equipment: ["dumbbells", "bench"],
      terrain_access: ["flow_trail", "bermed_trail", "full_dh_track"],
      declared_limitations: [],
      technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering"] },
      dh_technical_tier: "intermediate",
    });
    for (const d of [0, 1, 2, 3, 4, 5, 6]) await insertAvailabilityWindow(admin, athleteId, { day_of_week: d, start_time: "08:00:00", end_time: "20:00:00" });
    const { error: assignError } = await admin.from("training_plan_model_assignments").insert({ athlete_id: athleteId, planning_model: "v2", note: "P0-4 diagnostic" });
    if (assignError) throw new Error(assignError.message);
    const generatedOn = addCalendarDays(today, -10);
    const plan = await generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 2, today: generatedOn });
    if (plan.status !== "persisted") throw new Error("plan");
    await acceptTrainingPlanVersion(admin, athleteId, plan.planVersionId, addCalendarDays(generatedOn, 1), addCalendarDays(generatedOn, 14));
    const rider = await getAthleteAuthClient(athleteId);

    const { data: rows } = await admin.from("planned_sessions").select("planned_date, intervention").eq("athlete_id", athleteId).lt("planned_date", today).order("planned_date");
    const past = rows as { planned_date: string; intervention: { kind: string } | null }[];
    const dh = past.filter((r) => r.intervention?.kind === "DH_TECHNICAL").map((r) => r.planned_date);
    const force = past.filter((r) => r.intervention?.kind === "STRENGTH_UPPER" || r.intervention?.kind === "STRENGTH_LOWER").map((r) => r.planned_date);
    const other = past.filter((r) => r.intervention && !["DH_TECHNICAL", "STRENGTH_UPPER", "STRENGTH_LOWER", "REST"].includes(r.intervention.kind)).map((r) => r.planned_date);
    expect([dh.length >= 2, force.length >= 1]).toEqual([true, true]);

    async function guided(label: string, day: string, total: number, end: "completed" | "abandoned") {
      await insertCheckin(admin, athleteId, day);
      const run = await invoke(rider, "daily-run", { date: day });
      expect([run.status, run.body.finalPrescriptionStatus]).toEqual([200, "created"]);
      const fp = run.body.finalPrescription as { id: string; structure: Structure };
      const executionId = randomUUID();
      expect((await invoke(rider, "session-execution", { execution: { id: executionId, session_date: day, started_at: `${day}T07:00:00Z`, final_prescription_id: fp.id }, events: [{ id: randomUUID(), execution_id: executionId, event_type: "started", occurred_at: `${day}T07:00:00Z` }] })).status).toBe(200);
      const results = plannedResults(fp.structure, executionId, day, total);
      // Recorded one by one, as the guided screen does.
      for (const set of results) expect((await invoke(rider, "session-execution", { sets: [set] })).status).toBe(200);
      expect((await invoke(rider, "session-execution", { events: [{ id: randomUUID(), execution_id: executionId, event_type: end, occurred_at: `${day}T08:00:00Z` }] })).status).toBe(200);
      const persisted = JSON.parse(
        execLocalSql(`select json_build_object(
          'events', (select json_agg(event_type order by event_seq) from public.execution_events where execution_id = ${lit(executionId)}),
          'results', (select count(*) from public.exercise_set_results where execution_id = ${lit(executionId)}),
          'completedSessionsRows', (select count(*) from public.completed_sessions where athlete_id = ${lit(athleteId)} and session_date = ${lit(day)}));`).trim()
      );
      report[label] = { day, decisionId: run.body.decisionId, finalPrescriptionId: fp.id, family: fp.structure.family, sessionKind: fp.structure.sessionKind, executionId, recorded: results.length, persisted };
    }

    await guided("dhCompleted", dh[0]!, 7, "completed");
    await guided("forceCompleted", force[0]!, 7, "completed");
    await guided("dhAbandoned", dh[1]!, 2, "abandoned");

    // V1-style legacy record for comparison: a completed_sessions row linked to its decision (the debrief path).
    const legacyDay = other[0] ?? dh[2] ?? force[1];
    if (legacyDay) {
      await insertCheckin(admin, athleteId, legacyDay);
      const run = await invoke(rider, "daily-run", { date: legacyDay });
      await insertCompletedSession(admin, athleteId, legacyDay, "STRENGTH_A", { kind: "RECOVERY_ACTIVE" }, { decisionId: run.body.decisionId as string, actualDurationMin: 40 });
      report.legacy = { day: legacyDay, decisionId: run.body.decisionId };
    }

    // Browser check credentials (local scratch user only).
    const password = `P04${randomUUID().replace(/-/g, "").slice(0, 16)}aA1!`;
    await admin.auth.admin.updateUserById(userId, { password });
    const { data: user } = await admin.auth.admin.getUserById(userId);
    report.rider = { athleteId, email: user.user!.email, password };
    // The web app opens only for an onboarded rider who accepted the current privacy notice (local scratch data).
    await onboard(athleteId);
    if (process.env.P0_4_REPORT) writeFileSync(process.env.P0_4_REPORT, JSON.stringify(report, null, 2));
  });

  async function onboard(athleteId: string) {
    const now = new Date().toISOString();
    const { error } = await admin.from("athlete_onboarding_profiles").upsert({ athlete_id: athleteId, competition_level: "national", primary_goal: "performance", weekly_training_hours: "6-10", preferred_riding_days: ["saturday"], onboarding_completed_at: now, privacy_notice_version: "2026-09-24", health_data_consent_at: now });
    if (error) throw new Error(error.message);
  }
  async function credentials(userId: string) {
    const password = `P04${randomUUID().replace(/-/g, "").slice(0, 16)}aA1!`;
    await admin.auth.admin.updateUserById(userId, { password });
    const { data } = await admin.auth.admin.getUserById(userId);
    return { email: data.user!.email!, password };
  }

  it("extra scenarios (rider C): a session left open, a stop followed by a health REST (A6), a REST day without session; rider B for the cross-rider check", async () => {
    const { athleteId, userId } = await createTestAthlete(admin, `P0-4 history C ${randomUUID().slice(0, 6)}`);
    await setAthleteDiscipline(admin, athleteId, "Downhill");
    await upsertPerformanceProfileFor(admin, athleteId, {
      strength_experience_tier: "intermediate",
      equipment: ["dumbbells", "bench"],
      terrain_access: ["flow_trail", "bermed_trail", "full_dh_track"],
      declared_limitations: [],
      technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering"] },
      dh_technical_tier: "intermediate",
    });
    for (const d of [0, 1, 2, 3, 4, 5, 6]) await insertAvailabilityWindow(admin, athleteId, { day_of_week: d, start_time: "08:00:00", end_time: "20:00:00" });
    const generatedOn = addCalendarDays(today, -10);
    const plan = await generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 2, today: generatedOn });
    if (plan.status !== "persisted") throw new Error("plan");
    await acceptTrainingPlanVersion(admin, athleteId, plan.planVersionId, addCalendarDays(generatedOn, 1), addCalendarDays(generatedOn, 14));
    const rider = await getAthleteAuthClient(athleteId);
    const { data: rows } = await admin.from("planned_sessions").select("planned_date, intervention").eq("athlete_id", athleteId).lt("planned_date", today).order("planned_date");
    const past = rows as { planned_date: string; intervention: { kind: string } | null }[];
    const training = past.filter((r) => ["DH_TECHNICAL", "STRENGTH_UPPER", "STRENGTH_LOWER"].includes(r.intervention?.kind ?? "")).map((r) => r.planned_date);
    const other = past.filter((r) => !training.includes(r.planned_date)).map((r) => r.planned_date);
    expect([training.length >= 2, other.length >= 1]).toEqual([true, true]);

    async function startWithOneResult(day: string) {
      await insertCheckin(admin, athleteId, day);
      const run = await invoke(rider, "daily-run", { date: day });
      expect([run.status, run.body.finalPrescriptionStatus]).toEqual([200, "created"]);
      const fp = run.body.finalPrescription as { id: string; structure: Structure };
      const executionId = randomUUID();
      expect((await invoke(rider, "session-execution", { execution: { id: executionId, session_date: day, started_at: `${day}T07:00:00Z`, final_prescription_id: fp.id }, events: [{ id: randomUUID(), execution_id: executionId, event_type: "started", occurred_at: `${day}T07:00:00Z` }] })).status).toBe(200);
      const [first] = plannedResults(fp.structure, executionId, day, 1);
      expect((await invoke(rider, "session-execution", { sets: [first] })).status).toBe(200);
      return { day, decisionId: run.body.decisionId as string, executionId, family: fp.structure.family };
    }

    const open = await startWithOneResult(training[0]!);
    const stop = await startWithOneResult(training[1]!);
    expect((await invoke(rider, "session-execution", { events: [{ id: randomUUID(), execution_id: stop.executionId, event_type: "abandoned", occurred_at: `${stop.day}T07:20:00Z` }] })).status).toBe(200);
    const { error: painError } = await rider.from("daily_checkins").update({ pain: true, pain_intensity: 8, pain_new: false, pain_location_code: "knee_R", pain_traumatic: false, pain_function_loss: false, pain_getting_worse: false }).eq("athlete_id", athleteId).eq("checkin_date", stop.day);
    if (painError) throw new Error(painError.message);
    const restAfterStop = await invoke(rider, "daily-run", { date: stop.day });
    const restPlan = restAfterStop.body.dailyPlan as { decision: string; triggered_rules: { rule_id: string }[] };
    expect([restPlan.decision, restPlan.triggered_rules.some((r) => r.rule_id === "A6")]).toEqual(["REST", true]);
    // A REST day without any session (the A6 signal is still open: A7).
    const restDay = other[0]!;
    await insertCheckin(admin, athleteId, restDay);
    const rest = await invoke(rider, "daily-run", { date: restDay });
    const restDayPlan = rest.body.dailyPlan as { decision: string; triggered_rules: { rule_id: string }[] };
    expect(restDayPlan.decision).toBe("REST");
    await onboard(athleteId);

    // Rider B: onboarded, no data of its own.
    const b = await createTestAthlete(admin, `P0-4 history B ${randomUUID().slice(0, 6)}`);
    await onboard(b.athleteId);

    const report = process.env.P0_4_REPORT && existsSync(process.env.P0_4_REPORT) ? JSON.parse(readFileSync(process.env.P0_4_REPORT, "utf8")) : {};
    report.riderC = { athleteId, ...(await credentials(userId)) };
    report.openSession = open;
    report.healthStop = { ...stop, restDecisionId: restAfterStop.body.decisionId, restRules: restPlan.triggered_rules.map((r) => r.rule_id) };
    report.restDay = { day: restDay, decisionId: rest.body.decisionId, rules: restDayPlan.triggered_rules.map((r) => r.rule_id) };
    report.riderB = { athleteId: b.athleteId, ...(await credentials(b.userId)) };
    if (process.env.P0_4_REPORT) writeFileSync(process.env.P0_4_REPORT, JSON.stringify(report, null, 2));
  });
});
