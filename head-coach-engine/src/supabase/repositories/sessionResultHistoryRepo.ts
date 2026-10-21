/**
 * PARTIAL-01-L2 (HPM 2026-10-21) — reads the facts of the rider's real session history over [from, to]
 * (mapping/sessionResultHistory.ts normalizes them). Pure reads: nothing is written, nothing is wired to a decision.
 *
 * Every read filters `athlete_id` explicitly, so it is correct under the generation's service-role client and under
 * the rider's own client (RLS: own rows only). Free texts (notes, comments, pain note) are never selected.
 *
 * Fail closed: a failed read, or a result reaching the row cap, throws — never a silently empty or truncated history.
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
import { assertNoSupabaseError } from "./supabaseError.js";

/** Rows per read; reaching it means the read may be truncated → refused. */
export const SESSION_RESULT_HISTORY_ROW_CAP = 1000;

export class SessionResultHistoryReadError extends Error {
  constructor(context: string) {
    super(`Session result history read refused (${context}): row cap ${SESSION_RESULT_HISTORY_ROW_CAP} reached`);
    this.name = "SessionResultHistoryReadError";
  }
}

function rowsOf<T>(result: { data: unknown; error: { message: string } | null }, context: string): T[] {
  assertNoSupabaseError(result.error, context);
  const rows = (result.data ?? []) as T[];
  if (rows.length >= SESSION_RESULT_HISTORY_ROW_CAP) throw new SessionResultHistoryReadError(context);
  return rows;
}

const DEBRIEF_COLUMNS =
  "id, session_date, session_type, completion_status, actual_duration_min, rpe, session_load, intervention, decision_id, post_leg_fatigue, post_grip_fatigue, new_pain, technical_outcome, change_reason";
const EXECUTION_COLUMNS = "id, session_date, decision_id, final_prescription_id, started_at, execution_events(event_type, occurred_at, event_seq)";
const SET_COLUMNS = "id, execution_id, prescription_item_id, exercise_id, other_exercise_name, set_number, done, measure_type, measure_value, load_kg, rpe_actual, success, supersedes_id";
const ACTIVITY_COLUMNS = "id, execution_id, activity_id, duration_seconds, distance_m, rpe_actual, supersedes_id";

export async function readSessionResultHistoryFacts(client: SupabaseClient, athleteId: string, from: string, to: string): Promise<SessionHistoryFacts> {
  assertHistoryWindow(from, to);
  const cap = SESSION_RESULT_HISTORY_ROW_CAP;

  const [debriefs, executionRows] = await Promise.all([
    client
      .from("completed_sessions")
      .select(DEBRIEF_COLUMNS)
      .eq("athlete_id", athleteId)
      .gte("session_date", from)
      .lte("session_date", to)
      .order("session_date", { ascending: true })
      .limit(cap)
      .then((r) => rowsOf<SessionHistoryDebriefRow>(r, "completed_sessions")),
    client
      .from("session_executions")
      .select(EXECUTION_COLUMNS)
      .eq("athlete_id", athleteId)
      .gte("session_date", from)
      .lte("session_date", to)
      .order("session_date", { ascending: true })
      .order("started_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(cap)
      .then((r) => rowsOf<Omit<SessionHistoryExecutionRow, "events"> & { execution_events: SessionHistoryEventRow[] | null }>(r, "session_executions")),
  ]);

  const executions = executionRows.map(({ execution_events, ...e }) => ({ ...e, events: execution_events ?? [] }));
  const executionIds = executions.map((e) => e.id);
  const decisionIds = [...new Set([...debriefs.map((d) => d.decision_id), ...executions.map((e) => e.decision_id)].filter((id): id is string => id !== null))].sort();
  const prescriptionIds = [...new Set(executions.map((e) => e.final_prescription_id).filter((id): id is string => id !== null))].sort();

  const [decisions, prescriptions, sets, activities] = await Promise.all([
    decisionIds.length === 0
      ? Promise.resolve([] as SessionHistoryDecisionRow[])
      : client
          .from("decisions")
          .select("id, decision_date, final_session:daily_plan->final_session")
          .eq("athlete_id", athleteId)
          .in("id", decisionIds)
          .order("id", { ascending: true })
          .limit(cap)
          .then((r) => rowsOf<SessionHistoryDecisionRow>(r, "decisions")),
    prescriptionIds.length === 0
      ? Promise.resolve([] as SessionHistoryPrescriptionRow[])
      : client
          .from("decision_final_prescriptions")
          .select("id, structure")
          .eq("athlete_id", athleteId)
          .in("id", prescriptionIds)
          .order("id", { ascending: true })
          .limit(cap)
          .then((r) => rowsOf<SessionHistoryPrescriptionRow>(r, "decision_final_prescriptions")),
    // Results of EVERY attempt (an abandoned one may hold real work); the mapping applies corrections.
    executionIds.length === 0
      ? Promise.resolve([] as SessionHistorySetRow[])
      : client
          .from("exercise_set_results")
          .select(SET_COLUMNS)
          .eq("athlete_id", athleteId)
          .in("execution_id", executionIds)
          .order("execution_id", { ascending: true })
          .order("set_number", { ascending: true })
          .order("id", { ascending: true })
          .limit(cap)
          .then((r) => rowsOf<SessionHistorySetRow>(r, "exercise_set_results")),
    executionIds.length === 0
      ? Promise.resolve([] as SessionHistoryActivityRow[])
      : client
          .from("session_activity_results")
          .select(ACTIVITY_COLUMNS)
          .eq("athlete_id", athleteId)
          .in("execution_id", executionIds)
          .order("execution_id", { ascending: true })
          .order("id", { ascending: true })
          .limit(cap)
          .then((r) => rowsOf<SessionHistoryActivityRow>(r, "session_activity_results")),
  ]);

  return { debriefs, executions, decisions, prescriptions, sets, activities };
}
