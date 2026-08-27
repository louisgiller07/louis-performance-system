/**
 * M5_007 — read-only Supabase adapter over the human-review ledger's own
 * read view. Deliberately mirrors `patternEvidenceAggregationAdapter.ts`'s
 * conventions exactly: a separate, narrow class, one `.select()` query, no
 * `.insert(`/`.update(`/`.upsert(`/`.delete(`/`.rpc(` anywhere in this file
 * (grep to verify). Reads EXCLUSIVELY `pattern_insight_review_current` —
 * never `pattern_insight_review_history` — the same "current head only,
 * never the raw ledger" discipline as `pattern_evidence_current_effective`.
 *
 * OWNERSHIP: explicitly filters `.eq("athlete_id", athleteId)`, same
 * never-implicit-scoping discipline as every other adapter in this package,
 * even though this package only ever runs with a service-role client that
 * bypasses RLS.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PatternInsightReviewRecord } from "../insights/types.js";
import { mapPatternInsightReviewCurrentRow } from "./rowMapping.js";

const PATTERN_INSIGHT_REVIEW_CURRENT_COLUMNS = "athlete_id, detector_rule_id, detector_rule_version, insight_kind, review_number, decision, candidate_snapshot, reviewer_note";

export class SupabasePatternInsightReviewAdapter {
  constructor(private readonly client: SupabaseClient) {}

  async getCurrentPatternInsightReviews(athleteId: string): Promise<PatternInsightReviewRecord[]> {
    const { data, error } = await this.client.from("pattern_insight_review_current").select(PATTERN_INSIGHT_REVIEW_CURRENT_COLUMNS).eq("athlete_id", athleteId);

    if (error) throw new Error(`SupabasePatternInsightReviewAdapter.getCurrentPatternInsightReviews: ${error.code}`);
    return (data ?? []).map((row) => mapPatternInsightReviewCurrentRow(row as Record<string, unknown>));
  }
}
