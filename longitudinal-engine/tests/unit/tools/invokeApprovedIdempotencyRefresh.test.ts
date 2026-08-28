import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  EXPECTED_DETECTOR_COUNTERS,
  EXPECTED_EXISTING_DECISION_OUTCOMES,
  IdempotencyApprovalGateError,
  MissingApprovalArgsError,
  assertIdempotencyApprovalGates,
  buildSafePreflightSummary,
  invokeIdempotencyRefreshOnce,
  isValidIdempotencyConfirmation,
  parseApprovalArgs,
  sanitizeInvokeResponse,
  validateIdempotencyResponse,
  type InvokeClient,
} from "../../../tools/invokeApprovedIdempotencyRefresh.js";
import type { PreviewReport } from "../../../tools/buildPreviewReport.js";
import { RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID, SLEEP_ENERGY_RULE_ID, PAIN_PERSISTENCE_RULE_ID } from "../../../src/detectors/index.js";

const SOURCE_PATH = fileURLToPath(new URL("../../../tools/invokeApprovedIdempotencyRefresh.ts", import.meta.url));
const SOURCE_TEXT = readFileSync(SOURCE_PATH, "utf8");

const APPROVED_HEAD = "87cf003921e129a83b8b1401f1037e797824e12f";
const APPROVED_FINGERPRINT = "sha256:61d187ea4163f1dd6ed4fb17a1337497c728ff1d14d5e39e0f5eb60aac1a0b1e";
const APPROVAL = { approvedHead: APPROVED_HEAD, approvedFingerprint: APPROVED_FINGERPRINT };

function idempotentReport(overrides: Partial<PreviewReport> = {}): PreviewReport {
  return {
    canonicalHead: APPROVED_HEAD,
    processingDate: "2026-08-28",
    sourceFingerprint: APPROVED_FINGERPRINT,
    athleteResolution: "exactly_one",
    emptyLedgerPrecondition: true,
    sourceCounts: { decisions: 14, dailyCheckins: 3, completedSessions: 0, existingDecisionOutcomes: EXPECTED_EXISTING_DECISION_OUTCOMES, healthFlags: 1 },
    timeline: { fromDate: "2026-06-19", toDate: "2026-08-28", dayCount: 71 },
    outcomes: { attempted: 0, writeSucceededSimulated: 0, alreadyExisted: EXPECTED_EXISTING_DECISION_OUTCOMES, skippedImmature: 0, errorCount: 0, byHorizon: {} },
    detectors: {
      [RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID]: { attempted: 14, evidence: { total: 0, supporting: 0, neutral: 0, contradicting: 0 }, noEvidence: { total: 14, reasonCodeCounts: { no_completed_session: 14 } }, simulatedActions: { skipped_no_evidence_no_prior: 14 } },
      [SLEEP_ENERGY_RULE_ID]: { attempted: 3, evidence: { total: 0, supporting: 0, neutral: 0, contradicting: 0 }, noEvidence: { total: 3, reasonCodeCounts: {} }, simulatedActions: { skipped_no_evidence_no_prior: 3 } },
      [PAIN_PERSISTENCE_RULE_ID]: { attempted: 3, evidence: { total: 0, supporting: 0, neutral: 0, contradicting: 0 }, noEvidence: { total: 3, reasonCodeCounts: {} }, simulatedActions: { skipped_no_evidence_no_prior: 3 } },
    },
    expectedDbDeltas: { decisionOutcomes: 0, patternEvidenceIdentities: 0, patternEvidenceRevisions: 0, patternEvidenceSourceRefs: 0, patternEvidenceLifecycleTransitions: 0 },
    expectedCandidateKinds: [],
    ...overrides,
  };
}

function expectGateFailure(report: PreviewReport, code: string): void {
  try {
    assertIdempotencyApprovalGates(report, APPROVAL);
    expect.unreachable(`should have thrown ${code}`);
  } catch (err) {
    expect(err).toBeInstanceOf(IdempotencyApprovalGateError);
    expect((err as IdempotencyApprovalGateError).code).toBe(code);
  }
}

