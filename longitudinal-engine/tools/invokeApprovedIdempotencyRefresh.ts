/**
 * V0.3_001B — operator-only, guarded, single-shot SECOND invocation of the
 * DEPLOYED `refresh-longitudinal` Edge Function, scoped exclusively to
 * proving idempotency of the already-completed first backfill. This is a
 * SEPARATE tool from `invokeApprovedRefresh.ts` — that tool remains
 * permanently scoped to first-backfill semantics (requires zero existing
 * outcomes, a positive new-write count) and is never weakened or reused
 * here. This tool requires the OPPOSITE shape: the fresh preview must show
 * the exact already-reviewed post-first-run state (42 existing outcomes,
 * zero new writes, zero pattern evidence, identical per-detector
 * `skippedNoPrior` counts) before it will proceed.
 *
 * Reuses `repositoryGuard.ts`/`operatorAuth.ts` verbatim (no
 * authentication logic duplicated), and reuses the exact same real
 * production orchestrators (`assembleAthleteTimeline`,
 * `calculateAndPersistOutcomes`, `runDetectors`) plus `RecordingRpcClient`/
 * `buildPreviewReport` that `previewRemoteRefresh.ts`/
 * `invokeApprovedRefresh.ts` use — the preview rebuilt here is
 * byte-for-byte the same kind of report, never a reimplementation, never
 * shelled out to another CLI script.
 *
 * Usage (run by the OPERATOR, in their own terminal — never by Claude
 * Code, see below):
 *   cd longitudinal-engine
 *   SUPABASE_URL=https://uvolpldwwyvadlamulvr.supabase.co \
 *   SUPABASE_ANON_KEY=<the project's public anon/publishable key> \
 *   npx tsx tools/invokeApprovedIdempotencyRefresh.ts \
 *     --approved-head <the exact HEAD a human already reviewed> \
 *     --approved-fingerprint <the exact sourceFingerprint a human already reviewed>
 *
 * --approved-head/--approved-fingerprint are NOT secrets and are meant to
 * appear in argv/shell history/logs — the explicit, auditable approval
 * reference, not a credential. No password/JWT/refresh-token/service-role
 * value is ever accepted as a CLI argument, in this tool or any other in
 * this project.
 *
 * IDEMPOTENCY-PROOF SAFETY SCOPE: this tool refuses to proceed unless the
 * FRESH preview shows EXACTLY the already-proven second-run state —
 * `sourceCounts.existingDecisionOutcomes === 42`, every outcome counter
 * matching the audited "short-circuit, zero new writes" contract (see
 * `outcomeIdempotency.audit.integration.test.ts`), zero pattern-evidence
 * deltas, and the exact per-detector `skippedNoPrior` totals already
 * observed on the real first run (14/3/3). If real source data has
 * changed since approval — a new decision appeared, a completed_session
 * was linked, checkin content changed — this tool aborts rather than
 * silently authorizing a now-different write. A new preview/review is
 * required for that, and likely a different tool entirely (this one is
 * NOT a general-purpose second-invocation runner).
 */
import { runRepositoryGuard } from "./repositoryGuard.js";
import {
  checkOwnEvidenceLedgerEmpty,
  NoInteractiveTtyError,
  promptVisible,
  resolveOperatorSupabaseConfig,
  resolveOwnAthleteId,
  signInInteractive,
  signOutBestEffort,
} from "./operatorAuth.js";
import { assembleAthleteTimeline } from "../src/supabase/assembleAthleteTimeline.js";
import { calculateAndPersistOutcomes } from "../src/supabase/outcomeOrchestrator.js";
import { runDetectors } from "../src/supabase/detectorOrchestrator.js";
import { currentLongitudinalProcessingDate } from "../src/timeline/index.js";
import { RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID, SLEEP_ENERGY_RULE_ID, PAIN_PERSISTENCE_RULE_ID } from "../src/detectors/index.js";
import { createRecordingRpcClient } from "./recordingRpcClient.js";
import { buildPreviewReport, type PreviewReport } from "./buildPreviewReport.js";

export interface ApprovalArgs {
  readonly approvedHead: string;
  readonly approvedFingerprint: string;
}

export class MissingApprovalArgsError extends Error {
  constructor(missing: string) {
    super(
      `Missing required CLI argument: ${missing}. Usage: npx tsx tools/invokeApprovedIdempotencyRefresh.ts --approved-head <sha> --approved-fingerprint <sha256:...>`
    );
    this.name = "MissingApprovalArgsError";
  }
}

