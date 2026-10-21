import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SESSION_RESULT_HISTORY_MAX_ROWS,
  SessionResultHistoryReadError,
  readSessionResultHistoryFacts,
  type SessionHistoryReadResult,
} from "../../src/supabase/repositories/sessionResultHistoryRepo.js";
import { sessionResultHistory } from "../../src/supabase/mapping/sessionResultHistory.js";

// PARTIAL-01-L2 / HISTORY-READ-01 — the reads of the real session history are exhaustive or refused, whatever the
// server's row cap. A small in-memory PostgREST stands in for the server: filters, ordering by id, keyset (`gt`),
// `limit` capped by its own `max_rows`, exact counts (HEAD); hooks change the data between requests or tamper with
// answers.

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const FROM = "2026-11-02";
const TO = "2026-11-08";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

type Row = Record<string, unknown> & { id: string };
type Filter = [op: "eq" | "gte" | "lte" | "in" | "gt", column: string, value: unknown];
interface Request {
  n: number;
  table: string;
  columns: string;
  head: boolean;
  filters: Filter[];
  limit: number | null;
}
type Answer = { data: unknown; error: { message: string } | null; count: number | null };
interface ServerOptions {
  /** Emulated PostgREST `max_rows`. */
  maxRows?: number;
  /** Runs before a request is answered (the data may change between pages). */
  before?: (req: Request, tables: Record<string, Row[]>) => void;
  /** Tampers with an answer. */
  answer?: (req: Request, a: Answer) => Answer;
}
const lower = (v: unknown) => String(v).toLowerCase();
function matches(row: Row, [op, column, value]: Filter): boolean {
  const v = row[column];
  if (op === "eq") return lower(v) === lower(value);
  if (op === "gte") return String(v) >= String(value);
  if (op === "lte") return String(v) <= String(value);
  if (op === "gt") return lower(v) > lower(value);
  return (value as unknown[]).map(lower).includes(lower(v));
}
function fakeServer(tables: Record<string, Row[]>, options: ServerOptions = {}) {
  const requests: Request[] = [];
  const client = {
    from(table: string) {
      const req: Request = { n: 0, table, columns: "", head: false, filters: [], limit: null };
      const b: Record<string, unknown> = {
        select(columns: string, opts?: { head?: boolean }) {
          req.columns = columns;
          req.head = opts?.head === true;
          return b;
        },
        order() {
          return b;
        },
        limit(n: number) {
          req.limit = n;
          return b;
        },
        then(resolve: (a: Answer) => unknown, reject: (e: unknown) => unknown) {
          return Promise.resolve()
            .then(() => run(req))
            .then(resolve, reject);
        },
      };
      for (const op of ["eq", "gte", "lte", "in", "gt"] as const)
        b[op] = (column: string, value: unknown) => {
          req.filters.push([op, column, value]);
          return b;
        };
      return b;
    },
  };
  function run(req: Request): Answer {
    req.n = requests.length + 1;
    requests.push(req);
    options.before?.(req, tables);
    const rows = (tables[req.table] ?? []).filter((r) => req.filters.every((f) => matches(r, f))).sort((x, y) => (lower(x.id) < lower(y.id) ? -1 : 1));
    // Only the selected columns come back (an alias `a:path` is stored under `a` in this world).
    const keys = req.columns.split(",").map((c) => c.trim().split(":")[0]!);
    const project = (r: Row) => Object.fromEntries(keys.filter((k) => k in r).map((k) => [k, r[k]])) as Row;
    const answer: Answer = req.head
      ? { data: null, error: null, count: rows.length }
      : { data: rows.slice(0, Math.min(req.limit ?? Infinity, options.maxRows ?? Infinity)).map(project), error: null, count: null };
    return options.answer ? options.answer(req, answer) : answer;
  }
  return { client: client as unknown as SupabaseClient, requests };
}
const isDataPage = (req: Request, table: string) => req.table === table && !req.head;
const isNextPage = (req: Request, table: string) => isDataPage(req, table) && req.filters.some(([op]) => op === "gt");

