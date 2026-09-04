/**
 * Read-only access to `training_blocks` — minimal: only the `mode` of the
 * current block, which is the sole `training_blocks` data M1 actually
 * consumes (`RawContext.active_mode`). `TrainingBlockRef` (id/mode/focus,
 * `RawContext.current_block`) is not built here: it is optional on
 * `RawContext` and unused anywhere in `src/{engine,rules,domains}` — see
 * M2 integration report for the grep evidence. Building it would be a
 * repository for data M1 never reads.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertNoSupabaseError } from "./supabaseError.js";

export interface CurrentTrainingBlockRow {
  mode: unknown;
}

/**
 * Fetches the athlete's current block (`is_current = true`), or `null` if
 * none exists. V0.3_004C — deliberately returns the whole row (or null)
 * rather than plucking `.mode` early: an ABSENT current row and a PRESENT
 * current row whose `mode` column happens to be NULL are two genuinely
 * different states (unconfigured athlete vs. malformed configured data)
 * that a caller must not conflate. `null` from this function means
 * exactly one thing — no current row — never "row exists but mode is
 * null", which the caller can only tell apart by reading `.mode` off a
 * non-null result.
 */
export async function getCurrentTrainingBlock(
  client: SupabaseClient,
  athleteId: string
): Promise<CurrentTrainingBlockRow | null> {
  const { data, error } = await client
    .from("training_blocks")
    .select("mode")
    .eq("athlete_id", athleteId)
    .eq("is_current", true)
    .maybeSingle();

  assertNoSupabaseError(error, "training_blocks");
  return data as CurrentTrainingBlockRow | null;
}
