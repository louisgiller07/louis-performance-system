/**
 * UX-11R.3.1 — no client can delete a public.athletes row (local Supabase only).
 *
 * Migration 20261003120000_ux11r31_revoke_direct_athlete_delete revokes
 * DELETE on athletes from anon and authenticated (audit UX-11R.3: a rider
 * without a plan could erase their own history through the cascade). The
 * only deletion path is the server purge (service_role), then the Auth
 * Admin API. SELECT / INSERT / UPDATE and the RLS policy are unchanged.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  createTestAthlete,
  createTestClient,
  generateAndAcceptTrainingPlan,
  getAthleteAuthClient,
  insertCheckin,
  insertCompletedSession,
  insertDecision,
  insertHealthFlag,
  resolveTestSupabaseUrl,
  type TestAthlete,
} from "./testDb.js";
import { assertLocalDbReady, execLocalSql, localIntegrationRequested, sqlLiteral } from "./localDb.js";
import { recordPilotEvent } from "../../src/supabase/observability/pilotEvents.js";
import { purgeAthleteAccount } from "../../src/supabase/purgeAthleteAccount.js";

const INTEGRATION_ENABLED = localIntegrationRequested({ requirePublishableKey: true });

const count = (table: string, athleteId: string) => Number(execLocalSql(`select count(*) from public.${table} where athlete_id = ${sqlLiteral(athleteId)};`).trim());
const authUserExists = (userId: string) => execLocalSql(`select count(*) from auth.users where id = ${sqlLiteral(userId)};`).trim() === "1";
const snapshot = (athleteId: string) => ({
  athletes: Number(execLocalSql(`select count(*) from public.athletes where id = ${sqlLiteral(athleteId)};`).trim()),
  ...Object.fromEntries(["daily_checkins", "decisions", "health_flags", "completed_sessions", "training_plan_versions", "pilot_observability_events"].map((t) => [t, count(t, athleteId)])),
});
const privileges = (role: string) =>
  execLocalSql(`select string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'athletes' and grantee = '${role}';`).trim();

describe.skipIf(!INTEGRATION_ENABLED)("UX-11R.3.1 — direct DELETE on athletes is revoked from clients (local Supabase)", () => {
  let admin: SupabaseClient;

  async function riderWithHistory(label: string): Promise<TestAthlete> {
    const athlete = await createTestAthlete(admin, `R3.1 delete ${label}`);
    await insertCheckin(admin, athlete.athleteId, "2026-10-01");
    const decisionId = await insertDecision(admin, athlete.athleteId, "2026-10-01");
    await insertHealthFlag(admin, athlete.athleteId, "other", "monitoring");
    await insertCompletedSession(admin, athlete.athleteId, "2026-10-01", "REST", null, { decisionId });
    await recordPilotEvent(admin, { eventType: "plan_generation_blocked", athleteId: athlete.athleteId, generationRequestId: randomUUID(), blockedReason: "missing_availability" });
    return athlete;
  }
  const anonClient = () =>
    createClient(resolveTestSupabaseUrl(), (process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY) as string, { auth: { persistSession: false, autoRefreshToken: false } });

  beforeAll(() => {
    assertLocalDbReady();
    admin = createTestClient();
  });

  it("catalog: anon / authenticated lose DELETE only; service_role keeps it; the RLS policy and the purge EXECUTE grant are unchanged", () => {
    expect(privileges("anon")).toBe("INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE");
    expect(privileges("authenticated")).toBe("INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE");
    expect(privileges("service_role")).toBe("DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE");
    // No privilege granted to PUBLIC (grantee oid 0).
    expect(execLocalSql("select count(*) from aclexplode((select relacl from pg_class where oid = 'public.athletes'::regclass)) where grantee = 0;").trim()).toBe("0");
    expect(execLocalSql("select policyname || '|' || cmd || '|' || qual || '|' || with_check from pg_policies where schemaname = 'public' and tablename = 'athletes';").trim()).toBe(
      "athletes_own_data|ALL|(user_id = auth.uid())|(user_id = auth.uid())"
    );
    expect(
      execLocalSql(
        "select string_agg(r || ':' || has_function_privilege(r, 'public.purge_athlete_account(uuid)', 'EXECUTE'), ',' order by r) from unnest(array['anon', 'authenticated', 'service_role']) r;"
      ).trim()
    ).toBe("anon:false,authenticated:false,service_role:true");
  });

  it("rider, own row, no plan and no RESTRICT foreign key: DELETE refused (42501), nothing removed", async () => {
    const a = await riderWithHistory("own, no plan");
    const before = snapshot(a.athleteId);
    expect(before).toMatchObject({ athletes: 1, daily_checkins: 1, decisions: 1, health_flags: 1, completed_sessions: 1, pilot_observability_events: 1 });
    const { error } = await (await getAthleteAuthClient(a.athleteId)).from("athletes").delete().eq("id", a.athleteId);
    expect(error?.code).toBe("42501");
    expect(snapshot(a.athleteId)).toEqual(before);
  }, 120_000);

  it("rider, own row with an accepted plan: refused by the privilege check (42501), nothing removed", async () => {
    const a = await riderWithHistory("own, with plan");
    await generateAndAcceptTrainingPlan(admin, a.athleteId, { horizonStartDate: "2026-10-05", horizonEndDate: "2026-10-11", sessions: [{ date: "2026-10-05", kind: "REST" }] });
    const before = snapshot(a.athleteId);
    const { error } = await (await getAthleteAuthClient(a.athleteId)).from("athletes").delete().eq("id", a.athleteId);
    expect(error?.code).toBe("42501");
    expect(snapshot(a.athleteId)).toEqual(before);
  }, 120_000);

  it("rider, another athlete: refused (42501), the other athlete intact", async () => {
    const attacker = await riderWithHistory("attacker");
    const victim = await riderWithHistory("victim");
    const before = snapshot(victim.athleteId);
    const { error } = await (await getAthleteAuthClient(attacker.athleteId)).from("athletes").delete().eq("id", victim.athleteId);
    expect(error?.code).toBe("42501");
    expect(snapshot(victim.athleteId)).toEqual(before);
  }, 120_000);

  it("anon: refused (42501), even with a match-all filter", async () => {
    const victim = await riderWithHistory("anon victim");
    const before = snapshot(victim.athleteId);
    const anon = anonClient();
    expect((await anon.from("athletes").delete().eq("id", victim.athleteId)).error?.code).toBe("42501");
    expect((await anon.from("athletes").delete().neq("id", "00000000-0000-0000-0000-000000000000")).error?.code).toBe("42501");
    expect(snapshot(victim.athleteId)).toEqual(before);
  }, 120_000);

  it("neither a rider nor anon can call the purge; nothing removed", async () => {
    const a = await riderWithHistory("purge caller");
    const before = snapshot(a.athleteId);
    for (const client of [await getAthleteAuthClient(a.athleteId), anonClient()]) {
      const { error } = await client.rpc("purge_athlete_account", { p_athlete_id: a.athleteId });
      expect(error?.code).toBe("42501");
    }
    expect(snapshot(a.athleteId)).toEqual(before);
  }, 120_000);

  it("server purge (service_role) still removes everything, auth identity included, and touches no other athlete", async () => {
    const a = await riderWithHistory("purged");
    const witness = await riderWithHistory("witness");
    await generateAndAcceptTrainingPlan(admin, a.athleteId, { horizonStartDate: "2026-10-05", horizonEndDate: "2026-10-11", sessions: [{ date: "2026-10-05", kind: "REST" }] });
    execLocalSql(`insert into public.training_plan_model_assignments (athlete_id, planning_model) values (${sqlLiteral(a.athleteId)}, 'v2');`);
    const witnessBefore = snapshot(witness.athleteId);
    const result = await purgeAthleteAccount(admin, a.athleteId);
    expect(result.authUserDeleted).toBe(true);
    expect(snapshot(a.athleteId)).toEqual({ athletes: 0, daily_checkins: 0, decisions: 0, health_flags: 0, completed_sessions: 0, training_plan_versions: 0, pilot_observability_events: 0 });
    expect(count("training_plan_model_assignments", a.athleteId)).toBe(0);
    expect(authUserExists(a.userId)).toBe(false);
    expect(snapshot(witness.athleteId)).toEqual(witnessBefore);
  }, 120_000);
});
