/**
 * PHYS-01 — the rider's recorded Force sets, for the load guidance of today's
 * final prescription (dailyV2/strengthLoadGuidance.ts).
 *
 * Reads only COMPLETED executions (an `execution_events` row of type
 * `completed`, the canonical completion — UX-11B.2) dated in
 * [windowStart, beforeDate[, with the final prescription each one executed
 * (its `structure`: what was prescribed that day), then the set results of
 * the requested exercises in those executions. Abandoned or open attempts are
 * never read. Corrections (`supersedes_id`) are returned as stored: the pure
 * mapping keeps the active rows.
 *
 * Two queries, deterministic order. Read-only.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertNoSupabaseError } from "./supabaseError.js";

export interface CompletedStrengthExecutionRow {
  executionId: string;
  sessionDate: string;
  /** decision_final_prescriptions.structure of the execution (null: none). */
  structure: unknown;
}

export interface StrengthSetResultRow {
  id: string;
  execution_id: string;
  prescription_item_id: string | null;
  exercise_id: string | null;
  set_number: number;
  done: boolean;
  measure_type: string;
  measure_value: number | null;
  load_kg: number | string | null;
  rpe_actual: number | string | null;
  supersedes_id: string | null;
}

export interface StrengthSetHistoryRead {
  executions: CompletedStrengthExecutionRow[];
  sets: StrengthSetResultRow[];
}

export async function getCompletedStrengthSetHistory(
  client: SupabaseClient,
  athleteId: string,
  exerciseIds: readonly string[],
  windowStart: string,
  beforeDate: string
): Promise<StrengthSetHistoryRead> {
  if (exerciseIds.length === 0) return { executions: [], sets: [] };
  const { data, error } = await client
    .from("session_executions")
    .select("id, session_date, final_prescription_id, execution_events!inner(event_type), decision_final_prescriptions(structure)")
    .eq("athlete_id", athleteId)
    .eq("execution_events.event_type", "completed")
    .not("final_prescription_id", "is", null)
    .gte("session_date", windowStart)
    .lt("session_date", beforeDate)
    .order("session_date", { ascending: true })
    .order("id", { ascending: true });
  assertNoSupabaseError(error, "session_executions (completed, strength history)");

  type Embedded = { structure: unknown } | Array<{ structure: unknown }> | null;
  const executions = ((data ?? []) as unknown as Array<{ id: string; session_date: string; decision_final_prescriptions: Embedded }>).map((row) => {
    const fp = Array.isArray(row.decision_final_prescriptions) ? (row.decision_final_prescriptions[0] ?? null) : row.decision_final_prescriptions;
    return { executionId: row.id, sessionDate: row.session_date, structure: fp?.structure ?? null };
  });
  if (executions.length === 0) return { executions: [], sets: [] };

  const { data: setRows, error: setError } = await client
    .from("exercise_set_results")
    .select("id, execution_id, prescription_item_id, exercise_id, set_number, done, measure_type, measure_value, load_kg, rpe_actual, supersedes_id")
    .eq("athlete_id", athleteId)
    .in(
      "execution_id",
      executions.map((e) => e.executionId)
    )
    .in("exercise_id", [...exerciseIds])
    .order("execution_id", { ascending: true })
    .order("set_number", { ascending: true })
    .order("id", { ascending: true });
  assertNoSupabaseError(setError, "exercise_set_results (strength history)");

  return { executions, sets: (setRows ?? []) as StrengthSetResultRow[] };
}
