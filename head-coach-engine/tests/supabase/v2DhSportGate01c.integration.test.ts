/**
 * V2-DH-SPORT-GATE-01C (HPM 2026-10-26) — same-day revocation of a DH sports validation, end to end (local database,
 * local Edge runtime, the rider's JWT).
 *
 * 09:00 — the day's analyses run under a complete validation (TEST sign-offs through the REAL gate, Node): SECTION
 * final prescriptions are frozen; one execution is completed, another started. Then the validation is revoked: the
 * Edge runtime runs the deployed code, whose production tables sign nothing — the state right after a revocation.
 * The seven counter-proofs: a new execution refused; nothing written; pause and abandon still possible, resume / results
 * / completion refused; the completed execution readable; a Force session served; no client path around the guard
 * (record_session_execution is service_role only, the tables take no direct write); the residual demonstrated (the
 * service_role key itself). Edge part: RUN_LOCAL_P0_EDGE=1 with the Edge runtime up.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, getAthleteAuthClient, insertCheckin, setAthleteDiscipline, type TestAthlete } from "./testDb.js";
import { assertLocalDbReady, execLocalSql, localIntegrationRequested, sqlLiteral } from "./localDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { runDailyFor, DEFAULT_RUN_DAILY_FOR_DEPS } from "../../src/supabase/runDailyFor.js";
import { generateTrainingPlanForAthlete } from "../../src/generation/generateTrainingPlanForAthlete.js";
import { dhServedCommonContentV2, dhServedSportContentV2 } from "../../../planning-engine/dist/sessionModelV2/dhSportGateV2.js";
import { SESSION_DRILL_CATALOG_V2_ENTRIES } from "../../../planning-engine/dist/catalog/sessionDrillCatalogV2.js";

const INTEGRATION_ENABLED = localIntegrationRequested({ requirePublishableKey: true });
const EDGE = INTEGRATION_ENABLED && process.env.RUN_LOCAL_P0_EDGE === "1";
const TODAY = "2026-11-08";
const HORIZON_END = "2026-11-22";

const fixture = vi.hoisted(() => ({ signoffs: {} as Record<string, unknown>, common: null as unknown }));
vi.mock("../../../planning-engine/dist/sessionModelV2/dhSportGateV2.js", async (importOriginal) => {
  const real = await importOriginal<{ dhRepetitionUnitAttributionFromSignoffV2: (drillId: string, signoff: unknown, common: unknown) => unknown }>();
  return { ...real, dhRepetitionUnitAttributionV2: (drillId: string) => real.dhRepetitionUnitAttributionFromSignoffV2(drillId, fixture.signoffs[drillId], fixture.common) };
});

const TEST_DECISION = "TEST fixture V2-DH-SPORT-GATE-01C (not a sports decision)";
function signAll() {
  fixture.signoffs = Object.fromEntries(
    SESSION_DRILL_CATALOG_V2_ENTRIES.map((d) => {
      const s = dhServedSportContentV2(d.drillId)!;
      return [
        d.drillId,
        {
          unit: { decision: TEST_DECISION, unit: "SECTION" },
          cue: { decision: TEST_DECISION, drillName: s.drillName, cueText: s.cueText, criterionText: s.criterionText },
          dose: { decision: TEST_DECISION, doseTerms: s.doseTerms },
          safety: { decision: TEST_DECISION, vigilanceTexts: [...s.vigilanceTexts], regressesTo: s.regressesTo, terrains: [...s.terrains] },
        },
      ];
    })
  );
  fixture.common = { decision: TEST_DECISION, ...dhServedCommonContentV2()! };
}

type Outcome = { status: string; code?: string };
type Answer = { status: number; body: { error?: { code?: string; message?: string } } & Record<string, unknown> };
type Structure = { blocks: { items: { kind: string; prescriptionItemId: string; measure: Record<string, unknown> }[] }[] };
const at = (day: string, hhmm: string) => `${day}T${hhmm}:00Z`;

describe.skipIf(!INTEGRATION_ENABLED)("V2-DH-SPORT-GATE-01C — same-day revocation (local Supabase)", () => {
  let admin: SupabaseClient;
  beforeAll(() => {
    assertLocalDbReady();
    admin = createTestClient();
  });

  it("the execution write path has no client route: record_session_execution is service_role only; the execution tables take no direct write and no update", () => {
    const fn = "'public.record_session_execution(uuid, jsonb)'";
    const privileges = execLocalSql(
      `select concat_ws(',', has_function_privilege('anon', ${fn}, 'execute'), has_function_privilege('authenticated', ${fn}, 'execute'), has_function_privilege('service_role', ${fn}, 'execute'),
        ${["session_executions", "execution_events", "exercise_set_results", "session_activity_results", "decision_final_prescriptions"]
          .flatMap((t) => ["insert", "update", "delete"].map((p) => `has_table_privilege('authenticated', 'public.${t}', '${p}')`))
          .join(", ")});`
    ).trim();
    expect(privileges).toBe(["f", "f", "t", ...Array(15).fill("f")].join(","));
  });

  describe.skipIf(!EDGE)("over the local Edge runtime with the rider's JWT", { timeout: 300_000 }, () => {
    let rider: TestAthlete;
    let client: SupabaseClient;
    const days: { dh: string[]; force: string[] } = { dh: [], force: [] };
    const fp: Record<string, { id: string; structure: Structure }> = {};
    const before: Record<string, string> = {};
    const completedExecution = randomUUID();
    const startedExecution = randomUUID();

    const record = async (payload: unknown): Promise<Outcome> => {
      const { data, error } = await admin.rpc("record_session_execution", { p_athlete_id: rider.athleteId, p_payload: payload });
      if (error) throw new Error(`record_session_execution raised: ${error.message}`);
      return data as Outcome;
    };
    const invoke = async (name: string, body: unknown): Promise<Answer> => {
      const { data, error } = await client.functions.invoke(name, { body: body as Record<string, unknown> });
      if (!error) return { status: 200, body: data as Answer["body"] };
      const res = (error as FunctionsHttpError).context as Response;
      return { status: res.status, body: (await res.json()) as Answer["body"] };
    };
    const count = (table: string, column: string, value: string) => execLocalSql(`select count(*) from public.${table} where ${column} = ${sqlLiteral(value)};`).trim();
    const start = (executionId: string, prescription: string, day: string, hhmm: string) => ({
      execution: { id: executionId, session_date: day, started_at: at(day, hhmm), final_prescription_id: prescription },
      events: [{ id: randomUUID(), execution_id: executionId, event_type: "started", occurred_at: at(day, hhmm) }],
    });
    const event = (executionId: string, day: string, event_type: string, hhmm: string) => ({ events: [{ id: randomUUID(), execution_id: executionId, event_type, occurred_at: at(day, hhmm) }] });
    const pass = (executionId: string, day: string, item: string, n: number) => ({ id: randomUUID(), execution_id: executionId, prescription_item_id: item, set_number: n, done: true, measure_type: "pass", measure_value: null, success: true, occurred_at: at(day, `09:1${n}`) });
    const drillItem = (s: Structure) => s.blocks.flatMap((b) => b.items).find((i) => i.kind === "drill")!;
    const frozen = (athleteId: string) =>
      execLocalSql(
        `select json_build_object(
           'planned', (select json_agg(p.structure order by p.id) from public.training_plan_planned_prescriptions p join public.training_plan_versions v on v.id = p.plan_version_id where v.athlete_id = ${sqlLiteral(athleteId)}),
           'final', (select json_agg(json_build_array(f.id, f.structure) order by f.id) from public.decision_final_prescriptions f where f.athlete_id = ${sqlLiteral(athleteId)}),
           'completed', (select json_agg(json_build_array(r.id, r.set_number, r.success) order by r.id) from public.exercise_set_results r where r.execution_id = ${sqlLiteral(completedExecution)})
         )::text;`
      ).trim();

    beforeAll(async () => {
      signAll();
      rider = await createTestAthlete(admin, "DH sport gate 01C same day");
      await setAthleteDiscipline(admin, rider.athleteId, "Downhill");
      await upsertPerformanceProfileFor(admin, rider.athleteId, {
        strength_experience_tier: "intermediate",
        equipment: ["dumbbells", "bench"],
        terrain_access: ["flow_trail", "bermed_trail", "root_rock_trail", "technical_trail"],
        declared_limitations: [],
        technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["roots_rocks"] },
        dh_technical_tier: "intermediate",
      });
      for (const d of [0, 1, 2, 3, 4, 5, 6]) await insertAvailabilityWindow(admin, rider.athleteId, { day_of_week: d, start_time: "08:00:00", end_time: "20:00:00" });
      execLocalSql(`insert into public.training_plan_model_assignments (athlete_id, planning_model, note) values (${sqlLiteral(rider.athleteId)}, 'v2', 'V2-DH-SPORT-GATE-01C test');`);
      const plan = await generateTrainingPlanForAthlete({ client: admin, athleteId: rider.athleteId, generationRequestId: randomUUID(), durationWeeks: 2, today: TODAY, globalV2Enabled: true });
      if (plan.status !== "persisted") throw new Error(`expected a persisted V2 plan, got ${JSON.stringify(plan)}`);
      await acceptTrainingPlanVersion(admin, rider.athleteId, plan.planVersionId, TODAY, HORIZON_END);
      const daysOf = (kind: string) =>
        execLocalSql(`select string_agg(date::text, ',' order by date) from public.training_plan_generated_sessions where plan_version_id = ${sqlLiteral(plan.planVersionId)} and kind = ${sqlLiteral(kind)} and date > '${TODAY}' and date <= '${HORIZON_END}';`).trim().split(",");
      days.dh = daysOf("DH_TECHNICAL");
      days.force = daysOf("STRENGTH_LOWER");
      // 09:00 — the day's analyses run under the complete validation: frozen SECTION final prescriptions.
      for (const day of [...days.dh.slice(0, 3), days.force[0]!]) {
        await insertCheckin(admin, rider.athleteId, day);
        const served = await runDailyFor(admin, rider.athleteId, day, { ...DEFAULT_RUN_DAILY_FOR_DEPS, dhUnit: "required" });
        expect(served.finalPrescriptionStatus, day).toBe("created");
        const { data } = await admin.from("decision_final_prescriptions").select("id, structure").eq("decision_id", served.persistence.decision_id).single();
        fp[day] = { id: data!.id as string, structure: data!.structure as Structure };
      }
      for (const day of days.dh.slice(0, 3)) expect(drillItem(fp[day]!.structure).measure, day).toMatchObject({ type: "pass", unit: "SECTION" });
      // Before the revocation, through the write path: one execution completed (day 1), one started (day 2).
      const [d1, d2] = days.dh;
      expect(await record(start(completedExecution, fp[d1!]!.id, d1!, "09:00"))).toMatchObject({ status: "ok" });
      expect(await record({ sets: [1, 2].map((n) => pass(completedExecution, d1!, drillItem(fp[d1!]!.structure).prescriptionItemId, n)) })).toMatchObject({ status: "ok" });
      expect(await record(event(completedExecution, d1!, "completed", "09:30"))).toMatchObject({ status: "ok" });
      expect(await record(start(startedExecution, fp[d2!]!.id, d2!, "09:05"))).toMatchObject({ status: "ok" });
      expect(await record({ sets: [pass(startedExecution, d2!, drillItem(fp[d2!]!.structure).prescriptionItemId, 1)] })).toMatchObject({ status: "ok" });
      before.rows = frozen(rider.athleteId);
      // The revocation: from here on, the deployed code (Edge runtime) signs nothing; so does the Node side.
      fixture.signoffs = {};
      client = await getAthleteAuthClient(rider.athleteId);
    }, 300_000);

    it("1–4: a new execution of a prescription frozen valid at 09:00 is refused after the revocation, nothing is written; the refusal shows no validation detail", async () => {
      const d3 = days.dh[2]!;
      const attempt = randomUUID();
      const refused = await invoke("session-execution", { ...start(attempt, fp[d3]!.id, d3, "11:00"), sets: [pass(attempt, d3, drillItem(fp[d3]!.structure).prescriptionItemId, 1)] });
      expect(refused.status).toBe(409);
      expect(refused.body.error?.code).toBe("dh_validation_not_current");
      expect(refused.body.error?.message).not.toMatch(/sign|unit|roots_rocks|drill/i);
      expect(count("session_executions", "id", attempt)).toBe("0");
      expect(count("execution_events", "execution_id", attempt)).toBe("0");
      expect(count("exercise_set_results", "execution_id", attempt)).toBe("0");
    });

    it("Pause / Resume: the execution started at 09:05 can be paused and abandoned; a result, resume and completion are refused, nothing written", async () => {
      const d2 = days.dh[1]!;
      const item = drillItem(fp[d2]!.structure).prescriptionItemId;
      const passBatch = { sets: [pass(startedExecution, d2, item, 2)] };
      expect((await invoke("session-execution", passBatch)).body.error?.code).toBe("dh_validation_not_current");
      expect(count("exercise_set_results", "id", passBatch.sets[0]!.id)).toBe("0");
      expect((await invoke("session-execution", event(startedExecution, d2, "paused", "10:00"))).status).toBe(200);
      for (const type of ["resumed", "completed"]) {
        const batch = event(startedExecution, d2, type, "10:05");
        const out = await invoke("session-execution", batch);
        expect([out.status, out.body.error?.code], type).toEqual([409, "dh_validation_not_current"]);
        expect(count("execution_events", "id", batch.events[0]!.id), type).toBe("0");
      }
      expect((await invoke("session-execution", event(startedExecution, d2, "abandoned", "10:10"))).status).toBe(200);
      expect(count("exercise_set_results", "execution_id", startedExecution)).toBe("1");
    });

    it("5: the execution completed before the revocation stays readable by the rider; the frozen rows are unchanged", async () => {
      const { data: execution } = await client.from("session_executions").select("id, final_prescription_id").eq("id", completedExecution).single();
      expect(execution).toEqual({ id: completedExecution, final_prescription_id: fp[days.dh[0]!]!.id });
      const { data: passes } = await client.from("exercise_set_results").select("set_number").eq("execution_id", completedExecution).order("set_number");
      expect(passes).toEqual([{ set_number: 1 }, { set_number: 2 }]);
      const { data: prescription } = await client.from("decision_final_prescriptions").select("structure").eq("id", fp[days.dh[0]!]!.id).single();
      expect(prescription!.structure).toEqual(fp[days.dh[0]!]!.structure);
      expect(frozen(rider.athleteId)).toBe(before.rows);
    });

    it("6: an independent Force session is served: its guided session starts and stops", async () => {
      const f = days.force[0]!;
      const execution = randomUUID();
      expect((await invoke("session-execution", start(execution, fp[f]!.id, f, "17:00"))).status).toBe(200);
      expect((await invoke("session-execution", event(execution, f, "abandoned", "17:30"))).status).toBe(200);
    });

    it("D: a new analysis of a DH day after the revocation answers 409 dh_validation_not_current (no 500, no detail), writes no decision", async () => {
      const d3 = days.dh[2]!;
      const decisions = execLocalSql(`select count(*) from public.decisions where athlete_id = ${sqlLiteral(rider.athleteId)} and decision_date = ${sqlLiteral(d3)};`).trim();
      const out = await invoke("daily-run", { date: d3 });
      expect([out.status, out.body.error?.code]).toEqual([409, "dh_validation_not_current"]);
      expect(out.body.error?.message).not.toMatch(/sign|unit|roots_rocks|drill/i);
      expect(execLocalSql(`select count(*) from public.decisions where athlete_id = ${sqlLiteral(rider.athleteId)} and decision_date = ${sqlLiteral(d3)};`).trim()).toBe(decisions);
    });

    it("7: no client route around the guard — the rider's JWT and the publishable key cannot call record_session_execution nor write the tables; only the service_role key can (residual, operators)", async () => {
      const d3 = days.dh[2]!;
      const attempt = randomUUID();
      const payload = start(attempt, fp[d3]!.id, d3, "12:00");
      const asRider = await client.rpc("record_session_execution", { p_athlete_id: rider.athleteId, p_payload: payload });
      expect(asRider.error).not.toBeNull();
      const anon = createClient(process.env.SUPABASE_URL ?? "http://127.0.0.1:59421", (process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY)!, { auth: { persistSession: false } });
      expect((await anon.rpc("record_session_execution", { p_athlete_id: rider.athleteId, p_payload: payload })).error).not.toBeNull();
      const direct = await client.from("session_executions").insert({ id: attempt, athlete_id: rider.athleteId, session_date: d3, started_at: at(d3, "12:00"), final_prescription_id: fp[d3]!.id });
      expect(direct.error).not.toBeNull();
      expect(count("session_executions", "id", attempt)).toBe("0");
      // Residual, demonstrated: the service_role key reaches the RPC without the Edge guard (operators only).
      expect(await record(payload)).toMatchObject({ status: "ok" });
      expect(await record(event(attempt, d3, "abandoned", "12:05"))).toMatchObject({ status: "ok" });
    });
  });
});
