/**
 * PARTIAL-01-L2 / HISTORY-READ-01 (HPM 2026-10-21) — reads the facts of the rider's real session history over
 * [from, to] (mapping/sessionResultHistory.ts normalizes them), EXHAUSTIVELY or not at all. Pure reads: nothing is
 * written, nothing is wired to a decision.
 *
 * Every read filters `athlete_id` explicitly and every row returned is checked to belong to the rider, so the reader
 * is correct under the generation's service-role client and under the rider's own client (RLS: own rows only). Free
 * texts (notes, comments, pain note) are never selected.
 *
 * Exhaustiveness, per table read — the server's row cap (PostgREST `max_rows`) is never assumed:
 * 1. the exact total of the read (`count: exact`, HEAD request), which no row cap shortens;
 * 2. keyset pagination on the primary key (`id` ascending, then `id > last`). A page may hold fewer rows than asked:
 *    any size is accepted, but every row must come strictly after the previous one (no duplicate, no step back),
 *    belong to the rider and match the read's own filters. An empty page ends the read;
 * 3. tables updatable in place (`completed_sessions`, `decisions`): a second keyset pass of (`id`, `updated_at`) must
 *    find exactly the same rows and versions. The other tables are append-only (triggers);
 * 4. the exact total again: it must equal the first one and the number of rows read — a row added or removed during
 *    the read changes it.
 * A failed request, a missing total, an inconsistent page, a foreign row, a change during the read or a read beyond
 * `SESSION_RESULT_HISTORY_MAX_ROWS` refuses the whole history: a partial history is never returned as a success.
 *
 * Limit: each request is a consistent snapshot, the whole read is not one transaction. A change made after a row was
 * verified belongs to the next read.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assertHistoryWindow,
  type SessionHistoryActivityRow,
  type SessionHistoryDebriefRow,
  type SessionHistoryDecisionRow,
  type SessionHistoryEventRow,
  type SessionHistoryExecutionRow,
  type SessionHistoryFacts,
  type SessionHistoryPrescriptionRow,
  type SessionHistorySetRow,
} from "../mapping/sessionResultHistory.js";

/** Rows asked per page. The server may return fewer: never assumed. */
export const SESSION_RESULT_HISTORY_PAGE_SIZE = 500;
/** Rows accepted per table read; beyond, the history is refused (bounded requests and memory), never truncated. */
export const SESSION_RESULT_HISTORY_MAX_ROWS = 10_000;

export type SessionResultHistoryReadFailure =
  /** The server answered an error. */
  | "read_failed"
  /** No exact total: exhaustiveness cannot be proven. */
  | "count_unavailable"
  /** A page out of key order, repeated, larger than asked, or a row outside the read's filters. */
  | "inconsistent_page"
  /** A row of another rider. */
  | "foreign_row"
  /** Rows added, removed or updated while the history was read. */
  | "changed_during_read"
  /** The rows read do not match the exact total. */
  | "incomplete"
  /** More rows than `SESSION_RESULT_HISTORY_MAX_ROWS`. */
  | "too_large";

export class SessionResultHistoryReadError extends Error {
  constructor(
    public readonly code: SessionResultHistoryReadFailure,
    public readonly context: string,
    detail = ""
  ) {
    super(`Session result history read refused (${context}): ${code}${detail ? ` — ${detail}` : ""}`);
    this.name = "SessionResultHistoryReadError";
  }
}

/** What was proven for one table read. */
export interface SessionHistoryTableProof {
  context: string;
  /** Exact total, before and after the read. */
  total: number;
  /** Rows read (= total). */
  read: number;
  /** Data pages requested, the final empty page included. */
  pages: number;
  /** Second keyset pass of (id, updated_at) on a table updatable in place. */
  versionsVerified: boolean;
}
export interface SessionHistoryReadResult extends SessionHistoryFacts {
  proof: SessionHistoryTableProof[];
}
export interface SessionHistoryReadOptions {
  /** Rows asked per page (default `SESSION_RESULT_HISTORY_PAGE_SIZE`). */
  pageSize?: number;
}

/** The query-builder surface this reader uses (supabase-js PostgrestFilterBuilder). */
interface Query extends PromiseLike<{ data: unknown; error: { message: string } | null; count?: number | null }> {
  eq(column: string, value: unknown): Query;
  gte(column: string, value: unknown): Query;
  lte(column: string, value: unknown): Query;
  in(column: string, values: readonly unknown[]): Query;
  gt(column: string, value: unknown): Query;
  order(column: string, options: { ascending: boolean }): Query;
  limit(count: number): Query;
}
type Row = Record<string, unknown> & { id: string };

