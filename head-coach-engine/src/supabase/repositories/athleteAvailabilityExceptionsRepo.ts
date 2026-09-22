/**
 * Read/write access to `athlete_availability_exceptions` (V0.4_101 —
 * Performance Setup) — one-off date overrides, multiple rows per athlete.
 *
 * Write access exists for admin/fixture population ahead of any Performance
 * Setup UI, same justification as athletePerformanceProfileRepo.ts. No
 * runtime consumer exists yet.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertNoSupabaseError } from "./supabaseError.js";

export interface AthleteAvailabilityExceptionRawRow {
  id: string;
  date: string;
  available: boolean;
  note: string | null;
}

/** Fetches every availability exception declared for `athleteId`. An athlete with none returns an empty array, never an error. */
export async function getAvailabilityExceptionsFor(
  client: SupabaseClient,
  athleteId: string
): Promise<AthleteAvailabilityExceptionRawRow[]> {
  const { data, error } = await client
    .from("athlete_availability_exceptions")
    .select("id, date, available, note")
    .eq("athlete_id", athleteId);

  assertNoSupabaseError(error, "athlete_availability_exceptions");
  return (data ?? []) as AthleteAvailabilityExceptionRawRow[];
}

export interface AthleteAvailabilityExceptionUpsert {
  date: string;
  available: boolean;
  note?: string;
}

/**
 * Upserts one availability exception for `athleteId` on the given date —
 * `unique (athlete_id, date)` means a date is always at most one exception,
 * so re-declaring the same date replaces it rather than conflicting.
 */
export async function upsertAvailabilityException(
  client: SupabaseClient,
  athleteId: string,
  exception: AthleteAvailabilityExceptionUpsert
): Promise<void> {
  const { error } = await client
    .from("athlete_availability_exceptions")
    .upsert({ athlete_id: athleteId, ...exception }, { onConflict: "athlete_id,date" });

  assertNoSupabaseError(error, "athlete_availability_exceptions");
}
