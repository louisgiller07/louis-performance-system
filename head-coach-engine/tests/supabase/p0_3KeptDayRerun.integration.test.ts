/**
 * P0-3 (HPM 2026-10-13) — counter-proof before closure: a day kept by a new plan's acceptance (skipped_completed),
 * then the REAL daily-run re-run on it. Everything through the local Edge runtime with the rider's JWT, on the
 * product calendar's today: daily-run, session-execution, generate-training-plan (V2 assignment), accept-training-plan.
 *  - running: session started today → new plan accepted → daily-run again → complete → daily-run again;
 *  - completed: session completed today → new plan accepted → daily-run again.
 * Checked each time: the execution and its frozen prescription and results untouched, no second execution, earlier
 * decisions and prescriptions untouched, what the day's current decision now offers (Today) and whether a new
 * session could start.
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, getAthleteAuthClient, insertCheckin, setAthleteDiscipline } from "./testDb.js";
import { assertLocalDbReady, execLocalSql, localIntegrationRequested, sqlLiteral as lit } from "./localDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { generateAndPersistTrainingPlanV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { addCalendarDays, productToday } from "../../src/supabase/productCalendar.js";

const EDGE = localIntegrationRequested({ requirePublishableKey: true }) && process.env.RUN_LOCAL_P0_EDGE === "1";
const EXECUTABLE = ["DH_TECHNICAL", "STRENGTH_UPPER", "STRENGTH_LOWER"];

type Item = { kind: string; prescriptionItemId: string; measure: { type: string } };
type Structure = { family: string; blocks: { role: string; items: Item[] }[] };
type Body = Record<string, unknown>;

describe.skipIf(!EDGE)("P0-3 — kept day re-run through the local Edge runtime (rider JWT, product today)", { timeout: 300_000 }, () => {
  let admin: SupabaseClient;
  const today = productToday();
  const report: Record<string, unknown> = { today };

  beforeAll(() => {
    assertLocalDbReady();
    admin = createTestClient();
  });
  afterAll(() => {
    if (process.env.P0_3_REPORT) writeFileSync(process.env.P0_3_REPORT, JSON.stringify(report, null, 2));
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

  /** A V2-assigned rider whose accepted plan has an executable session today (plan generated a few days ago). */
  async function riderTrainingToday(label: string) {
    for (let k = 1; k <= 7; k += 1) {
      const { athleteId } = await createTestAthlete(admin, `P0-3 kept day ${label} ${randomUUID().slice(0, 6)}`);
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
      const { error } = await admin.from("training_plan_model_assignments").insert({ athlete_id: athleteId, planning_model: "v2", note: "P0-3 kept-day test" });
      if (error) throw new Error(error.message);
      const generatedOn = addCalendarDays(today, -k);
      const p = await generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 2, today: generatedOn });
      if (p.status !== "persisted") throw new Error("plan 1");
      await acceptTrainingPlanVersion(admin, athleteId, p.planVersionId, addCalendarDays(generatedOn, 1), addCalendarDays(generatedOn, 14));
      const { data } = await admin.from("planned_sessions").select("intervention").eq("athlete_id", athleteId).eq("planned_date", today).maybeSingle();
      const kind = (data as { intervention: { kind: string } | null } | null)?.intervention?.kind;
      if (kind && EXECUTABLE.includes(kind)) return { athleteId, plan1: p.planVersionId, kind, client: await getAthleteAuthClient(athleteId) };
    }
    throw new Error("no executable session today in 7 attempts");
  }

  /** Everything that must never change silently: executions, events, results, decisions' prescriptions, today's planned row. */
  function ledger(athleteId: string): string {
    return execLocalSql(`select concat_ws(' | ',
      (select md5(coalesce(string_agg(e.id::text || e.final_prescription_id::text || e.started_at::text, ',' order by e.id), '')) from public.session_executions e where e.athlete_id = ${lit(athleteId)}),
      (select md5(coalesce(string_agg(ev.id::text || ev.event_type::text || ev.occurred_at::text, ',' order by ev.id), '')) from public.execution_events ev where ev.athlete_id = ${lit(athleteId)}),
      (select md5(coalesce(string_agg(r.id::text || r.done::text, ',' order by r.id), '')) from public.exercise_set_results r where r.athlete_id = ${lit(athleteId)}),
      (select md5(coalesce(string_agg(f.id::text || f.structure::text, ',' order by f.id), '')) from public.decision_final_prescriptions f where f.athlete_id = ${lit(athleteId)}),
      (select md5(coalesce(string_agg(d.id::text || coalesce(d.final_prescription_status, '-'), ',' order by d.id), '')) from public.decisions d where d.athlete_id = ${lit(athleteId)}));`).trim();
  }
  function plannedToday(athleteId: string): string {
    return execLocalSql(`select coalesce((select id::text || '|' || updated_at::text || '|' || coalesce(source_plan_version_id::text, '-') from public.planned_sessions where athlete_id = ${lit(athleteId)} and planned_date = ${lit(today)}), 'none');`).trim();
  }
  /** What the day looks like now: executions, the latest decision (Today's), its currency and prescription status. */
  function dayState(athleteId: string) {
    const raw = execLocalSql(`select json_build_object(
      'executions', (select count(*) from public.session_executions where athlete_id = ${lit(athleteId)} and session_date = ${lit(today)}),
      'lastEvent', (select ev.event_type from public.execution_events ev join public.session_executions e on e.id = ev.execution_id where e.athlete_id = ${lit(athleteId)} and e.session_date = ${lit(today)} order by ev.event_seq desc limit 1),
      'latestDecision', (select json_build_object('id', d.id, 'decision', d.daily_plan->>'decision', 'status', d.final_prescription_status, 'current', (select c.is_current from public.daily_decision_currency c where c.decision_id = d.id), 'hasFinalPrescription', exists (select 1 from public.decision_final_prescriptions f where f.decision_id = d.id))
                           from public.decisions d where d.athlete_id = ${lit(athleteId)} and d.decision_date = ${lit(today)} order by d.created_at desc, d.id desc limit 1),
      'decisions', (select count(*) from public.decisions where athlete_id = ${lit(athleteId)} and decision_date = ${lit(today)}));`).trim();
    return JSON.parse(raw) as { executions: number; lastEvent: string; latestDecision: { id: string; decision: string; status: string | null; current: boolean; hasFinalPrescription: boolean }; decisions: number };
  }
  function session(fp: { id: string; structure: Structure }) {
    const id = randomUUID();
    const pass = fp.structure.blocks.find((b) => b.role === "main")!.items.find((i) => i.kind === "exercise" || i.measure.type === "pass")!;
    return {
      start: { execution: { id, session_date: today, started_at: `${today}T07:00:00Z`, final_prescription_id: fp.id }, events: [{ id: randomUUID(), execution_id: id, event_type: "started", occurred_at: `${today}T07:00:00Z` }] },
      complete: {
        sets: [{ id: randomUUID(), execution_id: id, prescription_item_id: pass.prescriptionItemId, set_number: 1, done: true, measure_type: pass.measure.type, measure_value: pass.measure.type === "pass" ? null : pass.measure.type === "duration" ? 30 : 8, occurred_at: `${today}T07:30:00Z` }],
        events: [{ id: randomUUID(), execution_id: id, event_type: "completed", occurred_at: `${today}T08:00:00Z` }],
      },
    };
  }
  /** Could a NEW session start from the day's latest decision? (the latest prescription, if any, through the real Edge) */
  async function newStartFromLatest(client: SupabaseClient, athleteId: string) {
    const latest = dayState(athleteId).latestDecision;
    const { data } = await admin.from("decision_final_prescriptions").select("id, structure").eq("decision_id", latest.id).maybeSingle();
    if (!data) return "no_prescription";
    const r = await invoke(client, "session-execution", session(data as { id: string; structure: Structure }).start);
    return `${r.status} ${JSON.stringify(r.body.error ?? r.body.code ?? r.body.status ?? "")}`;
  }

  async function scenario(label: string, completeBeforeAcceptance: boolean) {
    const out: Record<string, unknown> = {};
    const r = await riderTrainingToday(label);
    out.kindToday = r.kind;
    await insertCheckin(admin, r.athleteId, today);
    const first = await invoke(r.client, "daily-run", { date: today });
    expect([first.status, first.body.finalPrescriptionStatus]).toEqual([200, "created"]);
    const fp = first.body.finalPrescription as { id: string; structure: Structure };
    const s = session(fp);
    expect((await invoke(r.client, "session-execution", s.start)).status).toBe(200);
    if (completeBeforeAcceptance) expect((await invoke(r.client, "session-execution", s.complete)).status).toBe(200);

    const plannedBefore = plannedToday(r.athleteId);
    const generated = await invoke(r.client, "generate-training-plan", { generationRequestId: randomUUID(), durationWeeks: 2 });
    expect(generated.status).toBe(200);
    const plan2 = generated.body.planVersionId as string;
    const accepted = await invoke(r.client, "accept-training-plan", { planVersionId: plan2 });
    out.acceptance = { status: accepted.status, warnings: accepted.body.warnings, projectedSessionCount: accepted.body.projectedSessionCount, plan2Schema: execLocalSql(`select prescription_schema_version from public.training_plan_versions where id = ${lit(plan2)};`).trim() };
    expect([accepted.status, accepted.body.warnings]).toEqual([200, []]);
    expect(plannedToday(r.athleteId)).toBe(plannedBefore); // the day is kept (skipped_completed), lineage still plan 1
    const before = ledger(r.athleteId);

    const rerun = await invoke(r.client, "daily-run", { date: today });
    out.rerun = { status: rerun.status, decision: (rerun.body.dailyPlan as Body | undefined)?.decision, finalPrescriptionStatus: rerun.body.finalPrescriptionStatus, code: rerun.body.finalPrescriptionStatusCode, detail: rerun.body.finalPrescriptionStatusDetail, error: rerun.body.error };
    out.afterRerun = dayState(r.athleteId);
    out.ledgerUntouchedAfterRerun = ledger(r.athleteId).split(" | ").slice(0, 3).join() === before.split(" | ").slice(0, 3).join();
    out.newStartAfterRerun = await newStartFromLatest(r.client, r.athleteId);

    if (!completeBeforeAcceptance) {
      const done = await invoke(r.client, "session-execution", s.complete);
      out.completeAfterRerun = done.status;
      const afterComplete = ledger(r.athleteId);
      const again = await invoke(r.client, "daily-run", { date: today });
      out.rerunAfterComplete = { status: again.status, decision: (again.body.dailyPlan as Body | undefined)?.decision, finalPrescriptionStatus: again.body.finalPrescriptionStatus, code: again.body.finalPrescriptionStatusCode, error: again.body.error };
      out.afterSecondRerun = dayState(r.athleteId);
      out.ledgerUntouchedAfterSecondRerun = ledger(r.athleteId).split(" | ").slice(0, 3).join() === afterComplete.split(" | ").slice(0, 3).join();
      out.newStartAfterSecondRerun = await newStartFromLatest(r.client, r.athleteId);
    }
    out.plannedTodayUnchanged = plannedToday(r.athleteId) === plannedBefore;
    report[label] = out;

    // Data (HPM expectations): no error, no second execution, no concurrent prescription, nothing rewritten.
    const reruns = [out.rerun, out.rerunAfterComplete].filter(Boolean) as { status: number }[];
    expect(reruns.every((x) => x.status === 200)).toBe(true);
    expect([out.ledgerUntouchedAfterRerun, out.ledgerUntouchedAfterSecondRerun ?? true, out.plannedTodayUnchanged]).toEqual([true, true, true]);
    expect([out.newStartAfterRerun, out.newStartAfterSecondRerun ?? "no_prescription"]).toEqual(["no_prescription", "no_prescription"]);
    const states = [out.afterRerun, out.afterSecondRerun].filter(Boolean) as ReturnType<typeof dayState>[];
    for (const st of states) expect(st.executions).toBe(1);
    if (!completeBeforeAcceptance) expect([out.completeAfterRerun, (out.afterSecondRerun as ReturnType<typeof dayState>).lastEvent]).toEqual([200, "completed"]);
    // The re-run's decision becomes the day's current one, KEEP blocked final_prescription_no_lineage (the kept row's
    // lineage points to the superseded plan). It is not a health rule: the session goes on (execution_health_block),
    // and Today keeps it reachable from the recorded execution (web daySessionEntry, P0-3 visibility fix).
    for (const st of states) expect([st.latestDecision.decision, st.latestDecision.status, st.latestDecision.current, st.latestDecision.hasFinalPrescription]).toEqual(["KEEP", "blocked", true, false]);
    return out;
  }

  it("running session today → new plan accepted (day kept) → daily-run again → complete → daily-run again", async () => {
    await scenario("running", false);
  });

  it("session completed today → new plan accepted (day kept) → daily-run again", async () => {
    await scenario("completed", true);
  });
});
