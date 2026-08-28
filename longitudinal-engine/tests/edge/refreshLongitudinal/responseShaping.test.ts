/**
 * V0.3_001A hardening — pure unit tests for
 * supabase/functions/refresh-longitudinal/responseShaping.ts, the SOLE
 * production transport-response builder for refresh-longitudinal. No
 * Docker, no Deno, no network — responseShaping.ts is deliberately
 * portable plain TypeScript, so vitest can import it directly via a
 * relative path even though it physically lives under
 * supabase/functions/** (same established convention as
 * head-coach-engine/tests/edge/completedSession/validation.test.ts).
 *
 * The whole point of this file: prove real production code sanitizes raw
 * internal error text, using synthetic (not live-DB) DetectorOrchestrationResult/
 * OutcomeOrchestrationResult fixtures fed straight into the exact functions
 * index.ts calls — no test-only backdoor, no forced-failure query switch in
 * production code.
 */
import { describe, expect, it } from "vitest";
import {
  PAIN_PERSISTENCE_RULE_ID,
  RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID,
  SLEEP_ENERGY_RULE_ID,
  type DetectorOrchestrationResult,
  type OutcomeOrchestrationResult,
} from "../../../src/index.js";
import {
  buildRefreshLongitudinalResponse,
  sanitizeDetectorErrors,
  sanitizeOutcomeErrors,
  summarizeDetectorsByRule,
  summarizeOutcomes,
} from "../../../../supabase/functions/refresh-longitudinal/responseShaping.js";
import { mapRefreshLongitudinalError } from "../../../../supabase/functions/refresh-longitudinal/errorMapping.js";

const SENTINEL = "SENTINEL_POSTGRES_SECRET_SQL_MESSAGE";

function emptyOutcomes(overrides: Partial<OutcomeOrchestrationResult> = {}): OutcomeOrchestrationResult {
  return { attempted: 0, writeSucceeded: 0, alreadyExisted: 0, skippedImmature: 0, errors: [], ...overrides };
}

function emptyDetectors(overrides: Partial<DetectorOrchestrationResult> = {}): DetectorOrchestrationResult {
  return { attempted: 0, results: [], errors: [], ...overrides };
}

describe("summarizeDetectorsByRule — exact counts, derived only from the orchestration result", () => {
  it("counts every action kind into its own bucket, per rule", () => {
    const detectors = emptyDetectors({
      results: [
        { detectorRuleId: RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID, evaluationUnitId: "d1", action: "evidence_inserted" },
        { detectorRuleId: RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID, evaluationUnitId: "d2", action: "evidence_superseded" },
        { detectorRuleId: RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID, evaluationUnitId: "d3", action: "evidence_unchanged" },
        { detectorRuleId: RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID, evaluationUnitId: "d4", action: "withdrawn" },
        { detectorRuleId: RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID, evaluationUnitId: "d5", action: "unchanged_withdrawal" },
        { detectorRuleId: RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID, evaluationUnitId: "d6", action: "skipped_no_evidence_no_prior" },
        { detectorRuleId: SLEEP_ENERGY_RULE_ID, evaluationUnitId: "c1", action: "evidence_inserted" },
        { detectorRuleId: PAIN_PERSISTENCE_RULE_ID, evaluationUnitId: "c1", action: "evidence_inserted" },
      ],
    });

    const summary = summarizeDetectorsByRule(detectors);

    expect(summary[RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID]).toEqual({
      attempted: 6,
      inserted: 1,
      superseded: 1,
      unchanged: 1,
      withdrawn: 1,
      unchangedWithdrawal: 1,
      skippedNoPrior: 1,
      errorCount: 0,
    });
    expect(summary[SLEEP_ENERGY_RULE_ID]).toEqual({ attempted: 1, inserted: 1, superseded: 0, unchanged: 0, withdrawn: 0, unchangedWithdrawal: 0, skippedNoPrior: 0, errorCount: 0 });
    expect(summary[PAIN_PERSISTENCE_RULE_ID]).toEqual({ attempted: 1, inserted: 1, superseded: 0, unchanged: 0, withdrawn: 0, unchangedWithdrawal: 0, skippedNoPrior: 0, errorCount: 0 });
  });

  it("all three rule ids always present, even with zero results/errors", () => {
    const summary = summarizeDetectorsByRule(emptyDetectors());
    expect(Object.keys(summary).sort()).toEqual([PAIN_PERSISTENCE_RULE_ID, RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID, SLEEP_ENERGY_RULE_ID].sort());
    for (const ruleId of Object.keys(summary) as (keyof typeof summary)[]) {
      expect(summary[ruleId]).toEqual({ attempted: 0, inserted: 0, superseded: 0, unchanged: 0, withdrawn: 0, unchangedWithdrawal: 0, skippedNoPrior: 0, errorCount: 0 });
    }
  });

  it("errors increment attempted + errorCount for their own rule only", () => {
    const detectors = emptyDetectors({
      errors: [
        { detectorRuleId: SLEEP_ENERGY_RULE_ID, evaluationUnitId: "c1", error: `boom: ${SENTINEL}` },
        { detectorRuleId: SLEEP_ENERGY_RULE_ID, evaluationUnitId: "c2", error: "boom2" },
      ],
    });
    const summary = summarizeDetectorsByRule(detectors);
    expect(summary[SLEEP_ENERGY_RULE_ID]).toEqual({ attempted: 2, inserted: 0, superseded: 0, unchanged: 0, withdrawn: 0, unchangedWithdrawal: 0, skippedNoPrior: 0, errorCount: 2 });
    expect(summary[RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID].attempted).toBe(0);
    expect(summary[PAIN_PERSISTENCE_RULE_ID].attempted).toBe(0);
  });
});

