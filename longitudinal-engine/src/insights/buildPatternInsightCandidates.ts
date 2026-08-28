/**
 * M5_007 — pure, deterministic insight projection over M5_006D aggregates,
 * plus human-review-state derivation. No Supabase, no clock, no random, no
 * network, no LLM anywhere in this module.
 *
 * ===========================================================================
 * Architectural boundary
 * ===========================================================================
 * Pipeline: effective evidence -> M5_006D aggregate -> M5_007 insight
 * candidate -> human review. STOPS THERE. This module MUST NOT: modify
 * coaching, modify daily-run, modify Safety, activate patterns, create
 * automatic personalization, create confidence/significance scores, infer
 * causation, use an LLM, or invent a threshold for "reviewable" — EVERY
 * aggregate produces exactly one candidate, including a single-evidence one.
 *
 * ===========================================================================
 * Direction mapping — exact, no other math
 * ===========================================================================
 * supporting_only / supporting_majority       -> supporting
 * contradicting_only / contradicting_majority -> contradicting
 * balanced                                    -> mixed
 * neutral_only                                -> neutral
 *
 * ===========================================================================
 * Review state derivation
 * ===========================================================================
 * unreviewed: no current review row exists for this candidate's identity
 * (athleteId, detectorRuleId, detectorRuleVersion, insightKind).
 * reviewed_current: a current review exists AND every fingerprint dimension
 * of its stored `candidateSnapshot` matches the freshly-built snapshot
 * exactly: insightProjectorVersion, athleteId, insightKind, detectorRuleId,
 * detectorRuleVersion, rangeFromDate, rangeToDate, sourceEvidenceRefs
 * (order-sensitive deep equality — both sides are independently produced by
 * the same deterministic sort, so a genuine content difference, never a
 * reordering artifact, is what triggers staleness here).
 * reviewed_stale: a current review exists but at least one fingerprint
 * dimension differs (e.g. the range moved, or the evidence set changed —
 * same revisionId list, added/removed identity, or even just a
 * superseding revisionId for the same identity). A stale previous
 * `accepted_as_insight` decision is reported as-is (for context) but its
 * `reviewState` is `reviewed_stale`, never silently upgraded to
 * `reviewed_current` — a caller MUST treat a stale acceptance as requiring
 * re-review, never as a still-valid acceptance.
 *
 * ===========================================================================
 * Ordering
 * ===========================================================================
 * detectorRuleId ASC, then detectorRuleVersion ASC, then insightKind ASC.
 * Input `aggregates` order never affects output order.
 */
import type { PatternEvidenceAggregate, PatternEvidenceAggregateSourceRef, PatternEvidenceBalance } from "../aggregation/types.js";
import { UnsupportedPatternInsightProjectorError } from "./errors.js";
import { INSIGHT_COPY, PATTERN_INSIGHT_PROJECTOR_VERSION, resolveInsightKind } from "./registry.js";
import type { PatternInsightCandidate, PatternInsightCandidateReviewState, PatternInsightDirection, PatternInsightReviewComparisonKey, PatternInsightReviewRecord, PatternInsightSnapshot } from "./types.js";

export interface BuildPatternInsightCandidatesInput {
  readonly aggregates: readonly PatternEvidenceAggregate[];
  readonly currentReviews: readonly PatternInsightReviewRecord[];
}

const DIRECTION_MAP: Readonly<Record<PatternEvidenceBalance, PatternInsightDirection>> = {
  supporting_only: "supporting",
  supporting_majority: "supporting",
  contradicting_only: "contradicting",
  contradicting_majority: "contradicting",
  balanced: "mixed",
  neutral_only: "neutral",
};

// NUL-separated (not space) — preserves the exact historical runtime
// identity-key semantics this module has always used (see
// resolveCandidateForReview.identityKey.test.ts for a direct proof of the
// runtime string). NUL can never occur inside athleteId/detectorRuleId/
// detectorRuleVersion/insightKind, so this remains a reliable Map-key
// separator; only the SOURCE representation changed (a textual `\u0000`
// escape, never a raw NUL byte in the file itself).
export function identityKey(athleteId: string, detectorRuleId: string, detectorRuleVersion: string, insightKind: string): string {
  return `${athleteId}\u0000${detectorRuleId}\u0000${detectorRuleVersion}\u0000${insightKind}`;
}

function sourceRefsEqual(a: readonly PatternEvidenceAggregateSourceRef[], b: readonly PatternEvidenceAggregateSourceRef[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ra = a[i]!;
    const rb = b[i]!;
    if (
      ra.identityId !== rb.identityId ||
      ra.revisionId !== rb.revisionId ||
      ra.revisionNumber !== rb.revisionNumber ||
      ra.evaluationKey !== rb.evaluationKey ||
      ra.evidenceKey !== rb.evidenceKey ||
      ra.eventType !== rb.eventType ||
      ra.eventDate !== rb.eventDate
    ) {
      return false;
    }
  }
  return true;
}

