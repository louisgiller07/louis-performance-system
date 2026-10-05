/**
 * UX-11B.2.2 — integration tests for the execution schema and its only write
 * path, record_session_execution (local Supabase stack only).
 *
 * Run with the local stack up and:
 *   RUN_LOCAL_SUPABASE_INTEGRATION=1
 *   SUPABASE_SECRET_KEY / SUPABASE_PUBLISHABLE_KEY from `npx supabase status -o env`
 *
 * Fixtures: these tests use hand-made v2 structures that no planner can
 * produce, so their decisions and final prescriptions are inserted as the
 * local database owner through `docker exec psql` on the local
 * `supabase_db_*` container only. UX-11A.5c.2: a fixture decision is written
 * as the V2 contract writes it (final_prescription_status 'created', computed
 * from the day's check-in) so that its final prescription is the current,
 * executable one; the V2 write path itself is covered by
 * v2DailyPersistence.integration.test.ts.
 * UX-11B.2.4c — setup fails loudly: integration requested but unusable, local
 * Postgres not answering, or any fixture statement failing makes the file
 * FAIL (never a skip). Fixture SQL runs as one batched statement through the
 * shared helpers in localDb.ts (one container lookup, one docker exec).
 * Scratch athletes are left in the local database on purpose: their
 * append-only rows (final prescriptions, executions) can never be deleted —
 * the same known limitation as canonical training plans (see testDb.ts).
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createTestAthlete,
  createTestClient,
  getAthleteAuthClient,
  insertCheckin,
  type TestAthlete,
} from "./testDb.js";
import { assertLocalDbReady, execLocalSql, localIntegrationRequested, sqlLiteral } from "./localDb.js";

// Skipped only when integration is NOT requested; requested but unusable -> throws (the file fails).
const INTEGRATION_ENABLED = localIntegrationRequested({ requirePublishableKey: true });

const DAY = "2026-10-01";
const OTHER_DAY = "2026-10-02";
const V1_DAY = "2026-10-03";
// UX-11R.9 — one main session per athlete and day: tests that start another
// normal execution after a completed one use a day of their own.
const SETS_DAY = "2026-10-12";
const CORRECTIONS_DAY = "2026-10-13";

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

/**
 * UX-11A.5c.2 fixture: a decision as the V2 contract writes it (status
 * 'created', computed from the day's check-in, so current until superseded)
 * with its final prescription. The day's check-in must already exist.
 */
interface FixtureDecision {
  decisionId: string;
  finalPrescriptionId: string;
  athleteId: string;
  day: string;
  schemaVersion: string;
  structure: unknown;
}

function fixtureDecision(athleteId: string, day: string, schemaVersion: string, structure: unknown): FixtureDecision {
  return { decisionId: randomUUID(), finalPrescriptionId: randomUUID(), athleteId, day, schemaVersion, structure };
}

