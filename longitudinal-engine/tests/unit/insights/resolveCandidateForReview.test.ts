/**
 * V0.3_001C — pure unit proof for the submit-review candidate-resolution
 * helper. Selector = (athleteId, detectorRuleId) only; detectorRuleVersion/
 * insightKind/insightProjectorVersion/range/sourceEvidenceRefs remain
 * freshness-only dimensions whose divergence must resolve "stale", never
 * "not_found" — see docs/06_ARCHITECTURE.md's "Sélecteur de candidat et
 * cardinalité" (locked 2026-08-28).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { buildPatternInsightCandidates, resolveCandidateForReview } from "../../../src/insights/index.js";
import type { PatternInsightCandidate, ReviewFreshnessRequest } from "../../../src/insights/index.js";
import type { PatternEvidenceAggregate, PatternEvidenceAggregateSourceRef } from "../../../src/aggregation/index.js";
import { nextId, resetIdSequence } from "../timeline/fixtures.js";

beforeEach(() => resetIdSequence());

const ATHLETE_A = "athlete-a";
const RANGE = { fromDate: "1900-01-01", toDate: "9999-12-31" };
const RECOMMENDATION_RULE_ID = "recommendation_vs_actual_execution";
const SLEEP_RULE_ID = "sleep_quality_to_same_day_energy_correlation";
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
    sourceEvidenceRefs: [sourceRef()],
    ...overrides,
  };
}

function candidatesFor(aggregates: readonly PatternEvidenceAggregate[]): readonly PatternInsightCandidate[] {
  return buildPatternInsightCandidates({ aggregates, currentReviews: [] });
}

function requestFrom(candidate: PatternInsightCandidate, overrides: Partial<ReviewFreshnessRequest> = {}): ReviewFreshnessRequest {
  const s = candidate.snapshot;
  return {
    detectorRuleId: s.detectorRuleId,
    detectorRuleVersion: s.detectorRuleVersion,
    insightKind: s.insightKind,
    insightProjectorVersion: s.insightProjectorVersion,
    rangeFromDate: s.rangeFromDate,
    rangeToDate: s.rangeToDate,
    sourceEvidenceRefs: s.sourceEvidenceRefs,
    ...overrides,
  };
}

describe("resolveCandidateForReview", () => {
  it("no current candidate for detectorRuleId -> not_found", () => {
    const candidates = candidatesFor([]);
    const result = resolveCandidateForReview(candidates, ATHLETE_A, {
      detectorRuleId: RECOMMENDATION_RULE_ID,
      detectorRuleVersion: RULE_VERSION,
      insightKind: "recommendation_execution_alignment",
      insightProjectorVersion: "1.0.0",
      rangeFromDate: RANGE.fromDate,
      rangeToDate: RANGE.toDate,
      sourceEvidenceRefs: [],
    });
    expect(result.status).toBe("not_found");
  });

  it("unrelated/bogus detectorRuleId with a real candidate present for a different rule -> not_found", () => {
    const candidates = candidatesFor([aggregateFixture({ detectorRuleId: SLEEP_RULE_ID })]);
    const result = resolveCandidateForReview(candidates, ATHLETE_A, requestFrom(candidates[0]!, { detectorRuleId: "totally_unknown_rule" }));
    expect(result.status).toBe("not_found");
  });

  it("exactly one current candidate, all 7 dimensions match -> matched", () => {
    const candidates = candidatesFor([aggregateFixture()]);
    const result = resolveCandidateForReview(candidates, ATHLETE_A, requestFrom(candidates[0]!));
    expect(result.status).toBe("matched");
    if (result.status === "matched") expect(result.candidate).toBe(candidates[0]);
  });

  it("detectorRuleVersion differs -> stale, NOT not_found (same detectorRuleId still resolves the candidate)", () => {
    const candidates = candidatesFor([aggregateFixture()]);
    const result = resolveCandidateForReview(candidates, ATHLETE_A, requestFrom(candidates[0]!, { detectorRuleVersion: "0.9.0" }));
    expect(result.status).toBe("stale");
    if (result.status === "stale") expect(result.candidate).toBe(candidates[0]);
  });

  it("insightKind differs -> stale, NOT not_found", () => {
    const candidates = candidatesFor([aggregateFixture()]);
    const result = resolveCandidateForReview(candidates, ATHLETE_A, requestFrom(candidates[0]!, { insightKind: "pain_persistence_between_recent_checkins" }));
    expect(result.status).toBe("stale");
  });

  it("insightProjectorVersion differs -> stale", () => {
    const candidates = candidatesFor([aggregateFixture()]);
    const result = resolveCandidateForReview(candidates, ATHLETE_A, requestFrom(candidates[0]!, { insightProjectorVersion: "0.9.0" }));
    expect(result.status).toBe("stale");
  });

  it("rangeFromDate differs -> stale", () => {
    const candidates = candidatesFor([aggregateFixture()]);
    const result = resolveCandidateForReview(candidates, ATHLETE_A, requestFrom(candidates[0]!, { rangeFromDate: "2026-01-01" }));
    expect(result.status).toBe("stale");
  });

  it("rangeToDate differs -> stale", () => {
    const candidates = candidatesFor([aggregateFixture()]);
    const result = resolveCandidateForReview(candidates, ATHLETE_A, requestFrom(candidates[0]!, { rangeToDate: "2026-12-31" }));
    expect(result.status).toBe("stale");
  });

  it("sourceEvidenceRefs differ -> stale", () => {
    const candidates = candidatesFor([aggregateFixture()]);
    const result = resolveCandidateForReview(candidates, ATHLETE_A, requestFrom(candidates[0]!, { sourceEvidenceRefs: [sourceRef()] }));
    expect(result.status).toBe("stale");
  });

  it("stale result returns the fresh server candidate, never the browser's stale view", () => {
    const candidates = candidatesFor([aggregateFixture()]);
    const result = resolveCandidateForReview(candidates, ATHLETE_A, requestFrom(candidates[0]!, { detectorRuleVersion: "0.9.0" }));
    if (result.status !== "stale") throw new Error("expected stale");
    expect(result.candidate.snapshot.detectorRuleVersion).toBe(RULE_VERSION);
  });

  it("more than one current candidate for the same detectorRuleId -> invariant_violation, matchCount reported, no arbitrary selection", () => {
    // Two aggregates that would collide on the SAME detectorRuleId only if the
    // registry/aggregation invariant is violated — simulated directly here at
    // the candidate level (this helper must stay defensive regardless of how
    // such a state arose upstream).
    // Both aggregates use a genuinely registered (detectorRuleId, version) pair
    // on their own — the collision is simulated by relabeling candidateB's
    // detectorRuleId afterward, exactly the kind of state the locked
    // "at most one current candidate per (athlete, detectorRuleId)" invariant
    // (docs/06_ARCHITECTURE.md, 2026-08-28) exists to guard against.
    const [candidateA] = candidatesFor([aggregateFixture()]);
    const [candidateB] = candidatesFor([aggregateFixture({ detectorRuleId: SLEEP_RULE_ID })]);
    const bogusCandidates: readonly PatternInsightCandidate[] = [candidateA!, { ...candidateB!, snapshot: { ...candidateB!.snapshot, detectorRuleId: RECOMMENDATION_RULE_ID } }];

    const result = resolveCandidateForReview(bogusCandidates, ATHLETE_A, requestFrom(candidateA!));
    expect(result.status).toBe("invariant_violation");
    if (result.status === "invariant_violation") expect(result.matchCount).toBe(2);
  });

  it("invariant_violation never returns stale_candidate or candidate_not_found's shape, and never picks array[0]", () => {
    const [candidateA] = candidatesFor([aggregateFixture()]);
    const [candidateB] = candidatesFor([aggregateFixture({ detectorRuleId: SLEEP_RULE_ID })]);
    const bogusCandidates: readonly PatternInsightCandidate[] = [
      { ...candidateB!, snapshot: { ...candidateB!.snapshot, detectorRuleId: RECOMMENDATION_RULE_ID } },
      candidateA!,
    ];

    const result = resolveCandidateForReview(bogusCandidates, ATHLETE_A, requestFrom(candidateA!));
    expect(result.status).not.toBe("matched");
    expect(result.status).not.toBe("stale");
    expect(result.status).not.toBe("not_found");
    expect(result.status).toBe("invariant_violation");
    // No `candidate` field carried on the invariant_violation branch — proves
    // no first/array[0]/sort-order candidate is smuggled through.
    expect((result as { candidate?: unknown }).candidate).toBeUndefined();
  });
});
