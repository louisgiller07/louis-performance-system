/**
 * M5_007 adapter end-to-end integration suite — exercises the ACTUAL
 * production write adapter (persistPatternInsightReview), read adapter
 * (SupabasePatternInsightReviewAdapter), and pure review-state derivation
 * (buildPatternInsightCandidates) chained together against a real local
 * Supabase stack — never calling `client.rpc(...)`/`client.from(...)`
 * directly the way patternInsightReviewLedger.integration.test.ts does (that
 * file proves the RPC/schema/views themselves; this file proves the
 * TypeScript adapter layer built on top of them).
 *
 * No afterAll athlete cleanup (see patternEvidenceSchema.integration.test.ts's
 * own comment) — pattern_insight_identities.athlete_id is ON DELETE
 * RESTRICT by design, and this suite persists reviews for every athlete it
 * creates.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, type TestAthlete } from "./testDb.js";
import { SupabasePatternInsightReviewAdapter } from "../../src/supabase/index.js";
import { persistPatternInsightReview } from "../../src/persistence/index.js";
import { buildPatternInsightCandidates } from "../../src/insights/index.js";
import type { PatternEvidenceAggregate, PatternEvidenceAggregateSourceRef } from "../../src/aggregation/index.js";

describe("M5_007 adapter round trip — integration (real DB, real production adapters)", () => {
  let client: SupabaseClient;
  let readAdapter: SupabasePatternInsightReviewAdapter;
  let athleteA: TestAthlete;
  let athleteB: TestAthlete;

  beforeAll(async () => {
    client = createTestClient();
    readAdapter = new SupabasePatternInsightReviewAdapter(client);
    athleteA = await createTestAthlete(client, "M5_007 Adapter Round Trip Test Athlete A");
    athleteB = await createTestAthlete(client, "M5_007 Adapter Round Trip Test Athlete B");
  }, 60_000);

  function sourceRef(athleteId: string, suffix: string, overrides: Partial<PatternEvidenceAggregateSourceRef> = {}): PatternEvidenceAggregateSourceRef {
    return {
      identityId: `identity-${athleteId}-${suffix}`,
      revisionId: `revision-${athleteId}-${suffix}-r1`,
      revisionNumber: 1,
      evaluationKey: `eval-${athleteId}-${suffix}`,
      evidenceKey: `evidence-${athleteId}-${suffix}`,
      eventType: "supporting",
      eventDate: "2026-06-10",
      ...overrides,
    };
  }

  function aggregateFor(athleteId: string, suffix: string): PatternEvidenceAggregate {
    return {
      athleteId,
      detectorRuleId: "sleep_quality_to_same_day_energy_correlation",
      detectorRuleVersion: "1.0.0",
      rangeFromDate: "2026-06-01",
      rangeToDate: "2026-06-30",
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
      sourceEvidenceRefs: [sourceRef(athleteId, suffix)],
    };
  }

  it("full chain: build -> persist (accepted_as_insight) -> read -> rebuild -> reviewed_current; then a revision change -> reviewed_stale, never auto-upgraded", async () => {
    const aggregate = aggregateFor(athleteA.athleteId, "chain-1");

    // 1. Build the candidate the same way a real caller would.
    const [initialCandidate] = buildPatternInsightCandidates({ aggregates: [aggregate], currentReviews: [] });
    expect(initialCandidate!.reviewState).toBe("unreviewed");

    // 2. Persist through the REAL write adapter (not client.rpc directly).
    const persistResult = await persistPatternInsightReview(client, {
      athleteId: athleteA.athleteId,
      candidate: initialCandidate!,
      decision: "accepted_as_insight",
      reviewerNote: "Consistent pattern over the last month.",
    });
    expect(persistResult.action).toBe("inserted");
    expect(persistResult.reviewNumber).toBe(1);

    // 3. Read back through the REAL read adapter (not client.from directly).
    const reviewsAfterFirst = await readAdapter.getCurrentPatternInsightReviews(athleteA.athleteId);
    const reviewForThisIdentity = reviewsAfterFirst.filter(
      (r) => r.detectorRuleId === aggregate.detectorRuleId && r.detectorRuleVersion === aggregate.detectorRuleVersion && r.insightKind === initialCandidate!.snapshot.insightKind
    );
    expect(reviewForThisIdentity).toHaveLength(1);
    const review = reviewForThisIdentity[0]!;
    expect(review.athleteId).toBe(athleteA.athleteId);
    expect(review.detectorRuleId).toBe(aggregate.detectorRuleId);
    expect(review.detectorRuleVersion).toBe(aggregate.detectorRuleVersion);
    expect(review.insightKind).toBe(initialCandidate!.snapshot.insightKind);
    expect(review.decision).toBe("accepted_as_insight");
    expect(review.reviewNumber).toBe(1);
    expect(review.reviewerNote).toBe("Consistent pattern over the last month.");
    expect(review.candidateSnapshot).toEqual(initialCandidate!.snapshot);

    // 4. Rebuild with the SAME aggregate + the real currentReviews just read back.
    const [rebuiltCandidate] = buildPatternInsightCandidates({ aggregates: [aggregate], currentReviews: reviewsAfterFirst });
    expect(rebuiltCandidate!.reviewState).toBe("reviewed_current");
    expect(rebuiltCandidate!.currentReview!.decision).toBe("accepted_as_insight");
    expect(rebuiltCandidate!.currentReview).toEqual(review);

    // 5. Now simulate a newer effective revision for the SAME evidence identity — only
    // sourceEvidenceRefs.revisionId/revisionNumber change, everything else about the
    // aggregate stays put.
    const newerAggregate: PatternEvidenceAggregate = {
      ...aggregate,
      sourceEvidenceRefs: [{ ...aggregate.sourceEvidenceRefs[0]!, revisionId: `revision-${athleteA.athleteId}-chain-1-r2`, revisionNumber: 2 }],
    };
    const [staleCandidate] = buildPatternInsightCandidates({ aggregates: [newerAggregate], currentReviews: reviewsAfterFirst });
    expect(staleCandidate!.reviewState).toBe("reviewed_stale");
    // The prior accepted_as_insight decision is reported for context but never
    // silently upgraded to a current acceptance.
    expect(staleCandidate!.currentReview!.decision).toBe("accepted_as_insight");
  });

  it("athlete isolation via the REAL read adapter: A's reviews never leak into B's read, and vice versa", async () => {
    const aggregateA = aggregateFor(athleteA.athleteId, "isolation-a");
    const aggregateB = aggregateFor(athleteB.athleteId, "isolation-b");

    const [candidateA] = buildPatternInsightCandidates({ aggregates: [aggregateA], currentReviews: [] });
    const [candidateB] = buildPatternInsightCandidates({ aggregates: [aggregateB], currentReviews: [] });

    await persistPatternInsightReview(client, { athleteId: athleteA.athleteId, candidate: candidateA!, decision: "accepted_as_insight", reviewerNote: null });
    await persistPatternInsightReview(client, { athleteId: athleteB.athleteId, candidate: candidateB!, decision: "dismissed", reviewerNote: null });

    const reviewsForA = await readAdapter.getCurrentPatternInsightReviews(athleteA.athleteId);
    expect(reviewsForA.length).toBeGreaterThan(0);
    expect(reviewsForA.every((r) => r.athleteId === athleteA.athleteId)).toBe(true);
    expect(reviewsForA.some((r) => r.athleteId === athleteB.athleteId)).toBe(false);

    const reviewsForB = await readAdapter.getCurrentPatternInsightReviews(athleteB.athleteId);
    expect(reviewsForB.length).toBeGreaterThan(0);
    expect(reviewsForB.every((r) => r.athleteId === athleteB.athleteId)).toBe(true);
    expect(reviewsForB.some((r) => r.athleteId === athleteA.athleteId)).toBe(false);
  });
});
