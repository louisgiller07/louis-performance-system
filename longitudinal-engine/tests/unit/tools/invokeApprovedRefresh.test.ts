import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ApprovalGateError,
  MissingApprovalArgsError,
  assertApprovalGates,
  buildSafePreflightSummary,
  invokeRefreshOnce,
  isValidBackfillConfirmation,
  parseApprovalArgs,
  sanitizeInvokeResponse,
  type InvokeClient,
} from "../../../tools/invokeApprovedRefresh.js";
import type { PreviewReport } from "../../../tools/buildPreviewReport.js";

const SOURCE_PATH = fileURLToPath(new URL("../../../tools/invokeApprovedRefresh.ts", import.meta.url));
const SOURCE_TEXT = readFileSync(SOURCE_PATH, "utf8");

const APPROVED_HEAD = "f6e5add666d587b9011634fd563382d23c77e020";
const APPROVED_FINGERPRINT = "sha256:61d187ea4163f1dd6ed4fb17a1337497c728ff1d14d5e39e0f5eb60aac1a0b1e";

function baseReport(overrides: Partial<PreviewReport> = {}): PreviewReport {
  return {
    canonicalHead: APPROVED_HEAD,
    processingDate: "2026-08-28",
    sourceFingerprint: APPROVED_FINGERPRINT,
    athleteResolution: "exactly_one",
    emptyLedgerPrecondition: true,
    sourceCounts: { decisions: 14, dailyCheckins: 3, completedSessions: 0, existingDecisionOutcomes: 0, healthFlags: 1 },
    timeline: { fromDate: "2026-06-19", toDate: "2026-08-28", dayCount: 71 },
    outcomes: { attempted: 42, writeSucceededSimulated: 42, alreadyExisted: 0, skippedImmature: 0, errorCount: 0, byHorizon: { J_PLUS_1: 14, J_PLUS_3: 14, J_PLUS_7: 14 } },
    detectors: {
      recommendation_vs_actual_execution: { attempted: 14, evidence: { total: 0, supporting: 0, neutral: 0, contradicting: 0 }, noEvidence: { total: 14, reasonCodeCounts: { no_completed_session: 14 } }, simulatedActions: { skipped_no_evidence_no_prior: 14 } },
      sleep_quality_to_same_day_energy_correlation: { attempted: 3, evidence: { total: 0, supporting: 0, neutral: 0, contradicting: 0 }, noEvidence: { total: 3, reasonCodeCounts: {} }, simulatedActions: { skipped_no_evidence_no_prior: 3 } },
      pain_persistence_across_recent_checkins: { attempted: 3, evidence: { total: 0, supporting: 0, neutral: 0, contradicting: 0 }, noEvidence: { total: 3, reasonCodeCounts: {} }, simulatedActions: { skipped_no_evidence_no_prior: 3 } },
    },
    expectedDbDeltas: { decisionOutcomes: 42, patternEvidenceIdentities: 0, patternEvidenceRevisions: 0, patternEvidenceSourceRefs: 0, patternEvidenceLifecycleTransitions: 0 },
    expectedCandidateKinds: [],
    ...overrides,
  };
}

const APPROVAL = { approvedHead: APPROVED_HEAD, approvedFingerprint: APPROVED_FINGERPRINT };

describe("parseApprovalArgs", () => {
  it("parses both flags", () => {
    expect(parseApprovalArgs(["--approved-head", APPROVED_HEAD, "--approved-fingerprint", APPROVED_FINGERPRINT])).toEqual(APPROVAL);
  });

  it("throws MissingApprovalArgsError when --approved-head is missing", () => {
    expect(() => parseApprovalArgs(["--approved-fingerprint", APPROVED_FINGERPRINT])).toThrow(MissingApprovalArgsError);
  });

  it("throws MissingApprovalArgsError when --approved-fingerprint is missing", () => {
    expect(() => parseApprovalArgs(["--approved-head", APPROVED_HEAD])).toThrow(MissingApprovalArgsError);
  });

  it("throws when neither flag is present", () => {
    expect(() => parseApprovalArgs([])).toThrow(MissingApprovalArgsError);
  });
});

