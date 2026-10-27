import { describe, expect, it } from "vitest";
import {
  sessionResultHistory,
  type SessionHistoryActivityRow,
  type SessionHistoryDebriefRow,
  type SessionHistoryExecutionRow,
  type SessionHistoryFacts,
  type SessionHistorySetRow,
  type V1DebriefEntry,
  type V2ExecutionEntry,
} from "../../../src/supabase/mapping/sessionResultHistory.js";

// PARTIAL-01-L2 — the normalized real session history (fictitious rows). What is real, estimated, planned or absent;
// partial never becomes complete; nothing is invented, merged or copied from the prescription.

const FROM = "2026-11-02";
const TO = "2026-11-08";

const strength = {
  family: "strength",
  sessionKind: "STRENGTH_LOWER",
  blocks: [
    { role: "warm_up", items: [] },
    {
      role: "main",
      items: [
        { kind: "exercise", prescriptionItemId: "I-SQUAT", exerciseId: "goblet_squat", sets: 3, measure: { type: "reps", min: 8, max: 10, perSide: false } },
        { kind: "exercise", prescriptionItemId: "I-PLANK", exerciseId: "plank", sets: 2, measure: { type: "duration", minSeconds: 30, maxSeconds: 45, perSide: false } },
      ],
    },
  ],
};
const dh = {
  family: "dh_technical",
  sessionKind: "DH_TECHNICAL",
  blocks: [{ role: "main", items: [{ kind: "drill", prescriptionItemId: "I-DRILL", drillId: "braking_late_entry", measure: { type: "pass", count: 4 } }] }],
};
const endurance = { family: "endurance", sessionKind: "AEROBIC_BASE", activitySelection: { mode: "restricted", activityIds: ["road_bike", "running"] }, blocks: [{ role: "main", items: [] }] };
const recovery = { family: "recovery", sessionKind: "RECOVERY_ACTIVE", blocks: [{ role: "main", items: [] }] };

const decision = (id: string, date: string, kind: string, loadProfile: string | null, durationMin: number | null) => ({
  id,
  decision_date: date,
  final_session: { kind, ...(loadProfile ? { load_profile: loadProfile } : {}), ...(durationMin ? { duration_min: durationMin } : {}) },
});
const ev = (event_type: string, occurred_at: string, event_seq: number) => ({ event_type, occurred_at, event_seq });
const execution = (id: string, date: string, fp: string | null, dec: string | null, events: SessionHistoryExecutionRow["events"], startedAt = `${date}T17:00:00Z`): SessionHistoryExecutionRow => ({
  id,
  session_date: date,
  decision_id: dec,
  final_prescription_id: fp,
  started_at: startedAt,
  events,
});
const completedEvents = (date: string) => [ev("started", `${date}T17:00:00Z`, 1), ev("completed", `${date}T18:00:00Z`, 2)];
let n = 0;
const set = (executionId: string, item: string | null, setNumber: number, over: Partial<SessionHistorySetRow> = {}): SessionHistorySetRow => ({
  id: `S${++n}`,
  execution_id: executionId,
  prescription_item_id: item,
  exercise_id: item === "I-SQUAT" ? "goblet_squat" : item === "I-PLANK" ? "plank" : null,
  other_exercise_name: null,
  set_number: setNumber,
  done: true,
  measure_type: item === "I-DRILL" ? "pass" : item === "I-PLANK" ? "duration" : "reps",
  measure_value: item === "I-DRILL" ? null : item === "I-PLANK" ? 40 : 10,
  load_kg: null,
  rpe_actual: null,
  success: null,
  supersedes_id: null,
  ...over,
});
const fullStrengthSets = (e: string) => [set(e, "I-SQUAT", 1, { load_kg: "24.00", rpe_actual: "7.5" }), set(e, "I-SQUAT", 2, { load_kg: "24.00" }), set(e, "I-SQUAT", 3), set(e, "I-PLANK", 1), set(e, "I-PLANK", 2)];
const debrief = (over: Partial<SessionHistoryDebriefRow>): SessionHistoryDebriefRow => ({
  id: "D1",
  session_date: "2026-11-03",
  session_type: "STRENGTH_A",
  completion_status: "done",
  actual_duration_min: 55,
  rpe: 6,
  session_load: "33.00",
  intervention: { kind: "STRENGTH_LOWER", load_profile: "MODERATE", duration_min: 60 },
  decision_id: null,
  post_leg_fatigue: 4,
  post_grip_fatigue: null,
  new_pain: false,
  technical_outcome: null,
  change_reason: null,
  ...over,
});
const facts = (over: Partial<SessionHistoryFacts>): SessionHistoryFacts => ({ debriefs: [], executions: [], decisions: [], prescriptions: [], sets: [], activities: [], ...over });
const only = <T>(entries: readonly unknown[]) => {
  expect(entries).toHaveLength(1);
  return entries[0] as T;
};

