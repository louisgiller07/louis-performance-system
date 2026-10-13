/**
 * A04 — read-only access to the input snapshot of ONE plan version
 * (`training_plan_versions.input_snapshot`): what the plan was generated
 * with (tier, equipment, DH data, terrain, availability). The daily
 * MODIFY / REPLACE adaptation builds from it — never from the live profile.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertNoSupabaseError } from "./supabaseError.js";

export interface PlanVersionSnapshotRow {
  input_snapshot: unknown;
  input_snapshot_schema_version: string;
  /** P0-3 — the version's horizon (dates it covers), to tell whether a canonical plan covers a manual session's date. */
  horizon_start_date?: string | null;
  horizon_end_date?: string | null;
}

/** The snapshot of exactly `planVersionId`, or null when no such version exists. */
export async function getPlanInputSnapshotOfVersion(client: SupabaseClient, planVersionId: string): Promise<PlanVersionSnapshotRow | null> {
  const { data, error } = await client
    .from("training_plan_versions")
    .select("input_snapshot, input_snapshot_schema_version, horizon_start_date, horizon_end_date")
    .eq("id", planVersionId)
    .maybeSingle();
  assertNoSupabaseError(error, "training_plan_versions");
  return data as PlanVersionSnapshotRow | null;
}