export function parseApprovalArgs(argv: readonly string[]): ApprovalArgs {
  const headIndex = argv.indexOf("--approved-head");
  const fingerprintIndex = argv.indexOf("--approved-fingerprint");
  const approvedHead = headIndex >= 0 ? argv[headIndex + 1] : undefined;
  const approvedFingerprint = fingerprintIndex >= 0 ? argv[fingerprintIndex + 1] : undefined;
  if (!approvedHead) throw new MissingApprovalArgsError("--approved-head <sha>");
  if (!approvedFingerprint) throw new MissingApprovalArgsError("--approved-fingerprint <sha256:...>");
  return { approvedHead, approvedFingerprint };
}

/** The exact, already-reviewed idempotency-proof state (Section 1 of the V0.3_001B idempotency-runner authorization) — fixed constants, not a general parameter, by design: this tool proves ONE specific already-audited scenario, never an arbitrary "second run". */
export const EXPECTED_EXISTING_DECISION_OUTCOMES = 42;
export const EXPECTED_DETECTOR_COUNTERS: Readonly<Record<string, { readonly attempted: number; readonly skippedNoPrior: number }>> = {
  [RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID]: { attempted: 14, skippedNoPrior: 14 },
  [SLEEP_ENERGY_RULE_ID]: { attempted: 3, skippedNoPrior: 3 },
  [PAIN_PERSISTENCE_RULE_ID]: { attempted: 3, skippedNoPrior: 3 },
};

export type IdempotencyApprovalGateFailureCode =
  | "approval_stale_head"
  | "approval_stale_source_fingerprint"
  | "ledger_not_empty"
  | "existing_outcomes_mismatch"
  | "outcomes_attempted_nonzero"
  | "outcomes_write_succeeded_nonzero"
  | "outcomes_already_existed_mismatch"
  | "outcomes_skipped_immature_nonzero"
  | "outcomes_error_count_nonzero"
  | "decision_outcomes_delta_nonzero"
  | "pattern_evidence_delta_nonzero"
  | "candidates_expected"
  | "detector_evidence_nonzero"
  | "detector_counters_mismatch";

export class IdempotencyApprovalGateError extends Error {
  public readonly code: IdempotencyApprovalGateFailureCode;
  constructor(code: IdempotencyApprovalGateFailureCode, detail: string) {
    super(`IdempotencyApprovalGateError[${code}]: ${detail}`);
    this.name = "IdempotencyApprovalGateError";
    this.code = code;
  }
}

export class ConfirmationDeclinedError extends Error {
  constructor() {
    super('ConfirmationDeclinedError: the operator did not type exactly "IDEMPOTENCY" — aborting with zero invocation.');
    this.name = "ConfirmationDeclinedError";
  }
}

/**
 * The full hard-gate chain, run against a FRESH preview report — never a
 * cached/prior one. Every check must pass before a single invocation is
 * ever attempted. Any single failure aborts with zero side effects.
 */
