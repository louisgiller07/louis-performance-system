/**
 * Read/write access to `athlete_locked_dates` (V0.4_101 — Performance
 * Setup) — dates fully off-limits to the planner, multiple rows per
 * athlete.
 *
 * Write access exists for admin/fixture population ahead of any Performance
 * Setup UI, same justification as athletePerformanceProfileRepo.ts. No
 * runtime consumer exists yet.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertNoSupabaseError } from "./supabaseError.js";

export interface AthleteLockedDateRawRow {
  id: string;
  date: string;
  reason: string | null;
}

/** Fetches every locked date declared for `athleteId`. An athlete with none returns an empty array, never an error. */
export async function getLockedDatesFor(
  client: SupabaseClient,
  athleteId: string
): Promise<AthleteLockedDateRawRow[]> {
  const { data, error } = await client
    .from("athlete_locked_dates")
    .select("id, date, reason")
    .eq("athlete_id", athleteId);

  assertNoSupabaseError(error, "athlete_locked_dates");
  return (data ?? []) as AthleteLockedDateRawRow[];
}

export interface AthleteLockedDateUpsert {
  date: string;
  reason?: string;
}

/**
 * Upserts one locked date for `athleteId` — `unique (athlete_id, date)`
 * means a date is always at most one locked-date row, so re-declaring the
 * same date replaces it (e.g. updating the reason) rather than conflicting.
 */
export async function upsertLockedDate(
  client: SupabaseClient,
  athleteId: string,
  lockedDate: AthleteLockedDateUpsert
): Promise<void> {
  const { error } = await client
    .from("athlete_locked_dates")
    .upsert({ athlete_id: athleteId, ...lockedDate }, { onConflict: "athlete_id,date" });

  assertNoSupabaseError(error, "athlete_locked_dates");
}
