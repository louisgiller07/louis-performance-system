/**
 * Read-only access to `training_plan_blocks` — the canonical mesocycle
 * table within one accepted `TrainingPlanVersion`. Not to be confused with
 * the existing, legacy `training_blocks` table (the compatibility
 * projection this repository's caller writes into) — different table,
 * different schema, same name minus "plan". See
 * supabase/migrations/20260921091000_v0_4_001c_training_plan_hierarchy.sql.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertNoSupabaseError } from "./supabaseError.js";

/** Raw shape of the columns needed to build a training_blocks projection candidate. */
export interface CurrentGeneratedBlockRow {
  id: string;
  name: string;
  mode: string;
  primary_focus: string;
  start_date: string;
  end_date: string;
}

/**
 * Fetches the `training_plan_blocks` row of `planVersionId` whose
 * `[start_date, end_date]` covers `date`, or `null` if none does (e.g. the
 * date falls outside the version's horizon). At most one row can ever
 * match — blocks within one version are non-overlapping, enforced by the
 * canonical schema's own trigger (check_training_plan_block_no_overlap).
 */
export async function getCurrentGeneratedBlock(
  client: SupabaseClient,
  planVersionId: string,
  date: string
): Promise<CurrentGeneratedBlockRow | null> {
  const { data, error } = await client
    .from("training_plan_blocks")
    .select("id, name, mode, primary_focus, start_date, end_date")
    .eq("plan_version_id", planVersionId)
    .lte("start_date", date)
    .gte("end_date", date)
    .maybeSingle();

  assertNoSupabaseError(error, "training_plan_blocks");
  return data as CurrentGeneratedBlockRow | null;
}
