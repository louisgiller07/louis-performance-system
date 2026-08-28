/**
 * V0.3_001B — operator-only preview tooling. Pure aggregation: takes the
 * REAL `AthleteTimeline`, the REAL `OutcomeOrchestrationResult`/
 * `DetectorOrchestrationResult` (produced by the real
 * `calculateAndPersistOutcomes`/`runDetectors` running against a
 * `RecordingRpcClient`, never a reimplementation), plus that client's
 * recorded call metadata, and shapes the privacy-safe report described in
 * the V0.3_001B pre-rollout review. No I/O, no network, no classification
 * logic of its own — every count here is read off real production output,
 * never recomputed independently (see module docs on
 * recordingRpcClient.ts/sourceFingerprint.ts for what each upstream piece
 * already guarantees).
 *
 * Never includes: athleteId, decisionId, checkinId, completedSessionId,
 * healthFlagId, observedValue, sleep/energy/pain field values, notes,
 * input_snapshot, outcome_signals, JWT/token, email, password.
 */
import type { AthleteTimeline } from "../src/timeline/types.js";
import type { OutcomeOrchestrationResult } from "../src/supabase/outcomeOrchestrator.js";
import type { DetectorOrchestrationResult } from "../src/supabase/detectorOrchestrator.js";
import { resolveInsightKind } from "../src/insights/index.js";
import { computeSourceFingerprint } from "./sourceFingerprint.js";
import type { RecordedEvidenceCall, RecordedLifecycleCall, RecordedOutcomeCall } from "./recordingRpcClient.js";

export interface DetectorPreviewSummary {
  readonly attempted: number;
  readonly evidence: { readonly total: number; readonly supporting: number; readonly neutral: number; readonly contradicting: number };
  readonly noEvidence: { readonly total: number; readonly reasonCodeCounts: Readonly<Record<string, number>> };
  readonly simulatedActions: Readonly<Record<string, number>>;
}

export interface PreviewReport {
  readonly canonicalHead: string;
  readonly processingDate: string;
  readonly sourceFingerprint: string;
  readonly athleteResolution: "exactly_one";
  readonly emptyLedgerPrecondition: boolean;
  readonly sourceCounts: {
    readonly decisions: number;
    readonly dailyCheckins: number;
    readonly completedSessions: number;
    readonly existingDecisionOutcomes: number;
    readonly healthFlags: number;
  };
  readonly timeline: { readonly fromDate: string; readonly toDate: string; readonly dayCount: number };
  readonly outcomes: {
    readonly attempted: number;
    readonly writeSucceededSimulated: number;
    readonly alreadyExisted: number;
    readonly skippedImmature: number;
    readonly errorCount: number;
    readonly byHorizon: Readonly<Record<string, number>>;
  };
  readonly detectors: Readonly<Record<string, DetectorPreviewSummary>>;
  /**
   * Evidence-ledger deltas are `null` (not 0, not NaN) whenever
   * `emptyLedgerPrecondition` is false — the empty-ledger simplification
   * (Section 16 of the V0.3_001B review) does not hold, and reporting 0 or
   * any other guessed number here would be a silent overclaim.
   * `decisionOutcomes` has no such caveat: it is read directly off the real
   * `OutcomeOrchestrationResult`, which already accounts for pre-existing
   * rows via its own `alreadyExisted` bucket regardless of ledger state.
   */
  readonly expectedDbDeltas: {
    readonly decisionOutcomes: number;
    readonly patternEvidenceIdentities: number | null;
    readonly patternEvidenceRevisions: number | null;
    readonly patternEvidenceSourceRefs: number | null;
    readonly patternEvidenceLifecycleTransitions: number | null;
  };
  readonly expectedCandidateKinds: readonly string[];
}

export interface BuildPreviewReportParams {
  readonly canonicalHead: string;
  readonly processingDate: string;
  readonly emptyLedgerPrecondition: boolean;
  readonly timeline: AthleteTimeline;
  readonly outcomesResult: OutcomeOrchestrationResult;
  readonly detectorsResult: DetectorOrchestrationResult;
  readonly outcomeCalls: readonly RecordedOutcomeCall[];
  readonly evidenceCalls: readonly RecordedEvidenceCall[];
  readonly lifecycleCalls: readonly RecordedLifecycleCall[];
}