export function assertIdempotencyApprovalGates(report: PreviewReport, approval: ApprovalArgs): void {
  if (report.canonicalHead !== approval.approvedHead) {
    throw new IdempotencyApprovalGateError(
      "approval_stale_head",
      `fresh preview canonicalHead (${report.canonicalHead}) does not match the approved --approved-head (${approval.approvedHead}). Re-run the canonical preview and obtain fresh approval.`
    );
  }
  if (report.sourceFingerprint !== approval.approvedFingerprint) {
    throw new IdempotencyApprovalGateError(
      "approval_stale_source_fingerprint",
      `fresh preview sourceFingerprint (${report.sourceFingerprint}) does not match the approved --approved-fingerprint (${approval.approvedFingerprint}). Source data or processingDate has moved since approval — re-run the canonical preview and obtain fresh approval.`
    );
  }
  if (!report.emptyLedgerPrecondition) {
    throw new IdempotencyApprovalGateError("ledger_not_empty", "the target athlete's pattern_evidence_identities ledger is not proven empty in the fresh preview.");
  }

  if (report.sourceCounts.existingDecisionOutcomes !== EXPECTED_EXISTING_DECISION_OUTCOMES) {
    throw new IdempotencyApprovalGateError(
      "existing_outcomes_mismatch",
      `existingDecisionOutcomes is ${report.sourceCounts.existingDecisionOutcomes} in the fresh preview, expected exactly ${EXPECTED_EXISTING_DECISION_OUTCOMES} (the already-audited first-run result). Source data changed since approval — a new preview/review is required.`
    );
  }
  if (report.outcomes.attempted !== 0) {
    throw new IdempotencyApprovalGateError("outcomes_attempted_nonzero", `outcomes.attempted is ${report.outcomes.attempted}, expected 0 — a second run must short-circuit before any new attempt.`);
  }
  if (report.outcomes.writeSucceededSimulated !== 0) {
    throw new IdempotencyApprovalGateError("outcomes_write_succeeded_nonzero", `outcomes.writeSucceededSimulated is ${report.outcomes.writeSucceededSimulated}, expected 0.`);
  }
  if (report.outcomes.alreadyExisted !== EXPECTED_EXISTING_DECISION_OUTCOMES) {
    throw new IdempotencyApprovalGateError(
      "outcomes_already_existed_mismatch",
      `outcomes.alreadyExisted is ${report.outcomes.alreadyExisted}, expected exactly ${EXPECTED_EXISTING_DECISION_OUTCOMES}.`
    );
  }
  if (report.outcomes.skippedImmature !== 0) {
    throw new IdempotencyApprovalGateError("outcomes_skipped_immature_nonzero", `outcomes.skippedImmature is ${report.outcomes.skippedImmature}, expected 0.`);
  }
  if (report.outcomes.errorCount !== 0) {
    throw new IdempotencyApprovalGateError("outcomes_error_count_nonzero", `outcomes.errorCount is ${report.outcomes.errorCount}, expected 0.`);
  }

  if (report.expectedDbDeltas.decisionOutcomes !== 0) {
    throw new IdempotencyApprovalGateError("decision_outcomes_delta_nonzero", `expectedDbDeltas.decisionOutcomes is ${report.expectedDbDeltas.decisionOutcomes}, expected 0 for an idempotency-proof run.`);
  }
  const evidenceDeltas = [
    report.expectedDbDeltas.patternEvidenceIdentities,
    report.expectedDbDeltas.patternEvidenceRevisions,
    report.expectedDbDeltas.patternEvidenceSourceRefs,
    report.expectedDbDeltas.patternEvidenceLifecycleTransitions,
  ];
  if (evidenceDeltas.some((d) => d !== 0)) {
    throw new IdempotencyApprovalGateError(
      "pattern_evidence_delta_nonzero",
      "the fresh preview predicts a non-zero pattern-evidence delta; this idempotency-proof tool only authorizes the already-reviewed zero-evidence state. A new preview/review is required."
    );
  }
  if (report.expectedCandidateKinds.length !== 0) {
    throw new IdempotencyApprovalGateError(
      "candidates_expected",
      `the fresh preview predicts ${report.expectedCandidateKinds.length} insight candidate kind(s); this idempotency-proof tool only authorizes the already-reviewed zero-candidate state.`
    );
  }

  for (const [ruleId, summary] of Object.entries(report.detectors)) {
    if (summary.evidence.total !== 0) {
      throw new IdempotencyApprovalGateError(
        "detector_evidence_nonzero",
        `detector "${ruleId}" predicts ${summary.evidence.total} Evidence item(s) in the fresh preview; this idempotency-proof tool only authorizes zero-Evidence detection across every detector.`
      );
    }
  }

  for (const [ruleId, expected] of Object.entries(EXPECTED_DETECTOR_COUNTERS)) {
    const summary = report.detectors[ruleId];
    if (!summary) {
      throw new IdempotencyApprovalGateError("detector_counters_mismatch", `detector "${ruleId}" is missing from the fresh preview entirely.`);
    }
    if (summary.attempted !== expected.attempted) {
      throw new IdempotencyApprovalGateError(
        "detector_counters_mismatch",
        `detector "${ruleId}" attempted=${summary.attempted} in the fresh preview, expected exactly ${expected.attempted}.`
      );
    }
    const skippedNoPrior = summary.simulatedActions.skipped_no_evidence_no_prior ?? 0;
    if (skippedNoPrior !== expected.skippedNoPrior) {
      throw new IdempotencyApprovalGateError(
        "detector_counters_mismatch",
        `detector "${ruleId}" skipped_no_evidence_no_prior=${skippedNoPrior} in the fresh preview, expected exactly ${expected.skippedNoPrior}.`
      );
    }
    const otherActionsTotal = Object.entries(summary.simulatedActions)
      .filter(([action]) => action !== "skipped_no_evidence_no_prior")
      .reduce((sum, [, count]) => sum + count, 0);
    if (otherActionsTotal !== 0) {
      throw new IdempotencyApprovalGateError(
        "detector_counters_mismatch",
        `detector "${ruleId}" has ${otherActionsTotal} simulated action(s) other than skipped_no_evidence_no_prior in the fresh preview — this idempotency-proof tool only authorizes the pure no-op second-run state.`
      );
    }
  }
}

