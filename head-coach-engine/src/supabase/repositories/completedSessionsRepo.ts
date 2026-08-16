/**
 * Read-only access to `completed_sessions`, windowed to the recent-load
 * lookback. See docs/05_DATA_MODEL.md §completed_sessions.
 *
 * Window bound reuses M1's own `PROVISIONAL_THRESHOLDS.recentLoad.windowDays`
 * (read-only import from the frozen engine) — `computeRecentLoad`
 * (src/engine/recentLoad.ts) re-filters by age itself, so this is a
 * query-efficiency superset, not a re-decided business rule.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { PROVISIONAL_THRESHOLDS } from "../../engine/provisionalThresholds.js";
import { assertNoSupabaseError } from "./supabaseError.js";

export type CompletedSessionRawRow = Record<string, unknown>;

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Fetches `completed_sessions` rows for `athleteId` with
 * `session_date` in [today - windowDays, today].
 */
export async function getRecentSessions(
  client: SupabaseClient,
  athleteId: string,
  today: string
): Promise<CompletedSessionRawRow[]> {
  const windowStart = addDays(today, -PROVISIONAL_THRESHOLDS.recentLoad.windowDays);

  const { data, error } = await client
    .from("completed_sessions")
    .select("session_date, session_type, intervention")
    .eq("athlete_id", athleteId)
    .gte("session_date", windowStart)
    .lte("session_date", today);

  assertNoSupabaseError(error, "completed_sessions");
  return (data ?? []) as CompletedSessionRawRow[];
}