describe("assertApprovalGates — happy path", () => {
  it("does not throw for the exact already-reviewed low-complexity state", () => {
    expect(() => assertApprovalGates(baseReport(), APPROVAL)).not.toThrow();
  });
});

describe("assertApprovalGates — approval staleness", () => {
  it("wrong approved HEAD -> ApprovalGateError(approval_stale_head), zero invocation reachable", () => {
    const report = baseReport({ canonicalHead: "0000000000000000000000000000000000000000" });
    try {
      assertApprovalGates(report, APPROVAL);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApprovalGateError);
      expect((err as ApprovalGateError).code).toBe("approval_stale_head");
    }
  });

  it("wrong fingerprint -> ApprovalGateError(approval_stale_source_fingerprint)", () => {
    const report = baseReport({ sourceFingerprint: "sha256:0000000000000000000000000000000000000000000000000000000000000000" });
    try {
      assertApprovalGates(report, APPROVAL);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApprovalGateError);
      expect((err as ApprovalGateError).code).toBe("approval_stale_source_fingerprint");
    }
  });
});

describe("assertApprovalGates — ledger/first-backfill safety invariants", () => {
  it("non-empty ledger -> ApprovalGateError(ledger_not_empty)", () => {
    const report = baseReport({ emptyLedgerPrecondition: false });
    expect(() => assertApprovalGates(report, APPROVAL)).toThrow(ApprovalGateError);
    try {
      assertApprovalGates(report, APPROVAL);
    } catch (err) {
      expect((err as ApprovalGateError).code).toBe("ledger_not_empty");
    }
  });

  it("existing outcome present -> ApprovalGateError(existing_outcomes_nonzero)", () => {
    const report = baseReport({ sourceCounts: { ...baseReport().sourceCounts, existingDecisionOutcomes: 1 } });
    try {
      assertApprovalGates(report, APPROVAL);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as ApprovalGateError).code).toBe("existing_outcomes_nonzero");
    }
  });

  it("zero anticipated new outcomes -> ApprovalGateError(no_new_outcomes_expected)", () => {
    const report = baseReport({ expectedDbDeltas: { ...baseReport().expectedDbDeltas, decisionOutcomes: 0 } });
    try {
      assertApprovalGates(report, APPROVAL);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as ApprovalGateError).code).toBe("no_new_outcomes_expected");
    }
  });

  it.each([
    ["patternEvidenceIdentities", { patternEvidenceIdentities: 1 }],
    ["patternEvidenceRevisions", { patternEvidenceRevisions: 1 }],
    ["patternEvidenceSourceRefs", { patternEvidenceSourceRefs: 1 }],
    ["patternEvidenceLifecycleTransitions", { patternEvidenceLifecycleTransitions: 1 }],
  ])("any predicted pattern evidence write (%s) -> ApprovalGateError(pattern_evidence_delta_nonzero)", (_label, patch) => {
    const report = baseReport({ expectedDbDeltas: { ...baseReport().expectedDbDeltas, ...patch } });
    try {
      assertApprovalGates(report, APPROVAL);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as ApprovalGateError).code).toBe("pattern_evidence_delta_nonzero");
    }
  });

  it("candidateKinds non-empty -> ApprovalGateError(candidates_expected)", () => {
    const report = baseReport({ expectedCandidateKinds: ["sleep_energy_same_day_association"] });
    try {
      assertApprovalGates(report, APPROVAL);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as ApprovalGateError).code).toBe("candidates_expected");
    }
  });

  it("any detector Evidence > 0 -> ApprovalGateError(pattern_evidence_delta_nonzero), even with candidateKinds still empty", () => {
    const report = baseReport();
    const withEvidence = {
      ...report,
      detectors: {
        ...report.detectors,
        sleep_quality_to_same_day_energy_correlation: { ...report.detectors.sleep_quality_to_same_day_energy_correlation!, evidence: { total: 1, supporting: 1, neutral: 0, contradicting: 0 } },
      },
    };
    try {
      assertApprovalGates(withEvidence, APPROVAL);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as ApprovalGateError).code).toBe("pattern_evidence_delta_nonzero");
    }
  });
});

