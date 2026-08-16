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

/**
 * Fetches `training_blocks.mode` for the athlete's current block
 * (`is_current = true`). Returns `null` if no current block exists —
 * never guesses/defaults a mode.
 */
export async function getCurrentTrainingModeRaw(
  client: SupabaseClient,
  athleteId: string
): Promise<unknown> {
  const { data, error } = await client
    .from("training_blocks")
    .select("mode")
    .eq("athlete_id", athleteId)
    .eq("is_current", true)
    .maybeSingle();

  assertNoSupabaseError(error, "training_blocks");
  return data ? (data as Record<string, unknown>).mode : null;
}