describe("parseApprovalArgs", () => {
  it("parses both flags", () => {
    expect(parseApprovalArgs(["--approved-head", APPROVED_HEAD, "--approved-fingerprint", APPROVED_FINGERPRINT])).toEqual(APPROVAL);
  });
  it("throws MissingApprovalArgsError when either flag is missing", () => {
    expect(() => parseApprovalArgs(["--approved-head", APPROVED_HEAD])).toThrow(MissingApprovalArgsError);
    expect(() => parseApprovalArgs(["--approved-fingerprint", APPROVED_FINGERPRINT])).toThrow(MissingApprovalArgsError);
  });
});

describe("assertIdempotencyApprovalGates — happy path", () => {
  it("does not throw for the exact already-audited idempotent second-run state", () => {
    expect(() => assertIdempotencyApprovalGates(idempotentReport(), APPROVAL)).not.toThrow();
  });
});

describe("assertIdempotencyApprovalGates — approval staleness and ledger", () => {
  it("wrong HEAD -> zero invocation reachable (approval_stale_head)", () => {
    expectGateFailure(idempotentReport({ canonicalHead: "0000000000000000000000000000000000000000" }), "approval_stale_head");
  });
  it("wrong fingerprint -> approval_stale_source_fingerprint", () => {
    expectGateFailure(idempotentReport({ sourceFingerprint: "sha256:0000000000000000000000000000000000000000000000000000000000000000" }), "approval_stale_source_fingerprint");
  });
  it("non-empty ledger -> ledger_not_empty", () => {
    expectGateFailure(idempotentReport({ emptyLedgerPrecondition: false }), "ledger_not_empty");
  });
});

