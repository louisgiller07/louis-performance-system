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
    .select("session_type, intervention, planned_intent, is_committed")
    .eq("athlete_id", athleteId)
    .eq("planned_date", date)
    .maybeSingle();

  assertNoSupabaseError(error, "planned_sessions");
  return data as PlannedSessionRawRow | null;
}

/**
 * V0.5_047/048 — reads only the generated-session lineage of today's
 * `planned_sessions` row, deliberately separate from `getPlannedSessionFor`
 * above (never touched — that function feeds M1 via buildRawContext and
 * stays exactly as it was). Returns `null` both when no row exists for the
 * date, and when a row exists but was never sourced from a generated plan
 * (a manual/legacy session, or a date with no accepted plan coverage) —
 * both are legitimate, never an error (see planning-engine's
 * `ActiveSessionOrigin: "no_canonical_plan"` for the same distinction).
 */
export async function getProjectedGeneratedSessionIdForDate(
  client: SupabaseClient,
  athleteId: string,
  date: string
): Promise<string | null> {
  const { data, error } = await client
    .from("planned_sessions")
    .select("source_generated_session_id")
    .eq("athlete_id", athleteId)
    .eq("planned_date", date)
    .maybeSingle();

  assertNoSupabaseError(error, "planned_sessions");
  return (data as { source_generated_session_id: string | null } | null)?.source_generated_session_id ?? null;
}