describe("sessionResultHistory — V2 guided executions", () => {
  it("a Force session fully performed: completed against its frozen prescription; real sets with their load and RPE; no duration or session RPE is invented", () => {
    const e = "E-FULL";
    const h = sessionResultHistory(
      facts({
        executions: [execution(e, "2026-11-02", "FP1", "DEC1", completedEvents("2026-11-02"))],
        decisions: [decision("DEC1", "2026-11-02", "STRENGTH_LOWER", "MODERATE", 60)],
        prescriptions: [{ id: "FP1", structure: strength }],
        sets: fullStrengthSets(e),
      }),
      FROM,
      TO
    );
    const entry = only<V2ExecutionEntry>(h.entries);
    expect([entry.outcome, entry.outcomeBasis, entry.unqualifiedReason]).toEqual(["completed", "results_vs_frozen_prescription", null]);
    expect(entry.slots).toEqual({ prescribed: 5, withDoneResult: 5, withoutResult: 0, ambiguous: 0 });
    expect(entry.decided.durationMin).toEqual({ status: "planned", value: 60, source: "decisions.daily_plan.final_session.duration_min" });
    // The decided 60 min never becomes a performed duration.
    expect(entry.performed.durationSeconds).toEqual({ status: "absent", reason: "not_collected", source: null });
    expect(entry.performed.sessionRpe).toEqual({ status: "absent", reason: "not_collected", source: null });
    const squat = entry.performed.items.find((i) => i.prescriptionItemId === "I-SQUAT")!;
    expect(squat.sets.map((s) => [s.setNumber, s.measureValue, s.loadKg, s.rpe])).toEqual([
      [1, { status: "real", basis: "recorded", value: 10, source: "exercise_set_results.measure_value" }, { status: "real", basis: "recorded", value: 24, source: "exercise_set_results.load_kg" }, { status: "real", basis: "recorded", value: 7.5, source: "exercise_set_results.rpe_actual" }],
      [2, { status: "real", basis: "recorded", value: 10, source: "exercise_set_results.measure_value" }, { status: "real", basis: "recorded", value: 24, source: "exercise_set_results.load_kg" }, { status: "absent", reason: "not_entered", source: "exercise_set_results.rpe_actual" }],
      [3, { status: "real", basis: "recorded", value: 10, source: "exercise_set_results.measure_value" }, { status: "absent", reason: "not_entered", source: "exercise_set_results.load_kg" }, { status: "absent", reason: "not_entered", source: "exercise_set_results.rpe_actual" }],
    ]);
    expect(squat.sets[0]!.success).toEqual({ status: "absent", reason: "not_collected", source: "exercise_set_results.success" });
    expect(entry.prescription.status).toBe("planned");
    expect(entry.prescription.status === "planned" && entry.prescription.value.items.map((i) => [i.prescriptionItemId, i.prescribedCount, i.blockRole])).toEqual([
      ["I-SQUAT", 3, "main"],
      ["I-PLANK", 2, "main"],
    ]);
    expect(entry.lifecycle).toEqual({
      startedAt: { status: "real", basis: "recorded", value: "2026-11-02T17:00:00Z", source: "session_executions.started_at" },
      endedAt: { status: "real", basis: "recorded", value: "2026-11-02T18:00:00Z", source: "execution_events.occurred_at" },
      events: ["started", "completed"],
    });
    expect(entry.feedback.newPain).toEqual({ status: "absent", reason: "not_collected", source: null });
  });

  it("a Force session partially performed stays partial — never completed — with the missing slots counted, not filled", () => {
    const e = "E-PART";
    const entry = only<V2ExecutionEntry>(
      sessionResultHistory(
        facts({
          executions: [execution(e, "2026-11-02", "FP1", "DEC1", completedEvents("2026-11-02"))],
          decisions: [decision("DEC1", "2026-11-02", "STRENGTH_LOWER", "MODERATE", 60)],
          prescriptions: [{ id: "FP1", structure: strength }],
          sets: [set(e, "I-SQUAT", 1), set(e, "I-SQUAT", 2)],
        }),
        FROM,
        TO
      ).entries
    );
    expect([entry.outcome, entry.outcomeBasis]).toEqual(["partial", "results_vs_frozen_prescription"]);
    expect(entry.slots).toEqual({ prescribed: 5, withDoneResult: 2, withoutResult: 3, ambiguous: 0 });
    expect(entry.performed.items.map((i) => [i.prescriptionItemId, i.sets.map((s) => s.setNumber)])).toEqual([["I-SQUAT", [1, 2]]]);
  });

  it("an abandoned session keeps its real work but is abandoned, even when every slot was recorded", () => {
    const e = "E-STOP";
    const entry = only<V2ExecutionEntry>(
      sessionResultHistory(
        facts({
          executions: [execution(e, "2026-11-04", "FP1", "DEC1", [ev("started", "2026-11-04T17:00:00Z", 1), ev("abandoned", "2026-11-04T17:20:00Z", 2)])],
          decisions: [decision("DEC1", "2026-11-04", "STRENGTH_LOWER", "MODERATE", 60)],
          prescriptions: [{ id: "FP1", structure: strength }],
          sets: fullStrengthSets(e),
        }),
        FROM,
        TO
      ).entries
    );
    expect([entry.outcome, entry.outcomeBasis, entry.unqualifiedReason]).toEqual(["abandoned", "lifecycle_event", null]);
    expect(entry.slots).toEqual({ prescribed: 5, withDoneResult: 5, withoutResult: 0, ambiguous: 0 });
    expect(entry.lifecycle.endedAt).toEqual({ status: "real", basis: "recorded", value: "2026-11-04T17:20:00Z", source: "execution_events.occurred_at" });
  });

  it("sessions without results: an open attempt; an attempt stopped before any result; a completed recovery session (no realisation provable)", () => {
    const h = sessionResultHistory(
      facts({
        executions: [
          execution("E-OPEN", "2026-11-05", "FP1", "DEC1", [ev("started", "2026-11-05T17:00:00Z", 1), ev("paused", "2026-11-05T17:05:00Z", 2)]),
          execution("E-STOP0", "2026-11-06", "FP1", "DEC1", [ev("started", "2026-11-06T17:00:00Z", 1), ev("abandoned", "2026-11-06T17:02:00Z", 2)]),
          execution("E-REC", "2026-11-07", "FP-REC", "DEC2", completedEvents("2026-11-07")),
        ],
        decisions: [decision("DEC1", "2026-11-05", "STRENGTH_LOWER", "MODERATE", 60), decision("DEC2", "2026-11-07", "RECOVERY_ACTIVE", null, 30)],
        prescriptions: [
          { id: "FP1", structure: strength },
          { id: "FP-REC", structure: recovery },
        ],
      }),
      FROM,
      TO
    );
    const [open, stopped, rec] = h.entries as V2ExecutionEntry[];
    expect([open!.outcome, open!.lifecycle.endedAt, open!.lifecycle.events]).toEqual(["open", { status: "absent", reason: "not_applicable", source: "execution_events" }, ["started", "paused"]]);
    expect([stopped!.outcome, stopped!.slots, stopped!.performed.items]).toEqual(["abandoned", { prescribed: 5, withDoneResult: 0, withoutResult: 5, ambiguous: 0 }, []]);
    expect([rec!.outcome, rec!.outcomeBasis, rec!.unqualifiedReason, rec!.slots]).toEqual(["completed_unqualified", "lifecycle_event", "family_without_provable_realisation", null]);
    expect(rec!.decided.loadProfile).toEqual({ status: "absent", reason: "not_applicable", source: "decisions.daily_plan.final_session.load_profile" });
  });

  it("a DH session: every pass done → completed, the success of each pass as recorded (or not evaluated); no load or RPE on a pass", () => {
    const e = "E-DH";
    const entry = only<V2ExecutionEntry>(
      sessionResultHistory(
        facts({
          executions: [execution(e, "2026-11-03", "FP-DH", "DEC1", completedEvents("2026-11-03"))],
          decisions: [decision("DEC1", "2026-11-03", "DH_TECHNICAL", "MODERATE", 90)],
          prescriptions: [{ id: "FP-DH", structure: dh }],
          sets: [set(e, "I-DRILL", 1, { success: true }), set(e, "I-DRILL", 2, { success: false }), set(e, "I-DRILL", 3), set(e, "I-DRILL", 4, { success: true })],
        }),
        FROM,
        TO
      ).entries
    );
    expect(entry.outcome).toBe("completed");
    const passes = entry.performed.items[0]!.sets;
    expect(passes.map((p) => (p.success.status === "real" ? p.success.value : p.success.status === "absent" ? p.success.reason : p.success.status))).toEqual([true, false, "not_entered", true]);
    expect([passes[0]!.measureValue, passes[0]!.loadKg, passes[0]!.rpe]).toEqual([
      { status: "absent", reason: "not_applicable", source: "exercise_set_results.measure_value" },
      { status: "absent", reason: "not_collected", source: "exercise_set_results.load_kg" },
      { status: "absent", reason: "not_collected", source: "exercise_set_results.rpe_actual" },
    ]);
  });

  it("an endurance session: the recorded activity duration is the only real duration; distance and RPE when entered, absent otherwise; a correction replaces the original", () => {
    const e = "E-END";
    const original: SessionHistoryActivityRow = { id: "A1", execution_id: e, activity_id: "road_bike", duration_seconds: 3000, distance_m: null, rpe_actual: null, supersedes_id: null };
    const correction: SessionHistoryActivityRow = { id: "A2", execution_id: e, activity_id: "road_bike", duration_seconds: "3150", distance_m: "21500", rpe_actual: null, supersedes_id: "A1" };
    const entry = only<V2ExecutionEntry>(
      sessionResultHistory(
        facts({
          executions: [execution(e, "2026-11-06", "FP-END", "DEC1", completedEvents("2026-11-06"))],
          decisions: [decision("DEC1", "2026-11-06", "AEROBIC_BASE", "MODERATE", 45)],
          prescriptions: [{ id: "FP-END", structure: endurance }],
          activities: [original, correction],
        }),
        FROM,
        TO
      ).entries
    );
    expect([entry.outcome, entry.unqualifiedReason]).toEqual(["completed_unqualified", "family_without_provable_realisation"]);
    expect(entry.performed.durationSeconds).toEqual({ status: "real", basis: "recorded", value: 3150, source: "session_activity_results.duration_seconds" });
    expect(entry.performed.activity).toEqual({
      status: "real",
      basis: "recorded",
      value: {
        activityId: "road_bike",
        durationSeconds: 3150,
        distanceM: { status: "real", basis: "recorded", value: 21500, source: "session_activity_results.distance_m" },
        rpe: { status: "absent", reason: "not_entered", source: "session_activity_results.rpe_actual" },
        corrected: true,
      },
      source: "session_activity_results",
    });
    expect(entry.performed.correctionsApplied).toBe(1);
  });

  it("corrections: the active result counts; two active results for one slot make the realisation ambiguous, never complete", () => {
    const e = "E-COR";
    const sets = fullStrengthSets(e);
    const correction = set(e, "I-SQUAT", 1, { measure_value: 8, supersedes_id: sets[0]!.id });
    const corrected = only<V2ExecutionEntry>(
      sessionResultHistory(
        facts({ executions: [execution(e, "2026-11-02", "FP1", null, completedEvents("2026-11-02"))], prescriptions: [{ id: "FP1", structure: strength }], sets: [...sets, correction] }),
        FROM,
        TO
      ).entries
    );
    expect([corrected.outcome, corrected.performed.correctionsApplied]).toEqual(["completed", 1]);
    expect(corrected.performed.items.map((i) => i.prescriptionItemId)).toEqual(["I-SQUAT", "I-PLANK"]);
    const first = corrected.performed.items.find((i) => i.prescriptionItemId === "I-SQUAT")!.sets[0]!;
    expect([first.setNumber, first.measureValue.status === "real" && first.measureValue.value, first.corrected]).toEqual([1, 8, true]);
    expect(corrected.decided.kind).toEqual({ status: "absent", reason: "not_linked", source: null });

    const duplicate = set(e, "I-SQUAT", 2);
    const ambiguous = only<V2ExecutionEntry>(
      sessionResultHistory(
        facts({ executions: [execution(e, "2026-11-02", "FP1", null, completedEvents("2026-11-02"))], prescriptions: [{ id: "FP1", structure: strength }], sets: [...sets, duplicate] }),
        FROM,
        TO
      ).entries
    );
    expect([ambiguous.outcome, ambiguous.unqualifiedReason, ambiguous.slots]).toEqual(["completed_unqualified", "ambiguous_results", { prescribed: 5, withDoneResult: 4, withoutResult: 0, ambiguous: 1 }]);
  });

  it("an unreadable or missing prescription: not_readable, never guessed — the completed session stays unqualified", () => {
    const entries = sessionResultHistory(
      facts({
        executions: [execution("E-X", "2026-11-02", "FP-BAD", null, completedEvents("2026-11-02")), execution("E-Y", "2026-11-03", "FP-GONE", null, completedEvents("2026-11-03"))],
        prescriptions: [{ id: "FP-BAD", structure: { family: "strength", sessionKind: "STRENGTH_LOWER", blocks: [{ role: "main", items: [{ kind: "exercise", prescriptionItemId: "I", sets: 3 }] }] } }],
        sets: [set("E-X", "I", 1)],
      }),
      FROM,
      TO
    ).entries as V2ExecutionEntry[];
    expect(entries.map((e) => [e.outcome, e.unqualifiedReason, e.prescription])).toEqual([
      ["completed_unqualified", "prescription_not_readable", { status: "absent", reason: "not_readable", source: "decision_final_prescriptions.structure" }],
      ["completed_unqualified", "prescription_not_readable", { status: "absent", reason: "not_readable", source: "decision_final_prescriptions.structure" }],
    ]);
  });
});