/** Rider A: `debriefs` V1 debriefs (≤ 7, one per day from FROM) and `executions` completed guided executions of `sets` sets each; rider B and an out-of-window debrief around them. */
function world(debriefs: number, executions: number, sets: number): Record<string, Row[]> {
  let n = 0;
  const t: Record<string, Row[]> = { completed_sessions: [], session_executions: [], execution_events: [], exercise_set_results: [], session_activity_results: [], decisions: [], decision_final_prescriptions: [] };
  const debrief = (athlete: string, date: string): Row => ({
    id: uuid(++n),
    athlete_id: athlete,
    updated_at: "2026-11-09T08:00:00+00:00",
    session_date: date,
    session_type: "AEROBIC_BASE",
    completion_status: "done",
    actual_duration_min: 40,
    rpe: 5,
    session_load: "20.00",
    intervention: { kind: "AEROBIC_BASE", load_profile: "LIGHT" },
    decision_id: null,
    post_leg_fatigue: null,
    post_grip_fatigue: null,
    new_pain: false,
    technical_outcome: null,
    change_reason: null,
  });
  for (let i = 0; i < debriefs; i += 1) t.completed_sessions!.push(debrief(A, `2026-11-0${2 + i}`));
  t.completed_sessions!.push(debrief(A, "2026-11-01"), debrief(B, "2026-11-03"));
  const execution = (athlete: string, date: string) => {
    const id = uuid(++n);
    t.session_executions!.push({ id, athlete_id: athlete, session_date: date, decision_id: null, final_prescription_id: null, started_at: `${date}T17:00:00Z` });
    t.execution_events!.push(
      { id: uuid(++n), athlete_id: athlete, execution_id: id, event_type: "started", occurred_at: `${date}T17:00:00Z`, event_seq: n },
      { id: uuid(++n), athlete_id: athlete, execution_id: id, event_type: "completed", occurred_at: `${date}T18:00:00Z`, event_seq: n }
    );
    for (let s = 1; s <= sets; s += 1)
      t.exercise_set_results!.push({ id: uuid(++n), athlete_id: athlete, execution_id: id, prescription_item_id: "I-1", exercise_id: "goblet_squat", other_exercise_name: null, set_number: s, done: true, measure_type: "reps", measure_value: 8, load_kg: null, rpe_actual: null, success: null, supersedes_id: null });
  };
  for (let i = 0; i < executions; i += 1) execution(A, `2026-11-0${2 + i}`);
  execution(B, "2026-11-04");
  return t;
}
const counts = (r: SessionHistoryReadResult) => [r.debriefs.length, r.executions.length, r.executions.reduce((k, e) => k + e.events.length, 0), r.sets.length];
const proofOf = (r: SessionHistoryReadResult, context: string) => r.proof.find((p) => p.context === context)!;
async function refusal(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(SessionResultHistoryReadError);
  return error as SessionResultHistoryReadError;
}

describe("readSessionResultHistoryFacts — exhaustive reads", () => {
  it("an empty history: two exact totals of 0, one empty page each, no dependent read", async () => {
    const { client, requests } = fakeServer(world(0, 0, 0));
    const r = await readSessionResultHistoryFacts(client, A, FROM, TO, { pageSize: 5 });
    expect(counts(r)).toEqual([0, 0, 0, 0]);
    expect(r.proof).toEqual([
      { context: "completed_sessions", total: 0, read: 0, pages: 1, versionsVerified: true },
      { context: "session_executions", total: 0, read: 0, pages: 1, versionsVerified: false },
    ]);
    expect([...new Set(requests.map((q) => q.table))].sort()).toEqual(["completed_sessions", "session_executions"]);
  });

  it.each([
    ["fewer rows than one page", 3, 5, 2],
    ["exactly one page", 5, 5, 2],
    ["several pages", 12, 5, 4],
    ["a total exactly divisible by the page size", 10, 5, 3],
  ])("%s: every row once, in pages until an empty one", async (_label, sets, pageSize, pages) => {
    const { client } = fakeServer(world(1, 1, sets));
    const r = await readSessionResultHistoryFacts(client, A, FROM, TO, { pageSize });
    expect(counts(r)).toEqual([1, 1, 2, sets]);
    expect(new Set(r.sets.map((s) => s.id)).size).toBe(sets);
    expect(proofOf(r, "exercise_set_results")).toEqual({ context: "exercise_set_results", total: sets, read: sets, pages, versionsVerified: false });
  });

  it("a server row cap below the page asked (max_rows 2 or 1 for pages of 5): the page size is never assumed, the read stays complete", async () => {
    for (const [maxRows, setPages, debriefPages] of [
      [2, 8, 3],
      [1, 15, 4],
    ] as const) {
      const { client } = fakeServer(world(3, 2, 7), { maxRows });
      const r = await readSessionResultHistoryFacts(client, A, FROM, TO, { pageSize: 5 });
      expect(counts(r), `max_rows ${maxRows}`).toEqual([3, 2, 4, 14]);
      expect([proofOf(r, "exercise_set_results").pages, proofOf(r, "completed_sessions").pages], `max_rows ${maxRows}`).toEqual([setPages, debriefPages]);
    }
  });

  it("the same normalized history whatever the page size and the server cap", async () => {
    const reference = sessionResultHistory(await readSessionResultHistoryFacts(fakeServer(world(4, 3, 6)).client, A, FROM, TO), FROM, TO);
    expect(reference.entries).toHaveLength(7);
    for (const [pageSize, maxRows] of [
      [1, undefined],
      [2, 1],
      [3, 2],
      [7, 4],
      [500, 3],
    ] as const) {
      const r = await readSessionResultHistoryFacts(fakeServer(world(4, 3, 6), maxRows === undefined ? {} : { maxRows }).client, A, FROM, TO, { pageSize });
      expect(sessionResultHistory(r, FROM, TO), `page ${pageSize}, max_rows ${maxRows}`).toEqual(reference);
    }
  });

  it("two riders: each read returns only the rider's rows; a row of another rider in an answer refuses the history", async () => {
    const t = world(2, 1, 3);
    const a = await readSessionResultHistoryFacts(fakeServer(t).client, A, FROM, TO, { pageSize: 2 });
    const b = await readSessionResultHistoryFacts(fakeServer(t).client, B, FROM, TO, { pageSize: 2 });
    expect([counts(a), counts(b)]).toEqual([
      [2, 1, 2, 3],
      [1, 1, 2, 3],
    ]);
    expect([...a.debriefs, ...a.executions, ...a.sets].every((r) => (r as unknown as Row).athlete_id === A)).toBe(true);
    // A server leaking rider B's sets into rider A's answer (B's rows come after A's in key order here).
    const leaky = fakeServer(t, {
      answer: (req, ans) => (isDataPage(req, "exercise_set_results") && Array.isArray(ans.data) ? { ...ans, data: [...(ans.data as Row[]), ...t.exercise_set_results!.filter((s) => s.athlete_id === B)] } : ans),
    });
    expect((await refusal(readSessionResultHistoryFacts(leaky.client, A, FROM, TO, { pageSize: 50 }))).code).toBe("foreign_row");
  });
});

