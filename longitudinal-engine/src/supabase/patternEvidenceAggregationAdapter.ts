/**
 * M5_006D — read-only Supabase adapter for effective-evidence aggregation.
 * Deliberately a SEPARATE, narrow class from `SupabaseLongitudinalSourceAdapter`
 * (adapter.ts) — that class implements the closed `LongitudinalSourceAdapter`
 * interface (M5_002A's five raw source getters); this one queries a single
 * evidence VIEW, not a source table, and has nothing to do with that
 * frozen contract.
 *
 * READ-ONLY INVARIANT, same discipline as adapter.ts: exactly one
 * `.select()` query, no `.insert(`/`.update(`/`.upsert(`/`.delete(`/`.rpc(`
 * anywhere in this file — grep to verify. It queries EXCLUSIVELY
 * `pattern_evidence_current_effective` — never `pattern_evidence_current`,
 * `pattern_evidence_history`, or `pattern_evidence_current_state`. That is
 * the entire point of this milestone's future-aggregation contract (locked
 * at M5_006B's own closure): withdrawn evidence must never silently
 * re-enter an aggregate just because a caller queried the wrong view.
 *
 * OWNERSHIP: explicitly filters `.eq("athlete_id", athleteId)`, same
 * never-implicit-scoping discipline as adapter.ts, even though this
 * package only ever runs with a service-role client that bypasses RLS.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DateRange } from "../types/adapter.js";
import type { PatternEvidenceCurrentEffectiveRow } from "../aggregation/types.js";
import { mapPatternEvidenceCurrentEffectiveRow } from "./rowMapping.js";

const PATTERN_EVIDENCE_CURRENT_EFFECTIVE_COLUMNS =
  "identity_id, athlete_id, detector_rule_id, detector_rule_version, evaluation_key, evidence_key, revision_id, revision_number, supersedes_id, event_type, event_date, observed_value, revision_created_at";

export class SupabasePatternEvidenceAggregationAdapter {
  constructor(private readonly client: SupabaseClient) {}

  /** Ordered by event_date ASC, evidence_key ASC (stable tie-breaker) — aggregateEffectivePatternEvidence.ts re-sorts deterministically regardless, but a stable read order keeps this adapter's own output reproducible on its own. */
  async getCurrentEffectivePatternEvidence(athleteId: string, range: DateRange): Promise<PatternEvidenceCurrentEffectiveRow[]> {
    const { data, error } = await this.client
      .from("pattern_evidence_current_effective")
      .select(PATTERN_EVIDENCE_CURRENT_EFFECTIVE_COLUMNS)
      .eq("athlete_id", athleteId)
      .gte("event_date", range.fromDate)
      .lte("event_date", range.toDate)
      .order("event_date", { ascending: true })
      .order("evidence_key", { ascending: true });

    if (error) throw new Error(`SupabasePatternEvidenceAggregationAdapter.getCurrentEffectivePatternEvidence: ${error.code}`);
    return (data ?? []).map((row) => mapPatternEvidenceCurrentEffectiveRow(row as Record<string, unknown>));
  }
}