describe("sessionResultHistory — V1 debriefs", () => {
  it("a declared session: declared intervention, duration and session RPE; the load is an estimate; the decided session stays planned", () => {
    const entry = only<V1DebriefEntry>(
      sessionResultHistory(facts({ debriefs: [debrief({ decision_id: "DEC1" })], decisions: [decision("DEC1", "2026-11-03", "STRENGTH_LOWER", "HEAVY", 60)] }), FROM, TO).entries
    );
    expect([entry.outcome, entry.outcomeBasis]).toEqual(["completed", "declared_by_rider"]);
    expect(entry.performed).toEqual({
      intervention: { status: "real", basis: "declared", value: { kind: "STRENGTH_LOWER", loadProfile: "MODERATE", durationMin: 60 }, source: "completed_sessions.intervention" },
      sessionType: { status: "real", basis: "declared", value: "STRENGTH_A", source: "completed_sessions.session_type" },
      durationMin: { status: "real", basis: "declared", value: 55, source: "completed_sessions.actual_duration_min" },
      sessionRpe: { status: "real", basis: "declared", value: 6, source: "completed_sessions.rpe" },
    });
    expect(entry.estimatedLoad).toEqual({ status: "estimated", value: 33, source: "completed_sessions.session_load", method: "actual_duration_min × rpe / 10, derived by trigger trg_compute_session_load" });
    expect(entry.decided.loadProfile).toEqual({ status: "planned", value: "HEAVY", source: "decisions.daily_plan.final_session.load_profile" });
    expect(entry.feedback).toEqual({
      technicalOutcome: { status: "absent", reason: "not_entered", source: "completed_sessions.technical_outcome" },
      changeReason: { status: "absent", reason: "not_applicable", source: "completed_sessions.change_reason" },
      postLegFatigue: { status: "real", basis: "declared", value: 4, source: "completed_sessions.post_leg_fatigue" },
      postGripFatigue: { status: "absent", reason: "not_entered", source: "completed_sessions.post_grip_fatigue" },
      newPain: { status: "real", basis: "declared", value: false, source: "completed_sessions.new_pain" },
    });
  });

  it("partial and replaced stay as declared; a partial is never completed", () => {
    const h = sessionResultHistory(
      facts({
        debriefs: [
          debrief({ id: "D-P", session_date: "2026-11-02", completion_status: "partial", change_reason: "fatigue_control", post_leg_fatigue: 8 }),
          debrief({ id: "D-R", session_date: "2026-11-04", completion_status: "replaced", change_reason: "weather_terrain", intervention: { kind: "AEROBIC_BASE", load_profile: "LIGHT" } }),
        ],
      }),
      FROM,
      TO
    );
    expect(h.entries.map((e) => [e.recordId, e.outcome, e.feedback.changeReason.status === "real" && e.feedback.changeReason.value])).toEqual([
      ["D-P", "partial", "fatigue_control"],
      ["D-R", "replaced", "weather_terrain"],
    ]);
    expect((h.entries[1] as V1DebriefEntry).feedback.technicalOutcome).toEqual({ status: "absent", reason: "not_applicable", source: "completed_sessions.technical_outcome" });
  });

  it("a session not performed (« Non réalisée »): not_done; no duration, RPE, load or intervention (not applicable); the reason as declared", () => {
    const entry = only<V1DebriefEntry>(
      sessionResultHistory(
        facts({ debriefs: [debrief({ completion_status: "skipped", session_type: "DH_TECHNICAL", actual_duration_min: null, rpe: null, session_load: null, intervention: null, change_reason: "time_life", post_leg_fatigue: null })] }),
        FROM,
        TO
      ).entries
    );
    expect(entry.outcome).toBe("not_done");
    expect([entry.performed.durationMin, entry.performed.sessionRpe, entry.estimatedLoad, entry.performed.intervention]).toEqual([
      { status: "absent", reason: "not_applicable", source: "completed_sessions.actual_duration_min" },
      { status: "absent", reason: "not_applicable", source: "completed_sessions.rpe" },
      { status: "absent", reason: "not_applicable", source: "completed_sessions.session_load" },
      { status: "absent", reason: "not_applicable", source: "completed_sessions.intervention" },
    ]);
    expect(entry.performed.sessionType).toEqual({ status: "real", basis: "declared", value: "DH_TECHNICAL", source: "completed_sessions.session_type" });
    expect(entry.feedback.changeReason).toEqual({ status: "real", basis: "declared", value: "time_life", source: "completed_sessions.change_reason" });
  });

  it("a legacy row (no intervention, no duration, no RPE, no debrief fields): every missing value is absent, nothing inferred from session_type", () => {
    const entry = only<V1DebriefEntry>(
      sessionResultHistory(
        facts({ debriefs: [debrief({ intervention: null, actual_duration_min: null, rpe: null, session_load: null, post_leg_fatigue: null, new_pain: null, decision_id: "DEC-MISSING" })] }),
        FROM,
        TO
      ).entries
    );
    expect(entry.outcome).toBe("completed");
    expect([entry.performed.intervention, entry.performed.durationMin, entry.performed.sessionRpe, entry.estimatedLoad, entry.feedback.newPain]).toEqual([
      { status: "absent", reason: "not_entered", source: "completed_sessions.intervention" },
      { status: "absent", reason: "not_entered", source: "completed_sessions.actual_duration_min" },
      { status: "absent", reason: "not_entered", source: "completed_sessions.rpe" },
      { status: "absent", reason: "not_entered", source: "completed_sessions.session_load" },
      { status: "absent", reason: "not_entered", source: "completed_sessions.new_pain" },
    ]);
    // A decision id whose row was not read: unreadable, never reconstructed.
    expect(entry.decided.kind).toEqual({ status: "absent", reason: "not_readable", source: "decisions.daily_plan.final_session" });
  });
});