describe("readSessionResultHistoryFacts — refused, never partial", () => {
  it("an error in the middle of the pagination refuses the whole history", async () => {
    let dataPages = 0;
    const { client } = fakeServer(world(1, 1, 9), { answer: (req, a) => (isDataPage(req, "exercise_set_results") && ++dataPages === 2 ? { data: null, error: { message: "connection reset" }, count: null } : a) });
    const e = await refusal(readSessionResultHistoryFacts(client, A, FROM, TO, { pageSize: 4 }));
    expect([e.code, e.context]).toEqual(["read_failed", "exercise_set_results"]);
  });

  it("no exact total (count missing): exhaustiveness cannot be proven", async () => {
    const { client } = fakeServer(world(1, 1, 2), { answer: (req, a) => (req.table === "session_executions" && req.head ? { ...a, count: null } : a) });
    expect((await refusal(readSessionResultHistoryFacts(client, A, FROM, TO))).code).toBe("count_unavailable");
  });

  it("a row added during the read (a set recorded between two pages) is detected", async () => {
    let inserted = false;
    const { client } = fakeServer(world(1, 1, 6), {
      before: (req, t) => {
        if (isNextPage(req, "exercise_set_results") && !inserted) {
          inserted = true;
          const exec = t.session_executions!.find((e) => e.athlete_id === A)!;
          t.exercise_set_results!.push({ ...t.exercise_set_results![0]!, id: uuid(9999), execution_id: exec.id, set_number: 7 });
        }
      },
    });
    const e = await refusal(readSessionResultHistoryFacts(client, A, FROM, TO, { pageSize: 2 }));
    expect([e.code, e.context]).toEqual(["changed_during_read", "exercise_set_results"]);
  });

  it("a debrief replaced during the read (same row, new version, already read) is detected by the second pass", async () => {
    let updated = false;
    const { client } = fakeServer(world(3, 0, 0), {
      before: (req, t) => {
        if (isNextPage(req, "completed_sessions") && !updated) {
          updated = true;
          const first = t.completed_sessions!.filter((d) => d.athlete_id === A).sort((x, y) => (x.id < y.id ? -1 : 1))[0]!;
          first.updated_at = "2026-11-09T09:30:00+00:00";
          first.actual_duration_min = 25;
        }
      },
    });
    const e = await refusal(readSessionResultHistoryFacts(client, A, FROM, TO, { pageSize: 1 }));
    expect([e.code, e.context]).toEqual(["changed_during_read", "completed_sessions"]);
  });

  it("a row removed during the read is detected", async () => {
    let removed = false;
    const t = world(1, 2, 0);
    const { client } = fakeServer(t, {
      before: (req) => {
        if (isNextPage(req, "session_executions") && !removed) {
          removed = true;
          const firstOfA = t.session_executions!.find((e) => e.athlete_id === A);
          t.session_executions = t.session_executions!.filter((e) => e !== firstOfA);
        }
      },
    });
    expect((await refusal(readSessionResultHistoryFacts(client, A, FROM, TO, { pageSize: 1 }))).code).toBe("changed_during_read");
  });

  it("unprovable exhaustiveness: a row the server counts but never returns; repeated or out-of-order rows; more rows than asked; a row outside the window", async () => {
    const tamper = (table: string, f: (rows: Row[], req: Request) => Row[]) => (req: Request, a: Answer) => (isDataPage(req, table) && Array.isArray(a.data) ? { ...a, data: f(a.data as Row[], req) } : a);

    const hidden = fakeServer(world(1, 1, 5), { answer: tamper("exercise_set_results", (rows) => rows.filter((s) => s.set_number !== 3)) });
    expect((await refusal(readSessionResultHistoryFacts(hidden.client, A, FROM, TO, { pageSize: 2 }))).code).toBe("incomplete");

    const repeated = fakeServer(world(1, 1, 5), { answer: tamper("exercise_set_results", (rows) => (rows.length > 0 ? [rows[0]!, ...rows] : rows)) });
    expect((await refusal(readSessionResultHistoryFacts(repeated.client, A, FROM, TO, { pageSize: 50 }))).code).toBe("inconsistent_page");

    const reversed = fakeServer(world(1, 1, 5), { answer: tamper("exercise_set_results", (rows) => [...rows].reverse()) });
    expect((await refusal(readSessionResultHistoryFacts(reversed.client, A, FROM, TO, { pageSize: 50 }))).code).toBe("inconsistent_page");

    const oversized = fakeServer(world(1, 1, 5), { answer: tamper("exercise_set_results", (rows) => [...rows, ...rows.map((r, i) => ({ ...r, id: uuid(8000 + i) }))]) });
    expect((await refusal(readSessionResultHistoryFacts(oversized.client, A, FROM, TO, { pageSize: 2 }))).code).toBe("inconsistent_page");

    const outside = fakeServer(world(1, 0, 0), { answer: tamper("completed_sessions", (rows) => rows.map((d) => ({ ...d, session_date: "2026-10-01" }))) });
    expect((await refusal(readSessionResultHistoryFacts(outside.client, A, FROM, TO))).code).toBe("inconsistent_page");
  });

  it("a read larger than the accepted maximum is refused before any row of it is read", async () => {
    const { client, requests } = fakeServer(world(1, 1, 2), { answer: (req, a) => (req.table === "completed_sessions" && req.head ? { ...a, count: SESSION_RESULT_HISTORY_MAX_ROWS + 1 } : a) });
    const e = await refusal(readSessionResultHistoryFacts(client, A, FROM, TO));
    expect([e.code, e.context]).toEqual(["too_large", "completed_sessions"]);
    expect(requests.filter((q) => isDataPage(q, "completed_sessions"))).toEqual([]);
  });

  it("every request filters the rider; the dated reads are bounded by the window; free texts are never selected; a bad window or page size is refused before any request", async () => {
    const { client, requests } = fakeServer(world(2, 2, 3));
    await readSessionResultHistoryFacts(client, A, FROM, TO, { pageSize: 2 });
    for (const q of requests) expect(q.filters, q.table).toContainEqual(["eq", "athlete_id", A]);
    for (const q of requests.filter((r) => r.table === "completed_sessions" || r.table === "session_executions"))
      expect(
        q.filters.filter(([op]) => op === "gte" || op === "lte"),
        q.table
      ).toEqual([
        ["gte", "session_date", FROM],
        ["lte", "session_date", TO],
      ]);
    const selected = requests.map((q) => q.columns).join(", ");
    for (const column of ["free_notes", "new_pain_note", "change_reason_note", "main_content", "comment"]) expect(selected, column).not.toContain(column);

    const none = fakeServer(world(1, 1, 1));
    await expect(readSessionResultHistoryFacts(none.client, A, TO, FROM)).rejects.toThrow(RangeError);
    await expect(readSessionResultHistoryFacts(none.client, A, FROM, TO, { pageSize: 0 })).rejects.toThrow(RangeError);
    expect(none.requests).toEqual([]);
  });
});