export interface SafePreflightSummary {
  readonly canonicalHead: string;
  readonly sourceFingerprint: string;
  readonly sourceCounts: PreviewReport["sourceCounts"];
  readonly outcomes: { readonly attempted: number; readonly writeSucceededSimulated: number; readonly alreadyExisted: number; readonly skippedImmature: number; readonly errorCount: number };
  readonly expectedDbDeltas: PreviewReport["expectedDbDeltas"];
  readonly expectedCandidateKinds: PreviewReport["expectedCandidateKinds"];
  readonly preflight: "idempotency_approved";
}

export function buildSafePreflightSummary(report: PreviewReport): SafePreflightSummary {
  return {
    canonicalHead: report.canonicalHead,
    sourceFingerprint: report.sourceFingerprint,
    sourceCounts: report.sourceCounts,
    outcomes: {
      attempted: report.outcomes.attempted,
      writeSucceededSimulated: report.outcomes.writeSucceededSimulated,
      alreadyExisted: report.outcomes.alreadyExisted,
      skippedImmature: report.outcomes.skippedImmature,
      errorCount: report.outcomes.errorCount,
    },
    expectedDbDeltas: report.expectedDbDeltas,
    expectedCandidateKinds: report.expectedCandidateKinds,
    preflight: "idempotency_approved",
  };
}

interface RawRefreshResponse {
  readonly status?: unknown;
  readonly processingDate?: unknown;
  readonly outcomes?: unknown;
  readonly detectors?: unknown;
  readonly errors?: unknown;
}

/** Passes through ONLY the 5 known, already-sanitized top-level fields of refresh-longitudinal's own response contract — never spreads the raw body. */
export function sanitizeInvokeResponse(rawBody: unknown): Record<string, unknown> {
  const body = (rawBody ?? {}) as RawRefreshResponse;
  return {
    status: body.status ?? null,
    processingDate: body.processingDate ?? null,
    outcomes: body.outcomes ?? null,
    detectors: body.detectors ?? null,
    errors: body.errors ?? null,
  };
}

export interface ResponseValidationResult {
  readonly matches: boolean;
  readonly mismatches: readonly string[];
}

/**
 * Validates the ACTUAL sanitized response against the exact idempotency
 * contract this tool authorized (Section 13). Any deviation — including a
 * partial_failure status, which will always show up here as a `status`
 * mismatch — is reported explicitly; the caller stops regardless (a single
 * call site, never retried, per invokeIdempotencyRefreshOnce's own doc).
 */
export function validateIdempotencyResponse(sanitized: Record<string, unknown>, expectedProcessingDate: string): ResponseValidationResult {
  const mismatches: string[] = [];

  if (sanitized.status !== "complete") mismatches.push(`status: expected "complete", got ${JSON.stringify(sanitized.status)}`);
  if (sanitized.processingDate !== expectedProcessingDate) {
    mismatches.push(`processingDate: expected "${expectedProcessingDate}", got ${JSON.stringify(sanitized.processingDate)}`);
  }

  const outcomes = (sanitized.outcomes ?? null) as Record<string, unknown> | null;
  const expectedOutcomes: Record<string, number> = { attempted: 0, writeSucceeded: 0, alreadyExisted: EXPECTED_EXISTING_DECISION_OUTCOMES, skippedImmature: 0, errorCount: 0 };
  for (const [key, expected] of Object.entries(expectedOutcomes)) {
    const actual = outcomes ? outcomes[key] : undefined;
    if (actual !== expected) mismatches.push(`outcomes.${key}: expected ${expected}, got ${JSON.stringify(actual)}`);
  }

  const detectors = (sanitized.detectors ?? null) as Record<string, Record<string, unknown>> | null;
  for (const [ruleId, expected] of Object.entries(EXPECTED_DETECTOR_COUNTERS)) {
    const summary = detectors ? detectors[ruleId] : undefined;
    const expectedShape: Record<string, number> = {
      attempted: expected.attempted,
      inserted: 0,
      superseded: 0,
      unchanged: 0,
      withdrawn: 0,
      unchangedWithdrawal: 0,
      skippedNoPrior: expected.skippedNoPrior,
      errorCount: 0,
    };
    for (const [key, expectedValue] of Object.entries(expectedShape)) {
      const actual = summary ? summary[key] : undefined;
      if (actual !== expectedValue) mismatches.push(`detectors.${ruleId}.${key}: expected ${expectedValue}, got ${JSON.stringify(actual)}`);
    }
  }

  if (!Array.isArray(sanitized.errors) || sanitized.errors.length !== 0) {
    mismatches.push(`errors: expected [], got ${JSON.stringify(sanitized.errors)}`);
  }

  return { matches: mismatches.length === 0, mismatches };
}