interface TableRead {
  context: string;
  table: string;
  /** Always holds `id` and `athlete_id` (and `updated_at` when `versioned`). */
  columns: string;
  /** The read's filters, `athlete_id` included. */
  filter: (q: Query) => Query;
  /** A returned row must satisfy the read's filters. */
  matches: (row: Row) => boolean;
  /** The columns `matches` reads, also selected by the second pass. */
  matchColumns: string;
  /** Updatable in place: verified by a second pass of (id, updated_at). */
  versioned: boolean;
}

const lower = (v: unknown) => String(v).toLowerCase();

function select(client: SupabaseClient, read: TableRead, columns: string, head = false): Query {
  const base = client.from(read.table).select(columns, head ? { count: "exact", head: true } : undefined) as unknown as Query;
  return read.filter(base);
}

async function exactTotal(client: SupabaseClient, read: TableRead): Promise<number> {
  const { error, count } = await select(client, read, "id", true);
  if (error) throw new SessionResultHistoryReadError("read_failed", read.context, error.message);
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0) throw new SessionResultHistoryReadError("count_unavailable", read.context);
  if (count > SESSION_RESULT_HISTORY_MAX_ROWS) throw new SessionResultHistoryReadError("too_large", read.context, `${count} rows`);
  return count;
}

/** Every row of the read, by ascending id, in pages of whatever size the server returns. */
async function keysetRows(client: SupabaseClient, read: TableRead, athleteId: string, columns: string, pageSize: number): Promise<{ rows: Row[]; pages: number }> {
  const rows: Row[] = [];
  let last: string | null = null;
  for (let pages = 1; ; pages += 1) {
    let q = select(client, read, columns).order("id", { ascending: true }).limit(pageSize);
    if (last !== null) q = q.gt("id", last);
    const { data, error } = await q;
    if (error) throw new SessionResultHistoryReadError("read_failed", read.context, error.message);
    if (!Array.isArray(data)) throw new SessionResultHistoryReadError("inconsistent_page", read.context, "no row array");
    if (data.length === 0) return { rows, pages };
    if (data.length > pageSize) throw new SessionResultHistoryReadError("inconsistent_page", read.context, `${data.length} rows for ${pageSize} asked`);
    for (const row of data as Row[]) {
      const id = lower(row.id);
      if (last !== null && !(id > last)) throw new SessionResultHistoryReadError("inconsistent_page", read.context, "rows out of key order or repeated");
      if (lower(row.athlete_id) !== lower(athleteId)) throw new SessionResultHistoryReadError("foreign_row", read.context);
      if (!read.matches(row)) throw new SessionResultHistoryReadError("inconsistent_page", read.context, "row outside the read's filters");
      last = id;
      rows.push(row);
    }
    if (rows.length > SESSION_RESULT_HISTORY_MAX_ROWS) throw new SessionResultHistoryReadError("too_large", read.context);
  }
}

/** The exhaustiveness protocol of one table read (see the header). */
async function readExhaustive<T>(client: SupabaseClient, read: TableRead, athleteId: string, pageSize: number, proof: SessionHistoryTableProof[]): Promise<T[]> {
  const before = await exactTotal(client, read);
  const { rows, pages } = await keysetRows(client, read, athleteId, read.columns, pageSize);
  if (read.versioned) {
    const { rows: versions } = await keysetRows(client, read, athleteId, `id, athlete_id, updated_at${read.matchColumns ? `, ${read.matchColumns}` : ""}`, pageSize);
    const first = rows.map((r) => `${lower(r.id)}@${String(r.updated_at)}`).join(",");
    const second = versions.map((r) => `${lower(r.id)}@${String(r.updated_at)}`).join(",");
    if (first !== second) throw new SessionResultHistoryReadError("changed_during_read", read.context, "rows or versions differ between the two passes");
  }
  const after = await exactTotal(client, read);
  if (after !== before) throw new SessionResultHistoryReadError("changed_during_read", read.context, `total ${before} then ${after}`);
  if (rows.length !== before) throw new SessionResultHistoryReadError("incomplete", read.context, `${rows.length} rows read for a total of ${before}`);
  proof.push({ context: read.context, total: before, read: rows.length, pages, versionsVerified: read.versioned });
  return rows as unknown as T[];
}

const DEBRIEF_COLUMNS =
  "id, athlete_id, updated_at, session_date, session_type, completion_status, actual_duration_min, rpe, session_load, intervention, decision_id, post_leg_fatigue, post_grip_fatigue, new_pain, technical_outcome, change_reason";
