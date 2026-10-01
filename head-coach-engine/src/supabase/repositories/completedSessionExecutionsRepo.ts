/**
 * UX-11B.2.4b — V2 executions COMPLETED in M1's recent-load window, for the
 * daily context bridge (see mapping/recentSessionsForDailyContext.ts).
 *
 * Canonical completion (schema UX-11B.2): an execution is completed iff it
 * has an `execution_events` row of type `completed`. `completed` and
 * `abandoned` are terminal and mutually exclusive (record_session_execution
 * refuses any event after either), so a started-only, paused, resumed or
 * abandoned attempt never appears here. Executions are append-only and are
 * never superseded; set corrections (`supersedes_id`) concern
 * exercise_set_results only, which this read does not use.
 *
 * The session's intervention is the decision's own M1 output
 * (`decisions.daily_plan.final_session`): exactly what the final prescription
 * the rider executed was built for. An execution without decision (no final
 * prescription) carries no intervention.
 *
 * One query (embedded events + decision), deterministic order.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertNoSupabaseError } from "./supabaseError.js";

export interface CompletedExecutionRow {
  executionId: string;
  sessionDate: string;
  decisionId: string;
  /** decisions.daily_plan.final_session (null when the decision has no daily_plan, e.g. pre-M2 rows). */
  finalSession: unknown;
}

export async function getCompletedExecutionsInWindow(
  client: SupabaseClient,
  athleteId: string,
  windowStart: string,
  today: string
): Promise<CompletedExecutionRow[]> {
  const { data, error } = await client
    .from("session_executions")
    .select("id, session_date, decision_id, execution_events!inner(event_type), decisions(final_session:daily_plan->final_session)")
    .eq("athlete_id", athleteId)
    .eq("execution_events.event_type", "completed")
    .not("decision_id", "is", null)
    .gte("session_date", windowStart)
    .lte("session_date", today)
    .order("session_date", { ascending: true })
    .order("id", { ascending: true });

  assertNoSupabaseError(error, "session_executions (completed)");
  // A many-to-one embed comes back as one object (typed as an array by the generic client).
  type Embedded = { final_session: unknown } | Array<{ final_session: unknown }> | null;
  return ((data ?? []) as unknown as Array<{ id: string; session_date: string; decision_id: string; decisions: Embedded }>).map((row) => {
    const decision = Array.isArray(row.decisions) ? (row.decisions[0] ?? null) : row.decisions;
    return { executionId: row.id, sessionDate: row.session_date, decisionId: row.decision_id, finalSession: decision?.final_session ?? null };
  });
}
