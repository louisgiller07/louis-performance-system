/**
 * Read-only access to open `health_flags`. See docs/05_DATA_MODEL.md
 * §health_flags — discriminant column is `flag_type` (not `type`), mapped
 * to the domain `HealthFlag.type` downstream. Read-only: this module never
 * creates or resolves a flag.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertNoSupabaseError } from "./supabaseError.js";

export type HealthFlagRawRow = Record<string, unknown>;

/**
 * Fetches `health_flags` rows for `athleteId` with
 * `status IN ('active', 'monitoring')` — the flags SAFETY A5 and
 * `active_health_flags` need to know about. Resolved flags are excluded.
 */
export async function getOpenHealthFlags(
  client: SupabaseClient,
  athleteId: string
): Promise<HealthFlagRawRow[]> {
  const { data, error } = await client
    .from("health_flags")
    .select("flag_type, status")
    .eq("athlete_id", athleteId)
    .in("status", ["active", "monitoring"]);

  assertNoSupabaseError(error, "health_flags");
  return (data ?? []) as HealthFlagRawRow[];
}
