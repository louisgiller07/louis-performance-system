/**
 * BETA-V2-TECH-01 — V1 exemptions traced (HPM 2026-10-29, migration 20261027150000, candidate): on the local database,
 * a 'v1' assignment (the explicit exemption, test accounts only) needs a reason (note) and the administrator who decided
 * it (decided_by), for the operator (service_role) as for the owner, at insert as at update; 'v2' rows are unchanged; the
 * constraint is validated on a stack built from the migrations; the browser still has no access at all.
 * Opt-in: RUN_LOCAL_SUPABASE_INTEGRATION=1.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, getAthleteAuthClient } from "./testDb.js";
import { assertLocalDbReady, execLocalSql, localIntegrationRequested, sqlLiteral as lit } from "./localDb.js";

const ENABLED = localIntegrationRequested();
const OPERATOR = "TEST operator (not a real decision)";

describe.skipIf(!ENABLED)("BETA-V2-TECH-01 — every v1 exemption states its reason and its author (local DB)", { timeout: 120_000 }, () => {
  let admin: SupabaseClient;
  beforeAll(() => {
    assertLocalDbReady();
    admin = createTestClient();
  });
  const athlete = async (label: string) => (await createTestAthlete(admin, `v1 exemption trace ${label}`)).athleteId;
  /** The owner's SQL: the constraint violation code, or "ok". */
  const ownerWrite = (sql: string) => {
    try {
      execLocalSql(sql);
      return "ok";
    } catch (e) {
      return /violates check constraint "([a-z_0-9]+)"/.exec(String(e))?.[1] ?? String(e).slice(0, 200);
    }
  };
  const rowOf = (athleteId: string) => execLocalSql(`select planning_model || '|' || coalesce(note, '-') || '|' || coalesce(decided_by, '-') from public.training_plan_model_assignments where athlete_id = ${lit(athleteId)};`).trim();

  it("the migration left the trace constraint validated, next to the length rule of the author", () => {
    const out = execLocalSql(
      "select string_agg(conname || ':' || convalidated, ',' order by conname) from pg_constraint where conrelid = 'public.training_plan_model_assignments'::regclass and conname in ('training_plan_model_assignments_v1_exemption_traced', 'training_plan_model_assignments_decided_by_length');"
    ).trim();
    expect(out).toBe("training_plan_model_assignments_decided_by_length:true,training_plan_model_assignments_v1_exemption_traced:true");
  });

  it("operator (service_role): a v1 exemption without a reason or without an author is refused (23514), nothing stored; with both it is stored", async () => {
    const a = await athlete("operator");
    const noReason = await admin.from("training_plan_model_assignments").insert({ athlete_id: a, planning_model: "v1", decided_by: OPERATOR });
    const noAuthor = await admin.from("training_plan_model_assignments").insert({ athlete_id: a, planning_model: "v1", note: "test account" });
    const blankAuthor = await admin.from("training_plan_model_assignments").insert({ athlete_id: a, planning_model: "v1", note: "test account", decided_by: "   " });
    expect([noReason.error?.code, noAuthor.error?.code, blankAuthor.error?.code, rowOf(a)]).toEqual(["23514", "23514", "23514", ""]);
    const traced = await admin.from("training_plan_model_assignments").insert({ athlete_id: a, planning_model: "v1", note: "test account", decided_by: OPERATOR });
    expect([traced.error, rowOf(a)]).toEqual([null, `v1|test account|${OPERATOR}`]);
  });

  it("owner SQL: the same rule; and an update can neither turn a v2 row into an untraced v1 nor erase the trace of a v1", async () => {
    const a = await athlete("owner");
    expect(ownerWrite(`insert into public.training_plan_model_assignments (athlete_id, planning_model) values (${lit(a)}, 'v1');`)).toBe("training_plan_model_assignments_v1_exemption_traced");
    expect(ownerWrite(`insert into public.training_plan_model_assignments (athlete_id, planning_model) values (${lit(a)}, 'v2');`)).toBe("ok");
    expect(ownerWrite(`update public.training_plan_model_assignments set planning_model = 'v1' where athlete_id = ${lit(a)};`)).toBe("training_plan_model_assignments_v1_exemption_traced");
    expect(ownerWrite(`update public.training_plan_model_assignments set planning_model = 'v1', note = 'test account', decided_by = ${lit(OPERATOR)} where athlete_id = ${lit(a)};`)).toBe("ok");
    expect(ownerWrite(`update public.training_plan_model_assignments set decided_by = null where athlete_id = ${lit(a)};`)).toBe("training_plan_model_assignments_v1_exemption_traced");
    expect(ownerWrite(`update public.training_plan_model_assignments set note = null where athlete_id = ${lit(a)};`)).toBe("training_plan_model_assignments_v1_exemption_traced");
    expect(rowOf(a)).toBe(`v1|test account|${OPERATOR}`);
  });

  it("v2 rows are unchanged: no reason or author required", async () => {
    const a = await athlete("v2");
    const { error } = await admin.from("training_plan_model_assignments").insert({ athlete_id: a, planning_model: "v2" });
    expect([error, rowOf(a)]).toEqual([null, "v2|-|-"]);
  });

  it("the rider still neither reads nor writes any assignment, author included (42501)", async () => {
    const a = await athlete("rider");
    const rider = await getAthleteAuthClient(a);
    const write = await rider.from("training_plan_model_assignments").insert({ athlete_id: a, planning_model: "v1", note: "self", decided_by: "self" });
    const read = await rider.from("training_plan_model_assignments").select("decided_by");
    expect([write.error?.code, read.error?.code, rowOf(a)]).toEqual(["42501", "42501", ""]);
  });
});
