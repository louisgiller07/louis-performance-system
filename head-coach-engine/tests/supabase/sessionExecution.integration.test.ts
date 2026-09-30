/**
 * UX-11B.2.2 — integration tests for the execution schema and its only write
 * path, record_session_execution (local Supabase stack only).
 *
 * Run with the local stack up and:
 *   RUN_LOCAL_SUPABASE_INTEGRATION=1
 *   SUPABASE_SECRET_KEY / SUPABASE_PUBLISHABLE_KEY from `npx supabase status -o env`
 *
 * Fixtures: decision_final_prescriptions has no write path yet (UX-11A.5
 * will add one), so its rows are inserted as the local database owner
 * through `docker exec psql` on the local `supabase_db_*` container only.
 * Scratch athletes are left in the local database on purpose: their
 * append-only rows (final prescriptions, executions) can never be deleted —
 * the same known limitation as canonical training plans (see testDb.ts).
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createTestAthlete,
  createTestClient,
  getAthleteAuthClient,
  insertDecision,
  isLoopbackSupabaseUrl,
  resolveTestSupabaseUrl,
  type TestAthlete,
} from "./testDb.js";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
const INTEGRATION_ENABLED =
  process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" &&
  !!SERVER_KEY &&
  !!PUBLISHABLE_KEY &&
  isLoopbackSupabaseUrl(resolveTestSupabaseUrl());

const DAY = "2026-10-01";
const OTHER_DAY = "2026-10-02";

function localDbContainer(): string {
  const name = execSync('docker ps --filter "name=supabase_db_" --format "{{.Names}}"', { encoding: "utf8" }).trim().split("\n")[0];
  if (!name || !name.startsWith("supabase_db_")) throw new Error("local supabase_db_* container not found");
  return name;
}

/** Runs SQL as the local database owner. Local container only — never a remote target. */
function execLocalSql(sql: string): string {
  return execSync(`docker exec -i ${localDbContainer()} psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At -f -`, {
    input: sql,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function v2Structure(items: Array<{ id: string; exerciseId: string; measure: Record<string, unknown> }>): unknown {
  return {
    schemaVersion: "v2",
    family: "force",
    intentId: "corner_exit_power",
    blocks: [
      {
        blockId: "main",
        role: "main",
        items: items.map((item) => ({ prescriptionItemId: item.id, exerciseId: item.exerciseId, role: "principal", sets: 4, measure: item.measure })),
      },
    ],
  };
}

function insertFinalPrescription(athleteId: string, decisionId: string, schemaVersion: string, structure: unknown): string {
  const id = randomUUID();
  execLocalSql(
    `insert into public.decision_final_prescriptions
       (id, decision_id, athlete_id, active_session_origin, reconciliation_action, adaptation_rule_ids, schema_version, catalog_version, structure)
     values (${sqlLiteral(id)}, ${sqlLiteral(decisionId)}, ${sqlLiteral(athleteId)}, 'no_canonical_plan', 'keep', '[]'::jsonb,
             ${sqlLiteral(schemaVersion)}, 'test', ${sqlLiteral(JSON.stringify(structure))}::jsonb);`
  );
  return id;
}

const at = (minute: number) => `${DAY}T17:${String(minute).padStart(2, "0")}:00Z`;

type Outcome = { status: "ok"; inserted: Record<string, string[]>; unchanged: Record<string, string[]> } | { status: "rejected"; code: string; target: string };

describe.skipIf(!INTEGRATION_ENABLED)("UX-11B.2.2 — session execution schema and record_session_execution (local Supabase)", () => {
  let admin: SupabaseClient;
  let a: TestAthlete;
  let b: TestAthlete;
  let authA: SupabaseClient;
  let authB: SupabaseClient;
  let fpA: string;
  let fpV1: string;
  let fpOtherDay: string;
  let fpB: string;
  let decisionA: string;
  const itemSquat = randomUUID();
  const itemPass = randomUUID();
  const itemOfB = randomUUID();

  async function record(athleteId: string, payload: unknown): Promise<Outcome> {
    const { data, error } = await admin.rpc("record_session_execution", { p_athlete_id: athleteId, p_payload: payload });
    if (error) throw new Error(`record_session_execution raised: ${error.message}`);
    return data as Outcome;
  }

  function newExecution(finalPrescriptionId: string | null, day = DAY) {
    const id = randomUUID();
    return {
      id,
      execution: { id, session_date: day, started_at: at(0), final_prescription_id: finalPrescriptionId },
      started: { id: randomUUID(), execution_id: id, event_type: "started", occurred_at: at(0) },
      event: (event_type: string, minute: number) => ({ id: randomUUID(), execution_id: id, event_type, occurred_at: at(minute) }),
    };
  }

  function squatSet(executionId: string, set_number: number, extra: Record<string, unknown> = {}) {
    return {
      id: randomUUID(),
      execution_id: executionId,
      prescription_item_id: itemSquat,
      set_number,
      done: true,
      measure_type: "reps",
      measure_value: 8,
      load_kg: 60,
      rpe_actual: 7,
      occurred_at: at(5),
      ...extra,
    };
  }

  async function completeExecution(executionId: string) {
    const outcome = await record(a.athleteId, { events: [{ id: randomUUID(), execution_id: executionId, event_type: "completed", occurred_at: at(50) }] });
    expect(outcome.status).toBe("ok");
  }

  beforeAll(async () => {
    admin = createTestClient();
    a = await createTestAthlete(admin, "UX-11B.2.2 execution test A");
    b = await createTestAthlete(admin, "UX-11B.2.2 execution test B");
    authA = await getAthleteAuthClient(a.athleteId);
    authB = await getAthleteAuthClient(b.athleteId);

    decisionA = await insertDecision(admin, a.athleteId, DAY);
    const decisionAv1 = await insertDecision(admin, a.athleteId, DAY);
    const decisionAOtherDay = await insertDecision(admin, a.athleteId, OTHER_DAY);
    const decisionB = await insertDecision(admin, b.athleteId, DAY);

    fpA = insertFinalPrescription(
      a.athleteId,
      decisionA,
      "v2",
      v2Structure([
        { id: itemSquat, exerciseId: "goblet_squat", measure: { type: "reps", min: 6, max: 8 } },
        { id: itemPass, exerciseId: "cornering_drill", measure: { type: "passes", count: 6 } },
      ])
    );
    fpV1 = insertFinalPrescription(a.athleteId, decisionAv1, "v1", { domain: "strength", schemaVersion: "v1", blocks: [] });
    fpOtherDay = insertFinalPrescription(a.athleteId, decisionAOtherDay, "v2", v2Structure([]));
    fpB = insertFinalPrescription(b.athleteId, decisionB, "v2", v2Structure([{ id: itemOfB, exerciseId: "pushup", measure: { type: "reps", min: 8, max: 12 } }]));
  });

  it("records a new execution with its started event and a set; decision and exercise are derived by the server", async () => {
    const exec = newExecution(fpA);
    const set = squatSet(exec.id, 1);
    const outcome = await record(a.athleteId, { execution: exec.execution, events: [exec.started], sets: [set] });
    expect(outcome).toMatchObject({ status: "ok", inserted: { executions: [exec.id], events: [exec.started.id], sets: [set.id] } });

    const { data: execution } = await admin.from("session_executions").select("decision_id, final_prescription_id").eq("id", exec.id).single();
    expect(execution).toEqual({ decision_id: decisionA, final_prescription_id: fpA });
    const { data: storedSet } = await admin.from("exercise_set_results").select("exercise_id, load_kg, rpe_actual").eq("id", set.id).single();
    expect(storedSet).toEqual({ exercise_id: "goblet_squat", load_kg: 60, rpe_actual: 7 });

    // Idempotent replay: identical content → no-op.
    const replay = await record(a.athleteId, { execution: exec.execution, events: [exec.started], sets: [set] });
    expect(replay).toMatchObject({ status: "ok", inserted: { executions: [], events: [], sets: [] }, unchanged: { executions: [exec.id], events: [exec.started.id], sets: [set.id] } });

    // Same id, different content → id_conflict, and the whole batch is rolled back.
    const extraEvent = exec.event("paused", 10);
    const conflict = await record(a.athleteId, { events: [extraEvent], sets: [{ ...set, measure_value: 9 }] });
    expect(conflict).toEqual({ status: "rejected", code: "id_conflict", target: "sets[0]" });
    const { data: paused } = await admin.from("execution_events").select("id").eq("id", extraEvent.id);
    expect(paused).toEqual([]);

    // Only one active execution per athlete and day.
    const second = newExecution(fpA);
    expect(await record(a.athleteId, { execution: second.execution, events: [second.started] })).toEqual({
      status: "rejected",
      code: "active_execution_exists",
      target: "execution",
    });

    // Lifecycle: paused → resumed → paused → completed; nothing after completed.
    const lifecycle = await record(a.athleteId, {
      events: [exec.event("paused", 10), exec.event("resumed", 12), exec.event("paused", 20), exec.event("completed", 30)],
    });
    expect(lifecycle.status).toBe("ok");
    expect(await record(a.athleteId, { events: [exec.event("resumed", 40)] })).toMatchObject({ code: "invalid_transition", target: "events[0]" });
    // Same batch as the Edge Function sends it: explicit JSON nulls behave like absent keys.
    expect(await record(a.athleteId, { execution: null, events: [exec.event("resumed", 40)], sets: [] })).toMatchObject({
      code: "invalid_transition",
      target: "events[0]",
    });
    expect(await record(a.athleteId, { events: [exec.event("started", 41)] })).toMatchObject({ code: "invalid_transition" });

    // Sets stay recordable after the end of the lifecycle.
    expect((await record(a.athleteId, { sets: [squatSet(exec.id, 2)] })).status).toBe("ok");

    // Once completed, a new execution is allowed the same day; paused → completed is allowed.
    const next = newExecution(fpA);
    expect((await record(a.athleteId, { execution: next.execution, events: [next.started, next.event("paused", 5), next.event("completed", 6)] })).status).toBe("ok");
  });

  it("requires the started event with a new execution, and only accepts the athlete's own v2 prescription of that day", async () => {
    const exec = newExecution(null, "2026-10-05");
    expect(await record(a.athleteId, { execution: exec.execution, events: [] })).toMatchObject({ code: "missing_start_event" });

    const v1 = newExecution(fpV1);
    expect(await record(a.athleteId, { execution: v1.execution, events: [v1.started] })).toMatchObject({ code: "not_executable" });

    const foreign = newExecution(fpB);
    expect(await record(a.athleteId, { execution: foreign.execution, events: [foreign.started] })).toMatchObject({ code: "prescription_not_found" });

    const wrongDay = newExecution(fpOtherDay, DAY);
    expect(await record(a.athleteId, { execution: wrongDay.execution, events: [wrongDay.started] })).toMatchObject({ code: "date_mismatch" });

    const unknownExecution = { id: randomUUID(), execution_id: randomUUID(), event_type: "started", occurred_at: at(0) };
    expect(await record(a.athleteId, { events: [unknownExecution] })).toMatchObject({ code: "execution_not_found" });
  });

  it("validates each set against the day's prescription: known item, same measure, or a free 'other exercise'", async () => {
    // An execution without prescription only accepts free "other exercise" sets.
    const free = newExecution(null, "2026-10-06");
    expect((await record(a.athleteId, { execution: free.execution, events: [free.started] })).status).toBe("ok");
    expect(await record(a.athleteId, { sets: [squatSet(free.id, 1)] })).toMatchObject({ code: "invalid_item" });
    const other = { ...squatSet(free.id, 1), prescription_item_id: null, other_exercise_name: "Presse à cuisses" };
    expect((await record(a.athleteId, { sets: [other] })).status).toBe("ok");
    const { data: stored } = await admin.from("exercise_set_results").select("exercise_id, other_exercise_name").eq("id", other.id).single();
    expect(stored).toEqual({ exercise_id: null, other_exercise_name: "Presse à cuisses" });
    await completeExecution(free.id);

    const onDay = newExecution(fpA);
    expect((await record(a.athleteId, { execution: onDay.execution, events: [onDay.started] })).status).toBe("ok");
    expect(await record(a.athleteId, { sets: [{ ...squatSet(onDay.id, 1), prescription_item_id: randomUUID() }] })).toMatchObject({ code: "invalid_item" });
    expect(await record(a.athleteId, { sets: [{ ...squatSet(onDay.id, 1), prescription_item_id: itemOfB }] })).toMatchObject({ code: "invalid_item" });
    expect(await record(a.athleteId, { sets: [{ ...squatSet(onDay.id, 1), measure_type: "pass", measure_value: null }] })).toMatchObject({ code: "measure_mismatch" });
    const pass = { ...squatSet(onDay.id, 1), prescription_item_id: itemPass, measure_type: "pass", measure_value: null, load_kg: null, success: true };
    expect((await record(a.athleteId, { sets: [pass] })).status).toBe("ok");

    // Bounds and malformed values → invalid_payload, never a raised error.
    expect(await record(a.athleteId, { sets: [{ ...squatSet(onDay.id, 2), rpe_actual: 11 }] })).toMatchObject({ code: "invalid_payload", target: "sets[0]" });
    expect(await record(a.athleteId, { sets: [{ ...squatSet(onDay.id, 2), id: "not-a-uuid" }] })).toMatchObject({ code: "invalid_payload" });
    await completeExecution(onDay.id);
  });

  it("corrections: one correction per set, never a correction of a correction, always the same set", async () => {
    const exec = newExecution(fpA);
    expect((await record(a.athleteId, { execution: exec.execution, events: [exec.started] })).status).toBe("ok");
    const original = squatSet(exec.id, 1);
    const otherSet = squatSet(exec.id, 2);
    expect((await record(a.athleteId, { sets: [original, otherSet] })).status).toBe("ok");

    const correction = { ...squatSet(exec.id, 1, { measure_value: 7 }), supersedes_id: original.id };
    expect((await record(a.athleteId, { sets: [correction] })).status).toBe("ok");
    expect(await record(a.athleteId, { sets: [{ ...squatSet(exec.id, 1), supersedes_id: original.id }] })).toMatchObject({ code: "invalid_correction" });
    expect(await record(a.athleteId, { sets: [{ ...squatSet(exec.id, 1), supersedes_id: correction.id }] })).toMatchObject({ code: "invalid_correction" });
    expect(await record(a.athleteId, { sets: [{ ...squatSet(exec.id, 3), supersedes_id: otherSet.id }] })).toMatchObject({ code: "invalid_correction" });
    await completeExecution(exec.id);
  });

  it("RLS and write path: the rider reads only their own rows and can never write directly", async () => {
    const { data: ownA } = await authA.from("session_executions").select("id");
    expect((ownA ?? []).length).toBeGreaterThan(0);
    const { data: seenByB } = await authB.from("session_executions").select("id").eq("athlete_id", a.athleteId);
    expect(seenByB).toEqual([]);
    const { data: setsSeenByB } = await authB.from("exercise_set_results").select("id").eq("athlete_id", a.athleteId);
    expect(setsSeenByB).toEqual([]);

    const direct = await authA.from("session_executions").insert({ id: randomUUID(), athlete_id: a.athleteId, session_date: DAY, started_at: at(0) });
    expect(direct.error).not.toBeNull();
    const rpcAsRider = await authA.rpc("record_session_execution", { p_athlete_id: a.athleteId, p_payload: { events: [] } });
    expect(rpcAsRider.error).not.toBeNull();
    const directAsServer = await admin.from("execution_events").insert({ id: randomUUID(), execution_id: randomUUID(), athlete_id: a.athleteId, event_type: "started", occurred_at: at(0) });
    expect(directAsServer.error).not.toBeNull();
  });

  it("append-only: even the database owner can neither update nor delete a recorded row", async () => {
    const { data: row } = await admin.from("exercise_set_results").select("id").eq("athlete_id", a.athleteId).limit(1).single();
    const id = sqlLiteral(row!.id as string);
    expect(() => execLocalSql(`update public.exercise_set_results set measure_value = 1 where id = ${id};`)).toThrow(/append-only violation/);
    expect(() => execLocalSql(`delete from public.exercise_set_results where id = ${id};`)).toThrow(/append-only violation/);
    expect(() => execLocalSql(`delete from public.session_executions where athlete_id = ${sqlLiteral(a.athleteId)};`)).toThrow(/append-only violation/);
  });
});