describe("sessionResultHistory — several sessions, window, contract", () => {
  it("sessions close together stay separate entries: consecutive days, a stopped attempt then a new one the same day, a V1 debrief after an attempt stopped before any result", () => {
    const h = sessionResultHistory(
      facts({
        executions: [
          execution("E-2", "2026-11-03", "FP1", null, completedEvents("2026-11-03"), "2026-11-03T18:00:00Z"),
          execution("E-1", "2026-11-03", "FP1", null, [ev("started", "2026-11-03T09:00:00Z", 1), ev("abandoned", "2026-11-03T09:10:00Z", 2)], "2026-11-03T09:00:00Z"),
          execution("E-3", "2026-11-04", "FP1", null, completedEvents("2026-11-04")),
          execution("E-4", "2026-11-05", "FP1", null, [ev("started", "2026-11-05T17:00:00Z", 1), ev("abandoned", "2026-11-05T17:01:00Z", 2)]),
        ],
        debriefs: [debrief({ id: "D-5", session_date: "2026-11-05", completion_status: "skipped", actual_duration_min: null, rpe: null, session_load: null, intervention: null, change_reason: "motivation" })],
        prescriptions: [{ id: "FP1", structure: strength }],
        sets: [...fullStrengthSets("E-2"), set("E-1", "I-SQUAT", 1), set("E-3", "I-SQUAT", 1)],
      }),
      FROM,
      TO
    );
    expect(h.entries.map((e) => [e.date, e.source, e.recordId, e.outcome])).toEqual([
      ["2026-11-03", "v2_guided_execution", "E-1", "abandoned"],
      ["2026-11-03", "v2_guided_execution", "E-2", "completed"],
      ["2026-11-04", "v2_guided_execution", "E-3", "partial"],
      ["2026-11-05", "v2_guided_execution", "E-4", "abandoned"],
      ["2026-11-05", "v1_debrief", "D-5", "not_done"],
    ]);
  });

  it("only records dated in [from, to]; an empty history is empty — no day without a record is reported as missed", () => {
    const h = sessionResultHistory(facts({ debriefs: [debrief({ session_date: "2026-11-01" }), debrief({ id: "D-IN", session_date: "2026-11-08" }), debrief({ session_date: "2026-11-09" })] }), FROM, TO);
    expect(h.entries.map((e) => e.recordId)).toEqual(["D-IN"]);
    expect(sessionResultHistory(facts({}), FROM, TO)).toEqual({ from: FROM, to: TO, entries: [] });
  });

  it("a malformed or reversed window and an unknown V1 status are refused", () => {
    expect(() => sessionResultHistory(facts({}), "2026-11-08", "2026-11-02")).toThrow(RangeError);
    expect(() => sessionResultHistory(facts({}), "2026-11", TO)).toThrow(RangeError);
    expect(() => sessionResultHistory(facts({ debriefs: [debrief({ completion_status: "unknown" })] }), FROM, TO)).toThrow("Unknown completion_status");
  });

  it("every present value names its source; every absent one its reason — no bare value anywhere", () => {
    const e = "E-ALL";
    const h = sessionResultHistory(
      facts({
        executions: [execution(e, "2026-11-02", "FP1", "DEC1", completedEvents("2026-11-02"))],
        decisions: [decision("DEC1", "2026-11-02", "STRENGTH_LOWER", "MODERATE", 60)],
        prescriptions: [{ id: "FP1", structure: strength }],
        sets: fullStrengthSets(e),
        debriefs: [debrief({})],
      }),
      FROM,
      TO
    );
    const values: Array<Record<string, unknown>> = [];
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (typeof v !== "object" || v === null) return;
      const o = v as Record<string, unknown>;
      if (typeof o.status === "string" && ["real", "estimated", "planned", "absent"].includes(o.status)) values.push(o);
      Object.values(o).forEach(walk);
    };
    walk(h.entries);
    expect(values.length).toBeGreaterThan(30);
    for (const v of values) {
      if (v.status === "absent") expect(typeof v.reason, JSON.stringify(v)).toBe("string");
      else expect(typeof v.source, JSON.stringify(v)).toBe("string");
    }
  });
});

