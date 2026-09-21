/**
 * Read-only access to `training_plan_current_version` — the M2.5 pointer
 * table recording which canonical `TrainingPlanVersion` is currently
 * accepted for an athlete (at most one row per athlete, `athlete_id` is its
 * own primary key). See supabase/migrations/20260921090500_v0_4_001b_
 * training_plan_lifecycle.sql.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertNoSupabaseError } from "./supabaseError.js";

/** Raw shape of the single column this repository reads. */
export interface CurrentPlanVersionRow {
  plan_version_id: string;
}

/**
 * Fetches the athlete's currently accepted plan version id, or `null` if no
 * plan has ever been accepted for this athlete — a real, legitimate state
 * (an athlete with no active canonical plan), never an error.
 */
export async function getCurrentPlanVersion(
  client: SupabaseClient,
  athleteId: string
): Promise<CurrentPlanVersionRow | null> {
  const { data, error } = await client
    .from("training_plan_current_version")
    .select("plan_version_id")
    .eq("athlete_id", athleteId)
    .maybeSingle();

  assertNoSupabaseError(error, "training_plan_current_version");
  return data as CurrentPlanVersionRow | null;
}
