/**
 * Read/write access to `athlete_availability_windows` (V0.4_101 — Performance
 * Setup) — recurring weekly availability, multiple rows per athlete (unlike
 * the single-row profile tables in this directory).
 *
 * Write access exists for admin/fixture population ahead of any Performance
 * Setup UI, same justification as athletePerformanceProfileRepo.ts. No
 * runtime consumer exists yet.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertNoSupabaseError } from "./supabaseError.js";

export interface AthleteAvailabilityWindowRawRow {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  label: string | null;
}

/** Fetches every recurring availability window declared for `athleteId`. An athlete with none returns an empty array, never an error. */
export async function getAvailabilityWindowsFor(
  client: SupabaseClient,
  athleteId: string
): Promise<AthleteAvailabilityWindowRawRow[]> {
  const { data, error } = await client
    .from("athlete_availability_windows")
    .select("id, day_of_week, start_time, end_time, label")
    .eq("athlete_id", athleteId);

  assertNoSupabaseError(error, "athlete_availability_windows");
  return (data ?? []) as AthleteAvailabilityWindowRawRow[];
}

export interface AthleteAvailabilityWindowInsert {
  day_of_week: number;
  start_time: string;
  end_time: string;
  label?: string;
}

/**
 * Inserts one new recurring availability window for `athleteId`. Always an
 * insert, never an upsert: multiple windows per athlete are expected and
 * legitimate (no uniqueness key identifies "the same" window to replace).
 */
export async function insertAvailabilityWindow(
  client: SupabaseClient,
  athleteId: string,
  window: AthleteAvailabilityWindowInsert
): Promise<void> {
  const { error } = await client
    .from("athlete_availability_windows")
    .insert({ athlete_id: athleteId, ...window });

  assertNoSupabaseError(error, "athlete_availability_windows");
}
