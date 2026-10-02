/**
 * UX-11R.3 — audit of the client DELETE privilege on public.athletes (local
 * Supabase only). Documents the CURRENT behaviour; it changes no grant.
 *
 * anon and authenticated hold DELETE on athletes, filtered by the RLS policy
 * athletes_own_data (user_id = auth.uid()). Referential actions (ON DELETE
 * CASCADE) run as the table owner: they bypass the child tables' RLS and
 * grants, but row triggers and RESTRICT foreign keys still apply.
 *
 * Runs on the current schema (59 migrations) and on the production schema
 * `ba59239` (50 migrations): the UX-only cases skip themselves when the
 * table or the purge function does not exist.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
const exists = (regclassOrProc: string) => INTEGRATION_ENABLED && execLocalSql(`select ${regclassOrProc} is not null;`).trim() === "t";
const HAS_ASSIGNMENTS = exists("to_regclass('public.training_plan_model_assignments')");
const HAS_PURGE = exists("to_regprocedure('public.purge_athlete_account(uuid)')");

const count = (table: string, athleteId: string) => Number(execLocalSql(`select count(*) from public.${table} where athlete_id = ${sqlLiteral(athleteId)};`).trim());
const authUserExists = (userId: string) => execLocalSql(`select count(*) from auth.users where id = ${sqlLiteral(userId)};`).trim() === "1";
const CHILD_TABLES = ["daily_checkins", "decisions", "health_flags", "completed_sessions"] as const;
const snapshot = (athleteId: string) => Object.fromEntries(["athletes:id", ...CHILD_TABLES, "training_plan_versions", "pilot_observability_events"].map((t) => [t, t === "athletes:id" ? Number(execLocalSql(`select count(*) from public.athletes where id = ${sqlLiteral(athleteId)};`).trim()) : count(t, athleteId)]));

describe.skipIf(!INTEGRATION_ENABLED)("UX-11R.3 — client DELETE on athletes (audit, local Supabase)", () => {
  let admin: SupabaseClient;
  const created: TestAthlete[] = [];

  async function riderWithHistory(label: string): Promise<TestAthlete> {
    const athlete = await createTestAthlete(admin, `R3 delete audit ${label}`);
    created.push(athlete);
    await insertCheckin(admin, athlete.athleteId, "2026-10-01");
    const decisionId = await insertDecision(admin, athlete.athleteId, "2026-10-01");
    await insertHealthFlag(admin, athlete.athleteId, "other", "monitoring");
    await insertCompletedSession(admin, athlete.athleteId, "2026-10-01", "REST", null, { decisionId });
    await recordPilotEvent(admin, { eventType: "plan_generation_blocked", athleteId: athlete.athleteId, generationRequestId: randomUUID(), blockedReason: "missing_availability" });
    return athlete;
  }

  beforeAll(() => {
    assertLocalDbReady();
    admin = createTestClient();
  });

  afterAll(async () => {
    for (const athlete of created) {
      // Scratch cleanup only: auth users left behind by a self-delete, orphan pilot events.
      if (authUserExists(athlete.userId) && count("training_plan_versions", athlete.athleteId) === 0) {
        if (execLocalSql(`select count(*) from public.athletes where id = ${sqlLiteral(athlete.athleteId)};`).trim() === "0") await admin.auth.admin.deleteUser(athlete.userId);
      }
    }
  });

  it("catalog: anon and authenticated hold DELETE on athletes; the only policy is athletes_own_data (ALL, user_id = auth.uid())", () => {
    const grants = execLocalSql(
      "select grantee || ':' || string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'athletes' and grantee in ('anon', 'authenticated') group by grantee order by grantee;"
    ).trim().split("\n");
    for (const line of grants) expect(line).toMatch(/:.*DELETE/);
    expect(grants).toHaveLength(2);
    expect(execLocalSql("select policyname || '|' || cmd || '|' || qual from pg_policies where schemaname = 'public' and tablename = 'athletes';").trim()).toBe("athletes_own_data|ALL|(user_id = auth.uid())");
  });

  it("A1 — a rider without a plan deletes their own athletes row: the cascade erases check-ins, decisions, health flags and completed sessions they cannot delete directly; the auth user and pilot events stay behind", async () => {
    const a = await riderWithHistory("A1");
    const rider = await getAthleteAuthClient(a.athleteId);
    // Direct deletes of the append-only history are refused to the rider…
    expect((await rider.from("decisions").delete().eq("athlete_id", a.athleteId)).error?.code).toBe("42501");
    expect(count("decisions", a.athleteId)).toBe(1);
    // …but deleting the parent row cascades as the table owner.
    const { data, error } = await rider.from("athletes").delete().eq("id", a.athleteId).select("id");
    expect(error).toBeNull();
    expect(data).toEqual([{ id: a.athleteId }]);
    expect(snapshot(a.athleteId)).toEqual({ "athletes:id": 0, daily_checkins: 0, decisions: 0, health_flags: 0, completed_sessions: 0, training_plan_versions: 0, pilot_observability_events: 1 });
    expect(authUserExists(a.userId)).toBe(true);
  }, 120_000);

  it("A2 — a rider with an accepted plan cannot delete their own row (RESTRICT training_plan_versions); nothing is removed", async () => {
    const a = await riderWithHistory("A2");
    await generateAndAcceptTrainingPlan(admin, a.athleteId, { horizonStartDate: "2026-10-05", horizonEndDate: "2026-10-11", sessions: [{ date: "2026-10-05", kind: "REST" }] });
    const before = snapshot(a.athleteId);
    const rider = await getAthleteAuthClient(a.athleteId);
    const { error } = await rider.from("athletes").delete().eq("id", a.athleteId);
    expect(error?.code).toBe("23503");
    expect(error?.message).toContain("training_plan_versions_athlete_id_fkey");
    expect(snapshot(a.athleteId)).toEqual(before);
  }, 120_000);

  it.skipIf(!HAS_ASSIGNMENTS)("A3 (UX schema) — a rider with a planning model assignment but no plan cannot delete their own row (RESTRICT training_plan_model_assignments)", async () => {
    const a = await riderWithHistory("A3");
    execLocalSql(`insert into public.training_plan_model_assignments (athlete_id, planning_model, note) values (${sqlLiteral(a.athleteId)}, 'v1', 'R3 audit');`);
    const before = snapshot(a.athleteId);
    const { error } = await (await getAthleteAuthClient(a.athleteId)).from("athletes").delete().eq("id", a.athleteId);
    expect(error?.code).toBe("23503");
    expect(error?.message).toContain("training_plan_model_assignments_athlete_id_fkey");
    expect(snapshot(a.athleteId)).toEqual(before);
    execLocalSql(`delete from public.training_plan_model_assignments where athlete_id = ${sqlLiteral(a.athleteId)};`);
  }, 120_000);

  it("B — a rider cannot delete another athlete (RLS: 0 rows, no error)", async () => {
    const attacker = await riderWithHistory("B attacker");
    const victim = await riderWithHistory("B victim");
    const before = snapshot(victim.athleteId);
    const { data, error } = await (await getAthleteAuthClient(attacker.athleteId)).from("athletes").delete().eq("id", victim.athleteId).select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect(snapshot(victim.athleteId)).toEqual(before);
  }, 120_000);

  it("C — anon (publishable key, no session) deletes nothing, even with a match-all filter", async () => {
    const victim = await riderWithHistory("C victim");
    const before = snapshot(victim.athleteId);
    const anon = createClient(resolveTestSupabaseUrl(), (process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY) as string, { auth: { persistSession: false, autoRefreshToken: false } });
    for (const query of [anon.from("athletes").delete().eq("id", victim.athleteId).select("id"), anon.from("athletes").delete().neq("id", "00000000-0000-0000-0000-000000000000").select("id")]) {
      const { data, error } = await query;
      expect(error).toBeNull();
      expect(data).toEqual([]);
    }
    expect(snapshot(victim.athleteId)).toEqual(before);
  }, 120_000);

  it.skipIf(!HAS_PURGE)("D (UX schema) — the server purge contract removes everything, pilot events and auth identity included, and touches no other athlete", async () => {
    const a = await riderWithHistory("D purged");
    const witness = await riderWithHistory("D witness");
    await generateAndAcceptTrainingPlan(admin, a.athleteId, { horizonStartDate: "2026-10-05", horizonEndDate: "2026-10-11", sessions: [{ date: "2026-10-05", kind: "REST" }] });
    if (HAS_ASSIGNMENTS) execLocalSql(`insert into public.training_plan_model_assignments (athlete_id, planning_model) values (${sqlLiteral(a.athleteId)}, 'v2');`);
    const witnessBefore = snapshot(witness.athleteId);
    const result = await purgeAthleteAccount(admin, a.athleteId);
    expect(result.authUserDeleted).toBe(true);
    expect(snapshot(a.athleteId)).toEqual({ "athletes:id": 0, daily_checkins: 0, decisions: 0, health_flags: 0, completed_sessions: 0, training_plan_versions: 0, pilot_observability_events: 0 });
    expect(authUserExists(a.userId)).toBe(false);
    expect(snapshot(witness.athleteId)).toEqual(witnessBefore);
  }, 120_000);
});
