/**
 * Pure unit tests for supabase/functions/session-execution/validation.ts
 * (UX-11B.2.2). No Docker, no Deno, no network — validation.ts is portable
 * plain TypeScript, imported here via a relative path.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_BATCH_ITEMS,
  REJECTION_STATUS,
  validateSessionExecutionBody,
} from "../../../../supabase/functions/session-execution/validation.js";

const EXEC_ID = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "22222222-2222-4222-8222-222222222222";
const SET_ID = "33333333-3333-4333-8333-333333333333";
const ITEM_ID = "44444444-4444-4444-8444-444444444444";
const FP_ID = "55555555-5555-4555-8555-555555555555";

const EXECUTION = { id: EXEC_ID, session_date: "2026-10-01", started_at: "2026-10-01T17:00:00Z", final_prescription_id: FP_ID };
const STARTED = { id: EVENT_ID, execution_id: EXEC_ID, event_type: "started", occurred_at: "2026-10-01T17:00:00Z" };
const SET = {
  id: SET_ID,
  execution_id: EXEC_ID,
  prescription_item_id: ITEM_ID,
  set_number: 1,
  done: true,
  measure_type: "reps",
  measure_value: 8,
  load_kg: 60,
  rpe_actual: 7,
  occurred_at: "2026-10-01T17:05:00+02:00",
};

function errorOf(body: unknown): string {
  const result = validateSessionExecutionBody(body);
  if (result.ok) throw new Error("expected a validation error");
  return result.error.message;
}

describe("validateSessionExecutionBody — valid batches", () => {
  it("accepts a new execution with its started event and a set, normalizing optional fields to null", () => {
    const result = validateSessionExecutionBody({ execution: EXECUTION, events: [STARTED], sets: [SET] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.execution).toEqual({ ...EXECUTION, comment: null });
    expect(result.value.events).toEqual([STARTED]);
    expect(result.value.sets[0]).toEqual({
      ...SET,
      other_exercise_name: null,
      success: null,
      comment: null,
      supersedes_id: null,
    });
  });

  it("accepts events only, sets only, an execution without prescription, and an 'other exercise' set", () => {
    expect(validateSessionExecutionBody({ events: [STARTED] }).ok).toBe(true);
    expect(validateSessionExecutionBody({ sets: [SET] }).ok).toBe(true);
    expect(validateSessionExecutionBody({ execution: { ...EXECUTION, final_prescription_id: null }, events: [STARTED] }).ok).toBe(true);
    const other = { ...SET, prescription_item_id: null, other_exercise_name: "Presse à cuisses" };
    expect(validateSessionExecutionBody({ sets: [other] }).ok).toBe(true);
  });

  it("accepts a pass without value, a not-done set without value, and a correction", () => {
    const pass = { ...SET, measure_type: "pass", measure_value: null, load_kg: null, success: true };
    const notDone = { ...SET, done: false, measure_value: null };
    const correction = { ...SET, id: "66666666-6666-4666-8666-666666666666", supersedes_id: SET_ID };
    expect(validateSessionExecutionBody({ sets: [pass, notDone, correction] }).ok).toBe(true);
  });
});

describe("validateSessionExecutionBody — rejected shapes", () => {
  it("rejects a non-object, an unknown field, an empty batch and oversized arrays", () => {
    expect(errorOf(null)).toMatch(/JSON object/);
    expect(errorOf({ events: [STARTED], extra: 1 })).toMatch(/Unknown field "extra"/);
    expect(errorOf({})).toMatch(/empty/);
    expect(errorOf({ events: Array.from({ length: MAX_BATCH_ITEMS + 1 }, () => STARTED) })).toMatch(/at most 200/);
  });

  it("never accepts server-derived fields from the client", () => {
    expect(errorOf({ execution: { ...EXECUTION, decision_id: FP_ID }, events: [STARTED] })).toMatch(/derived by the server/);
    expect(errorOf({ sets: [{ ...SET, exercise_id: "barbell_back_squat" }] })).toMatch(/copied by the server/);
  });

  it("rejects malformed ids, dates and zone-less timestamps", () => {
    expect(errorOf({ execution: { ...EXECUTION, id: "nope" }, events: [STARTED] })).toMatch(/execution.id/);
    expect(errorOf({ execution: { ...EXECUTION, session_date: "2026-02-30" }, events: [STARTED] })).toMatch(/session_date/);
    expect(errorOf({ execution: { ...EXECUTION, started_at: "2026-10-01T17:00:00" }, events: [STARTED] })).toMatch(/started_at/);
    expect(errorOf({ events: [{ ...STARTED, event_type: "finished" }] })).toMatch(/event_type/);
  });

  it("requires exactly one of prescribed item or other exercise", () => {
    expect(errorOf({ sets: [{ ...SET, prescription_item_id: null }] })).toMatch(/exactly one/);
    expect(errorOf({ sets: [{ ...SET, other_exercise_name: "Presse" }] })).toMatch(/exactly one/);
    expect(errorOf({ sets: [{ ...SET, prescription_item_id: null, other_exercise_name: "x".repeat(81) }] })).toMatch(/other_exercise_name/);
  });

  it("enforces the measure shape", () => {
    expect(errorOf({ sets: [{ ...SET, measure_type: "pass", measure_value: 1 }] })).toMatch(/null for a pass/);
    expect(errorOf({ sets: [{ ...SET, measure_value: null }] })).toMatch(/required for a done reps set/);
    expect(errorOf({ sets: [{ ...SET, measure_value: -1 }] })).toMatch(/non-negative integer/);
    expect(errorOf({ sets: [{ ...SET, measure_value: 1.5 }] })).toMatch(/non-negative integer/);
    expect(errorOf({ sets: [{ ...SET, set_number: 0 }] })).toMatch(/set_number/);
  });

  it("bounds the observed load, the real RPE and the comment", () => {
    expect(errorOf({ sets: [{ ...SET, load_kg: 1000.5 }] })).toMatch(/load_kg/);
    expect(errorOf({ sets: [{ ...SET, load_kg: 60.125 }] })).toMatch(/load_kg/);
    expect(errorOf({ sets: [{ ...SET, rpe_actual: 0.5 }] })).toMatch(/rpe_actual/);
    expect(errorOf({ sets: [{ ...SET, rpe_actual: 7.25 }] })).toMatch(/rpe_actual/);
    expect(errorOf({ sets: [{ ...SET, comment: "   " }] })).toMatch(/comment/);
    expect(errorOf({ sets: [{ ...SET, comment: "x".repeat(501) }] })).toMatch(/comment/);
  });

  it("rejects a set superseding itself", () => {
    expect(errorOf({ sets: [{ ...SET, supersedes_id: SET_ID }] })).toMatch(/must not reference the set itself/);
  });
});

describe("REJECTION_STATUS — stable codes", () => {
  it("maps every record_session_execution rejection code to a 4xx status", () => {
    expect(Object.keys(REJECTION_STATUS).sort()).toEqual(
      [
        "active_execution_exists",
        "date_mismatch",
        "execution_not_found",
        "final_prescription_not_current",
        "activity_not_allowed_by_prescription",
        "activity_result_exists",
        "activity_result_required",
        "id_conflict",
        "invalid_correction",
        "invalid_item",
        "invalid_payload",
        "invalid_prescribed_measure",
        "invalid_transition",
        "measure_mismatch",
        "missing_start_event",
        "not_executable",
        "prescription_not_found",
        "execution_terminal",
        "result_slot_out_of_range",
        "result_slot_exists",
      ].sort()
    );
    // UX-11B.2.6 — frozen terminal results and an existing original are conflicts; an ordinal outside the prescription is unprocessable.
    expect(REJECTION_STATUS.execution_terminal).toBe(409);
    expect(REJECTION_STATUS.result_slot_exists).toBe(409);
    expect(REJECTION_STATUS.result_slot_out_of_range).toBe(422);
    // UX-11A.5c.2 — a superseded final prescription is a conflict with the current state.
    expect(REJECTION_STATUS.final_prescription_not_current).toBe(409);
    for (const status of Object.values(REJECTION_STATUS)) {
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(500);
    }
  });
});

describe("UX-11B.2.5 — activities (session_activity_results)", () => {
  const EXEC = "3f1c2b8e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
  const activity = (extra: Record<string, unknown> = {}) => ({
    id: "6a1c2b8e-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
    execution_id: EXEC,
    activity_id: "mtb_rolling",
    duration_seconds: 2700,
    occurred_at: "2026-10-09T18:00:00Z",
    ...extra,
  });

  it("an activity-only batch is valid; optional fields default to null", () => {
    const result = validateSessionExecutionBody({ activities: [activity()] });
    expect(result).toMatchObject({ ok: true, value: { execution: null, events: [], sets: [], activities: [{ activity_id: "mtb_rolling", duration_seconds: 2700, distance_m: null, rpe_actual: null, comment: null, supersedes_id: null }] } });
  });

  it.each<[string, Record<string, unknown>]>([
    ["a zero duration", { duration_seconds: 0 }],
    ["a fractional duration", { duration_seconds: 12.5 }],
    ["a fractional distance (metres are integers)", { distance_m: 12.5 }],
    ["a negative distance", { distance_m: -1 }],
    ["an RPE out of the 1-10 scale", { rpe_actual: 11 }],
    ["an empty activity id", { activity_id: "" }],
    ["a fake prescription item", { prescription_item_id: "6a1c2b8e-1a2b-4c3d-8e9f-0a1b2c3d4e5f" }],
    ["an exercise id", { exercise_id: "goblet_squat" }],
    ["a self correction", { supersedes_id: "6a1c2b8e-1a2b-4c3d-8e9f-0a1b2c3d4e5f" }],
  ])("refuses %s", (_label, extra) => {
    expect(validateSessionExecutionBody({ activities: [activity(extra)] }).ok).toBe(false);
  });

  it("the duration is the actual one: any positive integer is accepted (never compared with the prescription here)", () => {
    expect(validateSessionExecutionBody({ activities: [activity({ duration_seconds: 7 })] }).ok).toBe(true);
  });
});
