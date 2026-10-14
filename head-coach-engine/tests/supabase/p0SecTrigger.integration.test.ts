/**
 * P0-SEC-TRIGGER (HPM 2026-10-14, local) — the browser API roles never hold TRIGGER on public tables.
 *
 * Migration 20261014120000_p0_sec_trigger_api_roles revokes TRIGGER from anon and authenticated on the 9 baseline
 * tables and removes it from the default privileges of postgres in schema public. Unchanged: service_role,
 * REFERENCES, the RLS-governed privileges of the rider, every existing trigger (TRIGGER is checked when a trigger is
 * created, never when it fires), the server purge.
 *
 * Every CREATE TRIGGER probe runs inside a transaction that is rolled back: nothing is ever left installed, even if a
 * probe unexpectedly succeeded. Assertions do not depend on the TRUNCATE state (P0-SEC-TRUNCATE is a separate ticket).
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, generateAndAcceptTrainingPlan, getAthleteAuthClient, insertCheckin } from "./testDb.js";
import { assertLocalDbReady, execLocalSql, localIntegrationRequested, sqlLiteral } from "./localDb.js";
import { purgeAthleteAccount } from "../../src/supabase/purgeAthleteAccount.js";

const INTEGRATION_ENABLED = localIntegrationRequested({ requirePublishableKey: true });

const BASELINE_TABLES = [
  "athlete_baselines",
  "athlete_state",
  "athletes",
  "daily_checkins",
  "goals",
  "planned_sessions",
  "race_calendar",
  "training_blocks",
  "weekly_availability",
] as const;
const SERVICE_ROLE_TRIGGER_TABLES = "athlete_baselines,athlete_state,athletes,completed_sessions,daily_checkins,decisions,goals,health_flags,race_calendar,weekly_availability";

const tablesWithPrivilege = (role: string, privilege: string) =>
  execLocalSql(
    `select coalesce(string_agg(c.relname, ',' order by c.relname), '') from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') and has_table_privilege(${sqlLiteral(role)}, c.oid, ${sqlLiteral(privilege)});`
  ).trim();
const defaultTablePrivileges = (role: string) =>
  execLocalSql(
    `select coalesce(string_agg(a.privilege_type, ',' order by a.privilege_type), '') from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
      where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace and d.defaclobjtype = 'r' and a.grantee = ${sqlLiteral(role)}::regrole;`
  ).trim();
/** CREATE TRIGGER as `role` with an existing trigger function the role may execute, always rolled back. */
function createTriggerAs(role: string, table: string): string {
  try {
    execLocalSql(
      `begin; set local role ${role};
       create trigger p0_sec_trigger_probe before insert on public.${table} for each row execute function public.set_updated_at();
       rollback;`
    );
    return "CREATE TRIGGER ALLOWED";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
const probeTriggersLeft = () => execLocalSql("select count(*) from pg_trigger where tgname = 'p0_sec_trigger_probe';").trim();

describe.skipIf(!INTEGRATION_ENABLED)("P0-SEC-TRIGGER — anon and authenticated never hold TRIGGER (local Supabase)", () => {
  let admin: SupabaseClient;

  beforeAll(() => {
    assertLocalDbReady();
    admin = createTestClient();
  });

  it("catalog: no public table grants TRIGGER to anon, authenticated or PUBLIC; service_role and REFERENCES unchanged", () => {
    expect(tablesWithPrivilege("anon", "TRIGGER")).toBe("");
    expect(tablesWithPrivilege("authenticated", "TRIGGER")).toBe("");
    expect(tablesWithPrivilege("service_role", "TRIGGER")).toBe(SERVICE_ROLE_TRIGGER_TABLES);
    expect(
      execLocalSql(
        "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace cross join lateral aclexplode(c.relacl) a where n.nspname = 'public' and c.relkind in ('r', 'p') and a.grantee = 0 and a.privilege_type = 'TRIGGER';"
      ).trim()
    ).toBe("0");
    for (const role of ["anon", "authenticated"]) expect(tablesWithPrivilege(role, "REFERENCES")).toBe(BASELINE_TABLES.join(","));
  });

  it.each(BASELINE_TABLES.flatMap((table) => [["anon", table], ["authenticated", table]] as const))("%s cannot CREATE TRIGGER on public.%s (42501)", (role, table) => {
    expect(createTriggerAs(role, table)).toContain(`permission denied for table ${table}`);
    expect(probeTriggersLeft()).toBe("0");
  });

  it("service_role keeps TRIGGER (probe rolled back): not changed by this ticket", () => {
    expect(createTriggerAs("service_role", "weekly_availability")).toBe("CREATE TRIGGER ALLOWED");
    expect(probeTriggersLeft()).toBe("0");
  });

  it("default privileges: a NEW public table created by postgres grants no TRIGGER to anon or authenticated; service_role and SELECT unchanged", () => {
    expect(defaultTablePrivileges("anon")).not.toContain("TRIGGER");
    expect(defaultTablePrivileges("authenticated")).not.toContain("TRIGGER");
    expect(defaultTablePrivileges("service_role")).toContain("TRIGGER");
    const probe = execLocalSql(
      `begin;
       create table public.p0_sec_trigger_probe_table (id int);
       select string_agg(r || ':' || has_table_privilege(r, 'public.p0_sec_trigger_probe_table', 'TRIGGER') || ':' || has_table_privilege(r, 'public.p0_sec_trigger_probe_table', 'SELECT'), ' ' order by r)
         from unnest(array['anon', 'authenticated', 'service_role']) r;
       rollback;`
    )
      .trim()
      .split("\n")
      .filter((line) => line.includes(":"))
      .join("");
    expect(probe).toBe("anon:false:true authenticated:false:true service_role:true:true");
    expect(execLocalSql("select to_regclass('public.p0_sec_trigger_probe_table') is null;").trim()).toBe("t");
  });

  it("existing triggers still fire: updated_at on the rider's own writes (set_updated_at), RLS writes unchanged", async () => {
    const a = await createTestAthlete(admin, "P0-SEC trigger rider");
    const rider = await getAthleteAuthClient(a.athleteId);
    const inserted = await rider.from("weekly_availability").insert({ athlete_id: a.athleteId, week_start_date: "2026-10-12" }).select("id, updated_at").single();
    expect(inserted.error).toBeNull();
    const row = inserted.data as { id: string; updated_at: string };
    execLocalSql(`select pg_sleep(0.05);`);
    expect((await rider.from("weekly_availability").update({ travel: true }).eq("id", row.id)).error).toBeNull();
    const after = (await rider.from("weekly_availability").select("travel, updated_at").eq("id", row.id).single()).data as { travel: boolean; updated_at: string };
    expect(after.travel).toBe(true);
    expect(new Date(after.updated_at).getTime()).toBeGreaterThan(new Date(row.updated_at).getTime());
    expect((await rider.from("weekly_availability").delete().eq("id", row.id)).error).toBeNull();
  }, 120_000);

  it("existing triggers still fire: append-only protection (reject_append_only_mutation) on an accepted plan version", async () => {
    const a = await createTestAthlete(admin, "P0-SEC trigger append-only");
    const plan = await generateAndAcceptTrainingPlan(admin, a.athleteId, { horizonStartDate: "2026-10-12", horizonEndDate: "2026-10-18", sessions: [{ date: "2026-10-12", kind: "REST" }] });
    expect(() => execLocalSql(`update public.training_plan_versions set rationale = rationale where id = ${sqlLiteral(plan.planVersionId)};`)).toThrow(
      /append-only violation: UPDATE on training_plan_versions is not permitted/
    );
    expect(() => execLocalSql(`delete from public.training_plan_versions where id = ${sqlLiteral(plan.planVersionId)};`)).toThrow(/append-only violation: DELETE/);
  }, 120_000);

  it("the server purge (service_role) still removes a rider's data (its append-only bypass inside the purge transaction still works) and touches no other athlete", async () => {
    const purged = await createTestAthlete(admin, "P0-SEC trigger purged");
    const witness = await createTestAthlete(admin, "P0-SEC trigger witness");
    await generateAndAcceptTrainingPlan(admin, purged.athleteId, { horizonStartDate: "2026-10-12", horizonEndDate: "2026-10-18", sessions: [{ date: "2026-10-12", kind: "REST" }] });
    await insertCheckin(admin, purged.athleteId, "2026-10-12");
    await insertCheckin(admin, witness.athleteId, "2026-10-12");
    const result = await purgeAthleteAccount(admin, purged.athleteId);
    expect(result.authUserDeleted).toBe(true);
    for (const table of ["athletes", "daily_checkins", "training_plan_versions"]) {
      const column = table === "athletes" ? "id" : "athlete_id";
      expect(execLocalSql(`select count(*) from public.${table} where ${column} = ${sqlLiteral(purged.athleteId)};`).trim()).toBe("0");
    }
    expect(execLocalSql(`select count(*) from public.daily_checkins where athlete_id = ${sqlLiteral(witness.athleteId)};`).trim()).toBe("1");
  }, 120_000);
});