function tally<T extends string>(items: readonly T[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[item] = (counts[item] ?? 0) + 1;
  return counts;
}

export function buildPreviewReport(params: BuildPreviewReportParams): PreviewReport {
  const { canonicalHead, processingDate, emptyLedgerPrecondition, timeline, outcomesResult, detectorsResult, outcomeCalls, evidenceCalls, lifecycleCalls } = params;

  const byHorizon = tally(outcomeCalls.map((c) => c.horizon));

  const detectorRuleIds = new Set<string>([...detectorsResult.results.map((r) => r.detectorRuleId), ...detectorsResult.errors.map((e) => e.detectorRuleId)]);

  const detectors: Record<string, DetectorPreviewSummary> = {};
  for (const ruleId of detectorRuleIds) {
    const resultsForRule = detectorsResult.results.filter((r) => r.detectorRuleId === ruleId);
    const attempted = resultsForRule.length + detectorsResult.errors.filter((e) => e.detectorRuleId === ruleId).length;
    const simulatedActions = tally(resultsForRule.map((r) => r.action));

    const evidenceForRule = evidenceCalls.filter((c) => c.detectorRuleId === ruleId);
    const evidenceByType = tally(evidenceForRule.map((c) => c.eventType));

    const lifecycleForRule = lifecycleCalls.filter((c) => c.detectorRuleId === ruleId);
    const reasonCodeCounts = tally(lifecycleForRule.map((c) => c.reasonCode ?? "null"));

    detectors[ruleId] = {
      attempted,
      evidence: {
        total: evidenceForRule.length,
        supporting: evidenceByType.supporting ?? 0,
        neutral: evidenceByType.neutral ?? 0,
        contradicting: evidenceByType.contradicting ?? 0,
      },
      noEvidence: {
        total: lifecycleForRule.length,
        reasonCodeCounts,
      },
      simulatedActions,
    };
  }

  // Expected DB deltas — valid ONLY under the proven empty-ledger precondition (Section 3/16 of the
  // V0.3_001B review): every Evidence call is simulated as a fresh insert (+1 identity, +1 revision,
  // +provenanceCount source_refs), every NoEvidence call resolves skipped_no_prior (zero write, since
  // no prior identity can exist to withdraw).
  const patternEvidenceIdentities = emptyLedgerPrecondition ? evidenceCalls.length : null;
  const patternEvidenceRevisions = emptyLedgerPrecondition ? evidenceCalls.length : null;
  const patternEvidenceSourceRefs = emptyLedgerPrecondition ? evidenceCalls.reduce((sum, c) => sum + c.provenanceCount, 0) : null;
  const patternEvidenceLifecycleTransitions = emptyLedgerPrecondition ? 0 : null;

  // A detector only produces an expected insight candidate when it produced at least one Evidence
  // item this run (NoEvidence alone never creates an effective evidence row to aggregate — Section 17).
  const expectedCandidateKinds: string[] = [];
  for (const [ruleId, summary] of Object.entries(detectors)) {
    if (summary.evidence.total === 0) continue;
    const [detectorRuleVersion] = evidenceCalls.filter((c) => c.detectorRuleId === ruleId).map((c) => c.detectorRuleVersion);
    if (!detectorRuleVersion) continue;
    const kind = resolveInsightKind(ruleId, detectorRuleVersion);
    if (kind) expectedCandidateKinds.push(kind);
  }

  return {
    canonicalHead,
    processingDate,
    sourceFingerprint: computeSourceFingerprint(processingDate, timeline),
    athleteResolution: "exactly_one",
    emptyLedgerPrecondition,
    sourceCounts: {
      decisions: timeline.provenance.sourceCounts.decisions,
      dailyCheckins: timeline.provenance.sourceCounts.checkins,
      completedSessions: timeline.provenance.sourceCounts.completedSessions,
      existingDecisionOutcomes: timeline.provenance.sourceCounts.outcomes,
      healthFlags: timeline.provenance.sourceCounts.healthFlags,
    },
    timeline: { fromDate: timeline.range.fromDate, toDate: timeline.range.toDate, dayCount: timeline.provenance.rangeDaysMaterialized },
    outcomes: {
      attempted: outcomesResult.attempted,
      writeSucceededSimulated: outcomesResult.writeSucceeded,
      alreadyExisted: outcomesResult.alreadyExisted,
      skippedImmature: outcomesResult.skippedImmature,
      errorCount: outcomesResult.errors.length,
      byHorizon,
    },
    detectors,
    expectedDbDeltas: {
      decisionOutcomes: outcomesResult.writeSucceeded,
      patternEvidenceIdentities,
      patternEvidenceRevisions,
      patternEvidenceSourceRefs,
      patternEvidenceLifecycleTransitions,
    },
    expectedCandidateKinds,
  };
}
