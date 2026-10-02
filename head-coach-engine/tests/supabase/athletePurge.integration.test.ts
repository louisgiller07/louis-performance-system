/**
 * UX-11R.1 — account purge (ADR UX-11B.2.1 §11) on the local Supabase stack.
 *
 * Athlete A carries every kind of data the product writes: a historical V1
 * plan superseded by an accepted V2 plan (versions, lifecycle, structure,
 * planned prescriptions, projections), check-ins, decisions (incl. REST with
 * a health flag), final prescriptions, guided executions for Force, DH and
 * endurance with results and corrections, an abandoned execution, legacy
 * completed sessions, decision outcomes, pattern evidence / insight ledgers
 * with superseding chains and source references, pilot observability.
 * Athlete B (witness) has the same. Purging A removes every row of A and
 * leaves B strictly identical; the Auth identity is removed afterwards.
 * A provoked failure at the last step rolls the whole purge back.
 * Scratch fixtures written as the local database owner (localDb.ts) where
 * no API path exists (decision outcomes, pattern ledgers, observability).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, getAthleteAuthClient, insertCheckin, insertCompletedSession, setAthleteDiscipline, type TestAthlete } from "./testDb.js";
import { assertLocalDbReady, execLocalSql, localIntegrationRequested, sqlLiteral } from "./localDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { generateAndPersistTrainingPlan } from "../../src/supabase/generateAndPersistTrainingPlan.js";
import { generateAndPersistTrainingPlanV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { runDailyFor } from "../../src/supabase/runDailyFor.js";
import { purgeAthleteAccount } from "../../src/supabase/purgeAthleteAccount.js";

const INTEGRATION_ENABLED = localIntegrationRequested({ requirePublishableKey: true });
const TODAY = "2026-10-05";
const DAYS = ["2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12"];

/** Every row of the athlete in every table carrying an athlete_id, plus the plan structure reached through its plan versions. */
function athleteFootprint(athleteId: string): Record<string, string[]> {
  const sql = `
with t as (
  select c.table_name from information_schema.columns c
    join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name and x.table_type = 'BASE TABLE'
   where c.table_schema = 'public' and c.column_name = 'athlete_id'
)
select string_agg(table_name, ',') from t;`;
  const tables = execLocalSql(sql).trim().split(",");
  const parts = tables.map((t) => `select '${t}' as t, md5(to_jsonb(x)::text) as h from public.${t} x where athlete_id = ${sqlLiteral(athleteId)}`);
  const structure = ["training_plan_blocks", "training_plan_weeks", "training_plan_generated_sessions", "training_plan_planned_prescriptions", "training_plan_version_lifecycle_transitions"].map(
    (t) => `select '${t}' as t, md5(to_jsonb(x)::text) as h from public.${t} x where plan_version_id in (select id from public.training_plan_versions where athlete_id = ${sqlLiteral(athleteId)})`
  );
  const pattern = [
    `select 'pattern_evidence_revisions' as t, md5(to_jsonb(x)::text) from public.pattern_evidence_revisions x join public.pattern_evidence_identities i on i.id = x.evidence_identity_id where i.athlete_id = ${sqlLiteral(athleteId)}`,
    `select 'pattern_evidence_lifecycle_transitions' as t, md5(to_jsonb(x)::text) from public.pattern_evidence_lifecycle_transitions x join public.pattern_evidence_identities i on i.id = x.evidence_identity_id where i.athlete_id = ${sqlLiteral(athleteId)}`,
    `select 'pattern_evidence_source_refs' as t, md5(to_jsonb(x)::text) from public.pattern_evidence_source_refs x join public.pattern_evidence_revisions r on r.id = x.revision_id join public.pattern_evidence_identities i on i.id = r.evidence_identity_id where i.athlete_id = ${sqlLiteral(athleteId)}`,
    `select 'pattern_insight_reviews' as t, md5(to_jsonb(x)::text) from public.pattern_insight_reviews x join public.pattern_insight_identities i on i.id = x.insight_identity_id where i.athlete_id = ${sqlLiteral(athleteId)}`,
  ];
  const self = [`select 'athletes' as t, md5(to_jsonb(x)::text) from public.athletes x where id = ${sqlLiteral(athleteId)}`];
  const out = execLocalSql(`${[...self, ...parts, ...structure, ...pattern].join("\nunion all\n")};`).trim();
  const footprint: Record<string, string[]> = {};
  for (const line of out ? out.split(/\r?\n/) : []) {
    const [t, h] = line.split("|");
    (footprint[t!] ??= []).push(h!);
  }
  for (const k of Object.keys(footprint)) footprint[k]!.sort();
  return footprint;
}

