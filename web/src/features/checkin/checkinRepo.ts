// Persistence for daily_checkins — the authenticated user's own Supabase
// client only (RLS policy daily_checkins_own_data is the sole authority on
// which athlete_id a row can belong to). Never a service/secret key.
import { supabase } from "../../lib/supabase";
import type { CheckinInput, CheckinRow } from "./checkinTypes";

// A single string literal (not a runtime concatenation) — supabase-js's
// typed query builder parses this at the type level to shape .select()'s
// return type; a `string`-typed constant built from `+` falls back to an
// untypeable `GenericStringError`.
const CHECKIN_COLUMNS =
  "checkin_date, sleep_hours, sleep_quality, sleep_wake_ups, energy, work_stress, motivation, leg_fatigue, grip_fatigue, pain, pain_intensity, pain_new, pain_location_code, pain_traumatic, pain_function_loss, pain_getting_worse, suspected_concussion, fever_or_illness, free_comment";

export class CheckinLoadError extends Error {
  constructor() {
    super("Impossible de charger le check-in du jour. Réessaie dans un instant.");
    this.name = "CheckinLoadError";
  }
}

export class CheckinSaveError extends Error {
  constructor() {
    super("Impossible d'enregistrer le check-in. Réessaie dans un instant.");
    this.name = "CheckinSaveError";
  }
}

/** Loads today's (or any given date's) checkin for the caller's own athlete. Returns null if none exists yet. */
export async function loadCheckin(athleteId: string, date: string): Promise<CheckinRow | null> {
  const { data, error } = await supabase
    .from("daily_checkins")
    .select(CHECKIN_COLUMNS)
    .eq("athlete_id", athleteId)
    .eq("checkin_date", date)
    .maybeSingle();

  if (error) {
    // Generic + error code only — never the raw PostgREST message in a
    // browser console, which can echo table/column names.
    console.error("checkinRepo.loadCheckin failed", error.code);
    throw new CheckinLoadError();
  }

  return data as CheckinRow | null;
}

/**
 * Upserts today's checkin on the real unique constraint
 * (unique_checkin_per_day, `UNIQUE (athlete_id, checkin_date)` — already
 * present since the baseline migration). Returns the row actually
 * persisted, so the caller can confirm the save without a second
 * round-trip.
 */
export async function saveCheckin(athleteId: string, date: string, values: CheckinInput): Promise<CheckinRow> {
  const { data, error } = await supabase
    .from("daily_checkins")
    .upsert({ athlete_id: athleteId, checkin_date: date, ...values }, { onConflict: "athlete_id,checkin_date" })
    .select(CHECKIN_COLUMNS)
    .single();

  if (error) {
    console.error("checkinRepo.saveCheckin failed", error.code);
    throw new CheckinSaveError();
  }

  return data as CheckinRow;
}