const EXECUTION_COLUMNS = "id, athlete_id, session_date, decision_id, final_prescription_id, started_at";
const EVENT_COLUMNS = "id, athlete_id, execution_id, event_type, occurred_at, event_seq";
const DECISION_COLUMNS = "id, athlete_id, updated_at, decision_date, final_session:daily_plan->final_session";
const PRESCRIPTION_COLUMNS = "id, athlete_id, structure";
const SET_COLUMNS =
  "id, athlete_id, execution_id, prescription_item_id, exercise_id, other_exercise_name, set_number, done, measure_type, measure_value, load_kg, rpe_actual, success, supersedes_id";
const ACTIVITY_COLUMNS = "id, athlete_id, execution_id, activity_id, duration_seconds, distance_m, rpe_actual, supersedes_id";

export async function readSessionResultHistoryFacts(
  client: SupabaseClient,
  athleteId: string,
  from: string,
  to: string,
  options: SessionHistoryReadOptions = {}
): Promise<SessionHistoryReadResult> {
  assertHistoryWindow(from, to);
  const pageSize = options.pageSize ?? SESSION_RESULT_HISTORY_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new RangeError(`Invalid page size ${pageSize}`);
  const proof: SessionHistoryTableProof[] = [];
  const inWindow = (row: Row) => typeof row.session_date === "string" && row.session_date >= from && row.session_date <= to;
  const dated = (table: string, columns: string, versioned: boolean): TableRead => ({
    context: table,
    table,
    columns,
    filter: (q) => q.eq("athlete_id", athleteId).gte("session_date", from).lte("session_date", to),
    matches: inWindow,
    matchColumns: "session_date",
    versioned,
  });
  const byIds = (table: string, columns: string, column: string, ids: readonly string[], versioned: boolean): TableRead => {
    const wanted = new Set(ids.map(lower));
    return { context: table, table, columns, filter: (q) => q.eq("athlete_id", athleteId).in(column, ids), matches: (row) => wanted.has(lower(row[column])), matchColumns: column === "id" ? "" : column, versioned };
  };
  const read = <T>(r: TableRead) => readExhaustive<T>(client, r, athleteId, pageSize, proof);
  const none = <T>() => Promise.resolve([] as T[]);

  const [debriefs, executionRows] = await Promise.all([
    read<SessionHistoryDebriefRow>(dated("completed_sessions", DEBRIEF_COLUMNS, true)),
    read<Omit<SessionHistoryExecutionRow, "events">>(dated("session_executions", EXECUTION_COLUMNS, false)),
  ]);

  const executionIds = executionRows.map((e) => e.id).sort();
  const decisionIds = [...new Set([...debriefs.map((d) => d.decision_id), ...executionRows.map((e) => e.decision_id)].filter((id): id is string => id !== null))].sort();
  const prescriptionIds = [...new Set(executionRows.map((e) => e.final_prescription_id).filter((id): id is string => id !== null))].sort();
  type EventRow = SessionHistoryEventRow & { execution_id: string };

  const [events, decisions, prescriptions, sets, activities] = await Promise.all([
    executionIds.length === 0 ? none<EventRow>() : read<EventRow>(byIds("execution_events", EVENT_COLUMNS, "execution_id", executionIds, false)),
    decisionIds.length === 0 ? none<SessionHistoryDecisionRow>() : read<SessionHistoryDecisionRow>(byIds("decisions", DECISION_COLUMNS, "id", decisionIds, true)),
    prescriptionIds.length === 0 ? none<SessionHistoryPrescriptionRow>() : read<SessionHistoryPrescriptionRow>(byIds("decision_final_prescriptions", PRESCRIPTION_COLUMNS, "id", prescriptionIds, false)),
    executionIds.length === 0 ? none<SessionHistorySetRow>() : read<SessionHistorySetRow>(byIds("exercise_set_results", SET_COLUMNS, "execution_id", executionIds, false)),
    executionIds.length === 0 ? none<SessionHistoryActivityRow>() : read<SessionHistoryActivityRow>(byIds("session_activity_results", ACTIVITY_COLUMNS, "execution_id", executionIds, false)),
  ]);

  const eventsByExecution = new Map<string, SessionHistoryEventRow[]>();
  for (const e of events) {
    const key = lower(e.execution_id);
    eventsByExecution.set(key, [...(eventsByExecution.get(key) ?? []), { event_type: e.event_type, occurred_at: e.occurred_at, event_seq: e.event_seq }]);
  }
  const executions: SessionHistoryExecutionRow[] = executionRows.map((e) => ({ ...e, events: eventsByExecution.get(lower(e.id)) ?? [] }));

  return { debriefs, executions, decisions, prescriptions, sets, activities, proof: proof.sort((a, b) => a.context.localeCompare(b.context)) };
}
