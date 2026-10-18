import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PLAN_HISTORY_V2_ROW_CAP, PlanHistoryV2ReadError, readPlanHistoryFactsV2 } from "../../src/supabase/repositories/planHistoryV2Repo.js";

// V2-L2-01a — the grouped reads of the V2 generation history: explicit athlete filter, the window, fail closed.

const ATHLETE = "athlete-1";
const TODAY = "2026-11-02";
type Result = { data: unknown; error: { message: string } | null };
type Call = { table: string; ops: [string, unknown[]][] };

/** A chainable, thenable stand-in for the supabase-js query builder; `answer` gives each read its result. */
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
  { id: "e1", session_date: "2026-10-27", decision_id: "dec-old", final_prescription_id: "fp1", started_at: "2026-10-27T17:00:00Z", execution_events: [{ event_type: "started" }, { event_type: "completed" }] },
  { id: "e2", session_date: "2026-10-28", decision_id: "dec-2", final_prescription_id: "fp2", started_at: "2026-10-28T17:00:00Z", execution_events: [{ event_type: "started" }] },
];
const DECISIONS = [
  { id: "dec-2", decision_date: "2026-10-28", created_at: "2026-10-28T06:00:00Z", decision: "KEEP", final_session: { kind: "DH_TECHNICAL", duration_min: 75 }, triggered_rules: [] },
  { id: "dec-pre", decision_date: "2026-10-29", created_at: "2026-10-29T06:00:00Z", decision: null, final_session: null, triggered_rules: null },
];

function standard(table: string, call: Call): Result {
  if (table === "session_executions") return ok(EXECUTIONS);
  if (table === "decisions") return opsOf(call, "in").length > 0 ? ok([{ id: "dec-old", decision_date: "2026-10-27", created_at: "2026-10-27T06:00:00Z", decision: "KEEP", final_session: { kind: "STRENGTH_LOWER", duration_min: 60 }, triggered_rules: [] }]) : ok(DECISIONS);
  if (table === "decision_final_prescriptions") return ok([{ id: "fp1", structure: { family: "strength" } }]);
  return ok([]);
}

describe("readPlanHistoryFactsV2", () => {
  it("every read filters the athlete explicitly, is bounded by the window [today − 7, today] and capped", async () => {
    const { client, calls } = fakeClient(standard);
    await readPlanHistoryFactsV2(client, ATHLETE, TODAY);
    expect(calls.map((c) => c.table).sort()).toEqual(
      ["completed_sessions", "daily_checkins", "decision_final_prescriptions", "decisions", "decisions", "exercise_set_results", "health_flags", "session_activity_results", "session_executions"].sort()
    );
    for (const call of calls) {
      expect(opsOf(call, "eq"), call.table).toContainEqual(["athlete_id", ATHLETE]);
      expect(opsOf(call, "limit"), call.table).toEqual([[PLAN_HISTORY_V2_ROW_CAP]]);
    }
    const windowed: Record<string, string> = { completed_sessions: "session_date", session_executions: "session_date", daily_checkins: "checkin_date" };
    for (const [table, column] of Object.entries(windowed)) {
      const call = calls.find((c) => c.table === table)!;
      expect([opsOf(call, "gte"), opsOf(call, "lte")], table).toEqual([[[column, "2026-10-26"]], [[column, TODAY]]]);
    }
    const inWindow = calls.find((c) => c.table === "decisions" && opsOf(c, "in").length === 0)!;
    expect([opsOf(inWindow, "gte"), opsOf(inWindow, "lte")]).toEqual([[["decision_date", "2026-10-26"]], [["decision_date", TODAY]]]);
    // Every health signal up to today (a closed one without resolution day covers the whole window).
    const flags = calls.find((c) => c.table === "health_flags")!;
    expect([opsOf(flags, "gte"), opsOf(flags, "lte")]).toEqual([[], [["flag_date", TODAY]]]);
  });

  it("results are read for COMPLETED executions only; a decision of an execution outside the window is read by id", async () => {
    const { client, calls } = fakeClient(standard);
    const facts = await readPlanHistoryFactsV2(client, ATHLETE, TODAY);
    for (const table of ["exercise_set_results", "session_activity_results"]) expect(opsOf(calls.find((c) => c.table === table)!, "in"), table).toEqual([["execution_id", ["e1"]]]);
    expect(opsOf(calls.find((c) => c.table === "decision_final_prescriptions")!, "in")).toEqual([["id", ["fp1"]]]);
    expect(opsOf(calls.find((c) => c.table === "decisions" && opsOf(c, "in").length > 0)!, "in")).toEqual([["id", ["dec-old"]]]);
    expect(facts.executions).toEqual([
      { id: "e1", session_date: "2026-10-27", decision_id: "dec-old", final_prescription_id: "fp1", started_at: "2026-10-27T17:00:00Z", events: ["started", "completed"] },
      { id: "e2", session_date: "2026-10-28", decision_id: "dec-2", final_prescription_id: "fp2", started_at: "2026-10-28T17:00:00Z", events: ["started"] },
    ]);
    expect(facts.decisions.map((d) => [d.id, d.daily_plan])).toEqual([
      ["dec-2", { decision: "KEEP", final_session: { kind: "DH_TECHNICAL", duration_min: 75 }, triggered_rules: [] }],
      ["dec-pre", null],
      ["dec-old", { decision: "KEEP", final_session: { kind: "STRENGTH_LOWER", duration_min: 60 }, triggered_rules: [] }],
    ]);
  });

  it("no completed execution → no result read at all", async () => {
    const { client, calls } = fakeClient((table) => (table === "session_executions" ? ok([EXECUTIONS[1]]) : ok([])));
    const facts = await readPlanHistoryFactsV2(client, ATHLETE, TODAY);
    expect(calls.map((c) => c.table).sort()).toEqual(["completed_sessions", "daily_checkins", "decisions", "health_flags", "session_executions"]);
    expect([facts.sets, facts.activities, facts.prescriptions]).toEqual([[], [], []]);
  });

  it.each(["completed_sessions", "session_executions", "decisions", "daily_checkins", "health_flags", "decision_final_prescriptions", "exercise_set_results", "session_activity_results"])(
    "a failed read of %s refuses the whole read (never an empty history)",
    async (failing) => {
      const { client } = fakeClient((table, call) => (table === failing ? { data: null, error: { message: "boom" } } : standard(table, call)));
      await expect(readPlanHistoryFactsV2(client, ATHLETE, TODAY)).rejects.toThrow(/Supabase read failed/);
    }
  );

  it.each(["completed_sessions", "session_executions", "decisions", "health_flags", "exercise_set_results"])("a read of %s reaching the row cap is refused (possibly truncated)", async (capped) => {
    const { client } = fakeClient((table, call) => (table === capped ? ok(Array.from({ length: PLAN_HISTORY_V2_ROW_CAP }, () => (table === "session_executions" ? EXECUTIONS[1] : {}))) : standard(table, call)));
    await expect(readPlanHistoryFactsV2(client, ATHLETE, TODAY)).rejects.toBeInstanceOf(PlanHistoryV2ReadError);
  });
});