describe("assertIdempotencyApprovalGates — exact idempotent-state invariants", () => {
  it("existingDecisionOutcomes != 42 -> existing_outcomes_mismatch", () => {
    const report = idempotentReport({ sourceCounts: { ...idempotentReport().sourceCounts, existingDecisionOutcomes: 41 } });
    expectGateFailure(report, "existing_outcomes_mismatch");
  });

  it("outcomes.attempted != 0 -> outcomes_attempted_nonzero", () => {
    expectGateFailure(idempotentReport({ outcomes: { ...idempotentReport().outcomes, attempted: 1 } }), "outcomes_attempted_nonzero");
  });
  it("outcomes.writeSucceededSimulated != 0 -> outcomes_write_succeeded_nonzero", () => {
    expectGateFailure(idempotentReport({ outcomes: { ...idempotentReport().outcomes, writeSucceededSimulated: 1 } }), "outcomes_write_succeeded_nonzero");
  });
  it("outcomes.alreadyExisted != 42 -> outcomes_already_existed_mismatch", () => {
    expectGateFailure(idempotentReport({ outcomes: { ...idempotentReport().outcomes, alreadyExisted: 41 } }), "outcomes_already_existed_mismatch");
  });
  it("outcomes.skippedImmature != 0 -> outcomes_skipped_immature_nonzero", () => {
    expectGateFailure(idempotentReport({ outcomes: { ...idempotentReport().outcomes, skippedImmature: 1 } }), "outcomes_skipped_immature_nonzero");
  });
  it("outcomes.errorCount != 0 -> outcomes_error_count_nonzero", () => {
    expectGateFailure(idempotentReport({ outcomes: { ...idempotentReport().outcomes, errorCount: 1 } }), "outcomes_error_count_nonzero");
  });

  it("expectedDbDeltas.decisionOutcomes != 0 -> decision_outcomes_delta_nonzero", () => {
    expectGateFailure(idempotentReport({ expectedDbDeltas: { ...idempotentReport().expectedDbDeltas, decisionOutcomes: 1 } }), "decision_outcomes_delta_nonzero");
  });

  it.each([
    ["patternEvidenceIdentities", { patternEvidenceIdentities: 1 }],
    ["patternEvidenceRevisions", { patternEvidenceRevisions: 1 }],
    ["patternEvidenceSourceRefs", { patternEvidenceSourceRefs: 1 }],
    ["patternEvidenceLifecycleTransitions", { patternEvidenceLifecycleTransitions: 1 }],
  ])("any predicted pattern evidence write (%s) -> pattern_evidence_delta_nonzero", (_label, patch) => {
    expectGateFailure(idempotentReport({ expectedDbDeltas: { ...idempotentReport().expectedDbDeltas, ...patch } }), "pattern_evidence_delta_nonzero");
  });

  it("candidateKinds non-empty -> candidates_expected", () => {
    expectGateFailure(idempotentReport({ expectedCandidateKinds: ["sleep_energy_same_day_association"] }), "candidates_expected");
  });

  it("any detector Evidence > 0 -> detector_evidence_nonzero", () => {
    const report = idempotentReport();
    const withEvidence = {
      ...report,
      detectors: { ...report.detectors, [SLEEP_ENERGY_RULE_ID]: { ...report.detectors[SLEEP_ENERGY_RULE_ID]!, evidence: { total: 1, supporting: 1, neutral: 0, contradicting: 0 } } },
    };
    expectGateFailure(withEvidence, "detector_evidence_nonzero");
  });

  it("wrong recommendation counters (attempted) -> detector_counters_mismatch", () => {
    const report = idempotentReport();
    const wrong = { ...report, detectors: { ...report.detectors, [RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID]: { ...report.detectors[RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID]!, attempted: 13 } } };
    expectGateFailure(wrong, "detector_counters_mismatch");
  });

  it("wrong sleep-energy counters (skippedNoPrior) -> detector_counters_mismatch", () => {
    const report = idempotentReport();
    const wrong = {
      ...report,
      detectors: { ...report.detectors, [SLEEP_ENERGY_RULE_ID]: { ...report.detectors[SLEEP_ENERGY_RULE_ID]!, simulatedActions: { skipped_no_evidence_no_prior: 2 } } },
    };
    expectGateFailure(wrong, "detector_counters_mismatch");
  });

  it("wrong pain counters (extra unexpected action present) -> detector_counters_mismatch", () => {
    const report = idempotentReport();
    const wrong = {
      ...report,
      detectors: { ...report.detectors, [PAIN_PERSISTENCE_RULE_ID]: { ...report.detectors[PAIN_PERSISTENCE_RULE_ID]!, simulatedActions: { skipped_no_evidence_no_prior: 3, unchanged_withdrawal: 1 } } },
    };
    expectGateFailure(wrong, "detector_counters_mismatch");
  });

  it("a missing detector entirely -> detector_counters_mismatch", () => {
    const report = idempotentReport();
    const { [PAIN_PERSISTENCE_RULE_ID]: _omit, ...rest } = report.detectors;
    expectGateFailure({ ...report, detectors: rest }, "detector_counters_mismatch");
  });
});

describe("isValidIdempotencyConfirmation", () => {
  it("only the exact string \"IDEMPOTENCY\" is valid", () => {
    expect(isValidIdempotencyConfirmation("IDEMPOTENCY")).toBe(true);
  });
  it.each(["idempotency", "Idempotency", "IDEMPOTENCY ", "BACKFILL", "yes", ""])("rejects %j", (answer) => {
    expect(isValidIdempotencyConfirmation(answer)).toBe(false);
  });
});

describe("buildSafePreflightSummary", () => {
  it("returns preflight: 'idempotency_approved' and only the documented fields", () => {
    const summary = buildSafePreflightSummary(idempotentReport());
    expect(summary.preflight).toBe("idempotency_approved");
    expect(Object.keys(summary).sort()).toEqual(["canonicalHead", "expectedCandidateKinds", "expectedDbDeltas", "outcomes", "preflight", "sourceCounts", "sourceFingerprint"].sort());
  });
});

function mockInvokeClient(impl: () => Promise<{ data: unknown; error: unknown }>): { client: InvokeClient; calls: Array<{ name: string; opts: unknown }> } {
  const calls: Array<{ name: string; opts: unknown }> = [];
  const client: InvokeClient = { functions: { invoke: async (name, opts) => { calls.push({ name, opts }); return impl(); } } };
  return { client, calls };
}

