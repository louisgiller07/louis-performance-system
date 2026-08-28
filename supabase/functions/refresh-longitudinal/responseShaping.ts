/**
 * V0.3_001A hardening — the production transport-response builder for
 * refresh-longitudinal, factored out as plain, portable TypeScript (no
 * Deno-only API, no `@supabase/server`) so it can be exercised directly by
 * vitest even though it physically lives under `supabase/functions/**` —
 * same established convention as
 * `supabase/functions/completed-session/validation.ts`
 * (see `head-coach-engine/tests/edge/completedSession/validation.test.ts`'s
 * own doc comment for the precedent).
 *
 * MANDATORY sanitization contract: this is the ONLY place that converts a
 * real `DetectorOrchestrationResult`/`OutcomeOrchestrationResult` (whose
 * per-item `error` strings may legitimately embed raw Postgres/RPC text —
 * see outcomeOrchestrator.ts/detectorOrchestrator.ts's own docs) into the
 * browser-visible response. It NEVER reads `.error` beyond deciding
 * "did an error occur" — the transport error items it produces carry only
 * already-safe identifiers (detectorRuleId is one of a closed, non-secret
 * set of rule ids; evaluationUnitId is a UUID or `${uuid}:${horizon}`,
 * already returned elsewhere in this project's own responses, e.g.
 * daily-run's decisionId) plus a small fixed `code`. The index.ts handler
 * MUST call these builders rather than hand-assembling the response body,
 * so this contract cannot be silently bypassed.
 *
 * Per-detector counts and the sanitized error list are both derived
 * EXCLUSIVELY from the orchestration results already computed by
 * `runDetectors`/`calculateAndPersistOutcomes` — no second detector
 * execution, no DB re-query, no fabricated counts.
 */
import {
  PAIN_PERSISTENCE_RULE_ID,
  RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID,
  SLEEP_ENERGY_RULE_ID,
  type DetectorOrchestrationResult,
  type OutcomeOrchestrationResult,
} from "../../../longitudinal-engine/dist/index.js";

export const DETECTOR_RULE_IDS = [
  RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID,
  SLEEP_ENERGY_RULE_ID,
  PAIN_PERSISTENCE_RULE_ID,
] as const;

export type DetectorRuleId = (typeof DETECTOR_RULE_IDS)[number];

export interface DetectorRuleSummary {
  readonly attempted: number;
  readonly inserted: number;
  readonly superseded: number;
  readonly unchanged: number;
  readonly withdrawn: number;
  readonly unchangedWithdrawal: number;
  readonly skippedNoPrior: number;
  readonly errorCount: number;
}

export type DetectorSummaryByRule = Record<DetectorRuleId, DetectorRuleSummary>;

export interface OutcomeSummary {
  readonly attempted: number;
  readonly writeSucceeded: number;
  readonly alreadyExisted: number;
  readonly skippedImmature: number;
  readonly errorCount: number;
}

/** Sanitized, transport-safe representation of one internal orchestration item failure — see module doc for what is deliberately excluded. */
export interface SanitizedTransportError {
  readonly scope: "outcome" | "detector";
  readonly detectorRuleId?: DetectorRuleId;
  readonly evaluationUnitId: string;
  readonly code: string;
}

export interface RefreshLongitudinalResponseBody {
  readonly status: "complete" | "partial_failure";
  readonly processingDate: string;
  readonly outcomes: OutcomeSummary;
  readonly detectors: DetectorSummaryByRule;
  readonly errors: readonly SanitizedTransportError[];
}

function emptyDetectorSummary(): DetectorRuleSummary {
  return { attempted: 0, inserted: 0, superseded: 0, unchanged: 0, withdrawn: 0, unchangedWithdrawal: 0, skippedNoPrior: 0, errorCount: 0 };
}

function isKnownDetectorRuleId(id: string): id is DetectorRuleId {
  return (DETECTOR_RULE_IDS as readonly string[]).includes(id);
}