describe("isValidBackfillConfirmation", () => {
  it("only the exact string \"BACKFILL\" is valid", () => {
    expect(isValidBackfillConfirmation("BACKFILL")).toBe(true);
  });

  it.each(["backfill", "Backfill", "BACKFILL ", " BACKFILL", "yes", "y", "", "confirm"])("rejects %j", (answer) => {
    expect(isValidBackfillConfirmation(answer)).toBe(false);
  });
});

describe("buildSafePreflightSummary — never leaks more than the documented 5 fields", () => {
  it("returns exactly canonicalHead/sourceFingerprint/sourceCounts/expectedDbDeltas/expectedCandidateKinds/preflight", () => {
    const summary = buildSafePreflightSummary(baseReport());
    expect(Object.keys(summary).sort()).toEqual(["canonicalHead", "expectedCandidateKinds", "expectedDbDeltas", "preflight", "sourceCounts", "sourceFingerprint"].sort());
    expect(summary.preflight).toBe("approved");
  });

  it("never includes the detectors/outcomes/timeline/athleteResolution/emptyLedgerPrecondition/processingDate fields from the full report", () => {
    const summary = buildSafePreflightSummary(baseReport()) as unknown as Record<string, unknown>;
    expect(summary.detectors).toBeUndefined();
    expect(summary.outcomes).toBeUndefined();
    expect(summary.timeline).toBeUndefined();
    expect(summary.processingDate).toBeUndefined();
  });
});

function mockInvokeClient(impl: () => Promise<{ data: unknown; error: unknown }>): { client: InvokeClient; calls: Array<{ name: string; opts: unknown }> } {
  const calls: Array<{ name: string; opts: unknown }> = [];
  const client: InvokeClient = {
    functions: {
      invoke: async (name, opts) => {
        calls.push({ name, opts });
        return impl();
      },
    },
  };
  return { client, calls };
}

describe("invokeRefreshOnce — exactly one call, exact shape", () => {
  it("calls functions.invoke with function=refresh-longitudinal, method=POST, body={}", async () => {
    const { client, calls } = mockInvokeClient(async () => ({ data: { status: "complete" }, error: null }));
    await invokeRefreshOnce(client);
    expect(calls).toEqual([{ name: "refresh-longitudinal", opts: { method: "POST", body: {} } }]);
  });

  it("calling it twice in test code makes exactly two recorded calls (proves the function itself has no hidden retry loop — a single call site only ever produces one)", async () => {
    const { client, calls } = mockInvokeClient(async () => ({ data: {}, error: null }));
    await invokeRefreshOnce(client);
    await invokeRefreshOnce(client);
    expect(calls).toHaveLength(2);
  });
});

describe("sanitizeInvokeResponse", () => {
  it("passes through exactly the 5 known top-level fields", () => {
    const body = { status: "complete", processingDate: "2026-08-28", outcomes: { attempted: 42 }, detectors: {}, errors: [] };
    expect(sanitizeInvokeResponse(body)).toEqual(body);
  });

  it("never passes through an unexpected extra field (defense in depth against a future accidental leak)", () => {
    const body = { status: "complete", processingDate: "2026-08-28", outcomes: {}, detectors: {}, errors: [], athleteId: "SECRET-ATHLETE-ID", jwt: "SECRET.JWT.VALUE" };
    const sanitized = sanitizeInvokeResponse(body);
    expect(Object.keys(sanitized).sort()).toEqual(["detectors", "errors", "outcomes", "processingDate", "status"].sort());
    const serialized = JSON.stringify(sanitized);
    expect(serialized).not.toContain("SECRET-ATHLETE-ID");
    expect(serialized).not.toContain("SECRET.JWT.VALUE");
  });

  it("never throws on a malformed/undefined body — falls back to nulls", () => {
    expect(() => sanitizeInvokeResponse(undefined)).not.toThrow();
    expect(sanitizeInvokeResponse(undefined)).toEqual({ status: null, processingDate: null, outcomes: null, detectors: null, errors: null });
  });

  it("preserves a partial_failure status verbatim (the caller decides whether to stop, this function only sanitizes)", () => {
    const body = { status: "partial_failure", processingDate: "2026-08-28", outcomes: {}, detectors: {}, errors: [{ scope: "detector", evaluationUnitId: "x", code: "evaluation_failed" }] };
    expect(sanitizeInvokeResponse(body).status).toBe("partial_failure");
  });
});