describe("sessionResultHistory — V2-DH-UNIT-01: the unit of a DH count is read as prescribed, never added", () => {
  const prescribed = (structure: unknown) => {
    const e = "E-UNIT";
    const entry = only<V2ExecutionEntry>(
      sessionResultHistory(
        facts({
          executions: [execution(e, "2026-11-03", "FP-U", "DEC1", completedEvents("2026-11-03"))],
          decisions: [decision("DEC1", "2026-11-03", "DH_TECHNICAL", "MODERATE", 90)],
          prescriptions: [{ id: "FP-U", structure }],
          sets: [1, 2, 3, 4].map((n) => set(e, "I-DRILL", n, { success: true })),
        }),
        FROM,
        TO
      ).entries
    );
    return entry.prescription.status === "planned" ? entry.prescription.value.items[0]!.measure : null;
  };

  it("a historical count keeps exactly { type, count } (unit unknown, never assumed); a stated SECTION is kept as stated", () => {
    expect(prescribed(dh)).toEqual({ type: "pass", count: 4 });
    const section = { ...dh, blocks: [{ role: "main", items: [{ ...dh.blocks[0]!.items[0]!, measure: { type: "pass", count: 4, unit: "SECTION" } }] }] };
    expect(prescribed(section)).toEqual({ type: "pass", count: 4, unit: "SECTION" });
  });
});
