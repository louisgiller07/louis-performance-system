/**
 * V2-DH-REVOCATION (PR2-DH-REVOCATION-PREP, HPM 2026-10-27) — migration 20261027120000 (transactional safety revocation
 * of a DH drill) and its rollback (supabase/rollbacks/v2_dh_revocation/), on a DISPOSABLE local database only.
 * Opt-in: RUN_LOCAL_DH_REVOCATION=1, alone, on a FRESH stack (the migration applied by `supabase start`, the revocation
 * table still empty), thrown away afterwards (supabase stop --no-backup): it revokes catalogue drills for good
 * (append-only), rolls the migration back and re-applies it. v2DhRevocationDailyRun.integration.test.ts needs its own
 * fresh stack (the drills revoked here are those of its plan).
 *
 * Proves, in this order — the first four on an EMPTY revocation table:
 *  1. isolation: both RPCs refuse every level but READ COMMITTED (NX301), first, writing nothing;
 *  2. SHARE is a table lock: an execution batch or a daily-run write in progress holds the very first revocation back;
 *     a daily-run write without a DH drill does not take it;
 *  3. the rollback: in progress, it holds revocations back (service_role and owner), which are refused once it commits
 *     (never recorded without effect); both functions are restored exactly; re-applying the migration restores the
 *     guard and lets revocations through again;
 *  4. the first revocation, being written, holds back a new execution, a daily-run write and the rollback; once it
 *     commits, all three refuse;
 *  5. a revocation already waiting when the rollback starts is served before it: the rollback's guard counts it;
 *  then the structure, the rider, the refused / kept actions, both directions of concurrency, why READ COMMITTED (a
 *  REPEATABLE READ snapshot misses a revocation committed during the lock wait), the daily-run write refused with
 *  nothing written, and the rollback refused while a revocation exists.
 * Fixture prescriptions are hand-made v2 structures (as in executionResultIntegrity).
 */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, getAthleteAuthClient, insertCheckin } from "./testDb.js";
import { assertLocalDbReady, execLocalSql, localDbContainer, localIntegrationRequested, sqlLiteral } from "./localDb.js";

const ENABLED = localIntegrationRequested({ requirePublishableKey: true }) && process.env.RUN_LOCAL_DH_REVOCATION === "1";
const MIGRATIONS = new URL("../../../supabase/migrations/", import.meta.url);
const FORWARD = () => readFileSync(new URL("20261027120000_v2_dh_drill_revocation.sql", MIGRATIONS), "utf8");
const ROLLBACK = () => readFileSync(new URL("../../../supabase/rollbacks/v2_dh_revocation/20261027120000_rollback_v2_dh_drill_revocation.sql", import.meta.url), "utf8");
const REVOKED = "cornering_berm_speed";
const OTHER = "braking_late_entry";
const FIRST = "roots_rocks_rolling";
const QUEUED = "jumps_gap_intro";
const PROBE = "drops_small_controlled";
// Fixture decisions (one final prescription each): 0 completed before; 1 started before; 2 SECTION; 3 unit-less; 4 another
// drill; 5 Force; 6, 7 concurrency; 8 the empty-table hold; 9 the first revocation.
const DAYS = ["2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06", "2026-12-07", "2026-12-08", "2026-12-09", "2026-12-10"] as const;
const DRILL_OF: Record<number, string> = { 0: REVOKED, 1: REVOKED, 2: REVOKED, 3: REVOKED, 4: OTHER, 6: "jumps_table_top_basic", 7: "steep_terrain_body_position", 8: OTHER, 9: FIRST };
// Days written by persist_daily_run_v2 itself (no fixture decision).
const PERSIST_DAYS = ["2026-12-11", "2026-12-12", "2026-12-13", "2026-12-14", "2026-12-15", "2026-12-16"] as const;
type Outcome = { status: string; code?: string; target?: string };

