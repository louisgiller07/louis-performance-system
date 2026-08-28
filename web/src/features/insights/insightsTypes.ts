// V0.3_001C-3 — browser-side mirror of the get-insights / submit-review
// contract (supabase/functions/get-insights, supabase/functions/submit-review).
// The server candidate snapshot remains authoritative: no separate
// candidateId is invented here, and the UI never constructs its own
// identity for a candidate — it is always (detectorRuleId) within the
// caller's own already-authenticated scope, exactly as the backend selector
// works (see docs/06_ARCHITECTURE.md's "Sélecteur de candidat et
// cardinalité").

export type PatternInsightKind = "recommendation_execution_alignment" | "sleep_energy_same_day_association" | "pain_persistence_between_recent_checkins";

export type PatternInsightDirection = "supporting" | "contradicting" | "mixed" | "neutral";

export type PatternEvidenceBalance = "neutral_only" | "supporting_only" | "contradicting_only" | "supporting_majority" | "contradicting_majority" | "balanced";

export type PatternEvidenceEventType = "supporting" | "contradicting" | "neutral";

/** Evidence provenance — technical identity fields (identityId/revisionId/...) are carried for round-tripping into submit-review but are never rendered as athlete-facing UI. */
export interface PatternEvidenceSourceRef {
  readonly identityId: string;
  readonly revisionId: string;
  readonly revisionNumber: number;
  readonly evaluationKey: string;
  readonly evidenceKey: string;
  readonly eventType: PatternEvidenceEventType;
  readonly eventDate: string;
}

/** Exactly the 23-field server snapshot (longitudinal-engine/src/insights/types.ts) — the browser never constructs one of these, only reads it. */
export interface PatternInsightSnapshot {
  readonly insightProjectorVersion: string;
  readonly athleteId: string;
  readonly insightKind: PatternInsightKind;
  readonly detectorRuleId: string;
  readonly detectorRuleVersion: string;
  readonly rangeFromDate: string;
  readonly rangeToDate: string;
  readonly direction: PatternInsightDirection;
  readonly title: string;
  readonly statement: string;
  readonly caveats: readonly string[];
  readonly evidenceCount: number;
  readonly supportingCount: number;
  readonly contradictingCount: number;
  readonly neutralCount: number;
  readonly directionalEvidenceCount: number;
  readonly supportingRatio: number | null;
  readonly contradictingRatio: number | null;
  readonly neutralRatio: number;
  readonly evidenceBalance: PatternEvidenceBalance;
  readonly firstEventDate: string;
  readonly lastEventDate: string;
  readonly sourceEvidenceRefs: readonly PatternEvidenceSourceRef[];
}

export type PatternInsightReviewDecision = "accepted_as_insight" | "dismissed" | "needs_more_evidence";

export type PatternInsightCandidateReviewState = "unreviewed" | "reviewed_current" | "reviewed_stale";

export interface PatternInsightReviewRecord {
  readonly athleteId: string;
  readonly detectorRuleId: string;
  readonly detectorRuleVersion: string;
  readonly insightKind: PatternInsightKind;
  readonly decision: PatternInsightReviewDecision;
  readonly reviewNumber: number;
  readonly reviewerNote: string | null;
  readonly candidateSnapshot: PatternInsightSnapshot;
}

export interface PatternInsightCandidate {
  readonly snapshot: PatternInsightSnapshot;
  readonly reviewState: PatternInsightCandidateReviewState;
  readonly currentReview: PatternInsightReviewRecord | null;
}

export interface GetInsightsResponse {
  readonly range: { readonly fromDate: string; readonly toDate: string };
  readonly candidates: readonly PatternInsightCandidate[];
}

/**
 * Exactly the locked submit-review request contract
 * (supabase/functions/submit-review/requestValidation.ts) — the 7 freshness
 * dimensions (from `candidate.snapshot`, never invented) plus `decision`
 * plus optional `reviewerNote`. Never `athleteId` (server-resolved only),
 * never `candidateSnapshot`/`candidate`, never any other snapshot field.
 */
export interface SubmitReviewRequestBody {
  readonly detectorRuleId: string;
  readonly detectorRuleVersion: string;
  readonly insightKind: PatternInsightKind;
  readonly insightProjectorVersion: string;
  readonly rangeFromDate: string;
  readonly rangeToDate: string;
  readonly sourceEvidenceRefs: readonly PatternEvidenceSourceRef[];
  readonly decision: PatternInsightReviewDecision;
  readonly reviewerNote: string | null;
}

export interface SubmitReviewSuccess {
  readonly action: "inserted" | "superseded" | "unchanged";
  readonly reviewNumber: number;
}
