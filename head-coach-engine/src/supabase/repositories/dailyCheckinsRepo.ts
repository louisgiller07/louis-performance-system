/**
 * Read-only access to `daily_checkins` for the current (today's) checkin.
 * See docs/05_DATA_MODEL.md §daily_checkins.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertNoSupabaseError } from "./supabaseError.js";

const CHECKIN_COLUMNS =
  "checkin_date, sleep_hours, sleep_quality, sleep_wake_ups, energy, work_stress, motivation, " +
  "leg_fatigue, grip_fatigue, pain, pain_intensity, pain_new, pain_location_code, " +
  "pain_traumatic, pain_function_loss, pain_getting_worse, suspected_concussion, fever_or_illness, free_comment";

/** Raw shape of the columns selected above — validated downstream by the mapper. */
export type DailyCheckinRow = Record<string, unknown>;

/**
 * Fetches the `daily_checkins` row for `athleteId` on exactly `date`
 * (`checkin_date = date`) — the "current checkin". Returns `null` if no
 * such row exists; never guesses at the most recent prior checkin.
 */
export async function getCheckinFor(
  client: SupabaseClient,
  athleteId: string,
  date: string
): Promise<DailyCheckinRow | null> {
  const { data, error } = await client
    .from("daily_checkins")
    .select(CHECKIN_COLUMNS)
    .eq("athlete_id", athleteId)
    .eq("checkin_date", date)
    .maybeSingle();

  assertNoSupabaseError(error, "daily_checkins");
  return data as DailyCheckinRow | null;
}
