/**
 * UX-11B.2.6 — execution result integrity (local Supabase stack only):
 * 1. an execution that was terminal (completed / abandoned) BEFORE a batch
 *    takes no new set or activity result (corrections included);
 *    results sent in the SAME batch as the terminal event are accepted;
 * 2. a result ordinal is bounded by the prescription (exercise: sets;
 *    drill pass: measure.count);
 * 3. one ORIGINAL result per (execution, prescription item, ordinal).
 *
 * Fixtures: hand-made v2 final prescriptions written as the local database
 * owner (same practice as sessionExecution.integration.test.ts). Scratch
 * athletes stay in the local database (append-only rows).
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, insertCheckin } from "./testDb.js";
import { assertLocalDbReady, execLocalSql, localIntegrationRequested, sqlLiteral } from "./localDb.js";

const INTEGRATION_ENABLED = localIntegrationRequested();

// One day (one current decision) per test: a failing test never leaves an open execution behind for the next one.
const FORCE_DAYS = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"] as const;
const ENDURANCE_DAYS = ["2026-11-07", "2026-11-08"] as const;
const FORCE_DAY = FORCE_DAYS[0];
const ENDURANCE_DAY = ENDURANCE_DAYS[0];

type Outcome = { status: "ok"; inserted: Record<string, string[]>; unchanged: Record<string, string[]> } | { status: "rejected"; code: string; target: string };

describe.skipIf(!INTEGRATION_ENABLED)("UX-11B.2.6 — execution result integrity (record_session_execution)", () => {
  let admin: SupabaseClient;
  let athleteId: string;
  const fpOf = new Map<string, string>();
  const itemSquat = randomUUID(); // exercise, sets = 3
  const itemDrill = randomUUID(); // drill, pass count = 4

  async function record(payload: unknown): Promise<Outcome> {
    const { data, error } = await admin.rpc("record_session_execution", { p_athlete_id: athleteId, p_payload: payload });
    if (error) throw new Error(`record_session_execution raised: ${error.message}`);
    return data as Outcome;
  }
  const at = (day: string, minute: number) => `${day}T17:${String(minute).padStart(2, "0")}:00Z`;
  function newExecution(fp: string, day: string) {
    const id = randomUUID();
    return {
      id,
      batch: { execution: { id, session_date: day, started_at: at(day, 0), final_prescription_id: fp }, events: [{ id: randomUUID(), execution_id: id, event_type: "started", occurred_at: at(day, 0) }] },
      event: (event_type: string, minute = 50) => ({ id: randomUUID(), execution_id: id, event_type, occurred_at: at(day, minute) }),
    };
  }
  const squat = (executionId: string, set_number: number, extra: Record<string, unknown> = {}) => ({
    id: randomUUID(),
    execution_id: executionId,
    prescription_item_id: itemSquat,
    set_number,
    done: true,
    measure_type: "reps",
    measure_value: 8,
    occurred_at: at(FORCE_DAY, 10),
    ...extra,
  });
  const pass = (executionId: string, set_number: number, extra: Record<string, unknown> = {}) => ({
    id: randomUUID(),
    execution_id: executionId,
    prescription_item_id: itemDrill,
    set_number,
    done: true,
    measure_type: "pass",
    measure_value: null,
    success: true,
    occurred_at: at(FORCE_DAY, 12),
    ...extra,
  });
  const activity = (executionId: string, extra: Record<string, unknown> = {}) => ({
    id: randomUUID(),
    execution_id: executionId,
    activity_id: "road_bike",
    duration_seconds: 3600,
    occurred_at: at(ENDURANCE_DAY, 40),
    ...extra,
  });
  async function started(day: string) {
    const e = newExecution(fpOf.get(day)!, day);
    expect(await record(e.batch)).toMatchObject({ status: "ok" });
    return e;
  }

  beforeAll(async () => {
    assertLocalDbReady();
    admin = createTestClient();
    athleteId = (await createTestAthlete(admin, "UX-11B.2.6 result integrity")).athleteId;
    await Promise.all([...FORCE_DAYS, ...ENDURANCE_DAYS].map((day) => insertCheckin(admin, athleteId, day)));
    const force = {
      schemaVersion: "v2",
      family: "strength",
      sessionKind: "STRENGTH_LOWER",
      blocks: [
        { blockId: "main", role: "main", items: [{ kind: "exercise", prescriptionItemId: itemSquat, exerciseId: "goblet_squat", sets: 3, measure: { type: "reps", min: 6, max: 8, perSide: false } }] },
        { blockId: "drill", role: "main", items: [{ kind: "drill", prescriptionItemId: itemDrill, drillId: "cornering_berm_speed", measure: { type: "pass", count: 4 } }] },
      ],
    };
    const endurance = { schemaVersion: "v2", family: "endurance", activitySelection: { mode: "restricted", activityIds: ["road_bike"] }, blocks: [] };
    const fixture = (fp: string, day: string, finalSession: string, structure: unknown) => {
      const decisionId = randomUUID();
      return `insert into public.decisions (id, athlete_id, decision_date, final_session, reason, engine_version, final_prescription_status, source_checkin_id, source_checkin_updated_at)
  select ${sqlLiteral(decisionId)}, ${sqlLiteral(athleteId)}, ${sqlLiteral(day)}, '${finalSession}', 'test fixture', 'test', 'created', c.id, c.updated_at
    from public.daily_checkins c where c.athlete_id = ${sqlLiteral(athleteId)} and c.checkin_date = ${sqlLiteral(day)};
insert into public.decision_final_prescriptions (id, decision_id, athlete_id, active_session_origin, reconciliation_action, adaptation_rule_ids, schema_version, catalog_version, structure)
  values (${sqlLiteral(fp)}, ${sqlLiteral(decisionId)}, ${sqlLiteral(athleteId)}, 'no_canonical_plan', 'keep', '[]'::jsonb, 'v2', 'test', ${sqlLiteral(JSON.stringify(structure))}::jsonb);`;
    };
    for (const day of [...FORCE_DAYS, ...ENDURANCE_DAYS]) fpOf.set(day, randomUUID());
    execLocalSql(
      [...FORCE_DAYS.map((day) => fixture(fpOf.get(day)!, day, "STRENGTH_A", force)), ...ENDURANCE_DAYS.map((day) => fixture(fpOf.get(day)!, day, "AEROBIC_BASE", endurance))].join("\n")
    );
  }, 60_000);

  describe("result ordinals are bounded by the prescription", () => {
    it("exercise: 1..sets accepted; 0 is a structural payload error; sets + 1 → result_slot_out_of_range", async () => {
      const e = await started(FORCE_DAYS[0]);
      expect(await record({ sets: [squat(e.id, 1), squat(e.id, 2), squat(e.id, 3)] })).toMatchObject({ status: "ok" });
      expect(await record({ sets: [squat(e.id, 0)] })).toMatchObject({ status: "rejected", code: "invalid_payload", target: "sets[0]" });
      expect(await record({ sets: [squat(e.id, 4)] })).toMatchObject({ status: "rejected", code: "result_slot_out_of_range", target: "sets[0]" });
      await record({ events: [e.event("abandoned")] });
    });

    it("drill pass: 1..measure.count accepted; count + 1 → result_slot_out_of_range", async () => {
      const e = await started(FORCE_DAYS[1]);
      expect(await record({ sets: [pass(e.id, 1), pass(e.id, 4, { success: null })] })).toMatchObject({ status: "ok" });
      expect(await record({ sets: [pass(e.id, 5)] })).toMatchObject({ status: "rejected", code: "result_slot_out_of_range" });
      await record({ events: [e.event("abandoned")] });
    });
  });

  describe("one original per (execution, item, ordinal)", () => {
    it("replay of the same id is idempotent; another id on the same slot → result_slot_exists; corrections keep their rules", async () => {
      const e = await started(FORCE_DAYS[2]);
      const original = squat(e.id, 1);
      expect(await record({ sets: [original] })).toMatchObject({ status: "ok", inserted: { sets: [original.id] } });
      expect(await record({ sets: [original] })).toMatchObject({ status: "ok", unchanged: { sets: [original.id] } });
      expect(await record({ sets: [{ ...original, measure_value: 9 }] })).toMatchObject({ status: "rejected", code: "id_conflict" });
      // A second device creating its own original for the same set.
      expect(await record({ sets: [squat(e.id, 1, { measure_value: 7 })] })).toMatchObject({ status: "rejected", code: "result_slot_exists", target: "sets[0]" });
      // Same rule for a drill pass ordinal; another ordinal stays free.
      const p1 = pass(e.id, 1);
      expect(await record({ sets: [p1] })).toMatchObject({ status: "ok" });
      expect(await record({ sets: [pass(e.id, 1, { success: false })] })).toMatchObject({ status: "rejected", code: "result_slot_exists" });
      expect(await record({ sets: [pass(e.id, 2)] })).toMatchObject({ status: "ok" });
      // Corrections (supersedes_id) are not originals: one per original, never a correction of a correction.
      const correction = squat(e.id, 1, { measure_value: 6, supersedes_id: original.id });
      expect(await record({ sets: [correction] })).toMatchObject({ status: "ok" });
      expect(await record({ sets: [squat(e.id, 1, { measure_value: 5, supersedes_id: original.id })] })).toMatchObject({ status: "rejected", code: "invalid_correction" });
      expect(await record({ sets: [squat(e.id, 1, { measure_value: 5, supersedes_id: correction.id })] })).toMatchObject({ status: "rejected", code: "invalid_correction" });
      expect(await record({ sets: [pass(e.id, 1, { success: false, supersedes_id: p1.id })] })).toMatchObject({ status: "ok" });
      // Two originals of one slot in ONE batch: the batch is refused as a whole.
      const twins = [squat(e.id, 2), squat(e.id, 2)];
      expect(await record({ sets: twins })).toMatchObject({ status: "rejected", code: "result_slot_exists", target: "sets[1]" });
      const { count } = await admin.from("exercise_set_results").select("id", { count: "exact", head: true }).in("id", twins.map((t) => t.id));
      expect(count).toBe(0);
      await record({ events: [e.event("abandoned")] });
    });

    it("the database itself refuses a second original (unique index), even for the owner", () => {
      expect(() =>
        execLocalSql(`insert into public.exercise_set_results (id, execution_id, athlete_id, prescription_item_id, set_number, done, measure_type, measure_value, occurred_at)
select gen_random_uuid(), execution_id, athlete_id, prescription_item_id, set_number, true, 'reps', 1, now()
  from public.exercise_set_results where athlete_id = ${sqlLiteral(athleteId)} and prescription_item_id = ${sqlLiteral(itemSquat)} and supersedes_id is null limit 1;`)
      ).toThrow(/idx_exercise_set_results_one_original_per_slot/);
    });
  });

  describe("results of a terminal execution are frozen", () => {
    it("Force: the last set + completed in ONE batch is accepted; afterwards no new set, no correction (execution_terminal); a replay stays idempotent", async () => {
      const e = await started(FORCE_DAYS[3]);
      const first = squat(e.id, 1);
      expect(await record({ sets: [first] })).toMatchObject({ status: "ok" });
      const last = squat(e.id, 2);
      const completed = e.event("completed");
      expect(await record({ events: [completed], sets: [last] })).toMatchObject({ status: "ok", inserted: { events: [completed.id], sets: [last.id] } });
      expect(await record({ events: [completed], sets: [last] })).toMatchObject({ status: "ok", unchanged: { events: [completed.id], sets: [last.id] } });
      expect(await record({ sets: [squat(e.id, 3)] })).toMatchObject({ status: "rejected", code: "execution_terminal", target: "sets[0]" });
      expect(await record({ sets: [squat(e.id, 1, { measure_value: 6, supersedes_id: first.id })] })).toMatchObject({ status: "rejected", code: "execution_terminal" });
      expect(await record({ sets: [pass(e.id, 1)] })).toMatchObject({ status: "rejected", code: "execution_terminal" });
      expect(await record({ events: [e.event("paused", 55)] })).toMatchObject({ status: "rejected", code: "invalid_transition" });
    });

    it("Force: after abandoned, no new set (execution_terminal)", async () => {
      const e = await started(FORCE_DAYS[4]);
      expect(await record({ sets: [squat(e.id, 1)] })).toMatchObject({ status: "ok" });
      expect(await record({ events: [e.event("abandoned")] })).toMatchObject({ status: "ok" });
      expect(await record({ sets: [squat(e.id, 2)] })).toMatchObject({ status: "rejected", code: "execution_terminal" });
      // A refused batch writes nothing, not even its valid parts.
      const late = squat(e.id, 3);
      expect(await record({ sets: [late] })).toMatchObject({ status: "rejected" });
      expect((await admin.from("exercise_set_results").select("id").eq("id", late.id)).data).toEqual([]);
    });

    it("Endurance: activity + completed in ONE batch is accepted; afterwards no new activity and no correction (execution_terminal)", async () => {
      const e = await started(ENDURANCE_DAYS[0]);
      const original = activity(e.id);
      expect(await record({ events: [e.event("completed")], activities: [original] })).toMatchObject({ status: "ok", inserted: { activities: [original.id] } });
      expect(await record({ activities: [activity(e.id, { supersedes_id: original.id, duration_seconds: 3500 })] })).toMatchObject({ status: "rejected", code: "execution_terminal", target: "activities[0]" });
      expect(await record({ activities: [original] })).toMatchObject({ status: "ok", unchanged: { activities: [original.id] } });
    });

    it("Endurance: a correction before the terminal event is accepted; after abandoned, no activity", async () => {
      const e = await started(ENDURANCE_DAYS[1]);
      const original = activity(e.id);
      expect(await record({ activities: [original] })).toMatchObject({ status: "ok" });
      expect(await record({ activities: [activity(e.id, { supersedes_id: original.id, duration_seconds: 3000 })] })).toMatchObject({ status: "ok" });
      expect(await record({ events: [e.event("abandoned")] })).toMatchObject({ status: "ok" });
      const e2 = await started(ENDURANCE_DAYS[1]);
      expect(await record({ events: [e2.event("abandoned")] })).toMatchObject({ status: "ok" });
      expect(await record({ activities: [activity(e2.id)] })).toMatchObject({ status: "rejected", code: "execution_terminal" });
    });
  });
});