/** Writes every fixture in ONE owner-level statement batch; throws (setup fails) unless every decision was written. */
function insertFixtureDecisions(fixtures: readonly FixtureDecision[]): void {
  const sql = fixtures
    .map(
      (f) => `insert into public.decisions (id, athlete_id, decision_date, final_session, reason, engine_version, final_prescription_status, source_checkin_id, source_checkin_updated_at)
  select ${sqlLiteral(f.decisionId)}, ${sqlLiteral(f.athleteId)}, ${sqlLiteral(f.day)}, 'STRENGTH_A', 'test fixture', 'test', 'created', c.id, c.updated_at
    from public.daily_checkins c where c.athlete_id = ${sqlLiteral(f.athleteId)} and c.checkin_date = ${sqlLiteral(f.day)}
  returning id;
insert into public.decision_final_prescriptions
  (id, decision_id, athlete_id, active_session_origin, reconciliation_action, adaptation_rule_ids, schema_version, catalog_version, structure)
  values (${sqlLiteral(f.finalPrescriptionId)}, ${sqlLiteral(f.decisionId)}, ${sqlLiteral(f.athleteId)}, 'no_canonical_plan', 'keep', '[]'::jsonb,
          ${sqlLiteral(f.schemaVersion)}, 'test', ${sqlLiteral(JSON.stringify(f.structure))}::jsonb);`
    )
    .join("\n");
  const out = execLocalSql(sql);
  const missing = fixtures.filter((f) => !out.includes(f.decisionId));
  if (missing.length > 0) throw new Error(`fixture decisions not written (no check-in for ${missing.map((f) => f.day).join(", ")})`);
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
  let fpSets: string;
  let fpCorrections: string;
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

  // Real setup work (two users, check-ins, one SQL batch): an explicit budget
  // instead of the 10 s default, which the old one-docker-call-per-statement
  // setup could exceed under full-suite load. A failure still fails the file.
  beforeAll(async () => {
    assertLocalDbReady();
    admin = createTestClient();
    a = await createTestAthlete(admin, "UX-11B.2.2 execution test A");
    b = await createTestAthlete(admin, "UX-11B.2.2 execution test B");
    authA = await getAthleteAuthClient(a.athleteId);
    authB = await getAthleteAuthClient(b.athleteId);

    await Promise.all([
      insertCheckin(admin, a.athleteId, DAY),
      insertCheckin(admin, a.athleteId, V1_DAY),
      insertCheckin(admin, a.athleteId, OTHER_DAY),
      insertCheckin(admin, a.athleteId, SETS_DAY),
      insertCheckin(admin, a.athleteId, CORRECTIONS_DAY),
      insertCheckin(admin, b.athleteId, DAY),
    ]);
    const onDayA = fixtureDecision(
      a.athleteId,
      DAY,
      "v2",
      v2Structure([
        { id: itemSquat, exerciseId: "goblet_squat", measure: { type: "reps", min: 6, max: 8 } },
        { id: itemPass, exerciseId: "cornering_drill", measure: { type: "pass", count: 6 } },
      ])
    );
    // Its own day: a later decision on DAY would supersede decisionA (UX-11A.5c.2).
    const dayItems = [
      { id: itemSquat, exerciseId: "goblet_squat", measure: { type: "reps", min: 6, max: 8 } },
      { id: itemPass, exerciseId: "cornering_drill", measure: { type: "pass", count: 6 } },
    ];
    const setsDay = fixtureDecision(a.athleteId, SETS_DAY, "v2", v2Structure(dayItems));
    const correctionsDay = fixtureDecision(a.athleteId, CORRECTIONS_DAY, "v2", v2Structure(dayItems));
    const v1 = fixtureDecision(a.athleteId, V1_DAY, "v1", { domain: "strength", schemaVersion: "v1", blocks: [] });
    const otherDay = fixtureDecision(a.athleteId, OTHER_DAY, "v2", v2Structure([]));
    const ofB = fixtureDecision(b.athleteId, DAY, "v2", v2Structure([{ id: itemOfB, exerciseId: "pushup", measure: { type: "reps", min: 8, max: 12 } }]));
    insertFixtureDecisions([onDayA, setsDay, correctionsDay, v1, otherDay, ofB]);
    decisionA = onDayA.decisionId;
    fpA = onDayA.finalPrescriptionId;
    fpV1 = v1.finalPrescriptionId;
    fpOtherDay = otherDay.finalPrescriptionId;
    fpSets = setsDay.finalPrescriptionId;
    fpCorrections = correctionsDay.finalPrescriptionId;
    fpB = ofB.finalPrescriptionId;
  }, 60_000);

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

    // UX-11B.2.6 — once terminal, the execution's results are frozen.
    expect(await record(a.athleteId, { sets: [squatSet(exec.id, 2)] })).toMatchObject({ status: "rejected", code: "execution_terminal" });

    // UX-11R.9 (F-6B) — once completed, the day takes no new normal execution (one main session per day); nothing is written.
    const next = newExecution(fpA);
    expect(await record(a.athleteId, { execution: next.execution, events: [next.started, next.event("paused", 5), next.event("completed", 6)] })).toEqual({
      status: "rejected",
      code: "session_already_completed",
      target: "execution",
    });
    const { data: refused } = await admin.from("session_executions").select("id").eq("id", next.id);
    expect(refused).toEqual([]);
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

    const onDay = newExecution(fpSets, SETS_DAY);
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
    const exec = newExecution(fpCorrections, CORRECTIONS_DAY);
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

  // UX-11B.2.3 — single 'pass' vocabulary and fail-closed measure check.
  it("UX-11B.2.3 — prescribed measure types are exactly reps / duration / distance / pass; anything else is rejected, never unchecked", async () => {
    const PASS_DAY = "2026-10-07";
    await insertCheckin(admin, a.athleteId, PASS_DAY);
    const ids = {
      pass: randomUUID(),
      passes: randomUUID(),
      unknown: randomUUID(),
      missing: randomUUID(),
      reps: randomUUID(),
      duration: randomUUID(),
      distance: randomUUID(),
    };
    const structure = {
      schemaVersion: "v2",
      family: "strength",
      intentId: "lower_body_strength_control",
      blocks: [
        {
          blockId: "main",
          role: "main",
          items: [
            // UX-11A.5b.2.1 — canonical drill item: drillId only, never an exerciseId alias.
            { prescriptionItemId: ids.pass, kind: "drill", drillId: "cornering_flat_turn_precision", measure: { type: "pass", count: 6 } },
            { prescriptionItemId: ids.passes, kind: "drill", drillId: "cornering_flat_turn_precision", measure: { type: "passes", count: 6 } },
            { prescriptionItemId: ids.unknown, kind: "exercise", exerciseId: "goblet_squat", sets: 3, measure: { type: "unknown" } },
            { prescriptionItemId: ids.missing, kind: "exercise", exerciseId: "goblet_squat", sets: 3 },
            { prescriptionItemId: ids.reps, kind: "exercise", exerciseId: "goblet_squat", sets: 3, measure: { type: "reps", min: 6, max: 8 } },
            { prescriptionItemId: ids.duration, kind: "exercise", exerciseId: "plank", sets: 2, measure: { type: "duration", minSeconds: 30, maxSeconds: 45 } },
            { prescriptionItemId: ids.distance, kind: "exercise", exerciseId: "farmer_carry", sets: 2, measure: { type: "distance", minMeters: 20, maxMeters: 30 } },
          ],
        },
      ],
    };
    const passFixture = fixtureDecision(a.athleteId, PASS_DAY, "v2", structure);
    insertFixtureDecisions([passFixture]);
    const fp = passFixture.finalPrescriptionId;
    const exec = newExecution(fp, PASS_DAY);
    expect((await record(a.athleteId, { execution: exec.execution, events: [exec.started] })).status).toBe("ok");

    const set = (item: string, measure_type: string, measure_value: number | null, set_number = 1) => ({
      id: randomUUID(),
      execution_id: exec.id,
      prescription_item_id: item,
      set_number,
      done: true,
      measure_type,
      measure_value,
      occurred_at: `${PASS_DAY}T17:05:00Z`,
    });

    // pass + pass → accepted; pass + reps → measure_mismatch.
    const passSet = set(ids.pass, "pass", null);
    expect((await record(a.athleteId, { sets: [passSet] })).status).toBe("ok");
    expect(await record(a.athleteId, { sets: [set(ids.pass, "reps", 8, 2)] })).toMatchObject({ status: "rejected", code: "measure_mismatch", target: "sets[0]" });

    // 'passes', an unknown type or a missing measure on the prescribed item → explicit rejection, whatever the set says.
    for (const item of [ids.passes, ids.unknown, ids.missing]) {
      for (const [type, value] of [["pass", null], ["reps", 8]] as const) {
        expect(await record(a.athleteId, { sets: [set(item, type, value)] })).toMatchObject({ status: "rejected", code: "invalid_prescribed_measure", target: "sets[0]" });
      }
    }

    // reps / duration / distance behave as before: same type accepted, another type rejected.
    expect((await record(a.athleteId, { sets: [set(ids.reps, "reps", 8)] })).status).toBe("ok");
    expect(await record(a.athleteId, { sets: [set(ids.reps, "duration", 30, 2)] })).toMatchObject({ code: "measure_mismatch" });
    expect((await record(a.athleteId, { sets: [set(ids.duration, "duration", 40)] })).status).toBe("ok");
    expect(await record(a.athleteId, { sets: [set(ids.duration, "reps", 8, 2)] })).toMatchObject({ code: "measure_mismatch" });
    expect((await record(a.athleteId, { sets: [set(ids.distance, "distance", 25)] })).status).toBe("ok");
    expect(await record(a.athleteId, { sets: [set(ids.distance, "duration", 30, 2)] })).toMatchObject({ code: "measure_mismatch" });

    // A canonical drill item (drillId, no exerciseId) records its pass with exercise_id = null:
    // the drill is never written into exercise_id (UX-11A.5b.2.1).
    const { data: stored } = await admin.from("exercise_set_results").select("exercise_id, measure_type").eq("id", passSet.id).single();
    expect(stored).toEqual({ exercise_id: null, measure_type: "pass" });
    await completeExecution(exec.id);
  });
});