/**
 * The minimal functions.invoke surface this tool needs — injectable so
 * tests can prove call count/args/no-retry without ever touching a real
 * network or a real Supabase client.
 */
export interface InvokeClient {
  functions: {
    invoke(name: string, opts: { method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body: Record<string, never> }): Promise<{ data: unknown; error: unknown }>;
  };
}

export async function invokeIdempotencyRefreshOnce(client: InvokeClient): Promise<{ data: unknown; error: unknown }> {
  // Exactly one call. No loop, no retry — a partial failure or network
  // error is reported and the process stops; this function is never
  // called twice from within a single tool invocation.
  return client.functions.invoke("refresh-longitudinal", { method: "POST", body: {} });
}

/** The exact, case-sensitive, no-default comparison — extracted as a pure function so it is directly testable without a real prompt. */
export function isValidIdempotencyConfirmation(answer: string): boolean {
  return answer === "IDEMPOTENCY";
}

async function requireIdempotencyConfirmation(): Promise<void> {
  const answer = await promptVisible('\nType exactly "IDEMPOTENCY" to proceed with this second remote invocation, or anything else to abort: ');
  if (!isValidIdempotencyConfirmation(answer)) {
    throw new ConfirmationDeclinedError();
  }
}

async function main(): Promise<void> {
  const approval = parseApprovalArgs(process.argv.slice(2));

  // Repository guard — before any auth/network. Additionally requires the
  // current HEAD to exactly equal the approved HEAD supplied on argv.
  const guardState = runRepositoryGuard();
  if (guardState.head !== approval.approvedHead) {
    throw new IdempotencyApprovalGateError(
      "approval_stale_head",
      `current HEAD (${guardState.head}) does not match --approved-head (${approval.approvedHead}). Re-run the canonical preview against the current HEAD and supply its fresh values.`
    );
  }

  const config = resolveOperatorSupabaseConfig("remote");

  let session;
  try {
    session = await signInInteractive(config);
  } catch (err) {
    if (err instanceof NoInteractiveTtyError) {
      console.error(err.message);
      console.error("\nThis tool must be run by the operator directly in a normal local terminal — Claude Code must never run it interactively.");
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  try {
    const athleteId = await resolveOwnAthleteId(session.client);
    const emptyLedgerPrecondition = await checkOwnEvidenceLedgerEmpty(session.client, athleteId);
    const processingDate = currentLongitudinalProcessingDate();

    // Fresh canonical preview — real orchestrators, RecordingRpcClient,
    // zero writes — rebuilt from scratch, never trusting a prior report.
    const timeline = await assembleAthleteTimeline({ client: session.client, athleteId, longitudinalProcessingDate: processingDate });
    const recording = createRecordingRpcClient();
    const outcomesResult = await calculateAndPersistOutcomes({ supabaseAdmin: recording.client, timeline, observedThroughDate: processingDate });
    const detectorsResult = await runDetectors({ supabaseAdmin: recording.client, timeline });
    const report = buildPreviewReport({
      canonicalHead: guardState.head,
      processingDate,
      emptyLedgerPrecondition,
      timeline,
      outcomesResult,
      detectorsResult,
      outcomeCalls: recording.outcomeCalls,
      evidenceCalls: recording.evidenceCalls,
      lifecycleCalls: recording.lifecycleCalls,
    });

    assertIdempotencyApprovalGates(report, approval);

    console.log(JSON.stringify(buildSafePreflightSummary(report), null, 2));

    await requireIdempotencyConfirmation();

    const { data, error } = await invokeIdempotencyRefreshOnce(session.client);

    if (error) {
      const context = (error as { context?: Response }).context;
      const httpStatus = context?.status ?? null;
      let body: unknown = null;
      try {
        body = context ? await context.clone().json() : null;
      } catch {
        body = null;
      }
      console.log(JSON.stringify({ httpStatus, ...sanitizeInvokeResponse(body) }, null, 2));
      console.error("\nHTTP/network failure. STOP — do not invoke again. Inspect remote state read-only first.");
      process.exitCode = 1;
      return;
    }

    const sanitized = sanitizeInvokeResponse(data);
    console.log(JSON.stringify(sanitized, null, 2));

    const validation = validateIdempotencyResponse(sanitized, processingDate);
    console.log(JSON.stringify(validation, null, 2));

    if (!validation.matches) {
      console.error("\nActual response DID NOT match the exact approved idempotency contract. STOP — do not invoke again. Inspect remote state read-only first.");
      process.exitCode = 1;
    }
  } finally {
    await signOutBestEffort(session.client);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