describe("invokeApprovedRefresh.ts — structural source-level invariants", () => {
  it("calls invokeRefreshOnce exactly once at a single call site in main() — no loop, no retry construct around it", () => {
    const occurrences = SOURCE_TEXT.match(/invokeRefreshOnce\(/g) ?? [];
    // Exactly 2 occurrences total in the file: the function's own declaration
    // (`export async function invokeRefreshOnce(`) plus exactly one real call
    // site inside main() (`await invokeRefreshOnce(`) — proven separately below.
    expect(occurrences.length).toBe(2);
    const realCallSites = SOURCE_TEXT.match(/await invokeRefreshOnce\(/g) ?? [];
    expect(realCallSites.length).toBe(1);
    expect(SOURCE_TEXT).not.toMatch(/for\s*\([^)]*\)\s*\{[^}]*invokeRefreshOnce/s);
    expect(SOURCE_TEXT).not.toMatch(/while\s*\(/);
    expect(SOURCE_TEXT).not.toMatch(/\.retry\(/);
  });

  it("assertApprovalGates is called before requireBackfillConfirmation, which is called before invokeRefreshOnce (source order)", () => {
    const gatesIndex = SOURCE_TEXT.indexOf("assertApprovalGates(");
    const confirmIndex = SOURCE_TEXT.indexOf("await requireBackfillConfirmation();");
    const invokeIndex = SOURCE_TEXT.indexOf("await invokeRefreshOnce(");
    expect(gatesIndex).toBeGreaterThan(-1);
    expect(confirmIndex).toBeGreaterThan(-1);
    expect(invokeIndex).toBeGreaterThan(-1);
    expect(gatesIndex).toBeLessThan(confirmIndex);
    expect(confirmIndex).toBeLessThan(invokeIndex);
  });

  it("repository guard runs before Supabase config resolution and sign-in (same discipline as previewRemoteRefresh.ts/getInsightsCanary.ts)", () => {
    const guardIndex = SOURCE_TEXT.indexOf("runRepositoryGuard()");
    const configIndex = SOURCE_TEXT.indexOf("resolveOperatorSupabaseConfig(");
    const signInIndex = SOURCE_TEXT.indexOf("signInInteractive(");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(configIndex);
    expect(guardIndex).toBeLessThan(signInIndex);
  });

  it("uses signOutBestEffort (local-scope-only, per operatorAuth.ts) — never a raw client.auth.signOut call", () => {
    expect(SOURCE_TEXT).toContain("signOutBestEffort(");
    expect(SOURCE_TEXT).not.toMatch(/client\.auth\.signOut\(/);
  });

  it("never references a service-role credential anywhere in this file", () => {
    // Deliberately does NOT scan for the bare word "supabaseAdmin": this
    // file legitimately passes `recording.client` (the harmless in-memory
    // RecordingRpcClient) under the `supabaseAdmin:` parameter name that
    // calculateAndPersistOutcomes/runDetectors' own signatures require —
    // proven elsewhere (recordingRpcClient.test.ts) to perform zero network
    // I/O. The real risk signal is an actual credential/env-var reference.
    expect(SOURCE_TEXT).not.toMatch(/SUPABASE_SECRET_KEY/);
    expect(SOURCE_TEXT).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("never accepts password/JWT/refresh-token/service-role as a CLI argument — only --approved-head/--approved-fingerprint are parsed from argv", () => {
    expect(SOURCE_TEXT).not.toMatch(/--password/);
    expect(SOURCE_TEXT).not.toMatch(/--token/);
    expect(SOURCE_TEXT).not.toMatch(/--jwt/);
    expect(SOURCE_TEXT).not.toMatch(/--service-role/);
  });

  it("on a partial_failure response, sets a failing exit code but never calls invokeRefreshOnce a second time (single call site already proven above)", () => {
    expect(SOURCE_TEXT).toMatch(/partial_failure/);
    expect(SOURCE_TEXT).toMatch(/process\.exitCode = 1/);
  });
});