describe.skipIf(!INTEGRATION_ENABLED)("UX-11R.1 — athlete account purge (purge_athlete_account)", () => {
  let admin: SupabaseClient;
  let a: TestAthlete;
  let b: TestAthlete;
  let c: TestAthlete;

  async function record(athleteId: string, payload: unknown) {
    const { data, error } = await admin.rpc("record_session_execution", { p_athlete_id: athleteId, p_payload: payload });
    if (error) throw new Error(error.message);
    if ((data as { status: string }).status !== "ok") throw new Error(`record_session_execution rejected: ${JSON.stringify(data)}`);
  }

  /** A complete athlete: V1 plan, then V2 plan, daily decisions, Force / DH / endurance executions, legacy history, outcomes, patterns, observability. */
  async function richAthlete(label: string): Promise<TestAthlete> {
    const athlete = await createTestAthlete(admin, `R1 purge ${label}`);
    const id = athlete.athleteId;
    await setAthleteDiscipline(admin, id, "Downhill");
    await upsertPerformanceProfileFor(admin, id, {
      strength_experience_tier: "intermediate",
      equipment: ["dumbbells", "bench"],
      terrain_access: ["flow_trail", "bermed_trail"],
      declared_limitations: [],
      technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
      dh_technical_tier: "intermediate",
    });
    for (const d of [0, 1, 2, 3, 4, 5, 6]) await insertAvailabilityWindow(admin, id, { day_of_week: d, start_time: "08:00:00", end_time: "20:00:00" });
    // Historical V1 plan, accepted, then superseded by an accepted V2 plan.
    const v1 = await generateAndPersistTrainingPlan({ client: admin, athleteId: id, generationRequestId: randomUUID(), durationWeeks: 2, today: TODAY });
    await acceptTrainingPlanVersion(admin, id, v1.planVersionId, TODAY, "2026-10-18");
    const v2 = await generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId: id, generationRequestId: randomUUID(), durationWeeks: 2, today: TODAY });
    if (v2.status !== "persisted") throw new Error("V2 plan not persisted");
    await acceptTrainingPlanVersion(admin, id, v2.planVersionId, TODAY, "2026-10-18");

    const families = new Map<string, { day: string; fp: { id: string; structure: any } }>();
    for (const day of DAYS) {
      await insertCheckin(admin, id, day);
      const run = await runDailyFor(admin, id, day);
      if (run.finalPrescriptionStatus !== "created") continue;
      const { data: fp } = await admin.from("decision_final_prescriptions").select("id, structure").eq("decision_id", run.persistence.decision_id).single();
      const family = (fp!.structure as { family: string }).family;
      if (!families.has(family)) families.set(family, { day, fp: fp as { id: string; structure: any } });
    }
    for (const family of ["strength", "dh_technical", "endurance"]) if (!families.has(family)) throw new Error(`${label}: no ${family} day`);

    const start = async (day: string, fpId: string) => {
      const exec = randomUUID();
      await record(id, { execution: { id: exec, session_date: day, started_at: `${day}T17:00:00Z`, final_prescription_id: fpId }, events: [{ id: randomUUID(), execution_id: exec, event_type: "started", occurred_at: `${day}T17:00:00Z` }] });
      return exec;
    };
    const event = (exec: string, day: string, type: string) => ({ id: randomUUID(), execution_id: exec, event_type: type, occurred_at: `${day}T18:00:00Z` });

    // Force: sets + a correction, completed.
    const force = families.get("strength")!;
    const item = force.fp.structure.blocks.find((bl: any) => bl.role === "main").items[0];
    const fe = await start(force.day, force.fp.id);
    const s1 = randomUUID();
    await record(id, { sets: [{ id: s1, execution_id: fe, prescription_item_id: item.prescriptionItemId, set_number: 1, done: true, measure_type: item.measure.type, measure_value: 8, occurred_at: `${force.day}T17:10:00Z` }] });
    await record(id, { sets: [{ id: randomUUID(), execution_id: fe, prescription_item_id: item.prescriptionItemId, set_number: 1, done: true, measure_type: item.measure.type, measure_value: 7, supersedes_id: s1, occurred_at: `${force.day}T17:11:00Z` }] });
    await record(id, { events: [event(fe, force.day, "completed")], sets: [{ id: randomUUID(), execution_id: fe, prescription_item_id: item.prescriptionItemId, set_number: 2, done: true, measure_type: item.measure.type, measure_value: 8, occurred_at: `${force.day}T17:20:00Z` }] });
    // DH: an abandoned attempt with a pass, then a completed restart.
    const dh = families.get("dh_technical")!;
    const drill = dh.fp.structure.blocks.find((bl: any) => bl.role === "main").items[0];
    const pass = (exec: string, n: number) => ({ id: randomUUID(), execution_id: exec, prescription_item_id: drill.prescriptionItemId, set_number: n, done: true, measure_type: "pass", measure_value: null, success: n % 2 === 0, occurred_at: `${dh.day}T17:1${n}:00Z` });
    const de1 = await start(dh.day, dh.fp.id);
    await record(id, { events: [event(de1, dh.day, "abandoned")], sets: [pass(de1, 1)] });
    const de2 = await start(dh.day, dh.fp.id);
    await record(id, { events: [event(de2, dh.day, "completed")], sets: [pass(de2, 1), pass(de2, 2)] });
    // Endurance: activity + a correction, completed.
    const endurance = families.get("endurance")!;
    const activityId = endurance.fp.structure.activitySelection.activityIds[0];
    const ee = await start(endurance.day, endurance.fp.id);
    const act = randomUUID();
    await record(id, { activities: [{ id: act, execution_id: ee, activity_id: activityId, duration_seconds: 2580, distance_m: 18400, rpe_actual: 4, occurred_at: `${endurance.day}T17:50:00Z` }] });
    await record(id, { events: [event(ee, endurance.day, "completed")], activities: [{ id: randomUUID(), execution_id: ee, activity_id: activityId, duration_seconds: 3000, supersedes_id: act, occurred_at: `${endurance.day}T17:55:00Z` }] });

    // REST with a health flag, legacy completed sessions.
    await insertCheckin(admin, id, "2026-10-13");
    const { error } = await admin.from("daily_checkins").update({ suspected_concussion: true }).eq("athlete_id", id).eq("checkin_date", "2026-10-13");
    if (error) throw new Error(error.message);
    await runDailyFor(admin, id, "2026-10-13");
    await insertCompletedSession(admin, id, "2026-10-01", "STRENGTH_A", { kind: "STRENGTH_LOWER", load_profile: "MODERATE" });

    // Decision outcomes, pattern ledgers (chains + source references), observability: owner-level fixtures.
    const decision = (await admin.from("decisions").select("id").eq("athlete_id", id).eq("decision_date", force.day).limit(1).single()).data!.id as string;
    const A = sqlLiteral(id);
    execLocalSql(`
insert into public.decision_outcomes (athlete_id, decision_id, horizon, calculator_id, calculator_version, input_snapshot, outcome_signals)
  values (${A}, ${sqlLiteral(decision)}, 'J_PLUS_1', 'r1-test', '1', '{}'::jsonb, '{}'::jsonb);
with ident as (
  insert into public.pattern_evidence_identities (athlete_id, detector_rule_id, detector_rule_version, evaluation_key, evidence_key)
  values (${A}, 'r1-detector', '1', 'eval-${label}', 'evidence-${label}') returning id
), r1 as (
  insert into public.pattern_evidence_revisions (evidence_identity_id, revision_number, event_type, event_date, observed_value)
  select id, 1, 'supporting', '2026-10-06', '{}'::jsonb from ident returning id, evidence_identity_id
), r2 as (
  insert into public.pattern_evidence_revisions (evidence_identity_id, revision_number, event_type, event_date, observed_value, supersedes_id)
  select evidence_identity_id, 2, 'neutral', '2026-10-07', '{}'::jsonb, id from r1 returning id
), ref as (
  insert into public.pattern_evidence_source_refs (revision_id, role, source_decision_id) select id, 'trigger', ${sqlLiteral(decision)} from r2 returning id
), t1 as (
  insert into public.pattern_evidence_lifecycle_transitions (evidence_identity_id, transition_number, state) select id, 1, 'active' from ident returning id, evidence_identity_id
)
insert into public.pattern_evidence_lifecycle_transitions (evidence_identity_id, transition_number, state, reason_code, supersedes_id)
  select evidence_identity_id, 2, 'withdrawn', 'r1-test', id from t1;
with ins as (
  insert into public.pattern_insight_identities (athlete_id, detector_rule_id, detector_rule_version, insight_kind) values (${A}, 'r1-detector', '1', 'r1-kind') returning id
), rv1 as (
  insert into public.pattern_insight_reviews (insight_identity_id, review_number, decision, candidate_snapshot) select id, 1, 'needs_more_evidence', '{}'::jsonb from ins returning id, insight_identity_id
)
insert into public.pattern_insight_reviews (insight_identity_id, review_number, decision, candidate_snapshot, supersedes_id) select insight_identity_id, 2, 'dismissed', '{}'::jsonb, id from rv1;
insert into public.pilot_observability_events (event_type, severity, athlete_id, metadata) values ('daily_run_succeeded', 'info', ${A}, '{}'::jsonb);`);
    return athlete;
  }

  beforeAll(async () => {
    assertLocalDbReady();
    admin = createTestClient();
    a = await richAthlete("A");
    b = await richAthlete("B");
  }, 240_000);

  afterAll(() => {
    execLocalSql("drop trigger if exists r1_purge_test_fail on public.athletes; drop function if exists public.r1_purge_test_fail();");
  });

  it("A is complete before the purge (every kind of row present)", () => {
    const fp = athleteFootprint(a.athleteId);
    for (const table of [
      "athletes", "training_plan_versions", "training_plan_current_version", "training_plan_blocks", "training_plan_weeks", "training_plan_generated_sessions", "training_plan_planned_prescriptions",
      "training_plan_version_lifecycle_transitions", "planned_sessions", "daily_checkins", "decisions", "decision_final_prescriptions", "health_flags", "completed_sessions",
      "session_executions", "execution_events", "exercise_set_results", "session_activity_results", "decision_outcomes", "pattern_evidence_identities", "pattern_evidence_revisions",
      "pattern_evidence_source_refs", "pattern_evidence_lifecycle_transitions", "pattern_insight_identities", "pattern_insight_reviews", "pilot_observability_events",
    ]) {
      expect(fp[table]?.length ?? 0, table).toBeGreaterThan(0);
    }
  });

  it("only the backend may call it: an authenticated rider is refused", async () => {
    const riderClient = await getAthleteAuthClient(b.athleteId);
    const { error } = await riderClient.rpc("purge_athlete_account", { p_athlete_id: b.athleteId });
    expect(error).not.toBeNull();
    expect(athleteFootprint(b.athleteId).athletes).toHaveLength(1);
  });

  it("the append-only protection is never lifted outside the purge: a DELETE is still refused, even with a forged marker", () => {
    const ledger = "select id from public.session_executions where athlete_id = " + sqlLiteral(b.athleteId) + " limit 1";
    expect(() => execLocalSql(`delete from public.session_executions where id = (${ledger});`)).toThrow(/append-only violation/);
    expect(() => execLocalSql(`begin; select set_config('nalynt.athlete_purge_txid', '1', true); delete from public.session_executions where id = (${ledger}); commit;`)).toThrow(/append-only violation/);
  });

  it("purge A: every row of A is gone, B is strictly identical, the Auth identity is deleted afterwards", async () => {
    const beforeB = athleteFootprint(b.athleteId);
    const result = await purgeAthleteAccount(admin, a.athleteId);
    expect(result.authUserDeleted).toBe(true);
    expect(result.deleted.athletes).toBe(1);
    expect(result.deleted.session_executions).toBeGreaterThanOrEqual(4);
    expect(athleteFootprint(a.athleteId)).toEqual({});
    expect(athleteFootprint(b.athleteId)).toEqual(beforeB);
    const { data: authA } = await admin.auth.admin.getUserById(a.userId);
    expect(authA.user).toBeNull();
    const { data: authB } = await admin.auth.admin.getUserById(b.userId);
    expect(authB.user?.id).toBe(b.userId);
    // An unknown athlete is refused clearly (nothing to purge).
    const again = await admin.rpc("purge_athlete_account", { p_athlete_id: a.athleteId });
    expect(again.error?.code).toBe("P0002");
  }, 120_000);

  it("a failure at the last step rolls the whole purge back (nothing of the athlete is deleted)", async () => {
    c = await richAthlete("C");
    const before = athleteFootprint(c.athleteId);
    execLocalSql(`create function public.r1_purge_test_fail() returns trigger language plpgsql as $$ begin raise exception 'r1 provoked failure'; end $$;
create trigger r1_purge_test_fail before delete on public.athletes for each row when (old.id = ${sqlLiteral(c.athleteId)}) execute function public.r1_purge_test_fail();`);
    const { error } = await admin.rpc("purge_athlete_account", { p_athlete_id: c.athleteId });
    expect(error?.message).toMatch(/r1 provoked failure/);
    execLocalSql("drop trigger r1_purge_test_fail on public.athletes; drop function public.r1_purge_test_fail();");
    expect(athleteFootprint(c.athleteId)).toEqual(before);
    // The athlete can then be purged normally.
    await purgeAthleteAccount(admin, c.athleteId);
    expect(athleteFootprint(c.athleteId)).toEqual({});
  }, 240_000);
});
