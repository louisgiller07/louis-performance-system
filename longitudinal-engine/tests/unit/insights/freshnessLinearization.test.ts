/**
 * V0.3_001C — deterministic unit-level proof of the locked freshness
 * linearization semantics (docs/11_DECISION_LOG.md, "V0.3_001C :
 * verrouillage de la sémantique de linéarisation de fraîcheur", 2026-08-28):
 * freshness linearizes at the successful server comparison, NOT through
 * persistence commit. A candidate that was fresh AT THE COMPARISON MOMENT
 * remains valid to persist even if the underlying evidence changes
 * immediately afterward — the resulting review may legitimately project
 * `reviewed_stale` on a later read, and that is expected, not an error.
 *
 * This is a pure-function proof: it simulates the two DB reads a real
 * submit-review request would make in two SEPARATE transactions (exactly
 * as the real architecture does — see docs/06_ARCHITECTURE.md's own
 * "Edge read + RPC same transaction = NO" finding) by calling
 * buildPatternInsightCandidates twice against two different evidence
 * snapshots, never inside one call. The full real-DB/HTTP proof (mutate
 * real evidence between a real submit-review call and a real get-insights
 * read) is out of scope for this pure-unit slice — see V0.3_001C-1 spec
 * §22.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { buildPatternInsightCandidates, resolveCandidateForReview } from "../../../src/insights/index.js";
import type { PatternInsightReviewRecord } from "../../../src/insights/index.js";
import type { PatternEvidenceAggregate, PatternEvidenceAggregateSourceRef } from "../../../src/aggregation/index.js";
import { nextId, resetIdSequence } from "../timeline/fixtures.js";

beforeEach(() => resetIdSequence());

const ATHLETE_A = "athlete-a";
const RANGE = { fromDate: "1900-01-01", toDate: "9999-12-31" };
const RECOMMENDATION_RULE_ID = "recommendation_vs_actual_execution";
const RULE_VERSION = "1.0.0";

function sourceRef(overrides: Partial<PatternEvidenceAggregateSourceRef> = {}): PatternEvidenceAggregateSourceRef {
  return {
    identityId: nextId("identity"),
    revisionId: nextId("revision"),
    revisionNumber: 1,
    evaluationKey: nextId("eval"),
    evidenceKey: nextId("evidence"),
    eventType: "supporting",
    eventDate: "2026-06-10",
    ...overrides,
  };
}

function aggregateFixture(overrides: Partial<PatternEvidenceAggregate> = {}): PatternEvidenceAggregate {
  return {
    athleteId: ATHLETE_A,
    detectorRuleId: RECOMMENDATION_RULE_ID,
    detectorRuleVersion: RULE_VERSION,
    rangeFromDate: RANGE.fromDate,
    rangeToDate: RANGE.toDate,
    evidenceCount: 1,
    supportingCount: 1,
    contradictingCount: 0,
    neutralCount: 0,
    directionalEvidenceCount: 1,
    supportingRatio: 1,
    contradictingRatio: 0,
    neutralRatio: 0,
    evidenceBalance: "supporting_only",
    firstEventDate: "2026-06-10",
    lastEventDate: "2026-06-10",
    sourceEvidenceRefs: [sourceRef({ evidenceKey: "original-evidence" })],
    ...overrides,
  };
}

describe("freshness linearization (semantics A, locked 2026-08-28)", () => {
  it("candidate fresh at comparison time remains valid to persist even after a later evidence mutation, and the persisted review then projects reviewed_stale", () => {
    // --- T1: submit-review's own read (separate transaction #1) ---
    const [candidateAtComparisonTime] = buildPatternInsightCandidates({ aggregates: [aggregateFixture()], currentReviews: [] });

    // Browser's freshness token exactly matches the state read at T1.
    const step2Resolution = resolveCandidateForReview([candidateAtComparisonTime!], ATHLETE_A, {
      detectorRuleId: candidateAtComparisonTime!.snapshot.detectorRuleId,
      detectorRuleVersion: candidateAtComparisonTime!.snapshot.detectorRuleVersion,
      insightKind: candidateAtComparisonTime!.snapshot.insightKind,
      insightProjectorVersion: candidateAtComparisonTime!.snapshot.insightProjectorVersion,
      rangeFromDate: candidateAtComparisonTime!.snapshot.rangeFromDate,
      rangeToDate: candidateAtComparisonTime!.snapshot.rangeToDate,
      sourceEvidenceRefs: candidateAtComparisonTime!.snapshot.sourceEvidenceRefs,
    });

    // Linearization point: freshness check succeeds here.
    expect(step2Resolution.status).toBe("matched");
    if (step2Resolution.status !== "matched") throw new Error("expected matched");
    const selectedServerCandidate = step2Resolution.candidate;

    // --- T2: a concurrent refresh-longitudinal run commits new evidence,
    // in a wholly separate transaction, AFTER submit-review's own
    // comparison already succeeded. ---
    const [candidateAfterMutation] = buildPatternInsightCandidates({
      aggregates: [aggregateFixture({ sourceEvidenceRefs: [sourceRef({ evidenceKey: "original-evidence" }), sourceRef({ evidenceKey: "new-evidence-after-comparison" })] })],
      currentReviews: [],
    });
    expect(candidateAfterMutation!.snapshot.sourceEvidenceRefs).not.toEqual(selectedServerCandidate.snapshot.sourceEvidenceRefs);

    // --- T3: submit-review's own write proceeds using the candidate
    // SELECTED AT T1/comparison time — never re-validated against T2's
    // state. Locked semantics: no retroactive stale_candidate; persistence
    // of `selectedServerCandidate.snapshot` remains valid. ---
    const persistedSnapshot = selectedServerCandidate.snapshot; // what an Edge Function would pass to persistPatternInsightReview
    expect(persistedSnapshot).toBe(candidateAtComparisonTime!.snapshot); // exact same object — no re-fetch, no re-comparison

    // --- A later get-insights-equivalent read now sees the mutated evidence
    // AND the just-persisted review (candidateSnapshot = persistedSnapshot,
    // i.e. the T1 snapshot) -> must derive reviewed_stale, never
    // reviewed_current, never an error. ---
    const persistedReview: PatternInsightReviewRecord = {
      athleteId: ATHLETE_A,
      detectorRuleId: persistedSnapshot.detectorRuleId,
      detectorRuleVersion: persistedSnapshot.detectorRuleVersion,
      insightKind: persistedSnapshot.insightKind,
      decision: "accepted_as_insight",
      reviewNumber: 1,
      reviewerNote: null,
      candidateSnapshot: persistedSnapshot,
    };
    const [candidateAfterReview] = buildPatternInsightCandidates({
      aggregates: [aggregateFixture({ sourceEvidenceRefs: [sourceRef({ evidenceKey: "original-evidence" }), sourceRef({ evidenceKey: "new-evidence-after-comparison" })] })],
      currentReviews: [persistedReview],
    });

    expect(candidateAfterReview!.reviewState).toBe("reviewed_stale");
    expect(candidateAfterReview!.currentReview!.decision).toBe("accepted_as_insight");
  });

  it("evidence already changed BEFORE the server comparison -> stale_candidate at the comparison itself, never a retroactive concern", () => {
    const [candidateBeforeBrowserLoaded] = buildPatternInsightCandidates({ aggregates: [aggregateFixture()], currentReviews: [] });
    const staleBrowserToken = {
      detectorRuleId: candidateBeforeBrowserLoaded!.snapshot.detectorRuleId,
      detectorRuleVersion: candidateBeforeBrowserLoaded!.snapshot.detectorRuleVersion,
      insightKind: candidateBeforeBrowserLoaded!.snapshot.insightKind,
      insightProjectorVersion: candidateBeforeBrowserLoaded!.snapshot.insightProjectorVersion,
      rangeFromDate: candidateBeforeBrowserLoaded!.snapshot.rangeFromDate,
      rangeToDate: candidateBeforeBrowserLoaded!.snapshot.rangeToDate,
      sourceEvidenceRefs: candidateBeforeBrowserLoaded!.snapshot.sourceEvidenceRefs,
    };

    // Evidence already mutated by the time submit-review actually runs its
    // own server-side comparison.
    const [candidateAtActualComparisonTime] = buildPatternInsightCandidates({
      aggregates: [aggregateFixture({ sourceEvidenceRefs: [sourceRef({ evidenceKey: "original-evidence" }), sourceRef({ evidenceKey: "already-mutated-before-comparison" })] })],
      currentReviews: [],
    });

    const resolution = resolveCandidateForReview([candidateAtActualComparisonTime!], ATHLETE_A, staleBrowserToken);
    expect(resolution.status).toBe("stale");
  });
});
