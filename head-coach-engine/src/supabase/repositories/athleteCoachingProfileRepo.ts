/**
 * Read-only access to `athlete_coaching_profiles` (V0.3_004A) — the
 * athlete's personal coaching content (technique focus, mental pre-race
 * cue). `athlete_id` is the table's PRIMARY KEY, so at most one row can
 * ever exist per athlete: 0 rows means "not yet configured", never an
 * error, never a fabricated default.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertNoSupabaseError } from "./supabaseError.js";

export interface AthleteCoachingProfileRawRow {
  technique_primary_focus: string | null;
  mental_pre_race_cue: string | null;
}

/**
 * Fetches the `athlete_coaching_profiles` row for `athleteId`, or `null`
 * if the athlete has never configured one. Explicitly scoped by
 * `athlete_id` even though `athlete_id` is already the PK — matches the
 * same explicit-filter discipline used by every other RawContext-
 * contributing repository, never a bare `.single()`/global lookup.
 */
export async function getCoachingProfileFor(
  client: SupabaseClient,
  athleteId: string
): Promise<AthleteCoachingProfileRawRow | null> {
  const { data, error } = await client
    .from("athlete_coaching_profiles")
    .select("technique_primary_focus, mental_pre_race_cue")
    .eq("athlete_id", athleteId)
    .maybeSingle();

  assertNoSupabaseError(error, "athlete_coaching_profiles");
  return (data as AthleteCoachingProfileRawRow | null) ?? null;
}
