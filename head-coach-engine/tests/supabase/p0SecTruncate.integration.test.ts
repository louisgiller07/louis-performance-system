/**
 * P0-SEC-TRUNCATE (HPM 2026-10-13, local) — the browser API roles never hold TRUNCATE.
 *
 * Migration 20261014090000_p0_sec_truncate_api_roles revokes TRUNCATE from anon and authenticated on the 9 baseline
 * tables and removes it from the default privileges of postgres in schema public. Everything else is unchanged:
 * service_role keeps TRUNCATE (it already holds DELETE and bypasses RLS), RLS-governed SELECT / INSERT / UPDATE /
 * DELETE of the rider, TRIGGER / REFERENCES (reported, not changed), the server purge.
 *
 * Every TRUNCATE probe runs inside a transaction that is rolled back: no data is ever removed, even if a probe
 * unexpectedly succeeded.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, getAthleteAuthClient, insertCheckin, resolveTestSupabaseUrl } from "./testDb.js";
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
const SERVICE_ROLE_TRUNCATE_TABLES = "athlete_baselines,athlete_state,athletes,completed_sessions,daily_checkins,decisions,goals,health_flags,race_calendar,weekly_availability";

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
const athletesPrivileges = (role: string) =>
  execLocalSql(`select string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'athletes' and grantee = '${role}';`).trim();
/** TRUNCATE as `role`, always rolled back. Returns the psql error, or "TRUNCATE ALLOWED" (never expected for API roles). */
function truncateAs(role: string, table: string): string {
  try {
    execLocalSql(`begin; set local role ${role}; truncate table public.${table}; rollback;`);
    return "TRUNCATE ALLOWED";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

describe.skipIf(!INTEGRATION_ENABLED)("P0-SEC-TRUNCATE — anon and authenticated never hold TRUNCATE (local Supabase)", () => {
  let admin: SupabaseClient;

  beforeAll(() => {
    assertLocalDbReady();
    admin = createTestClient();
  });

  it("catalog: no public table grants TRUNCATE to anon or authenticated; service_role unchanged; no PUBLIC grant", () => {
    expect(tablesWithPrivilege("anon", "TRUNCATE")).toBe("");
    expect(tablesWithPrivilege("authenticated", "TRUNCATE")).toBe("");
    expect(tablesWithPrivilege("service_role", "TRUNCATE")).toBe(SERVICE_ROLE_TRUNCATE_TABLES);
    expect(
      execLocalSql(
        "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace cross join lateral aclexplode(c.relacl) a where n.nspname = 'public' and c.relkind in ('r', 'p') and a.grantee = 0 and a.privilege_type = 'TRUNCATE';"
      ).trim()
    ).toBe("0");
  });

  it("catalog: only TRUNCATE changed — the other privileges of the API roles on athletes are those of UX-11R.3.1", () => {
    expect(athletesPrivileges("anon")).toBe("INSERT,REFERENCES,SELECT,TRIGGER,UPDATE");
    expect(athletesPrivileges("authenticated")).toBe("INSERT,REFERENCES,SELECT,TRIGGER,UPDATE");
    expect(athletesPrivileges("service_role")).toBe("DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE");
    // TRIGGER and REFERENCES were reported to the HPM, not changed: same 9 baseline tables.
    for (const role of ["anon", "authenticated"]) {
      expect(tablesWithPrivilege(role, "TRIGGER")).toBe(BASELINE_TABLES.join(","));
      expect(tablesWithPrivilege(role, "REFERENCES")).toBe(BASELINE_TABLES.join(","));
    }
  });

  it.each(BASELINE_TABLES.flatMap((table) => [["anon", table], ["authenticated", table]] as const))("%s cannot TRUNCATE public.%s (42501)", (role, table) => {
    expect(truncateAs(role, table)).toContain(`permission denied for table ${table}`);
  });

  it("service_role keeps TRUNCATE (always rolled back here); its DELETE already covers the same rows", () => {
    expect(truncateAs("service_role", "weekly_availability")).toBe("TRUNCATE ALLOWED");
    expect(tablesWithPrivilege("service_role", "DELETE").split(",")).toEqual(expect.arrayContaining(SERVICE_ROLE_TRUNCATE_TABLES.split(",")));
  });

  it("default privileges: a NEW public table grants no TRUNCATE to anon or authenticated, the rest unchanged", () => {
    expect(defaultTablePrivileges("anon")).not.toContain("TRUNCATE");
    expect(defaultTablePrivileges("authenticated")).not.toContain("TRUNCATE");
    expect(defaultTablePrivileges("service_role")).toContain("TRUNCATE");
    const probe = execLocalSql(
      `begin;
       create table public.p0_sec_truncate_probe (id int);
       select string_agg(r || ':' || has_table_privilege(r, 'public.p0_sec_truncate_probe', 'TRUNCATE') || ':' || has_table_privilege(r, 'public.p0_sec_truncate_probe', 'SELECT'), ' ' order by r)
         from unnest(array['anon', 'authenticated', 'service_role']) r;
       rollback;`
    )
      .trim()
      .split("\n")
      .filter((line) => line.includes(":"))
      .join("");
    expect(probe).toBe("anon:false:true authenticated:false:true service_role:true:true");
    expect(execLocalSql("select to_regclass('public.p0_sec_truncate_probe') is null;").trim()).toBe("t");
  });

  it("the rider's own RLS-governed writes still work (insert, update, read, delete on weekly_availability); anon still reads nothing", async () => {
    const a = await createTestAthlete(admin, "P0-SEC truncate rider");
    const rider = await getAthleteAuthClient(a.athleteId);
    const inserted = await rider.from("weekly_availability").insert({ athlete_id: a.athleteId, week_start_date: "2026-10-12" }).select("id").single();
    expect(inserted.error).toBeNull();
    const id = (inserted.data as { id: string }).id;
    expect((await rider.from("weekly_availability").update({ travel: true }).eq("id", id)).error).toBeNull();
    const read = await rider.from("weekly_availability").select("travel").eq("id", id).single();
    expect(read.data).toEqual({ travel: true });
    const anon = createClient(resolveTestSupabaseUrl(), (process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY) as string, { auth: { persistSession: false, autoRefreshToken: false } });
    expect((await anon.from("weekly_availability").select("id").eq("id", id)).data).toEqual([]);
    expect((await rider.from("weekly_availability").delete().eq("id", id)).error).toBeNull();
    expect(execLocalSql(`select count(*) from public.weekly_availability where id = ${sqlLiteral(id)};`).trim()).toBe("0");
  }, 120_000);

  it("the server purge (service_role) still removes a rider's data and touches no other athlete", async () => {
    const purged = await createTestAthlete(admin, "P0-SEC truncate purged");
    const witness = await createTestAthlete(admin, "P0-SEC truncate witness");
    await insertCheckin(admin, purged.athleteId, "2026-10-12");
    await insertCheckin(admin, witness.athleteId, "2026-10-12");
    const result = await purgeAthleteAccount(admin, purged.athleteId);
    expect(result.authUserDeleted).toBe(true);
    expect(execLocalSql(`select count(*) from public.athletes where id = ${sqlLiteral(purged.athleteId)};`).trim()).toBe("0");
    expect(execLocalSql(`select count(*) from public.daily_checkins where athlete_id = ${sqlLiteral(purged.athleteId)};`).trim()).toBe("0");
    expect(execLocalSql(`select count(*) from public.daily_checkins where athlete_id = ${sqlLiteral(witness.athleteId)};`).trim()).toBe("1");
  }, 120_000);
});
