/**
 * PHYS-02 — the rider's recorded endurance sessions, for the endurance
 * guidance of today's final prescription (dailyV2/enduranceGuidance.ts).
 *
 * Reads only COMPLETED executions (an `execution_events` row of type
 * `completed`, the canonical completion — UX-11B.2) dated in
 * [windowStart, beforeDate[, with the final prescription each one executed
 * (its `structure`: the protocol performed that day), then the activity
 * results of those executions. Abandoned or open attempts are never read.
 * Corrections (`supersedes_id`) are returned as stored: the pure mapping
 * keeps the active row.
 *
 * Two queries, deterministic order. Read-only.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertNoSupabaseError } from "./supabaseError.js";
import type { CompletedStrengthExecutionRow } from "./strengthSetHistoryRepo.js";

export type CompletedExecutionRow = CompletedStrengthExecutionRow;

export interface ActivityResultHistoryRow {
  id: string;
  execution_id: string;
  activity_id: string;
  duration_seconds: number;
  distance_m: number | null;
  rpe_actual: number | string | null;
  supersedes_id: string | null;
}

export interface EnduranceActivityHistoryRead {
  executions: CompletedExecutionRow[];
  activities: ActivityResultHistoryRow[];
}

export async function getCompletedEnduranceActivityHistory(
  client: SupabaseClient,
  athleteId: string,
  windowStart: string,
  beforeDate: string
): Promise<EnduranceActivityHistoryRead> {
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
  assertNoSupabaseError(error, "session_executions (completed, endurance history)");

  type Embedded = { structure: unknown } | Array<{ structure: unknown }> | null;
  const executions = ((data ?? []) as unknown as Array<{ id: string; session_date: string; decision_final_prescriptions: Embedded }>).map((row) => {
    const fp = Array.isArray(row.decision_final_prescriptions) ? (row.decision_final_prescriptions[0] ?? null) : row.decision_final_prescriptions;
    return { executionId: row.id, sessionDate: row.session_date, structure: fp?.structure ?? null };
  });
  if (executions.length === 0) return { executions: [], activities: [] };

  const { data: rows, error: rowsError } = await client
    .from("session_activity_results")
    .select("id, execution_id, activity_id, duration_seconds, distance_m, rpe_actual, supersedes_id")
    .eq("athlete_id", athleteId)
    .in(
      "execution_id",
      executions.map((e) => e.executionId)
    )
    .order("execution_id", { ascending: true })
    .order("occurred_at", { ascending: true })
    .order("id", { ascending: true });
  assertNoSupabaseError(rowsError, "session_activity_results (endurance history)");

  return { executions, activities: (rows ?? []) as ActivityResultHistoryRow[] };
}
