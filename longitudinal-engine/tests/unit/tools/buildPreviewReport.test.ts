import { describe, expect, it } from "vitest";
import { buildTimeline } from "../../../src/timeline/buildTimeline.js";
import type { OutcomeOrchestrationResult } from "../../../src/supabase/outcomeOrchestrator.js";
import type { DetectorOrchestrationResult } from "../../../src/supabase/detectorOrchestrator.js";
import { RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID, RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_VERSION, SLEEP_ENERGY_RULE_ID, SLEEP_ENERGY_RULE_VERSION } from "../../../src/detectors/index.js";
import { ATHLETE_A, checkin, decision, emptySources, resetIdSequence } from "../timeline/fixtures.js";
import { buildPreviewReport } from "../../../tools/buildPreviewReport.js";

function timelineFixture() {
  resetIdSequence();
  const d1 = decision({ id: "d1", decisionDate: "2026-08-10" });
  const c1 = checkin({ id: "c1", checkinDate: "2026-08-10" });
  return buildTimeline({
    athleteId: ATHLETE_A,
    range: { fromDate: "2026-08-01", toDate: "2026-08-10" },
    sources: { ...emptySources(), decisions: [d1], checkins: [c1] },
  });
}

function emptyOutcomes(overrides: Partial<OutcomeOrchestrationResult> = {}): OutcomeOrchestrationResult {
  return { attempted: 0, writeSucceeded: 0, alreadyExisted: 0, skippedImmature: 0, errors: [], ...overrides };
}

describe("buildPreviewReport — never leaks private identifiers", () => {
  it("the full serialized report never contains a raw athleteId/decisionId/checkinId", () => {
    // Deliberately long, distinctive fixture ids — a short id like "d1"/"c1" is
    // guaranteed to coincidentally appear as a substring inside the report's own
    // 64-hex-char sourceFingerprint digest by pure chance, which would make this
    // assertion a false positive, not a real privacy check.
    resetIdSequence();
    const uniqueDecisionId = "DECISION-UNIQUE-TOKEN-9f3a7c21";
    const uniqueCheckinId = "CHECKIN-UNIQUE-TOKEN-9f3a7c21";
    const d = decision({ id: uniqueDecisionId, decisionDate: "2026-08-10" });
    const c = checkin({ id: uniqueCheckinId, checkinDate: "2026-08-10" });
    const timeline = buildTimeline({
      athleteId: ATHLETE_A,
      range: { fromDate: "2026-08-01", toDate: "2026-08-10" },
      sources: { ...emptySources(), decisions: [d], checkins: [c] },
    });

    const outcomesResult = emptyOutcomes({ attempted: 1, writeSucceeded: 1 });
    const detectorsResult: DetectorOrchestrationResult = {
      attempted: 1,
      results: [{ detectorRuleId: RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID, evaluationUnitId: uniqueDecisionId, action: "skipped_no_evidence_no_prior" }],
      errors: [],
    };

    const report = buildPreviewReport({
      canonicalHead: "deadbeef",
      processingDate: "2026-08-10",
      emptyLedgerPrecondition: true,
      timeline,
      outcomesResult,
      detectorsResult,
      outcomeCalls: [{ horizon: "J_PLUS_1" }],
      evidenceCalls: [],
      lifecycleCalls: [{ detectorRuleId: RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID, detectorRuleVersion: RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_VERSION, reasonCode: "no_completed_session" }],
    });

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(ATHLETE_A);
    expect(serialized).not.toContain(uniqueDecisionId);
    expect(serialized).not.toContain(uniqueCheckinId);
  });
});

describe("buildPreviewReport — source counts and timeline span", () => {
  it("reads counts/span directly off the real timeline's own provenance", () => {
    const timeline = timelineFixture();
    const report = buildPreviewReport({
      canonicalHead: "abc123",
      processingDate: "2026-08-10",
      emptyLedgerPrecondition: true,
      timeline,
      outcomesResult: emptyOutcomes(),
      detectorsResult: { attempted: 0, results: [], errors: [] },
      outcomeCalls: [],
      evidenceCalls: [],
      lifecycleCalls: [],
    });

    expect(report.sourceCounts).toEqual({ decisions: 1, dailyCheckins: 1, completedSessions: 0, existingDecisionOutcomes: 0, healthFlags: 0 });
    expect(report.timeline).toEqual({ fromDate: "2026-08-01", toDate: "2026-08-10", dayCount: 10 });
  });
});

