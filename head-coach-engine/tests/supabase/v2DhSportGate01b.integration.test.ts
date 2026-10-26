/**
 * V2-DH-SPORT-GATE-01B (HPM 2026-10-26) — a frozen DH prescription on the real V2 path (local database). Sign-offs,
 * the common validation and a changed drill name are TEST fixtures routed through the REAL gate (planning-engine dist):
 * not sports decisions; the production tables stay empty.
 *
 * - A drill renamed after approval: the plan is refused, nothing is written.
 * - Approved, frozen, executed, then the validation revoked: the frozen rows are never rewritten, the completed
 *   execution stays readable (rider through RLS, engine history reader), the next DH day is refused fail-closed under
 *   an identifiable name with nothing written, a Force day is served.
 * - CHARACTERISED, OPEN (HPM decision): the same day, a final prescription frozen before the revocation can still start
 *   a new execution — the execution write path (record_session_execution, SQL) does not see the code-level sign-off.
 * Local stack only.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, getAthleteAuthClient, insertCheckin, setAthleteDiscipline, type TestAthlete } from "./testDb.js";
import { assertLocalDbReady, execLocalSql, localIntegrationRequested, sqlLiteral } from "./localDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { readPlanHistoryFactsV2 } from "../../src/supabase/repositories/planHistoryV2Repo.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { runDailyFor, DEFAULT_RUN_DAILY_FOR_DEPS } from "../../src/supabase/runDailyFor.js";
import { errorNameOf } from "../../src/supabase/observability/pilotEvents.js";
import { generateTrainingPlanForAthlete } from "../../src/generation/generateTrainingPlanForAthlete.js";
import { dhServedCommonContentV2, dhServedSportContentV2 } from "../../../planning-engine/dist/sessionModelV2/dhSportGateV2.js";
import { SESSION_DRILL_CATALOG_V2_ENTRIES } from "../../../planning-engine/dist/catalog/sessionDrillCatalogV2.js";

const INTEGRATION_ENABLED = localIntegrationRequested({ requirePublishableKey: true });
const TODAY = "2026-11-08";
const HORIZON_END = "2026-11-22";

const fixture = vi.hoisted(() => ({ signoffs: {} as Record<string, unknown>, common: null as unknown, names: {} as Record<string, string> }));
vi.mock("../../../planning-engine/dist/sessionModelV2/dhSportGateV2.js", async (importOriginal) => {
  const real = await importOriginal<{ dhRepetitionUnitAttributionFromSignoffV2: (drillId: string, signoff: unknown, common: unknown) => unknown }>();
  return { ...real, dhRepetitionUnitAttributionV2: (drillId: string) => real.dhRepetitionUnitAttributionFromSignoffV2(drillId, fixture.signoffs[drillId], fixture.common) };
});
// A drill's displayed name can be changed after signing. Proxy over a copy: the real table is frozen.
vi.mock("../../../planning-engine/dist/catalog/sessionDrillCatalogV2.js", async (importOriginal) => {
  const real = await importOriginal<{ SESSION_DRILL_NAMES_V2: Record<string, string> }>();
  const names = new Proxy({ ...real.SESSION_DRILL_NAMES_V2 }, { get: (target, id) => (typeof id === "string" && id in fixture.names ? fixture.names[id] : Reflect.get(target, id)) });
  return { ...real, SESSION_DRILL_NAMES_V2: names };
});

const TEST_DECISION = "TEST fixture V2-DH-SPORT-GATE-01B (not a sports decision)";
const DRILL = "roots_rocks_unweighted_line";
function signAll() {
  fixture.signoffs = Object.fromEntries(
    SESSION_DRILL_CATALOG_V2_ENTRIES.map((d) => {
      const served = dhServedSportContentV2(d.drillId)!;
      return [
        d.drillId,
        {
          unit: { decision: TEST_DECISION, unit: "SECTION" },
          cue: { decision: TEST_DECISION, drillName: served.drillName, cueText: served.cueText, criterionText: served.criterionText },
          dose: { decision: TEST_DECISION, doseTerms: served.doseTerms },
          safety: { decision: TEST_DECISION, vigilanceTexts: [...served.vigilanceTexts], regressesTo: served.regressesTo, terrains: [...served.terrains] },
        },
      ];
    })
  );
  fixture.common = { decision: TEST_DECISION, ...dhServedCommonContentV2()! };
}
const revokeAll = () => {
  fixture.signoffs = {};
};

type Outcome = { status: string; code?: string };
type Structure = { family: string; blocks: { items: { kind: string; prescriptionItemId: string; drillId?: string; measure: Record<string, unknown> }[] }[] };

describe.skipIf(!INTEGRATION_ENABLED)("V2-DH-SPORT-GATE-01B — a frozen DH prescription on the real V2 path (local Supabase)", () => {
  let admin: SupabaseClient;

  async function v2Rider(label: string): Promise<TestAthlete> {
    const athlete = await createTestAthlete(admin, `DH sport gate 01B ${label}`);
    await setAthleteDiscipline(admin, athlete.athleteId, "Downhill");
    await upsertPerformanceProfileFor(admin, athlete.athleteId, {
      strength_experience_tier: "intermediate",
      equipment: ["dumbbells", "bench"],
      terrain_access: ["flow_trail", "bermed_trail", "root_rock_trail", "technical_trail"],
      declared_limitations: [],
      technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["roots_rocks"] },
      dh_technical_tier: "intermediate",
    });
    for (const d of [0, 1, 2, 3, 4, 5, 6]) await insertAvailabilityWindow(admin, athlete.athleteId, { day_of_week: d, start_time: "08:00:00", end_time: "20:00:00" });
    execLocalSql(`insert into public.training_plan_model_assignments (athlete_id, planning_model, note) values (${sqlLiteral(athlete.athleteId)}, 'v2', 'V2-DH-SPORT-GATE-01B test');`);
    return athlete;
  }
  const generateV2 = (athleteId: string) => generateTrainingPlanForAthlete({ client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 2, today: TODAY, globalV2Enabled: true });
  async function acceptedPlan(label: string) {
    signAll();
    const rider = await v2Rider(label);
    const r = await generateV2(rider.athleteId);
    if (r.status !== "persisted") throw new Error(`expected a persisted V2 plan, got ${JSON.stringify(r)}`);
    await acceptTrainingPlanVersion(admin, rider.athleteId, r.planVersionId, TODAY, HORIZON_END);
    return { rider, planVersionId: r.planVersionId };
  }
  const versions = (athleteId: string) => execLocalSql(`select count(*) from public.training_plan_versions where athlete_id = ${sqlLiteral(athleteId)};`).trim();
  const countOn = (table: string, athleteId: string, day: string) =>
    execLocalSql(`select count(*) from public.${table} t join public.decisions d on d.id = t.decision_id where d.athlete_id = ${sqlLiteral(athleteId)} and d.decision_date = ${sqlLiteral(day)};`).trim();
  const decisionsOn = (athleteId: string, day: string) => execLocalSql(`select count(*) from public.decisions where athlete_id = ${sqlLiteral(athleteId)} and decision_date = ${sqlLiteral(day)};`).trim();
  const daysOf = (planVersionId: string, kind: string) =>
    execLocalSql(`select string_agg(date::text, ',' order by date) from public.training_plan_generated_sessions where plan_version_id = ${sqlLiteral(planVersionId)} and kind = ${sqlLiteral(kind)} and date > '${TODAY}' and date <= '${HORIZON_END}';`)
      .trim()
      .split(",");
  const daily = (athleteId: string, day: string) => runDailyFor(admin, athleteId, day, { ...DEFAULT_RUN_DAILY_FOR_DEPS, dhUnit: "required" });
  /** Every frozen row of the rider, as stored: planned and final prescriptions, executions, results. */
  const frozenRows = (athleteId: string) =>
    execLocalSql(
      `select json_build_object(
         'planned', (select json_agg(p.structure order by p.id) from public.training_plan_planned_prescriptions p join public.training_plan_versions v on v.id = p.plan_version_id where v.athlete_id = ${sqlLiteral(athleteId)}),
         'final', (select json_agg(json_build_array(f.id, f.structure) order by f.id) from public.decision_final_prescriptions f where f.athlete_id = ${sqlLiteral(athleteId)}),
         'executions', (select json_agg(json_build_array(e.id, e.final_prescription_id, e.started_at) order by e.id) from public.session_executions e where e.athlete_id = ${sqlLiteral(athleteId)}),
         'results', (select json_agg(json_build_array(r.id, r.prescription_item_id, r.set_number, r.done, r.success) order by r.id) from public.exercise_set_results r where r.athlete_id = ${sqlLiteral(athleteId)})
       )::text;`
    ).trim();
  async function record(athleteId: string, payload: unknown): Promise<Outcome> {
    const { data, error } = await admin.rpc("record_session_execution", { p_athlete_id: athleteId, p_payload: payload });
    if (error) throw new Error(`record_session_execution raised: ${error.message}`);
    return data as Outcome;
  }
  const at = (day: string, minute: number) => `${day}T17:${String(minute).padStart(2, "0")}:00Z`;
  async function finalOf(decisionId: string) {
    const { data } = await admin.from("decision_final_prescriptions").select("id, structure").eq("decision_id", decisionId).single();
    const structure = data!.structure as Structure;
    return { id: data!.id as string, structure, drill: structure.blocks.flatMap((b) => b.items).find((i) => i.kind === "drill")! };
  }
  const startBatch = (executionId: string, fp: string, day: string) => ({
    execution: { id: executionId, session_date: day, started_at: at(day, 0), final_prescription_id: fp },
    events: [{ id: randomUUID(), execution_id: executionId, event_type: "started", occurred_at: at(day, 0) }],
  });
  const event = (executionId: string, day: string, event_type: string) => ({ events: [{ id: randomUUID(), execution_id: executionId, event_type, occurred_at: at(day, 50) }] });

  beforeAll(() => {
    assertLocalDbReady();
    admin = createTestClient();
  });
  beforeEach(() => {
    fixture.signoffs = {};
    fixture.common = null;
    fixture.names = {};
  });

  it("a drill renamed after approval: V2 ON refuses the plan for that drill, writes nothing", async () => {
    signAll();
    fixture.names[DRILL] = "Ligne délestée (nom changé après la signature)";
    const rider = await v2Rider("renamed");
    expect(await generateV2(rider.athleteId)).toMatchObject({ planningModel: "v2", status: "blocked", code: "dh_repetition_unit_unknown", detail: { drillId: DRILL } });
    expect(versions(rider.athleteId)).toBe("0");
  }, 120_000);

  it("approved, frozen, executed, then revoked: nothing rewritten, the completed execution readable, the next DH day refused (identifiable, nothing written), a Force day served", async () => {
    const { rider, planVersionId } = await acceptedPlan("frozen");
    const [dhDay, nextDhDay] = daysOf(planVersionId, "DH_TECHNICAL");
    const [forceDay] = daysOf(planVersionId, "STRENGTH_LOWER");
    expect(nextDhDay).toBeDefined();

    await insertCheckin(admin, rider.athleteId, dhDay!);
    const served = await daily(rider.athleteId, dhDay!);
    expect(served.finalPrescriptionStatus).toBe("created");
    const fp = await finalOf(served.persistence.decision_id);
    expect(fp.drill).toMatchObject({ drillId: DRILL, measure: { type: "pass", unit: "SECTION" } });
    const executionId = randomUUID();
    expect(await record(rider.athleteId, startBatch(executionId, fp.id, dhDay!))).toMatchObject({ status: "ok" });
    const pass = (n: number) => ({ id: randomUUID(), execution_id: executionId, prescription_item_id: fp.drill.prescriptionItemId, set_number: n, done: true, measure_type: "pass", measure_value: null, success: true, occurred_at: at(dhDay!, 10 + n) });
    expect(await record(rider.athleteId, { sets: [pass(1), pass(2)] })).toMatchObject({ status: "ok" });
    expect(await record(rider.athleteId, event(executionId, dhDay!, "completed"))).toMatchObject({ status: "ok" });
    const frozen = frozenRows(rider.athleteId);

    revokeAll();
    // The frozen rows are never rewritten.
    expect(frozenRows(rider.athleteId)).toBe(frozen);
    // The completed execution stays readable: the rider through RLS, the engine's history reader.
    const asRider = await getAthleteAuthClient(rider.athleteId);
    const { data: ownExecution } = await asRider.from("session_executions").select("id, final_prescription_id").eq("id", executionId).single();
    expect(ownExecution).toEqual({ id: executionId, final_prescription_id: fp.id });
    const { data: ownPrescription } = await asRider.from("decision_final_prescriptions").select("structure").eq("id", fp.id).single();
    expect(ownPrescription!.structure).toEqual(fp.structure);
    const { data: ownPasses } = await asRider.from("exercise_set_results").select("set_number").eq("execution_id", executionId).order("set_number");
    expect(ownPasses).toEqual([{ set_number: 1 }, { set_number: 2 }]);
    // The reader looks back over a recent window ending on `today`: read it as of the execution day.
    const history = await readPlanHistoryFactsV2(admin, rider.athleteId, dhDay!);
    expect(history.executions.map((e) => e.id)).toContain(executionId);
    expect(history.prescriptions.find((p) => p.id === fp.id)?.structure).toEqual(fp.structure);
    expect(history.sets.filter((s) => s.execution_id === executionId)).toHaveLength(2);

    // The next DH day: fail-closed under an identifiable name, nothing written for it.
    await insertCheckin(admin, rider.athleteId, nextDhDay!);
    const failure = await daily(rider.athleteId, nextDhDay!).then(
      () => null,
      (e: unknown) => e
    );
    expect(failure).toMatchObject({ name: "DhSportValidationNotCurrentError", drillIds: [DRILL] });
    expect(errorNameOf(failure)).toBe("DhSportValidationNotCurrentError");
    expect((failure as Error).message).toMatch(/dh_unit_not_attributed/);
    expect(decisionsOn(rider.athleteId, nextDhDay!)).toBe("0");
    expect(countOn("decision_final_prescriptions", rider.athleteId, nextDhDay!)).toBe("0");
    // An independent day needs no DH drill: served.
    await insertCheckin(admin, rider.athleteId, forceDay!);
    expect((await daily(rider.athleteId, forceDay!)).finalPrescriptionStatus).toBe("created");
    expect((await finalOf(served.persistence.decision_id)).structure).toEqual(fp.structure);
  }, 300_000);

  it("CHARACTERISED, OPEN (HPM decision): the same day, a final prescription frozen before the revocation can still start a new execution; a new analysis of that day is refused and writes nothing", async () => {
    const { rider, planVersionId } = await acceptedPlan("same-day");
    const [dhDay] = daysOf(planVersionId, "DH_TECHNICAL");
    await insertCheckin(admin, rider.athleteId, dhDay!);
    const served = await daily(rider.athleteId, dhDay!);
    expect(served.finalPrescriptionStatus).toBe("created");
    const fp = await finalOf(served.persistence.decision_id);
    expect(fp.drill.measure).toMatchObject({ unit: "SECTION" });

    revokeAll();
    await expect(daily(rider.athleteId, dhDay!)).rejects.toMatchObject({ name: "DhSportValidationNotCurrentError" });
    expect(decisionsOn(rider.athleteId, dhDay!)).toBe("1");
    // The window: the execution write path does not know the sign-off; the frozen final prescription is still today's current one.
    const executionId = randomUUID();
    expect(await record(rider.athleteId, startBatch(executionId, fp.id, dhDay!))).toMatchObject({ status: "ok" });
    expect(await record(rider.athleteId, event(executionId, dhDay!, "abandoned"))).toMatchObject({ status: "ok" });
  }, 240_000);
});