describe("invokeIdempotencyRefreshOnce — exactly one call, exact shape, no retry", () => {
  it("calls functions.invoke with function=refresh-longitudinal, method=POST, body={}", async () => {
    const { client, calls } = mockInvokeClient(async () => ({ data: { status: "complete" }, error: null }));
    await invokeIdempotencyRefreshOnce(client);
    expect(calls).toEqual([{ name: "refresh-longitudinal", opts: { method: "POST", body: {} } }]);
  });

  it("a partial_failure or network error result does not itself trigger a second call (single call site, proven separately below)", async () => {
    const { client, calls } = mockInvokeClient(async () => ({ data: null, error: { message: "network down" } }));
    await invokeIdempotencyRefreshOnce(client);
    expect(calls).toHaveLength(1);
  });
});

describe("sanitizeInvokeResponse", () => {
  it("passes through exactly the 5 known top-level fields, dropping anything else", () => {
    const body = { status: "complete", processingDate: "2026-08-28", outcomes: {}, detectors: {}, errors: [], athleteId: "SECRET" };
    const sanitized = sanitizeInvokeResponse(body);
    expect(Object.keys(sanitized).sort()).toEqual(["detectors", "errors", "outcomes", "processingDate", "status"].sort());
    expect(JSON.stringify(sanitized)).not.toContain("SECRET");
  });
});

describe("validateIdempotencyResponse — exact expected idempotency contract", () => {
  const exactMatchBody = {
    status: "complete",
    processingDate: "2026-08-28",
    outcomes: { attempted: 0, writeSucceeded: 0, alreadyExisted: EXPECTED_EXISTING_DECISION_OUTCOMES, skippedImmature: 0, errorCount: 0 },
    detectors: {
      [RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID]: { attempted: 14, inserted: 0, superseded: 0, unchanged: 0, withdrawn: 0, unchangedWithdrawal: 0, skippedNoPrior: 14, errorCount: 0 },
      [SLEEP_ENERGY_RULE_ID]: { attempted: 3, inserted: 0, superseded: 0, unchanged: 0, withdrawn: 0, unchangedWithdrawal: 0, skippedNoPrior: 3, errorCount: 0 },
      [PAIN_PERSISTENCE_RULE_ID]: { attempted: 3, inserted: 0, superseded: 0, unchanged: 0, withdrawn: 0, unchangedWithdrawal: 0, skippedNoPrior: 3, errorCount: 0 },
    },
    errors: [],
  };

  it("exact match -> matches: true, zero mismatches", () => {
    const result = validateIdempotencyResponse(exactMatchBody, "2026-08-28");
    expect(result).toEqual({ matches: true, mismatches: [] });
  });

  it("a partial_failure status is reported as a mismatch (never silently accepted)", () => {
    const body = { ...exactMatchBody, status: "partial_failure" };
    const result = validateIdempotencyResponse(body, "2026-08-28");
    expect(result.matches).toBe(false);
    expect(result.mismatches.some((m) => m.startsWith("status:"))).toBe(true);
  });

  it("a wrong processingDate is reported", () => {
    const result = validateIdempotencyResponse({ ...exactMatchBody, processingDate: "2026-08-29" }, "2026-08-28");
    expect(result.matches).toBe(false);
    expect(result.mismatches.some((m) => m.startsWith("processingDate:"))).toBe(true);
  });

  it("a wrong outcomes.alreadyExisted is reported", () => {
    const body = { ...exactMatchBody, outcomes: { ...exactMatchBody.outcomes, alreadyExisted: 41 } };
    const result = validateIdempotencyResponse(body, "2026-08-28");
    expect(result.matches).toBe(false);
    expect(result.mismatches.some((m) => m.includes("outcomes.alreadyExisted"))).toBe(true);
  });

  it("a wrong detector counter is reported with the exact dotted path", () => {
    const body = { ...exactMatchBody, detectors: { ...exactMatchBody.detectors, [SLEEP_ENERGY_RULE_ID]: { ...exactMatchBody.detectors[SLEEP_ENERGY_RULE_ID], skippedNoPrior: 2 } } };
    const result = validateIdempotencyResponse(body, "2026-08-28");
    expect(result.matches).toBe(false);
    expect(result.mismatches).toContain(`detectors.${SLEEP_ENERGY_RULE_ID}.skippedNoPrior: expected 3, got 2`);
  });

  it("a non-empty errors array is reported", () => {
    const body = { ...exactMatchBody, errors: [{ scope: "detector", evaluationUnitId: "x", code: "evaluation_failed" }] };
    const result = validateIdempotencyResponse(body, "2026-08-28");
    expect(result.matches).toBe(false);
    expect(result.mismatches.some((m) => m.startsWith("errors:"))).toBe(true);
  });

  it("a missing detector entirely produces mismatches for every one of its expected fields", () => {
    const { [PAIN_PERSISTENCE_RULE_ID]: _omit, ...restDetectors } = exactMatchBody.detectors;
    const result = validateIdempotencyResponse({ ...exactMatchBody, detectors: restDetectors }, "2026-08-28");
    expect(result.matches).toBe(false);
    expect(result.mismatches.some((m) => m.startsWith(`detectors.${PAIN_PERSISTENCE_RULE_ID}.`))).toBe(true);
  });
});