describe("buildPreviewReport — outcomes section", () => {
  it("maps 1:1 off the real OutcomeOrchestrationResult, groups outcomeCalls into byHorizon", () => {
    const timeline = timelineFixture();
    const report = buildPreviewReport({
      canonicalHead: "abc",
      processingDate: "2026-08-10",
      emptyLedgerPrecondition: true,
      timeline,
      outcomesResult: emptyOutcomes({ attempted: 3, writeSucceeded: 3, alreadyExisted: 1, skippedImmature: 2 }),
      detectorsResult: { attempted: 0, results: [], errors: [] },
      outcomeCalls: [{ horizon: "J_PLUS_1" }, { horizon: "J_PLUS_1" }, { horizon: "J_PLUS_3" }],
      evidenceCalls: [],
      lifecycleCalls: [],
    });

    expect(report.outcomes).toEqual({
      attempted: 3,
      writeSucceededSimulated: 3,
      alreadyExisted: 1,
      skippedImmature: 2,
      errorCount: 0,
      byHorizon: { J_PLUS_1: 2, J_PLUS_3: 1 },
    });
  });
});

describe("buildPreviewReport — per-detector breakdown", () => {
  it("splits Evidence by eventType and NoEvidence by reasonCode, per detector rule id", () => {
    const timeline = timelineFixture();
    const detectorsResult: DetectorOrchestrationResult = {
      attempted: 3,
      results: [
        { detectorRuleId: SLEEP_ENERGY_RULE_ID, evaluationUnitId: "c1", action: "evidence_inserted" },
        { detectorRuleId: SLEEP_ENERGY_RULE_ID, evaluationUnitId: "c2", action: "evidence_inserted" },
        { detectorRuleId: RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID, evaluationUnitId: "d1", action: "skipped_no_evidence_no_prior" },
      ],
      errors: [],
    };

    const report = buildPreviewReport({
      canonicalHead: "abc",
      processingDate: "2026-08-10",
      emptyLedgerPrecondition: true,
      timeline,
      outcomesResult: emptyOutcomes(),
      detectorsResult,
      outcomeCalls: [],
      evidenceCalls: [
        { detectorRuleId: SLEEP_ENERGY_RULE_ID, detectorRuleVersion: SLEEP_ENERGY_RULE_VERSION, eventType: "supporting", provenanceCount: 3 },
        { detectorRuleId: SLEEP_ENERGY_RULE_ID, detectorRuleVersion: SLEEP_ENERGY_RULE_VERSION, eventType: "contradicting", provenanceCount: 2 },
      ],
      lifecycleCalls: [{ detectorRuleId: RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID, detectorRuleVersion: RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_VERSION, reasonCode: "no_completed_session" }],
    });

    expect(report.detectors[SLEEP_ENERGY_RULE_ID]).toEqual({
      attempted: 2,
      evidence: { total: 2, supporting: 1, neutral: 0, contradicting: 1 },
      noEvidence: { total: 0, reasonCodeCounts: {} },
      simulatedActions: { evidence_inserted: 2 },
    });
    expect(report.detectors[RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID]).toEqual({
      attempted: 1,
      evidence: { total: 0, supporting: 0, neutral: 0, contradicting: 0 },
      noEvidence: { total: 1, reasonCodeCounts: { no_completed_session: 1 } },
      simulatedActions: { skipped_no_evidence_no_prior: 1 },
    });
  });

  it("counts errored units into attempted too, without an action bucket", () => {
    const timeline = timelineFixture();
    const detectorsResult: DetectorOrchestrationResult = {
      attempted: 1,
      results: [],
      errors: [{ detectorRuleId: SLEEP_ENERGY_RULE_ID, evaluationUnitId: "c1", error: "boom" }],
    };
    const report = buildPreviewReport({
      canonicalHead: "abc",
      processingDate: "2026-08-10",
      emptyLedgerPrecondition: true,
      timeline,
      outcomesResult: emptyOutcomes(),
      detectorsResult,
      outcomeCalls: [],
      evidenceCalls: [],
      lifecycleCalls: [],
    });
    expect(report.detectors[SLEEP_ENERGY_RULE_ID]!.attempted).toBe(1);
    expect(report.detectors[SLEEP_ENERGY_RULE_ID]!.simulatedActions).toEqual({});
  });
});