describe("summarizeOutcomes — exact mapping from OutcomeOrchestrationResult", () => {
  it("maps every field 1:1, errorCount = errors.length", () => {
    const outcomes = emptyOutcomes({
      attempted: 5,
      writeSucceeded: 3,
      alreadyExisted: 1,
      skippedImmature: 1,
      errors: [{ decisionId: "d1", horizon: "J_PLUS_1", error: SENTINEL }],
    });
    expect(summarizeOutcomes(outcomes)).toEqual({ attempted: 5, writeSucceeded: 3, alreadyExisted: 1, skippedImmature: 1, errorCount: 1 });
  });
});

describe("sanitization — sentinel proof (real production formatters, no backdoor)", () => {
  it("sanitizeDetectorErrors never leaks the raw error string", () => {
    const detectors = emptyDetectors({
      errors: [{ detectorRuleId: SLEEP_ENERGY_RULE_ID, evaluationUnitId: "c1", error: `pg error: ${SENTINEL}` }],
    });
    const sanitized = sanitizeDetectorErrors(detectors);
    expect(sanitized).toEqual([{ scope: "detector", detectorRuleId: SLEEP_ENERGY_RULE_ID, evaluationUnitId: "c1", code: "evaluation_failed" }]);
    expect(JSON.stringify(sanitized)).not.toContain(SENTINEL);
  });

  it("sanitizeOutcomeErrors never leaks the raw error string, evaluationUnitId encodes decisionId:horizon", () => {
    const outcomes = emptyOutcomes({ errors: [{ decisionId: "d1", horizon: "J_PLUS_7", error: `rpc failed: ${SENTINEL}` }] });
    const sanitized = sanitizeOutcomeErrors(outcomes);
    expect(sanitized).toEqual([{ scope: "outcome", evaluationUnitId: "d1:J_PLUS_7", code: "evaluation_failed" }]);
    expect(JSON.stringify(sanitized)).not.toContain(SENTINEL);
  });

  it("buildRefreshLongitudinalResponse: zero internal errors -> status complete, empty errors array", () => {
    const body = buildRefreshLongitudinalResponse("2026-08-28", emptyOutcomes(), emptyDetectors());
    expect(body.status).toBe("complete");
    expect(body.errors).toEqual([]);
  });

  it("buildRefreshLongitudinalResponse: one internal detector error -> status partial_failure, sentinel absent from the full serialized response", () => {
    const detectors = emptyDetectors({
      errors: [{ detectorRuleId: RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID, evaluationUnitId: "d1", error: `duplicate key violates constraint: ${SENTINEL}` }],
    });
    const body = buildRefreshLongitudinalResponse("2026-08-28", emptyOutcomes(), detectors);

    expect(body.status).toBe("partial_failure");
    expect(body.errors.length).toBeGreaterThan(0);
    expect(body.errors[0]!.code).toBe("evaluation_failed");

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(SENTINEL);
    expect(serialized).not.toContain("duplicate key");
    expect(serialized).not.toContain("constraint");
  });

  it("buildRefreshLongitudinalResponse: one internal outcome error -> status partial_failure, sentinel absent", () => {
    const outcomes = emptyOutcomes({ errors: [{ decisionId: "d1", horizon: "J_PLUS_3", error: `SQLSTATE 23503: ${SENTINEL}` }] });
    const body = buildRefreshLongitudinalResponse("2026-08-28", outcomes, emptyDetectors());

    expect(body.status).toBe("partial_failure");
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(SENTINEL);
    expect(serialized).not.toContain("SQLSTATE");
  });

  it("buildRefreshLongitudinalResponse: mixed outcome + detector errors -> both scopes present, both sentinels absent", () => {
    const outcomes = emptyOutcomes({ errors: [{ decisionId: "d1", horizon: "J_PLUS_1", error: `OUTCOME_${SENTINEL}` }] });
    const detectors = emptyDetectors({ errors: [{ detectorRuleId: PAIN_PERSISTENCE_RULE_ID, evaluationUnitId: "c9", error: `DETECTOR_${SENTINEL}` }] });
    const body = buildRefreshLongitudinalResponse("2026-08-28", outcomes, detectors);

    expect(body.status).toBe("partial_failure");
    expect(body.errors.map((e) => e.scope).sort()).toEqual(["detector", "outcome"]);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(SENTINEL);
    expect(serialized).not.toContain("OUTCOME_");
    expect(serialized).not.toContain("DETECTOR_");
  });
});

describe("mapRefreshLongitudinalError — hard-failure mapping never leaks the raw error message", () => {
  it("a thrown Error carrying a sentinel maps to a fixed sanitized message", () => {
    const mapped = mapRefreshLongitudinalError(new Error(`SENTINEL_DATABASE_INTERNAL_DETAIL: ${SENTINEL}`));
    expect(mapped).toEqual({ status: 500, code: "internal_error", message: "An unexpected error occurred while refreshing longitudinal data." });
    expect(JSON.stringify(mapped)).not.toContain(SENTINEL);
    expect(JSON.stringify(mapped)).not.toContain("SENTINEL_DATABASE_INTERNAL_DETAIL");
  });

  it("a non-Error thrown value also maps to the same fixed sanitized message", () => {
    const mapped = mapRefreshLongitudinalError(SENTINEL);
    expect(mapped.message).not.toContain(SENTINEL);
  });

  it("the full { error: {...} } HTTP body built from the mapping never contains the sentinel", () => {
    const mapped = mapRefreshLongitudinalError(new Error(SENTINEL));
    const httpBody = { error: { code: mapped.code, message: mapped.message } };
    expect(JSON.stringify(httpBody)).not.toContain(SENTINEL);
  });
});