/**
 * The ONE canonical freshness comparator — used here for
 * `reviewed_current`/`reviewed_stale` derivation, and reused verbatim
 * (never re-implemented) by `resolveCandidateForReview.ts` for
 * `submit-review`'s server-side freshness check (V0.3_001C). Parameter type
 * is `PatternInsightReviewComparisonKey` — the 7 locked freshness
 * dimensions PLUS `athleteId` (server-scope/isolation, never an eighth
 * browser-supplied freshness dimension — see that type's own doc). A
 * structural subset of `PatternInsightSnapshot`, so a browser-supplied
 * freshness token — which has no `title`/`statement`/counts/ratios/etc. —
 * can be compared directly without fabricating placeholder values for
 * fields this function never reads anyway.
 */
export function fingerprintMatches(snapshot: PatternInsightReviewComparisonKey, reviewedSnapshot: PatternInsightReviewComparisonKey): boolean {
  return (
    reviewedSnapshot.insightProjectorVersion === snapshot.insightProjectorVersion &&
    reviewedSnapshot.athleteId === snapshot.athleteId &&
    reviewedSnapshot.insightKind === snapshot.insightKind &&
    reviewedSnapshot.detectorRuleId === snapshot.detectorRuleId &&
    reviewedSnapshot.detectorRuleVersion === snapshot.detectorRuleVersion &&
    reviewedSnapshot.rangeFromDate === snapshot.rangeFromDate &&
    reviewedSnapshot.rangeToDate === snapshot.rangeToDate &&
    sourceRefsEqual(reviewedSnapshot.sourceEvidenceRefs, snapshot.sourceEvidenceRefs)
  );
}

function deriveReviewState(snapshot: PatternInsightSnapshot, review: PatternInsightReviewRecord | null): PatternInsightCandidateReviewState {
  if (!review) return "unreviewed";
  return fingerprintMatches(snapshot, review.candidateSnapshot) ? "reviewed_current" : "reviewed_stale";
}

function projectSnapshot(aggregate: PatternEvidenceAggregate): PatternInsightSnapshot {
  const insightKind = resolveInsightKind(aggregate.detectorRuleId, aggregate.detectorRuleVersion);
  if (!insightKind) {
    throw new UnsupportedPatternInsightProjectorError(aggregate.detectorRuleId, aggregate.detectorRuleVersion);
  }

  const direction = DIRECTION_MAP[aggregate.evidenceBalance];
  const copy = INSIGHT_COPY[insightKind];

  return {
    insightProjectorVersion: PATTERN_INSIGHT_PROJECTOR_VERSION,
    athleteId: aggregate.athleteId,
    insightKind,
    detectorRuleId: aggregate.detectorRuleId,
    detectorRuleVersion: aggregate.detectorRuleVersion,
    rangeFromDate: aggregate.rangeFromDate,
    rangeToDate: aggregate.rangeToDate,
    direction,
    title: copy.title,
    statement: copy.statements[direction],
    caveats: copy.caveats,
    evidenceCount: aggregate.evidenceCount,
    supportingCount: aggregate.supportingCount,
    contradictingCount: aggregate.contradictingCount,
    neutralCount: aggregate.neutralCount,
    directionalEvidenceCount: aggregate.directionalEvidenceCount,
    supportingRatio: aggregate.supportingRatio,
    contradictingRatio: aggregate.contradictingRatio,
    neutralRatio: aggregate.neutralRatio,
    evidenceBalance: aggregate.evidenceBalance,
    firstEventDate: aggregate.firstEventDate,
    lastEventDate: aggregate.lastEventDate,
    sourceEvidenceRefs: aggregate.sourceEvidenceRefs,
  };
}

function compareCandidates(a: PatternInsightCandidate, b: PatternInsightCandidate): number {
  if (a.snapshot.detectorRuleId !== b.snapshot.detectorRuleId) return a.snapshot.detectorRuleId < b.snapshot.detectorRuleId ? -1 : 1;
  if (a.snapshot.detectorRuleVersion !== b.snapshot.detectorRuleVersion) return a.snapshot.detectorRuleVersion < b.snapshot.detectorRuleVersion ? -1 : 1;
  if (a.snapshot.insightKind !== b.snapshot.insightKind) return a.snapshot.insightKind < b.snapshot.insightKind ? -1 : 1;
  return 0;
}

/** Every aggregate produces exactly one candidate — `aggregates=[]` produces `[]`. Throws {@link UnsupportedPatternInsightProjectorError} for any (detectorRuleId, detectorRuleVersion) outside the locked 3-entry registry. */
export function buildPatternInsightCandidates(input: BuildPatternInsightCandidatesInput): readonly PatternInsightCandidate[] {
  const reviewsByIdentity = new Map<string, PatternInsightReviewRecord>();
  for (const review of input.currentReviews) {
    reviewsByIdentity.set(identityKey(review.athleteId, review.detectorRuleId, review.detectorRuleVersion, review.insightKind), review);
  }

  const candidates = input.aggregates.map((aggregate): PatternInsightCandidate => {
    const snapshot = projectSnapshot(aggregate);
    const review = reviewsByIdentity.get(identityKey(snapshot.athleteId, snapshot.detectorRuleId, snapshot.detectorRuleVersion, snapshot.insightKind)) ?? null;
    return {
      snapshot,
      reviewState: deriveReviewState(snapshot, review),
      currentReview: review,
    };
  });

  return [...candidates].sort(compareCandidates);
}