/** Aggregates a real DetectorOrchestrationResult into fixed per-rule counters — see docs above: the orchestration result is the sole authority, never a second execution or DB query. */
export function summarizeDetectorsByRule(result: DetectorOrchestrationResult): DetectorSummaryByRule {
  const summary: DetectorSummaryByRule = {
    [RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID]: emptyDetectorSummary(),
    [SLEEP_ENERGY_RULE_ID]: emptyDetectorSummary(),
    [PAIN_PERSISTENCE_RULE_ID]: emptyDetectorSummary(),
  };

  for (const item of result.results) {
    if (!isKnownDetectorRuleId(item.detectorRuleId)) continue; // defensive: the closed rule-id set never changes without a code change here too
    const s = summary[item.detectorRuleId] as { -readonly [K in keyof DetectorRuleSummary]: DetectorRuleSummary[K] };
    s.attempted += 1;
    switch (item.action) {
      case "evidence_inserted":
        s.inserted += 1;
        break;
      case "evidence_superseded":
        s.superseded += 1;
        break;
      case "evidence_unchanged":
        s.unchanged += 1;
        break;
      case "withdrawn":
        s.withdrawn += 1;
        break;
      case "unchanged_withdrawal":
        s.unchangedWithdrawal += 1;
        break;
      case "skipped_no_evidence_no_prior":
        s.skippedNoPrior += 1;
        break;
    }
  }

  for (const err of result.errors) {
    if (!isKnownDetectorRuleId(err.detectorRuleId)) continue;
    const s = summary[err.detectorRuleId] as { -readonly [K in keyof DetectorRuleSummary]: DetectorRuleSummary[K] };
    s.attempted += 1;
    s.errorCount += 1;
  }

  return summary;
}

export function summarizeOutcomes(result: OutcomeOrchestrationResult): OutcomeSummary {
  return {
    attempted: result.attempted,
    writeSucceeded: result.writeSucceeded,
    alreadyExisted: result.alreadyExisted,
    skippedImmature: result.skippedImmature,
    errorCount: result.errors.length,
  };
}

/** Sanitized detector-scope error items — detectorRuleId + evaluationUnitId only, a fixed code, never `.error`'s raw text. */
export function sanitizeDetectorErrors(result: DetectorOrchestrationResult): SanitizedTransportError[] {
  return result.errors.map((e) => ({
    scope: "detector" as const,
    detectorRuleId: isKnownDetectorRuleId(e.detectorRuleId) ? e.detectorRuleId : undefined,
    evaluationUnitId: e.evaluationUnitId,
    code: "evaluation_failed",
  }));
}

/** Sanitized outcome-scope error items — evaluationUnitId encodes `decisionId:horizon` (both already non-secret, already returned elsewhere in this project's own responses), never `.error`'s raw text. */
export function sanitizeOutcomeErrors(result: OutcomeOrchestrationResult): SanitizedTransportError[] {
  return result.errors.map((e) => ({
    scope: "outcome" as const,
    evaluationUnitId: `${e.decisionId}:${e.horizon}`,
    code: "evaluation_failed",
  }));
}

/** The single production entry point index.ts calls — assembles the full sanitized response body from real orchestration results. status is "complete" iff BOTH result sets report zero internal item errors. */
export function buildRefreshLongitudinalResponse(
  processingDate: string,
  outcomes: OutcomeOrchestrationResult,
  detectors: DetectorOrchestrationResult
): RefreshLongitudinalResponseBody {
  const errors = [...sanitizeOutcomeErrors(outcomes), ...sanitizeDetectorErrors(detectors)];
  return {
    status: errors.length > 0 ? "partial_failure" : "complete",
    processingDate,
    outcomes: summarizeOutcomes(outcomes),
    detectors: summarizeDetectorsByRule(detectors),
    errors,
  };
}