describe("invokeApprovedIdempotencyRefresh.ts — structural source-level invariants", () => {
  it("repository guard runs before Supabase config resolution and sign-in", () => {
    const guardIndex = SOURCE_TEXT.indexOf("runRepositoryGuard()");
    const configIndex = SOURCE_TEXT.indexOf("resolveOperatorSupabaseConfig(");
    const signInIndex = SOURCE_TEXT.indexOf("signInInteractive(");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(configIndex);
    expect(guardIndex).toBeLessThan(signInIndex);
  });

  it("assertIdempotencyApprovalGates runs before requireIdempotencyConfirmation, which runs before invokeIdempotencyRefreshOnce", () => {
    const gatesIndex = SOURCE_TEXT.indexOf("assertIdempotencyApprovalGates(");
    const confirmIndex = SOURCE_TEXT.indexOf("await requireIdempotencyConfirmation();");
    const invokeIndex = SOURCE_TEXT.indexOf("await invokeIdempotencyRefreshOnce(");
    expect(gatesIndex).toBeGreaterThan(-1);
    expect(confirmIndex).toBeGreaterThan(-1);
    expect(invokeIndex).toBeGreaterThan(-1);
    expect(gatesIndex).toBeLessThan(confirmIndex);
    expect(confirmIndex).toBeLessThan(invokeIndex);
  });

  it("invokeIdempotencyRefreshOnce has exactly one real call site in main(), no loop/retry construct", () => {
    const realCallSites = SOURCE_TEXT.match(/await invokeIdempotencyRefreshOnce\(/g) ?? [];
    expect(realCallSites.length).toBe(1);
    expect(SOURCE_TEXT).not.toMatch(/while\s*\(/);
    expect(SOURCE_TEXT).not.toMatch(/\.retry\(/);
    expect(SOURCE_TEXT).not.toMatch(/for\s*\([^)]*\)\s*\{[^}]*invokeIdempotencyRefreshOnce/s);
  });

  it("uses signOutBestEffort (local-scope-only) — never a raw client.auth.signOut call", () => {
    expect(SOURCE_TEXT).toContain("signOutBestEffort(");
    expect(SOURCE_TEXT).not.toMatch(/client\.auth\.signOut\(/);
  });

  it("never references a service-role credential anywhere in this file", () => {
    expect(SOURCE_TEXT).not.toMatch(/SUPABASE_SECRET_KEY/);
    expect(SOURCE_TEXT).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("never accepts password/JWT/refresh-token/service-role as a CLI argument", () => {
    expect(SOURCE_TEXT).not.toMatch(/--password/);
    expect(SOURCE_TEXT).not.toMatch(/--token/);
    expect(SOURCE_TEXT).not.toMatch(/--jwt/);
    expect(SOURCE_TEXT).not.toMatch(/--service-role/);
  });

  it("is a separate file from invokeApprovedRefresh.ts and never imports/weakens it", () => {
    expect(SOURCE_TEXT).not.toMatch(/invokeApprovedRefresh\.js/);
    expect(SOURCE_TEXT).not.toMatch(/from ["']\.\/invokeApprovedRefresh/);
  });
});