describe("buildPreviewReport — expected DB deltas", () => {
  it("under the empty-ledger precondition: identities/revisions = evidenceCalls.length, source_refs = sum(provenanceCount), lifecycle_transitions = 0", () => {
    const timeline = timelineFixture();
    const report = buildPreviewReport({
      canonicalHead: "abc",
      processingDate: "2026-08-10",
      emptyLedgerPrecondition: true,
      timeline,
      outcomesResult: emptyOutcomes({ writeSucceeded: 5 }),
      detectorsResult: { attempted: 0, results: [], errors: [] },
      outcomeCalls: [],
      evidenceCalls: [
        { detectorRuleId: SLEEP_ENERGY_RULE_ID, detectorRuleVersion: SLEEP_ENERGY_RULE_VERSION, eventType: "supporting", provenanceCount: 3 },
        { detectorRuleId: SLEEP_ENERGY_RULE_ID, detectorRuleVersion: SLEEP_ENERGY_RULE_VERSION, eventType: "supporting", provenanceCount: 2 },
      ],
      lifecycleCalls: [],
    });
    expect(report.expectedDbDeltas).toEqual({
      decisionOutcomes: 5,
      patternEvidenceIdentities: 2,
      patternEvidenceRevisions: 2,
      patternEvidenceSourceRefs: 5,
      patternEvidenceLifecycleTransitions: 0,
    });
  });

  it("when the ledger precondition is NOT proven empty, all evidence deltas are null — never a guessed number", () => {
    const timeline = timelineFixture();
    const report = buildPreviewReport({
      canonicalHead: "abc",
      processingDate: "2026-08-10",
      emptyLedgerPrecondition: false,
      timeline,
      outcomesResult: emptyOutcomes({ writeSucceeded: 5 }),
      detectorsResult: { attempted: 0, results: [], errors: [] },
      outcomeCalls: [],
      evidenceCalls: [{ detectorRuleId: SLEEP_ENERGY_RULE_ID, detectorRuleVersion: SLEEP_ENERGY_RULE_VERSION, eventType: "supporting", provenanceCount: 1 }],
      lifecycleCalls: [],
    });
    expect(report.expectedDbDeltas).toEqual({
      decisionOutcomes: 5,
      patternEvidenceIdentities: null,
      patternEvidenceRevisions: null,
      patternEvidenceSourceRefs: null,
      patternEvidenceLifecycleTransitions: null,
    });
  });
});

describe("buildPreviewReport — expected candidate kinds", () => {
  it("a detector with at least one Evidence item produces its registered insight kind", () => {
    const timeline = timelineFixture();
    const report = buildPreviewReport({
      canonicalHead: "abc",
      processingDate: "2026-08-10",
      emptyLedgerPrecondition: true,
      timeline,
      outcomesResult: emptyOutcomes(),
      detectorsResult: { attempted: 1, results: [{ detectorRuleId: SLEEP_ENERGY_RULE_ID, evaluationUnitId: "c1", action: "evidence_inserted" }], errors: [] },
      outcomeCalls: [],
      evidenceCalls: [{ detectorRuleId: SLEEP_ENERGY_RULE_ID, detectorRuleVersion: SLEEP_ENERGY_RULE_VERSION, eventType: "supporting", provenanceCount: 3 }],
      lifecycleCalls: [],
    });
    expect(report.expectedCandidateKinds).toEqual(["sleep_energy_same_day_association"]);
  });

  it("a detector with only NoEvidence produces zero expected candidates (Section 17)", () => {
    const timeline = timelineFixture();
    const report = buildPreviewReport({
      canonicalHead: "abc",
      processingDate: "2026-08-10",
      emptyLedgerPrecondition: true,
      timeline,
      outcomesResult: emptyOutcomes(),
      detectorsResult: { attempted: 1, results: [{ detectorRuleId: RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID, evaluationUnitId: "d1", action: "skipped_no_evidence_no_prior" }], errors: [] },
      outcomeCalls: [],
      evidenceCalls: [],
      lifecycleCalls: [{ detectorRuleId: RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID, detectorRuleVersion: RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_VERSION, reasonCode: "no_completed_session" }],
    });
    expect(report.expectedCandidateKinds).toEqual([]);
  });
});

describe("buildPreviewReport — source fingerprint", () => {
  it("includes a well-formed sourceFingerprint", () => {
    const timeline = timelineFixture();
    const report = buildPreviewReport({
      canonicalHead: "abc",
      processingDate: "2026-08-10",
      emptyLedgerPrecondition: true,
      timeline,
      outcomesResult: emptyOutcomes(),
      detectorsResult: { attempted: 0, results: [], errors: [] },
      outcomeCalls: [],
      evidenceCalls: [],
      lifecycleCalls: [],
    });
    expect(report.sourceFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
