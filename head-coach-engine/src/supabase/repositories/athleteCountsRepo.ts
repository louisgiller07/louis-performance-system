/**
 * Read-only counts backing `RawContext.n_total_checkins` /
 * `n_total_completed_sessions` — genuine historical counts (docs/05
 * describes these as "indicateurs contextuels", not thresholds M1 uses for
 * decisions), never estimated.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertNoSupabaseError } from "./supabaseError.js";

export async function getTotalCheckinsCount(client: SupabaseClient, athleteId: string): Promise<number> {
  const { count, error } = await client
    .from("daily_checkins")
    .select("*", { count: "exact", head: true })
    .eq("athlete_id", athleteId);

  assertNoSupabaseError(error, "daily_checkins count");
  return count ?? 0;
}

export async function getTotalCompletedSessionsCount(client: SupabaseClient, athleteId: string): Promise<number> {
  const { count, error } = await client
    .from("completed_sessions")
    .select("*", { count: "exact", head: true })
    .eq("athlete_id", athleteId);

  assertNoSupabaseError(error, "completed_sessions count");
  return count ?? 0;
}
