import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SESSION_RESULT_HISTORY_ROW_CAP, SessionResultHistoryReadError, readSessionResultHistoryFacts } from "../../src/supabase/repositories/sessionResultHistoryRepo.js";

// PARTIAL-01-L2 — the reads of the real session history: explicit athlete filter, the window, read-only, no free text,
// fail closed.

const ATHLETE = "athlete-1";
const FROM = "2026-11-02";
const TO = "2026-11-08";
type Result = { data: unknown; error: { message: string } | null };
type Call = { table: string; ops: [string, unknown[]][] };

/** A chainable, thenable stand-in for the supabase-js query builder: read operations only (a write would throw). */
function fakeClient(answer: (table: string, call: Call) => Result) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const builder: Record<string, unknown> = {};
      for (const op of ["select", "eq", "gte", "lte", "in", "order", "limit"]) {
        builder[op] = (...args: unknown[]) => {
          call.ops.push([op, args]);
          return builder;
        };
      }
      builder.then = (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) => Promise.resolve().then(() => answer(table, call)).then(resolve, reject);
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}
const ok = (data: unknown[]): Result => ({ data, error: null });
const opsOf = (call: Call, op: string) => call.ops.filter(([o]) => o === op).map(([, args]) => args);

const EXECUTIONS = [
  { id: "e1", session_date: "2026-11-02", decision_id: "dec-1", final_prescription_id: "fp1", started_at: "2026-11-02T17:00:00Z", execution_events: [{ event_type: "started", occurred_at: "2026-11-02T17:00:00Z", event_seq: 1 }, { event_type: "completed", occurred_at: "2026-11-02T18:00:00Z", event_seq: 2 }] },
  { id: "e2", session_date: "2026-11-03", decision_id: "dec-2", final_prescription_id: "fp2", started_at: "2026-11-03T17:00:00Z", execution_events: [{ event_type: "started", occurred_at: "2026-11-03T17:00:00Z", event_seq: 3 }, { event_type: "abandoned", occurred_at: "2026-11-03T17:10:00Z", event_seq: 4 }] },
  { id: "e3", session_date: "2026-11-04", decision_id: null, final_prescription_id: null, started_at: "2026-11-04T17:00:00Z", execution_events: null },
];
const DEBRIEFS = [{ id: "d1", session_date: "2026-11-05", decision_id: "dec-5", completion_status: "skipped" }];

function standard(table: string): Result {
  if (table === "session_executions") return ok(EXECUTIONS);
  if (table === "completed_sessions") return ok(DEBRIEFS);
  return ok([]);
}

describe("readSessionResultHistoryFacts", () => {
  it("every read filters the athlete explicitly and is capped; the two dated reads are bounded by [from, to]", async () => {
    const { client, calls } = fakeClient(standard);
    await readSessionResultHistoryFacts(client, ATHLETE, FROM, TO);
    expect(calls.map((c) => c.table).sort()).toEqual(["completed_sessions", "decision_final_prescriptions", "decisions", "exercise_set_results", "session_activity_results", "session_executions"]);
    for (const call of calls) {
      expect(opsOf(call, "eq"), call.table).toEqual([["athlete_id", ATHLETE]]);
      expect(opsOf(call, "limit"), call.table).toEqual([[SESSION_RESULT_HISTORY_ROW_CAP]]);
    }
    for (const table of ["completed_sessions", "session_executions"]) {
      const call = calls.find((c) => c.table === table)!;
      expect([opsOf(call, "gte"), opsOf(call, "lte")], table).toEqual([[["session_date", FROM]], [["session_date", TO]]]);
    }
  });

  it("results are read for EVERY attempt (completed, abandoned, open); decisions of debriefs and executions, and prescriptions, by id", async () => {
    const { client, calls } = fakeClient(standard);
    const facts = await readSessionResultHistoryFacts(client, ATHLETE, FROM, TO);
    for (const table of ["exercise_set_results", "session_activity_results"]) expect(opsOf(calls.find((c) => c.table === table)!, "in"), table).toEqual([["execution_id", ["e1", "e2", "e3"]]]);
    expect(opsOf(calls.find((c) => c.table === "decisions")!, "in")).toEqual([["id", ["dec-1", "dec-2", "dec-5"]]]);
    expect(opsOf(calls.find((c) => c.table === "decision_final_prescriptions")!, "in")).toEqual([["id", ["fp1", "fp2"]]]);
    expect(facts.executions.map((e) => [e.id, e.events.map((x) => x.event_type)])).toEqual([
      ["e1", ["started", "completed"]],
      ["e2", ["started", "abandoned"]],
      ["e3", []],
    ]);
  });

  it("free texts are never selected (notes, comments, pain note, other free JSON)", async () => {
    const { client, calls } = fakeClient(standard);
    await readSessionResultHistoryFacts(client, ATHLETE, FROM, TO);
    const selected = calls.flatMap((c) => opsOf(c, "select").map(([columns]) => String(columns))).join(", ");
    for (const column of ["free_notes", "new_pain_note", "change_reason_note", "main_content", "comment"]) expect(selected, column).not.toContain(column);
  });

  it("no execution and no debrief: the dependent reads are not issued", async () => {
    const { client, calls } = fakeClient(() => ok([]));
    expect(await readSessionResultHistoryFacts(client, ATHLETE, FROM, TO)).toEqual({ debriefs: [], executions: [], decisions: [], prescriptions: [], sets: [], activities: [] });
    expect(calls.map((c) => c.table).sort()).toEqual(["completed_sessions", "session_executions"]);
  });

  it("fail closed: a failed read or a read reaching the cap refuses the whole history; a bad window is refused before any read", async () => {
    for (const table of ["completed_sessions", "session_executions", "decisions", "decision_final_prescriptions", "exercise_set_results", "session_activity_results"]) {
      const failing = fakeClient((t) => (t === table ? { data: null, error: { message: "boom" } } : standard(t)));
      await expect(readSessionResultHistoryFacts(failing.client, ATHLETE, FROM, TO), table).rejects.toThrow(`Supabase read failed (${table}): boom`);
      const full = fakeClient((t) => (t === table ? ok(Array.from({ length: SESSION_RESULT_HISTORY_ROW_CAP }, (_, i) => ({ id: `r${i}`, execution_events: [] }))) : standard(t)));
      await expect(readSessionResultHistoryFacts(full.client, ATHLETE, FROM, TO), table).rejects.toThrow(SessionResultHistoryReadError);
    }
    const { client, calls } = fakeClient(standard);
    await expect(readSessionResultHistoryFacts(client, ATHLETE, TO, FROM)).rejects.toThrow(RangeError);
    expect(calls).toEqual([]);
  });
});
