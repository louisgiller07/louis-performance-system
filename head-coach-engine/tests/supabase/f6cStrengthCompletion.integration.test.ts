/**
 * F-6C — Force session completion server invariant (migration 20261006120000).
 *
 * record_session_execution refuses `completed` on a Force execution without an
 * ACTIVE (not superseded), PERFORMED (`done`) set result on a prescribed
 * exercise of a work block (`main` / `complementary`): `strength_set_required`.
 * A partial session stays a legitimate completion. Ownership, lifecycle,
 * idempotence and concurrency are the function's existing rules, asserted here
 * for Force. The Edge part checks the 422 through the local runtime.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, getAthleteAuthClient, insertCheckin, resolveTestSupabaseUrl } from "./testDb.js";
import { assertLocalDbReady, execLocalSql, localIntegrationRequested, sqlLiteral } from "./localDb.js";

const INTEGRATION_ENABLED = localIntegrationRequested({ requirePublishableKey: true });

type Outcome = { status: "ok"; inserted: Record<string, string[]>; unchanged: Record<string, string[]> } | { status: "rejected"; code: string; target: string };

const WARM_UP_ITEM = randomUUID();
const SQUAT = randomUUID();
const LUNGE = randomUUID();
const PLANK = randomUUID();
const FORCE = {
  schemaVersion: "v2",
  family: "strength",
  sessionKind: "STRENGTH_LOWER",
  blocks: [
    { blockId: "warm_up", role: "warm_up", items: [{ kind: "exercise", prescriptionItemId: WARM_UP_ITEM, exerciseId: "bodyweight_squat", sets: 1, measure: { type: "reps", min: 10, max: 10, perSide: false } }] },
    {
      blockId: "main",
      role: "main",
      items: [
        { kind: "exercise", prescriptionItemId: SQUAT, exerciseId: "goblet_squat", sets: 4, measure: { type: "reps", min: 6, max: 8, perSide: false } },
        { kind: "exercise", prescriptionItemId: LUNGE, exerciseId: "reverse_lunge", sets: 3, measure: { type: "reps", min: 8, max: 10, perSide: true } },
      ],
    },
    { blockId: "complementary", role: "complementary", items: [{ kind: "exercise", prescriptionItemId: PLANK, exerciseId: "plank", sets: 2, measure: { type: "duration", min: 30, max: 45, perSide: false } }] },
  ],
};

describe.skipIf(!INTEGRATION_ENABLED)("F-6C — a Force session is completed only with an active performed work set", () => {
  let admin: SupabaseClient;
  let athleteId: string;
  let otherAthleteId: string;
  let dayIndex = 0;

  async function record(payload: unknown, athlete = athleteId): Promise<Outcome> {
    const { data, error } = await admin.rpc("record_session_execution", { p_athlete_id: athlete, p_payload: payload });
    if (error) throw new Error(`record_session_execution raised: ${error.message}`);
    return data as Outcome;
  }

  /** A fresh day with its own check-in, current decision and Force final prescription. */
  async function freshDay(athlete = athleteId): Promise<{ day: string; fpId: string; decisionId: string }> {
    dayIndex += 1;
    const day = new Date(Date.UTC(2027, 2, dayIndex)).toISOString().slice(0, 10); // 2027-03-01, 2027-03-02, …
    await insertCheckin(admin, athlete, day);
    const decisionId = randomUUID();
    const fpId = randomUUID();
    execLocalSql(`insert into public.decisions (id, athlete_id, decision_date, final_session, reason, engine_version, final_prescription_status, source_checkin_id, source_checkin_updated_at)
  select ${sqlLiteral(decisionId)}, ${sqlLiteral(athlete)}, ${sqlLiteral(day)}, 'STRENGTH_A', 'test fixture', 'test', 'created', c.id, c.updated_at
    from public.daily_checkins c where c.athlete_id = ${sqlLiteral(athlete)} and c.checkin_date = ${sqlLiteral(day)};
insert into public.decision_final_prescriptions (id, decision_id, athlete_id, active_session_origin, reconciliation_action, adaptation_rule_ids, schema_version, catalog_version, structure)
  values (${sqlLiteral(fpId)}, ${sqlLiteral(decisionId)}, ${sqlLiteral(athlete)}, 'no_canonical_plan', 'keep', '[]'::jsonb, 'v2', 'test', ${sqlLiteral(JSON.stringify(FORCE))}::jsonb);`);
    return { day, fpId, decisionId };
  }

  const at = (day: string, minute: number) => `${day}T17:${String(minute).padStart(2, "0")}:00Z`;

  function execution(day: string, fpId: string) {
    const id = randomUUID();
    return {
      id,
      startBatch: { execution: { id, session_date: day, started_at: at(day, 0), final_prescription_id: fpId }, events: [{ id: randomUUID(), execution_id: id, event_type: "started", occurred_at: at(day, 0) }] },
      event: (event_type: string, minute = 50) => ({ id: randomUUID(), execution_id: id, event_type, occurred_at: at(day, minute) }),
      set: (item: string, set_number: number, extra: Record<string, unknown> = {}) => ({
        id: randomUUID(),
        execution_id: id,
        prescription_item_id: item,
        set_number,
        done: true,
        measure_type: item === PLANK ? "duration" : "reps",
        measure_value: item === PLANK ? 40 : 8,
        occurred_at: at(day, 10 + set_number),
        ...extra,
      }),
    };
  }

  async function started(athlete = athleteId) {
    const d = await freshDay(athlete);
    const e = execution(d.day, d.fpId);
    expect(await record(e.startBatch, athlete)).toMatchObject({ status: "ok" });
    return { ...d, ...e };
  }

  async function eventsOf(executionId: string): Promise<string[]> {
    const { data } = await admin.from("execution_events").select("event_type, event_seq").eq("execution_id", executionId).order("event_seq");
    return (data ?? []).map((row) => row.event_type as string);
  }

  const REQUIRED = { status: "rejected", code: "strength_set_required", target: "execution" };

  beforeAll(async () => {
    assertLocalDbReady();
    admin = createTestClient();
    athleteId = (await createTestAthlete(admin, "F-6C force completion")).athleteId;
    otherAthleteId = (await createTestAthlete(admin, "F-6C other athlete")).athleteId;
  }, 60_000);

  it("A — one performed work set (main or complementary), recorded before or in the same batch → completed; a partial session is legitimate", async () => {
    const a = await started();
    expect(await record({ sets: [a.set(SQUAT, 1)] })).toMatchObject({ status: "ok" });
    expect(await record({ events: [a.event("completed")] })).toMatchObject({ status: "ok" });
    expect(await eventsOf(a.id)).toEqual(["started", "completed"]);

    const b = await started();
    const completed = b.event("completed");
    expect(await record({ sets: [b.set(PLANK, 1)], events: [completed] })).toMatchObject({ status: "ok", inserted: { events: [completed.id] } });
  });

  it("B — zero work result → strength_set_required, nothing written, the execution stays open; not-done, warm-up-only or 'other exercise' results do not count", async () => {
    const e = await started();
    expect(await record({ events: [e.event("completed")] })).toEqual(REQUIRED);
    expect(await eventsOf(e.id)).toEqual(["started"]);

    // Only a not-done set, a warm-up set and an other exercise: still no work done.
    const notDone = e.set(SQUAT, 1, { done: false, measure_value: null });
    const warmUp = e.set(WARM_UP_ITEM, 1);
    const other = { ...e.set(SQUAT, 1), prescription_item_id: null, other_exercise_name: "Tractions" };
    expect(await record({ sets: [notDone, warmUp, other] })).toMatchObject({ status: "ok" });
    expect(await record({ events: [e.event("completed")] })).toEqual(REQUIRED);
    // A rejected batch writes nothing: the set sent with the refused completion is not stored either.
    const rejectedSet = e.set(SQUAT, 2, { done: false, measure_value: null });
    expect(await record({ sets: [rejectedSet], events: [e.event("completed")] })).toEqual(REQUIRED);
    const { data: stored } = await admin.from("exercise_set_results").select("id").eq("id", rejectedSet.id);
    expect(stored).toEqual([]);
    expect(await eventsOf(e.id)).toEqual(["started"]);
  });

  it("C — only the ACTIVE result counts: done corrected to not-done → refused; not-done corrected to done → completed; a correction never counts twice", async () => {
    const e = await started();
    const original = e.set(SQUAT, 1);
    expect(await record({ sets: [original] })).toMatchObject({ status: "ok" });
    expect(await record({ sets: [e.set(SQUAT, 1, { done: false, measure_value: null, supersedes_id: original.id })] })).toMatchObject({ status: "ok" });
    expect(await record({ events: [e.event("completed")] })).toEqual(REQUIRED);

    const notDone = e.set(LUNGE, 1, { done: false, measure_value: null });
    expect(await record({ sets: [notDone] })).toMatchObject({ status: "ok" });
    expect(await record({ sets: [e.set(LUNGE, 1, { supersedes_id: notDone.id })], events: [e.event("completed")] })).toMatchObject({ status: "ok" });
    const { data: rows } = await admin.from("exercise_set_results").select("id, supersedes_id, done").eq("execution_id", e.id);
    const superseded = new Set(rows!.map((r) => r.supersedes_id).filter(Boolean));
    expect(rows!.filter((r) => !superseded.has(r.id) && r.done)).toHaveLength(1); // one performed set, not two
  });

  it("D — after abandon: completed refused (invalid_transition), results frozen; a restart is a new execution with its own rule", async () => {
    const e = await started();
    expect(await record({ sets: [e.set(SQUAT, 1)] })).toMatchObject({ status: "ok" });
    expect(await record({ events: [e.event("abandoned", 30)] })).toMatchObject({ status: "ok" });
    expect(await record({ events: [e.event("completed")] })).toMatchObject({ status: "rejected", code: "invalid_transition" });
    expect(await record({ sets: [e.set(SQUAT, 2)] })).toMatchObject({ status: "rejected", code: "execution_terminal" });
    expect(await eventsOf(e.id)).toEqual(["started", "abandoned"]);

    const restart = execution(e.day, e.fpId);
    expect(await record(restart.startBatch)).toMatchObject({ status: "ok" });
    expect(await record({ events: [restart.event("completed")] })).toEqual(REQUIRED); // the abandoned attempt's set never counts
    expect(await record({ sets: [restart.set(SQUAT, 1)], events: [restart.event("completed")] })).toMatchObject({ status: "ok" });
  });

  it("E — the same completed batch replayed → unchanged, no duplicate; another completed event → invalid_transition", async () => {
    const e = await started();
    const set = e.set(SQUAT, 1);
    const completed = e.event("completed");
    expect(await record({ sets: [set], events: [completed] })).toMatchObject({ status: "ok", inserted: { sets: [set.id], events: [completed.id] } });
    expect(await record({ sets: [set], events: [completed] })).toMatchObject({ status: "ok", unchanged: { sets: [set.id], events: [completed.id] } });
    expect(await record({ events: [e.event("completed", 55)] })).toMatchObject({ status: "rejected", code: "invalid_transition" });
    expect(await eventsOf(e.id)).toEqual(["started", "completed"]);
  });

  it("F — two concurrent completions (different event ids) → exactly one completed event, the other refused", async () => {
    for (let round = 0; round < 3; round += 1) {
      const e = await started();
      expect(await record({ sets: [e.set(SQUAT, 1)] })).toMatchObject({ status: "ok" });
      const outcomes = await Promise.all([record({ events: [e.event("completed", 50)] }), record({ events: [e.event("completed", 51)] })]);
      expect(outcomes.filter((o) => o.status === "ok")).toHaveLength(1);
      expect(outcomes.filter((o) => o.status === "rejected").map((o) => (o as { code: string }).code)).toEqual(["invalid_transition"]);
      expect(await eventsOf(e.id)).toEqual(["started", "completed"]);
    }
  });

  it("G — another athlete can neither complete nor add a result to this execution", async () => {
    const e = await started();
    expect(await record({ sets: [e.set(SQUAT, 1)], events: [e.event("completed")] }, otherAthleteId)).toMatchObject({ status: "rejected", code: "execution_not_found" });
    expect(await record({ events: [e.event("completed")] }, otherAthleteId)).toMatchObject({ status: "rejected", code: "execution_not_found" });
    // Nor start an execution on this athlete's prescription.
    const theirs = execution(e.day, e.fpId);
    expect(await record(theirs.startBatch, otherAthleteId)).toMatchObject({ status: "rejected", code: "prescription_not_found" });
    expect(await eventsOf(e.id)).toEqual(["started"]);
  });

  it("H — decision superseded after the start: the started execution is never interrupted (F-6C still applies); a new start on the old prescription → final_prescription_not_current", async () => {
    const e = await started();
    // A new daily decision for the same day (append-only) supersedes the one the execution started on.
    const newDecision = randomUUID();
    execLocalSql(`insert into public.decisions (id, athlete_id, decision_date, final_session, reason, engine_version, final_prescription_status, source_checkin_id, source_checkin_updated_at, created_at)
  select ${sqlLiteral(newDecision)}, ${sqlLiteral(athleteId)}, ${sqlLiteral(e.day)}, 'REST', 'test fixture', 'test', 'not_required', c.id, c.updated_at, clock_timestamp() + interval '1 second'
    from public.daily_checkins c where c.athlete_id = ${sqlLiteral(athleteId)} and c.checkin_date = ${sqlLiteral(e.day)};`);
    expect(await record({ events: [e.event("completed")] })).toEqual(REQUIRED);
    expect(await record({ sets: [e.set(SQUAT, 1)], events: [e.event("completed")] })).toMatchObject({ status: "ok" });

    const d = await freshDay();
    execLocalSql(`insert into public.decisions (id, athlete_id, decision_date, final_session, reason, engine_version, final_prescription_status, source_checkin_id, source_checkin_updated_at, created_at)
  select ${sqlLiteral(randomUUID())}, ${sqlLiteral(athleteId)}, ${sqlLiteral(d.day)}, 'REST', 'test fixture', 'test', 'not_required', c.id, c.updated_at, clock_timestamp() + interval '1 second'
    from public.daily_checkins c where c.athlete_id = ${sqlLiteral(athleteId)} and c.checkin_date = ${sqlLiteral(d.day)};`);
    expect(await record(execution(d.day, d.fpId).startBatch)).toMatchObject({ status: "rejected", code: "final_prescription_not_current" });
  });

  it("F-6B unchanged: after a Force completion, no new execution that day", async () => {
    const e = await started();
    expect(await record({ sets: [e.set(SQUAT, 1)], events: [e.event("completed")] })).toMatchObject({ status: "ok" });
    expect(await record(execution(e.day, e.fpId).startBatch)).toMatchObject({ status: "rejected", code: "session_already_completed" });
  });

  describe("Edge session-execution (local runtime)", () => {
    async function invoke(client: SupabaseClient, body: Record<string, unknown>): Promise<{ status: number; code?: string }> {
      const { error } = await client.functions.invoke("session-execution", { body, method: "POST" });
      if (!error) return { status: 200 };
      if (error instanceof FunctionsHttpError) {
        const response = error.context as Response;
        const json = (await response.json()) as { error?: { code?: string } };
        return { status: response.status, ...(json.error?.code ? { code: json.error.code } : {}) };
      }
      throw error;
    }

    it("a Force completion without a work set → 422 strength_set_required; with one → 200; another rider's call → refused", async () => {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const res = await fetch(`${resolveTestSupabaseUrl()}/functions/v1/session-execution`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => null);
        if (res && ![502, 503, 504].includes(res.status)) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      const rider = await getAthleteAuthClient(athleteId);
      const intruder = await getAthleteAuthClient(otherAthleteId);
      const d = await freshDay();
      const e = execution(d.day, d.fpId);
      expect(await invoke(rider, e.startBatch)).toEqual({ status: 200 });
      expect(await invoke(rider, { events: [e.event("completed")] })).toEqual({ status: 422, code: "strength_set_required" });
      expect((await invoke(intruder, { sets: [e.set(SQUAT, 1)], events: [e.event("completed")] })).code).toBe("execution_not_found");
      expect(await invoke(rider, { sets: [{ ...e.set(SQUAT, 1), supersedes_id: null }], events: [e.event("completed")] })).toEqual({ status: 200 });
      expect(await eventsOf(e.id)).toEqual(["started", "completed"]);
    });
  });
});
