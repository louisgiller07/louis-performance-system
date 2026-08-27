/**
 * M5_007 — the human-review ledger's write adapter, over
 * `persist_pattern_insight_review`. Mirrors `lifecycleAdapter.ts`'s
 * conventions exactly: unwrapped RPC error propagation (never
 * parsed/wrapped/recreated), a thin 1:1 mapping between the RPC's
 * snake_case jsonb response and a typed TS shape, no application-side
 * SELECT-then-decide logic of any kind (the RPC makes and acts on the
 * entire decision under its own lock).
 *
 * `candidate.snapshot` is ALWAYS what gets persisted as `candidate_snapshot`
 * — a caller cannot pass an arbitrary snapshot; the natural key
 * (detectorRuleId/detectorRuleVersion/insightKind) is also read from
 * `candidate.snapshot`, never accepted as a separate, potentially
 * inconsistent parameter.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PatternInsightCandidate, PatternInsightReviewDecision } from "../insights/types.js";

export interface PersistPatternInsightReviewParams {
  readonly athleteId: string;
  readonly candidate: PatternInsightCandidate;
  readonly decision: PatternInsightReviewDecision;
  readonly reviewerNote: string | null;
}

export type PersistPatternInsightReviewAction = "inserted" | "superseded" | "unchanged";

export interface PersistPatternInsightReviewResult {
  readonly identityId: string;
  readonly reviewId: string;
  readonly reviewNumber: number;
  readonly action: PersistPatternInsightReviewAction;
}

interface PersistPatternInsightReviewRpcResponse {
  readonly identity_id: string;
  readonly review_id: string;
  readonly review_number: number;
  readonly action: PersistPatternInsightReviewAction;
}

export async function persistPatternInsightReview(client: SupabaseClient, params: PersistPatternInsightReviewParams): Promise<PersistPatternInsightReviewResult> {
  const { athleteId, candidate, decision, reviewerNote } = params;

  const { data, error } = await client.rpc("persist_pattern_insight_review", {
    p_athlete_id: athleteId,
    p_detector_rule_id: candidate.snapshot.detectorRuleId,
    p_detector_rule_version: candidate.snapshot.detectorRuleVersion,
    p_insight_kind: candidate.snapshot.insightKind,
    p_decision: decision,
    p_candidate_snapshot: candidate.snapshot,
    p_reviewer_note: reviewerNote,
  });

  // Exact RPC error object propagates unwrapped — same locked contract as every other adapter in this package.
  if (error) {
    throw error;
  }

  const response = data as PersistPatternInsightReviewRpcResponse;
  return {
    identityId: response.identity_id,
    reviewId: response.review_id,
    reviewNumber: response.review_number,
    action: response.action,
  };
}
