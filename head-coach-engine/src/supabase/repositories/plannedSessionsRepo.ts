/**
 * Read-only access to `planned_sessions` for the current (today's) planned
 * session. See docs/05_DATA_MODEL.md §planned_sessions.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertNoSupabaseError } from "./supabaseError.js";

/** Raw shape of the columns needed by mapPlannedSessionRow (M2_003). */
export type PlannedSessionRawRow = Record<string, unknown>;

/**
 * Fetches the `planned_sessions` row for `athleteId` on exactly `date`.
 * Returns `null` if no row exists for that day — a day with no planned
 * session at all (distinct from a legacy row whose session_type can't be
 * inverted, which is handled downstream by mapPlannedSessionRow/M2_003).
 */
export async function getPlannedSessionFor(
  client: SupabaseClient,
  athleteId: string,
  date: string
): Promise<PlannedSessionRawRow | null> {
  const { data, error } = await client
    .from("planned_sessions")
    .select("session_type, intervention, planned_intent")
    .eq("athlete_id", athleteId)
    .eq("planned_date", date)
    .maybeSingle();

  assertNoSupabaseError(error, "planned_sessions");
  return data as PlannedSessionRawRow | null;
}
