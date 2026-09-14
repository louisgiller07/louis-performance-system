/**
 * V0.3_008B — the first-ever engine read of `decisions` (every prior
 * `daily-run` read path is write-only against this table — see
 * `mapping/dailyPlanToDecisionRow.ts` — no `decisionsRepo.ts` existed
 * before this file, confirmed at V0.3_008B's architecture lock). Deliberately
 * narrow and single-purpose: batch-resolves exactly the candidate decisions
 * technical continuity needs, never a generic decisions-history repository.
 *
 * `daily-run` reads via `supabaseAdmin`/`service_role` — RLS does not
 * protect this call. `athleteId` is explicitly filtered here even though
 * every `decisionId` passed in already comes from this same athlete's own
 * `completed_sessions.decision_id` — defense in depth, matching every other
 * privileged repository query (see docs/11_DECISION_LOG.md V0.3_008B §14).
 * A stale/foreign/cross-athlete id is simply absent from the result, never
 * an error.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertNoSupabaseError } from "./supabaseError.js";

export interface DecisionRawRow {
  id: string;
  decision_date: string;
  daily_plan: unknown;
}

/** Batch-fetches `decisions` rows by exact `id`, scoped to `athleteId`. No-op (empty result, no query) is the caller's responsibility for an empty `decisionIds` list — this function always issues the query it's given. */
export async function getDecisionsByIds(
  client: SupabaseClient,
  athleteId: string,
  decisionIds: readonly string[]
): Promise<DecisionRawRow[]> {
  const { data, error } = await client
    .from("decisions")
    .select("id, decision_date, daily_plan")
    .eq("athlete_id", athleteId)
    .in("id", decisionIds as string[]);

  assertNoSupabaseError(error, "decisions");
  return (data ?? []) as DecisionRawRow[];
}