const dhStructure = (item: string, drillIds: readonly string[], unit: boolean) => ({
  schemaVersion: "v2",
  family: "dh_technical",
  sessionKind: "DH_TECHNICAL",
  catalog: { aggregate: "test" },
  blocks: [{ blockId: "main", role: "main", items: drillIds.map((drillId, i) => ({ kind: "drill", prescriptionItemId: i === 0 ? item : randomUUID(), drillId, measure: unit ? { type: "pass", count: 4, unit: "SECTION" } : { type: "pass", count: 4 } })) }],
});
const forceStructure = (item: string) => ({
  schemaVersion: "v2",
  family: "strength",
  sessionKind: "STRENGTH_LOWER",
  catalog: { aggregate: "test" },
  blocks: [{ blockId: "main", role: "main", items: [{ kind: "exercise", prescriptionItemId: item, exerciseId: "goblet_squat", role: "principal", sets: 3, measure: { type: "reps", min: 6, max: 8, perSide: false } }] }],
});

/** A psql session kept open (its transaction held) until finish(). */
async function heldSession(sql: string) {
  const child = spawn("docker", ["exec", "-i", localDbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], { stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => (out += String(d)));
  child.stderr.on("data", (d) => (out += String(d)));
  child.stdin.write(`${sql}\nselect 'HELD';\n`);
  for (let i = 0; i < 100 && !out.includes("HELD"); i += 1) await new Promise((r) => setTimeout(r, 100));
  if (!out.includes("HELD")) throw new Error(`session not held: ${out}`);
  return {
    finish: async (tail: string) => {
      child.stdin.end(`${tail}\n`);
      await once(child, "exit");
      return out;
    },
  };
}
/** A psql session run in the background (it may wait on a lock): its exit code and output. */
function background(sql: string) {
  const child = spawn("docker", ["exec", "-i", localDbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], { stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => (out += String(d)));
  child.stderr.on("data", (d) => (out += String(d)));
  child.stdin.end(`${sql}\n`);
  return once(child, "exit").then(([code]) => ({ code: code as number, out }));
}
/** Until `n` lock requests on the revocation table are queued (not granted). */
async function lockWaiters(n: number) {
  let queued = 0;
  for (let i = 0; i < 150; i += 1) {
    queued = Number(execLocalSql("select count(*) from pg_locks where relation = to_regclass('public.dh_drill_revocations') and not granted;").trim());
    if (queued >= n) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`${queued} lock request(s) queued on dh_drill_revocations, expected ${n}`);
}
const lockTimeout = (sql: string) => {
  try {
    execLocalSql(`set lock_timeout = '1500ms';\n${sql}`);
    return "completed";
  } catch (e) {
    return /lock timeout/i.test(String((e as Error).message)) ? "waited (lock timeout)" : `error: ${(e as Error).message}`;
  }
};
const revocationCount = () => execLocalSql("select count(*) from public.dh_drill_revocations;").trim();
const prosrc = (fn: string) => execLocalSql(`select prosrc from pg_proc where oid = 'public.${fn}'::regprocedure;`).replace(/\r/g, "").trim();
/** The function body of a migration file, between its dollar quotes. */
const migrationBody = (file: string, tag: string) => {
  const text = readFileSync(new URL(file, MIGRATIONS), "utf8").replace(/\r/g, "");
  const start = text.indexOf(`as ${tag}\n`) + `as ${tag}`.length;
  return text.slice(start, text.indexOf(`${tag};`, start)).trim();
};

describe.skipIf(!ENABLED)("V2-DH-REVOCATION — migration 20261027120000 and its rollback (disposable local database)", { timeout: 240_000 }, () => {
  let admin: SupabaseClient;
  let athleteId: string;
  const fp: Record<string, string> = {};
  const item: Record<string, string> = {};
  const record = async (payload: unknown): Promise<Outcome> => {
    const { data, error } = await admin.rpc("record_session_execution", { p_athlete_id: athleteId, p_payload: payload });
    if (error) throw new Error(`record_session_execution raised: ${error.message}`);
    return data as Outcome;
  };
  const rpcSql = (payload: unknown) => `select public.record_session_execution(${sqlLiteral(athleteId)}::uuid, ${sqlLiteral(JSON.stringify(payload))}::jsonb);`;
  /** A daily-run write (persist_daily_run_v2): a REPLACE decision and its final prescription, hand-made. */
  const persistArgs = (day: string, structure: object, healthFlag: object | null = null) => {
    const decisionId = randomUUID();
    return {
      p_athlete_id: athleteId,
      p_health_flag: healthFlag,
      p_decision_row: { id: decisionId, athlete_id: athleteId, decision_date: day, final_session: "DH_TECHNICAL", reason: "TEST fixture", engine_version: "test", daily_plan: { decision: "REPLACE" }, active_mode: "UNSPECIFIED", confidence_level: "MEDIUM" },
      p_final_prescription_outcome: {
        status: "created",
        final_prescription: { id: randomUUID(), decision_id: decisionId, athlete_id: athleteId, plan_version_id: null, planned_prescription_id: null, active_session_origin: "no_canonical_plan", reconciliation_action: "replace", adaptation_rule_ids: ["test.revocation_fixture"], schema_version: "v2", catalog_version: "test", structure },
      },
    };
  };
  const persist = async (args: ReturnType<typeof persistArgs>) => admin.rpc("persist_daily_run_v2", args);
  const persistSql = (args: ReturnType<typeof persistArgs>) =>
    `select public.persist_daily_run_v2(${sqlLiteral(athleteId)}::uuid, ${args.p_health_flag === null ? "null" : `${sqlLiteral(JSON.stringify(args.p_health_flag))}::jsonb`}, ${sqlLiteral(JSON.stringify(args.p_decision_row))}::jsonb, ${sqlLiteral(JSON.stringify(args.p_final_prescription_outcome))}::jsonb);`;
  const at = (day: string, minute: number) => `${day}T09:${String(minute).padStart(2, "0")}:00Z`;
  const start = (id: string, day: string) => ({ execution: { id, session_date: day, started_at: at(day, 0), final_prescription_id: fp[day] }, events: [{ id: randomUUID(), execution_id: id, event_type: "started", occurred_at: at(day, 0) }] });
  const event = (execution: string, day: string, event_type: string, minute = 30) => ({ events: [{ id: randomUUID(), execution_id: execution, event_type, occurred_at: at(day, minute) }] });
  const pass = (execution: string, day: string, n: number, id = randomUUID()) => ({ id, execution_id: execution, prescription_item_id: item[day], set_number: n, done: true, measure_type: "pass", measure_value: null, success: true, occurred_at: at(day, 10 + n) });
  const revoke = (drill: string) => `insert into public.dh_drill_revocations (drill_id, reason, decided_by) values (${sqlLiteral(drill)}, 'TEST fixture: safety revocation (not a sports decision)', 'TEST operator');`;
  /** The operators' path: the service_role (the owner is a superuser and bypasses privileges). */
  const revokeAsOperator = (drill: string) => `set role service_role;\n${revoke(drill)}`;
  const rows = (table: string, column: string, value: string) => execLocalSql(`select count(*) from public.${table} where ${column} = ${sqlLiteral(value)};`).trim();
  const decisionsOn = (day: string) => execLocalSql(`select count(*) from public.decisions where athlete_id = ${sqlLiteral(athleteId)} and decision_date = ${sqlLiteral(day)};`).trim();

  beforeAll(async () => {
    assertLocalDbReady();
    if (execLocalSql("select to_regclass('public.dh_drill_revocations') is null;").trim() === "t" || !prosrc("persist_daily_run_v2(uuid, jsonb, jsonb, jsonb)").includes("NX302")) {
      throw new Error("migration 20261027120000 is not applied on this stack: start a fresh stack from this checkout");
    }
    if (revocationCount() !== "0") throw new Error("dh_drill_revocations already holds revocations: this suite needs a FRESH disposable stack");
    admin = createTestClient();
    athleteId = (await createTestAthlete(admin, "V2 DH revocation")).athleteId;
    await Promise.all(DAYS.map((day) => insertCheckin(admin, athleteId, day)));
    const structures: Record<string, unknown> = {};
    for (const [i, day] of DAYS.entries()) {
      fp[day] = randomUUID();
      item[day] = randomUUID();
      structures[day] = i === 5 ? forceStructure(item[day]!) : dhStructure(item[day]!, [DRILL_OF[i]!], i !== 3);
    }
    execLocalSql(
      DAYS.map((day) => {
        const decisionId = randomUUID();
        return `insert into public.decisions (id, athlete_id, decision_date, final_session, reason, engine_version, final_prescription_status, source_checkin_id, source_checkin_updated_at)
  select ${sqlLiteral(decisionId)}, ${sqlLiteral(athleteId)}, ${sqlLiteral(day)}, 'DH_TECHNICAL', 'test fixture', 'test', 'created', c.id, c.updated_at
    from public.daily_checkins c where c.athlete_id = ${sqlLiteral(athleteId)} and c.checkin_date = ${sqlLiteral(day)};
insert into public.decision_final_prescriptions (id, decision_id, athlete_id, active_session_origin, reconciliation_action, adaptation_rule_ids, schema_version, catalog_version, structure)
  values (${sqlLiteral(fp[day]!)}, ${sqlLiteral(decisionId)}, ${sqlLiteral(athleteId)}, 'no_canonical_plan', 'keep', '[]'::jsonb, 'v2', 'test', ${sqlLiteral(JSON.stringify(structures[day]))}::jsonb);`;
      }).join("\n")
    );
  }, 120_000);

  it("1. isolation (empty table): both RPCs refuse REPEATABLE READ, SERIALIZABLE and READ UNCOMMITTED with NX301, first, writing nothing; READ COMMITTED goes past the guard", () => {
    expect(revocationCount()).toBe("0");
    const execution = randomUUID();
    const daily = persistArgs(PERSIST_DAYS[0], dhStructure(randomUUID(), [OTHER], true));
    for (const level of ["repeatable read", "serializable", "read uncommitted"]) {
      for (const call of [rpcSql(start(execution, DAYS[8])), persistSql(daily)]) {
        expect(() => execLocalSql(`\\set VERBOSITY verbose\nbegin isolation level ${level};\n${call}\ncommit;`), level).toThrow(/NX301: dh_revocation_requires_read_committed/);
      }
    }
    expect(rows("session_executions", "id", execution)).toBe("0");
    expect(decisionsOn(PERSIST_DAYS[0])).toBe("0");
    // READ COMMITTED: past the guard, the next check answers (an invalid batch, a missing decision row).
    expect(execLocalSql(`begin isolation level read committed;\nselect public.record_session_execution(${sqlLiteral(athleteId)}::uuid, '{}'::jsonb) ->> 'code';\ncommit;`).trim().split("\n")).toEqual(["BEGIN", "invalid_payload", "COMMIT"]);
    expect(() => execLocalSql(`begin isolation level read committed;\nselect public.persist_daily_run_v2(${sqlLiteral(athleteId)}::uuid, null, null, null);\ncommit;`)).toThrow(/p_decision_row is required/);
  });

  it("2. SHARE is a table lock (empty table): an execution batch or a daily-run write in progress holds the very first revocation back; a daily-run write without a DH drill does not take it", async () => {
    expect(revocationCount()).toBe("0");
    for (const call of [rpcSql(start(randomUUID(), DAYS[8])), persistSql(persistArgs(PERSIST_DAYS[1], dhStructure(randomUUID(), [OTHER], true)))]) {
      const held = await heldSession(`begin;\n${call}`);
      expect(lockTimeout(revokeAsOperator(FIRST))).toBe("waited (lock timeout)");
      await held.finish("rollback;");
    }
    expect(decisionsOn(PERSIST_DAYS[1])).toBe("0");
    const revocation = await heldSession(`begin;\n${revokeAsOperator(FIRST)}`);
    expect(lockTimeout(persistSql(persistArgs(PERSIST_DAYS[1], forceStructure(randomUUID()))))).toBe("completed");
    expect(lockTimeout(persistSql(persistArgs(PERSIST_DAYS[2], dhStructure(randomUUID(), [OTHER], true))))).toBe("waited (lock timeout)");
    await revocation.finish("rollback;");
    expect(decisionsOn(PERSIST_DAYS[1])).toBe("1");
    expect(decisionsOn(PERSIST_DAYS[2])).toBe("0");
    expect(revocationCount()).toBe("0");
  });

  it("3. the rollback (empty table): in progress, it holds revocations back — by the service_role and by the owner — both refused once it commits (never recorded without effect); both functions restored exactly; re-applying the migration restores the guard", async () => {
    expect(revocationCount()).toBe("0");
    const uncommitted = ROLLBACK().replace(/\ncommit;\s*$/, "\n");
    expect(uncommitted).not.toBe(ROLLBACK());
    const rollback = await heldSession(uncommitted);
    const queuedOperator = background(revokeAsOperator(QUEUED));
    const queuedOwner = background(revoke(`${QUEUED}_owner`));
    await lockWaiters(2);
    expect(await rollback.finish("commit;")).not.toMatch(/ERROR/);
    const [operator, owner] = await Promise.all([queuedOperator, queuedOwner]);
    expect([operator.code, owner.code].every((c) => c !== 0)).toBe(true);
    expect(operator.out).toMatch(/permission denied for table dh_drill_revocations/);
    expect(owner.out).toMatch(/the revocation guard is rolled back/);
    expect(revocationCount()).toBe("0");
    expect(prosrc("record_session_execution(uuid, jsonb)")).toBe(migrationBody("20261018120000_power_guard_01_power_set_required.sql", "$$"));
    expect(prosrc("persist_daily_run_v2(uuid, jsonb, jsonb, jsonb)")).toBe(migrationBody("20261013180100_p0_3_manual_keep_persist_daily_run_v2.sql", "$function$"));
    expect(execLocalSql("select to_regprocedure('public.execution_dh_revocation_block(uuid)') is null;").trim()).toBe("t");

    execLocalSql(FORWARD());
    expect(prosrc("record_session_execution(uuid, jsonb)")).toContain("NX301");
    expect(prosrc("persist_daily_run_v2(uuid, jsonb, jsonb, jsonb)")).toContain("NX302");
    expect(execLocalSql("select has_table_privilege('service_role', 'public.dh_drill_revocations', 'insert'), to_regprocedure('public.execution_dh_revocation_block(uuid)') is not null;").trim()).toBe("t|t");
    // The guard back, revocations go through again (owner and service_role), here in transactions rolled back.
    for (const sql of [revoke(`${QUEUED}_owner`), revokeAsOperator(QUEUED)]) expect(execLocalSql(`begin;\n${sql}\nrollback;`)).toContain("INSERT 0 1");
    expect(revocationCount()).toBe("0");
  });

  it("4. the first revocation (empty table), being written, holds back a new execution, a daily-run write and the rollback; once it commits, all three refuse it and nothing is written", async () => {
    expect(revocationCount()).toBe("0");
    const revocation = await heldSession(`begin;\n${revokeAsOperator(FIRST)}`);
    const execution = randomUUID();
    const daily = persistArgs(PERSIST_DAYS[3], dhStructure(randomUUID(), [FIRST], true));
    const started = record(start(execution, DAYS[9]));
    const written = persist(daily);
    const rollback = background(ROLLBACK());
    await lockWaiters(3);
    await revocation.finish("commit;");
    expect(await started).toMatchObject({ status: "rejected", code: "dh_validation_not_current" });
    expect((await written).error).toMatchObject({ code: "NX302", message: "dh_validation_not_current", details: FIRST });
    const refused = await rollback;
    expect(refused.code).not.toBe(0);
    expect(refused.out).toMatch(/rollback refused: 1 DH drill revocation/);
    expect(rows("session_executions", "id", execution)).toBe("0");
    expect(decisionsOn(PERSIST_DAYS[3])).toBe("0");
    expect(revocationCount()).toBe("1");
    expect(prosrc("persist_daily_run_v2(uuid, jsonb, jsonb, jsonb)")).toContain("NX302");
  });

  it("5. a revocation already waiting when the rollback starts is served before it: the rollback's guard counts it and refuses", async () => {
    const before = Number(revocationCount());
    const execution = await heldSession(`begin;\n${rpcSql(start(randomUUID(), DAYS[8]))}`);
    const pending = background(revoke(`${QUEUED}_pending`));
    await lockWaiters(1);
    const rollback = background(ROLLBACK());
    await lockWaiters(2);
    await execution.finish("rollback;");
    expect((await pending).code).toBe(0);
    const refused = await rollback;
    expect(refused.code).not.toBe(0);
    expect(refused.out).toContain(`rollback refused: ${before + 1} DH drill revocation`);
    expect(prosrc("record_session_execution(uuid, jsonb)")).toContain("NX301");
  });

  it("additive structure, operators only: RLS without policy, no client privilege, the helper the owner's alone, append-only even for the owner; the RPCs keep their grants", () => {
    const fn = (sig: string, role: string) => `has_function_privilege('${role}', 'public.${sig}', 'execute')`;
    const table = (role: string, p: string) => `has_table_privilege('${role}', 'public.dh_drill_revocations', '${p}')`;
    const privileges = execLocalSql(
      `select concat_ws(',', (select relrowsecurity from pg_class where oid = 'public.dh_drill_revocations'::regclass),
         (select count(*) from pg_policies where tablename = 'dh_drill_revocations'),
         ${["anon", "authenticated"].flatMap((r) => ["select", "insert", "update", "delete", "truncate"].map((p) => table(r, p))).join(", ")},
         ${["select", "insert", "update", "delete", "truncate"].map((p) => table("service_role", p)).join(", ")},
         ${["anon", "authenticated", "service_role", "public"].map((r) => fn("execution_dh_revocation_block(uuid)", r)).join(", ")},
         ${fn("record_session_execution(uuid, jsonb)", "authenticated")}, ${fn("record_session_execution(uuid, jsonb)", "service_role")},
         ${fn("persist_daily_run_v2(uuid, jsonb, jsonb, jsonb)", "anon")}, ${fn("persist_daily_run_v2(uuid, jsonb, jsonb, jsonb)", "authenticated")}, ${fn("persist_daily_run_v2(uuid, jsonb, jsonb, jsonb)", "service_role")});`
    ).trim();
    expect(privileges).toBe(["t", "0", ...Array(10).fill("f"), "t", "t", "f", "f", "f", ...Array(4).fill("f"), "f", "t", "f", "f", "t"].join(","));
    // The helper: SECURITY INVOKER, executable by its owner, the owner of record_session_execution (SECURITY DEFINER),
    // which calls it as that owner (HPM 2026-10-28, least privilege, like execution_health_block).
    expect(
      execLocalSql(
        `select concat_ws(',', h.prosecdef, has_function_privilege(h.proowner, h.oid, 'execute'), h.proowner = r.proowner, r.prosecdef)
           from pg_proc h, pg_proc r
          where h.oid = 'public.execution_dh_revocation_block(uuid)'::regprocedure and r.oid = 'public.record_session_execution(uuid, jsonb)'::regprocedure;`
      ).trim()
    ).toBe("f,t,t,t");
    expect(() => execLocalSql(`update public.dh_drill_revocations set reason = 'x' where drill_id = ${sqlLiteral(FIRST)};`)).toThrow(/append/i);
    expect(() => execLocalSql(`delete from public.dh_drill_revocations where drill_id = ${sqlLiteral(FIRST)};`)).toThrow(/append/i);
  });

  it("the rider can neither forge nor read a revocation, nor call the helper; nor can the service_role key", async () => {
    const rider = await getAthleteAuthClient(athleteId);
    expect((await rider.from("dh_drill_revocations").insert({ drill_id: OTHER, reason: "forged", decided_by: "rider" })).error).not.toBeNull();
    const read = await rider.from("dh_drill_revocations").select("drill_id");
    expect(read.error !== null || (read.data ?? []).length === 0).toBe(true);
    expect((await rider.rpc("execution_dh_revocation_block", { p_final_prescription_id: fp[DAYS[2]] })).error).not.toBeNull();
    expect((await admin.rpc("execution_dh_revocation_block", { p_final_prescription_id: fp[DAYS[2]] })).error?.code).toBe("42501");
    expect(rows("dh_drill_revocations", "drill_id", OTHER)).toBe("0");
  });

  it("revoked: START / RESUME / COMPLETE / RESULT refused, PAUSE / STOP / READ / replays kept, on frozen prescriptions and through the service_role key; other drills and Force unaffected", async () => {
    const [d0, d1, d2, d3, d4, d5] = DAYS;
    const done = randomUUID();
    const running = randomUUID();
    const firstPass = pass(running, d1, 1);
    expect(await record(start(done, d0))).toMatchObject({ status: "ok" });
    expect(await record({ sets: [pass(done, d0, 1)] })).toMatchObject({ status: "ok" });
    expect(await record(event(done, d0, "completed"))).toMatchObject({ status: "ok" });
    expect(await record(start(running, d1))).toMatchObject({ status: "ok" });
    expect(await record({ sets: [firstPass] })).toMatchObject({ status: "ok" });

    execLocalSql(revoke(REVOKED));
    const refused = { status: "rejected", code: "dh_validation_not_current" };
    for (const day of [d2, d3]) {
      const id = randomUUID();
      expect(await record(start(id, day)), `start ${day}`).toMatchObject(refused);
      expect(rows("session_executions", "id", id)).toBe("0");
    }
    expect(await record({ sets: [pass(running, d1, 2)] })).toMatchObject(refused);
    expect(await record({ sets: [firstPass] })).toMatchObject({ status: "ok", unchanged: { sets: [firstPass.id] } });
    expect(await record(event(running, d1, "paused", 31))).toMatchObject({ status: "ok" });
    expect(await record(event(running, d1, "resumed", 32))).toMatchObject(refused);
    expect(await record(event(running, d1, "completed", 33))).toMatchObject(refused);
    expect(await record(event(running, d1, "abandoned", 34))).toMatchObject({ status: "ok" });
    expect(rows("exercise_set_results", "execution_id", running)).toBe("1");
    expect(rows("exercise_set_results", "execution_id", done)).toBe("1");
    const rider = await getAthleteAuthClient(athleteId);
    expect((await rider.from("session_executions").select("id").eq("id", done)).data).toEqual([{ id: done }]);
    for (const day of [d4, d5]) {
      const id = randomUUID();
      expect(await record(start(id, day)), day).toMatchObject({ status: "ok" });
      expect(await record(event(id, day, "abandoned"))).toMatchObject({ status: "ok" });
    }
  });

  it("concurrency: a revocation being written holds an execution write back, which then sees it; an execution write or a daily-run write in progress holds a revocation back until it commits", async () => {
    const [, , , , , , d6, d7] = DAYS;
    const a = await heldSession(`begin;\n${revoke("jumps_table_top_basic")}`);
    expect(lockTimeout(rpcSql(start(randomUUID(), d6!)))).toBe("waited (lock timeout)");
    await a.finish("commit;");
    const after = randomUUID();
    expect(await record(start(after, d6!))).toMatchObject({ status: "rejected", code: "dh_validation_not_current" });
    expect(rows("session_executions", "id", after)).toBe("0");

    const execution = randomUUID();
    const b = await heldSession(`begin;\n${rpcSql(start(execution, d7!))}`);
    expect(lockTimeout(revoke("steep_terrain_body_position"))).toBe("waited (lock timeout)");
    expect(await b.finish("commit;")).toContain('"status": "ok"');
    execLocalSql(revoke("steep_terrain_body_position"));
    expect(await record({ sets: [pass(execution, d7!, 1)] })).toMatchObject({ status: "rejected", code: "dh_validation_not_current" });
    expect(await record(event(execution, d7!, "abandoned"))).toMatchObject({ status: "ok" });

    // A daily-run write in progress: the revocation waits; the decision commits first.
    const c = await heldSession(`begin;\n${persistSql(persistArgs(PERSIST_DAYS[4], dhStructure(randomUUID(), [OTHER], true)))}`);
    expect(lockTimeout(revoke(OTHER))).toBe("waited (lock timeout)");
    expect(await c.finish("commit;")).toContain('"final_prescription_status": "created"');
    expect(decisionsOn(PERSIST_DAYS[4])).toBe("1");
    expect(rows("dh_drill_revocations", "drill_id", OTHER)).toBe("0");
  });

  it("why READ COMMITTED (counter-proof): under REPEATABLE READ the SHARE lock waits for a revocation but the frozen snapshot still misses it; under READ COMMITTED it is seen", async () => {
    const seen = (label: string, drill: string) => `select '${label}:' || count(*) from public.dh_drill_revocations where drill_id = ${sqlLiteral(drill)};`;
    const rr = await heldSession(`begin isolation level repeatable read;\n${seen("before", PROBE)}`);
    execLocalSql(revoke(PROBE));
    const repeatable = await rr.finish(`lock table public.dh_drill_revocations in share mode;\n${seen("after", PROBE)}\ncommit;`);
    expect([repeatable.includes("before:0"), repeatable.includes("after:0")]).toEqual([true, true]);
    const rc = await heldSession(`begin isolation level read committed;\n${seen("before", `${PROBE}_rc`)}`);
    execLocalSql(revoke(`${PROBE}_rc`));
    const committed = await rc.finish(`lock table public.dh_drill_revocations in share mode;\n${seen("after", `${PROBE}_rc`)}\ncommit;`);
    expect([committed.includes("before:0"), committed.includes("after:1")]).toEqual([true, true]);
  });

  it("daily-run write: a final prescription containing a revoked drill is refused (NX302, only the revoked ids), nothing written — no decision, no final prescription, no health flag; without one it is written", async () => {
    const flags = () => execLocalSql(`select count(*) from public.health_flags where athlete_id = ${sqlLiteral(athleteId)};`).trim();
    const flagsBefore = flags();
    const refusedArgs = persistArgs(PERSIST_DAYS[5], dhStructure(randomUUID(), [REVOKED, "flow_line_choice_basic", FIRST], true), { flag_type: "other", flag_date: PERSIST_DAYS[5], description: "TEST fixture" });
    const refused = await persist(refusedArgs);
    expect(refused.error).toMatchObject({ code: "NX302", message: "dh_validation_not_current", details: [REVOKED, FIRST].sort().join(",") });
    expect(decisionsOn(PERSIST_DAYS[5])).toBe("0");
    expect(rows("decision_final_prescriptions", "id", refusedArgs.p_final_prescription_outcome.final_prescription.id)).toBe("0");
    expect(flags()).toBe(flagsBefore);
    const served = await persist(persistArgs(PERSIST_DAYS[5], dhStructure(randomUUID(), ["flow_line_choice_basic"], true)));
    expect(served.error).toBeNull();
    expect(served.data).toMatchObject({ final_prescription_status: "created" });
    expect(decisionsOn(PERSIST_DAYS[5])).toBe("1");
  });

  it("the rollback is refused while a revocation exists: a revoked execution is never re-authorised", async () => {
    expect(() => execLocalSql(ROLLBACK())).toThrow(/rollback refused/);
    expect(prosrc("persist_daily_run_v2(uuid, jsonb, jsonb, jsonb)")).toContain("NX302");
    const id = randomUUID();
    expect(await record(start(id, DAYS[2]))).toMatchObject({ status: "rejected", code: "dh_validation_not_current" });
  });
});
