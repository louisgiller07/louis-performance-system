/**
 * P0-SEC-MAINTAIN (HPM 2026-10-14, local proposal) — the browser API roles never hold MAINTAIN on public tables.
 *
 * Migration 20261014150000_p0_sec_maintain_api_roles (version-guarded, PostgreSQL 17+) revokes MAINTAIN from anon (9
 * baseline tables) and authenticated (the same 9 + completed_sessions, decisions, health_flags) and removes it from the
 * default privileges of postgres. Unchanged: service_role, REFERENCES, RLS-governed privileges, the server purge.
 * Known residual (asserted, not hidden): a strong LOCK TABLE stays possible where a role holds UPDATE / DELETE.
 *
 * Every probe runs inside a transaction that is rolled back.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, getAthleteAuthClient, insertCheckin } from "./testDb.js";
import { assertLocalDbReady, execLocalSql, localIntegrationRequested, sqlLiteral } from "./localDb.js";
import { purgeAthleteAccount } from "../../src/supabase/purgeAthleteAccount.js";

const INTEGRATION_ENABLED = localIntegrationRequested({ requirePublishableKey: true });

const BASELINE_TABLES = ["athlete_baselines", "athlete_state", "athletes", "daily_checkins", "goals", "planned_sessions", "race_calendar", "training_blocks", "weekly_availability"];
const SELECT_ONLY_TABLES = ["completed_sessions", "decisions", "health_flags"];
const SERVICE_ROLE_MAINTAIN_TABLES = [...BASELINE_TABLES, ...SELECT_ONLY_TABLES].sort().join(",");

const hasMaintain = () => Number(execLocalSql("show server_version_num;").trim()) >= 170000;
const tablesWithMaintain = (role: string) =>
  execLocalSql(
    `select coalesce(string_agg(c.relname, ',' order by c.relname), '') from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'm') and has_table_privilege(${sqlLiteral(role)}, c.oid, 'MAINTAIN');`
  ).trim();
/** `statement` as `role`, always rolled back. Returns the psql error, or "ALLOWED". */
function asRole(role: string, statement: string): string {
  try {
    execLocalSql(`begin; set local role ${role}; ${statement}; rollback;`);
    return "ALLOWED";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

describe.skipIf(!INTEGRATION_ENABLED)("P0-SEC-MAINTAIN — anon and authenticated never hold MAINTAIN (local Supabase, PostgreSQL 17+)", () => {
  let admin: SupabaseClient;

  beforeAll(() => {
    assertLocalDbReady();
    admin = createTestClient();
  });

  it("the tested server has the MAINTAIN privilege (PostgreSQL 17+); otherwise the migration is a no-op", () => {
    expect(hasMaintain()).toBe(true);
  });

  it("catalog: no public table grants MAINTAIN to anon, authenticated or PUBLIC; service_role unchanged", () => {
    expect(tablesWithMaintain("anon")).toBe("");
    expect(tablesWithMaintain("authenticated")).toBe("");
    expect(tablesWithMaintain("service_role")).toBe(SERVICE_ROLE_MAINTAIN_TABLES);
    expect(
      execLocalSql(
        "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace cross join lateral aclexplode(c.relacl) a where n.nspname = 'public' and a.grantee = 0 and a.privilege_type = 'MAINTAIN';"
      ).trim()
    ).toBe("0");
  });

  it.each([...BASELINE_TABLES.map((t) => ["anon", t]), ...[...BASELINE_TABLES, ...SELECT_ONLY_TABLES].map((t) => ["authenticated", t])])(
    "%s cannot REINDEX public.%s",
    (role, table) => {
      expect(asRole(role!, `reindex table public.${table}`)).toMatch(new RegExp(`permission denied for table ${table}|must be owner of table ${table}`));
    }
  );

  it.each(SELECT_ONLY_TABLES)("authenticated cannot take an ACCESS EXCLUSIVE lock on public.%s (SELECT only)", (table) => {
    expect(asRole("authenticated", `lock table public.${table} in access exclusive mode`)).toContain(`permission denied for table ${table}`);
  });

  it("known residual, documented: a role holding UPDATE / DELETE can still LOCK the table (anon on goals)", () => {
    expect(asRole("anon", "lock table public.goals in access exclusive mode")).toBe("ALLOWED");
  });

  it("default privileges: a NEW public table created by postgres grants no MAINTAIN to anon or authenticated; service_role unchanged", () => {
    const probe = execLocalSql(
      `begin;
       create table public.p0_sec_maintain_probe (id int);
       select string_agg(r || ':' || has_table_privilege(r, 'public.p0_sec_maintain_probe', 'MAINTAIN') || ':' || has_table_privilege(r, 'public.p0_sec_maintain_probe', 'SELECT'), ' ' order by r)
         from unnest(array['anon', 'authenticated', 'service_role']) r;
       rollback;`
    )
      .trim()
      .split("\n")
      .filter((line) => line.includes(":"))
      .join("");
    expect(probe).toBe("anon:false:true authenticated:false:true service_role:true:true");
  });

  it("the rider's RLS-governed writes and the server purge are unchanged", async () => {
    const a = await createTestAthlete(admin, "P0-SEC maintain rider");
    const rider = await getAthleteAuthClient(a.athleteId);
    const inserted = await rider.from("weekly_availability").insert({ athlete_id: a.athleteId, week_start_date: "2026-10-12" }).select("id").single();
    expect(inserted.error).toBeNull();
    expect((await rider.from("weekly_availability").update({ travel: true }).eq("id", (inserted.data as { id: string }).id)).error).toBeNull();
    await insertCheckin(admin, a.athleteId, "2026-10-12");
    const result = await purgeAthleteAccount(admin, a.athleteId);
    expect(result.authUserDeleted).toBe(true);
    expect(execLocalSql(`select count(*) from public.athletes where id = ${sqlLiteral(a.athleteId)};`).trim()).toBe("0");
  }, 120_000);
});
