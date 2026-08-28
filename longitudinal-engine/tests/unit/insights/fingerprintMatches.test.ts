/**
 * V0.3_001C — direct unit proof for the now-exported `fingerprintMatches`
 * comparator (previously private to buildPatternInsightCandidates.ts,
 * reused unchanged by resolveCandidateForReview.ts for submit-review). The
 * existing buildPatternInsightCandidates.test.ts "review state derivation"
 * suite already proves this comparator's behavior is unchanged through the
 * reviewed_current/reviewed_stale derivation it still drives; this file
 * proves the exported function directly, each of the 7 locked dimensions
 * individually.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { fingerprintMatches } from "../../../src/insights/index.js";
import type { PatternInsightReviewComparisonKey } from "../../../src/insights/index.js";
import type { PatternEvidenceAggregateSourceRef } from "../../../src/aggregation/index.js";
import { nextId, resetIdSequence } from "../timeline/fixtures.js";

beforeEach(() => resetIdSequence());

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

function fingerprintFixture(overrides: Partial<PatternInsightReviewComparisonKey> = {}): PatternInsightReviewComparisonKey {
  return {
    insightProjectorVersion: "1.0.0",
    athleteId: "athlete-a",
    insightKind: "recommendation_execution_alignment",
    detectorRuleId: "recommendation_vs_actual_execution",
    detectorRuleVersion: "1.0.0",
    rangeFromDate: "1900-01-01",
    rangeToDate: "9999-12-31",
    sourceEvidenceRefs: [sourceRef()],
    ...overrides,
  };
}

describe("fingerprintMatches", () => {
  it("exact 7-dimension equality (deep-equal separate objects) -> match", () => {
    const sharedRef = sourceRef();
    const a = fingerprintFixture({ sourceEvidenceRefs: [sharedRef] });
    const b = fingerprintFixture({ sourceEvidenceRefs: [sharedRef] });
    expect(a).not.toBe(b); // genuinely separate objects, not the same reference
    expect(fingerprintMatches(a, b)).toBe(true);
  });

  it("identical object reference -> match", () => {
    const a = fingerprintFixture();
    expect(fingerprintMatches(a, a)).toBe(true);
  });

  it("detectorRuleId differs -> mismatch", () => {
    const a = fingerprintFixture();
    const b = fingerprintFixture({ detectorRuleId: "sleep_quality_to_same_day_energy_correlation" });
    expect(fingerprintMatches(a, b)).toBe(false);
  });

  it("detectorRuleVersion differs -> mismatch", () => {
    const a = fingerprintFixture();
    const b = fingerprintFixture({ detectorRuleVersion: "2.0.0" });
    expect(fingerprintMatches(a, b)).toBe(false);
  });

  it("insightKind differs -> mismatch", () => {
    const a = fingerprintFixture();
    const b = fingerprintFixture({ insightKind: "pain_persistence_between_recent_checkins" });
    expect(fingerprintMatches(a, b)).toBe(false);
  });

  it("insightProjectorVersion differs -> mismatch", () => {
    const a = fingerprintFixture();
    const b = fingerprintFixture({ insightProjectorVersion: "0.9.0" });
    expect(fingerprintMatches(a, b)).toBe(false);
  });

  it("rangeFromDate differs -> mismatch", () => {
    const a = fingerprintFixture();
    const b = fingerprintFixture({ rangeFromDate: "2026-01-01" });
    expect(fingerprintMatches(a, b)).toBe(false);
  });

  it("rangeToDate differs -> mismatch", () => {
    const a = fingerprintFixture();
    const b = fingerprintFixture({ rangeToDate: "2026-12-31" });
    expect(fingerprintMatches(a, b)).toBe(false);
  });

  it("sourceEvidenceRefs differs (extra ref) -> mismatch", () => {
    const ref = sourceRef();
    const a = fingerprintFixture({ sourceEvidenceRefs: [ref] });
    const b = fingerprintFixture({ sourceEvidenceRefs: [ref, sourceRef()] });
    expect(fingerprintMatches(a, b)).toBe(false);
  });

  it("sourceEvidenceRefs differs (same identity, superseding revisionId) -> mismatch", () => {
    const ref = sourceRef({ evidenceKey: "same-identity" });
    const a = fingerprintFixture({ sourceEvidenceRefs: [ref] });
    const b = fingerprintFixture({ sourceEvidenceRefs: [{ ...ref, revisionId: nextId("revision"), revisionNumber: 2 }] });
    expect(fingerprintMatches(a, b)).toBe(false);
  });

  it("athleteId differs -> mismatch (defensive; submit-review always supplies the server-resolved athleteId on both sides in practice)", () => {
    const a = fingerprintFixture({ athleteId: "athlete-a" });
    const b = fingerprintFixture({ athleteId: "athlete-b" });
    expect(fingerprintMatches(a, b)).toBe(false);
  });
});
