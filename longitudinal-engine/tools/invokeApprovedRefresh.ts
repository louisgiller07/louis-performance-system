/**
 * V0.3_001B — operator-only, guarded, single-shot invocation of the
 * DEPLOYED `refresh-longitudinal` Edge Function. This is the ONLY tool in
 * this repository authorized to perform the first remote write, and only
 * under a strict approval chain: an already-reviewed HEAD + source
 * fingerprint must be supplied on the command line, a FRESH canonical
 * preview is rebuilt immediately before any write (never trusting a
 * possibly-stale prior report), and every hard gate below must pass before
 * a single interactive human confirmation is requested. NOT imported by
 * `supabase/functions/**`/`web/**`/`head-coach-engine/**`, and does not
 * alter production runtime behavior — it calls the deployed endpoint
 * exactly as a real authenticated browser would, nothing more.
 *
 * Reuses `repositoryGuard.ts`/`operatorAuth.ts` verbatim (no
 * authentication logic duplicated), and reuses the exact same real
 * production orchestrators (`assembleAthleteTimeline`,
 * `calculateAndPersistOutcomes`, `runDetectors`) plus `RecordingRpcClient`/
 * `buildPreviewReport` that `previewRemoteRefresh.ts` uses — the preview
 * rebuilt here is byte-for-byte the same kind of report, never a
 * reimplementation, never shelled out to the CLI script.
 *
 * Usage (run by the OPERATOR, in their own terminal — never by Claude
 * Code, see below):
 *   cd longitudinal-engine
 *   SUPABASE_URL=https://uvolpldwwyvadlamulvr.supabase.co \
 *   SUPABASE_ANON_KEY=<the project's public anon/publishable key> \
 *   npx tsx tools/invokeApprovedRefresh.ts \
 *     --approved-head <the exact HEAD a human already reviewed> \
 *     --approved-fingerprint <the exact sourceFingerprint a human already reviewed>
 *
 * --approved-head/--approved-fingerprint are NOT secrets (a commit SHA and
 * a content hash) and are meant to appear in argv, shell history, and logs
 * — this is the explicit, auditable approval reference, not a credential.
 * No password/JWT/refresh-token/service-role value is ever accepted as a
 * CLI argument, in this tool or any other in this project.
 *
 * FIRST-BACKFILL SAFETY SCOPE (Section 8 of the V0.3_001B rollout review):
 * this specific tool additionally refuses to proceed unless the FRESH
 * preview still shows the exact already-reviewed low-complexity state —
 * zero existing decision_outcomes, a positive but evidence-free outcome
 * write count, and EVERY pattern-evidence delta and candidate count at
 * zero. If real source data has changed enough to produce actual Evidence
 * since the approval was granted, this tool aborts rather than silently
 * widening what was approved — a new preview/review is required for that.
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
import { createRecordingRpcClient } from "./recordingRpcClient.js";
import { buildPreviewReport, type PreviewReport } from "./buildPreviewReport.js";

export interface ApprovalArgs {
  readonly approvedHead: string;
  readonly approvedFingerprint: string;
}

export class MissingApprovalArgsError extends Error {
  constructor(missing: string) {
    super(
      `Missing required CLI argument: ${missing}. Usage: npx tsx tools/invokeApprovedRefresh.ts --approved-head <sha> --approved-fingerprint <sha256:...>`
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

export type ApprovalGateFailureCode =
  | "approval_stale_head"
  | "approval_stale_source_fingerprint"
  | "ledger_not_empty"
  | "existing_outcomes_nonzero"
  | "no_new_outcomes_expected"
  | "pattern_evidence_delta_nonzero"
  | "candidates_expected";

export class ApprovalGateError extends Error {
  public readonly code: ApprovalGateFailureCode;
  constructor(code: ApprovalGateFailureCode, detail: string) {
    super(`ApprovalGateError[${code}]: ${detail}`);
    this.name = "ApprovalGateError";
    this.code = code;
  }
}

export class ConfirmationDeclinedError extends Error {
  constructor() {
    super('ConfirmationDeclinedError: the operator did not type exactly "BACKFILL" — aborting with zero write.');
    this.name = "ConfirmationDeclinedError";
  }
}

/**
 * The full hard-gate chain, run against a FRESH preview report — never a
 * cached/prior one. Every check here must pass before a single write is
 * ever attempted. Order matters only for the specificity of the resulting
 * error code, not for correctness: any single failure aborts with zero
 * side effects.
 */
export function assertApprovalGates(report: PreviewReport, approval: ApprovalArgs): void {
  if (report.canonicalHead !== approval.approvedHead) {
    throw new ApprovalGateError(
      "approval_stale_head",
      `fresh preview canonicalHead (${report.canonicalHead}) does not match the approved --approved-head (${approval.approvedHead}). Re-run the canonical preview and obtain fresh approval.`
    );
  }
  if (report.sourceFingerprint !== approval.approvedFingerprint) {
    throw new ApprovalGateError(
      "approval_stale_source_fingerprint",
      `fresh preview sourceFingerprint (${report.sourceFingerprint}) does not match the approved --approved-fingerprint (${approval.approvedFingerprint}). Source data or processingDate has moved since approval — re-run the canonical preview and obtain fresh approval.`
    );
  }
  if (!report.emptyLedgerPrecondition) {
    throw new ApprovalGateError("ledger_not_empty", "the target athlete's pattern_evidence_identities ledger is not proven empty in the fresh preview.");
  }

  // First-backfill safety scope (Section 8) — deliberately constrains THIS
  // tool to the exact already-reviewed zero-evidence state. A real change
  // widening the write surface must never be silently absorbed here.
  if (report.sourceCounts.existingDecisionOutcomes !== 0) {
    throw new ApprovalGateError(
      "existing_outcomes_nonzero",
      `existingDecisionOutcomes is ${report.sourceCounts.existingDecisionOutcomes} in the fresh preview, expected 0 for this first-backfill tool.`
    );
  }
  if (!(report.expectedDbDeltas.decisionOutcomes > 0)) {
    throw new ApprovalGateError("no_new_outcomes_expected", `expectedDbDeltas.decisionOutcomes is ${report.expectedDbDeltas.decisionOutcomes} in the fresh preview, expected > 0.`);
  }
  const evidenceDeltas = [
    report.expectedDbDeltas.patternEvidenceIdentities,
    report.expectedDbDeltas.patternEvidenceRevisions,
    report.expectedDbDeltas.patternEvidenceSourceRefs,
    report.expectedDbDeltas.patternEvidenceLifecycleTransitions,
  ];
  if (evidenceDeltas.some((d) => d !== 0)) {
    throw new ApprovalGateError(
      "pattern_evidence_delta_nonzero",
      "the fresh preview predicts a non-zero pattern-evidence delta; this first-backfill tool only authorizes the already-reviewed zero-evidence state. A new preview/review is required."
    );
  }
  if (report.expectedCandidateKinds.length !== 0) {
    throw new ApprovalGateError(
      "candidates_expected",
      `the fresh preview predicts ${report.expectedCandidateKinds.length} insight candidate kind(s); this first-backfill tool only authorizes the already-reviewed zero-candidate state.`
    );
  }
  for (const [ruleId, summary] of Object.entries(report.detectors)) {
    if (summary.evidence.total !== 0) {
      throw new ApprovalGateError(
        "pattern_evidence_delta_nonzero",
        `detector "${ruleId}" predicts ${summary.evidence.total} Evidence item(s) in the fresh preview; this first-backfill tool only authorizes zero-Evidence detection across every detector.`
      );
    }
  }
}

export interface SafePreflightSummary {
  readonly canonicalHead: string;
  readonly sourceFingerprint: string;
  readonly sourceCounts: PreviewReport["sourceCounts"];
  readonly expectedDbDeltas: PreviewReport["expectedDbDeltas"];
  readonly expectedCandidateKinds: PreviewReport["expectedCandidateKinds"];
  readonly preflight: "approved";
}

export function buildSafePreflightSummary(report: PreviewReport): SafePreflightSummary {
  return {
    canonicalHead: report.canonicalHead,
    sourceFingerprint: report.sourceFingerprint,
    sourceCounts: report.sourceCounts,
    expectedDbDeltas: report.expectedDbDeltas,
    expectedCandidateKinds: report.expectedCandidateKinds,
    preflight: "approved",
  };
}

interface RawRefreshResponse {
  readonly status?: unknown;
  readonly processingDate?: unknown;
  readonly outcomes?: unknown;
  readonly detectors?: unknown;
  readonly errors?: unknown;
}

/** Passes through ONLY the 5 known, already-sanitized top-level fields of refresh-longitudinal's own response contract — never spreads the raw body, so an unexpected future field can never leak through unreviewed. */
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

export async function invokeRefreshOnce(client: InvokeClient): Promise<{ data: unknown; error: unknown }> {
  // Exactly one call. No loop, no retry — see module doc and Section 11 of
  // the V0.3_001B rollout review: a partial failure or network error is
  // reported and the process stops; this function is never called twice
  // from within a single tool invocation.
  return client.functions.invoke("refresh-longitudinal", { method: "POST", body: {} });
}

/** The exact, case-sensitive, no-default comparison — extracted as a pure function so it is directly testable without a real prompt. */
export function isValidBackfillConfirmation(answer: string): boolean {
  return answer === "BACKFILL";
}

async function requireBackfillConfirmation(): Promise<void> {
  const answer = await promptVisible('\nType exactly "BACKFILL" to proceed with the first remote write, or anything else to abort: ');
  if (!isValidBackfillConfirmation(answer)) {
    throw new ConfirmationDeclinedError();
  }
}

async function main(): Promise<void> {
  const approval = parseApprovalArgs(process.argv.slice(2));

  // Repository guard — before any auth/network. Additionally requires the
  // current HEAD to exactly equal the approved HEAD supplied on argv.
  const guardState = runRepositoryGuard();
  if (guardState.head !== approval.approvedHead) {
    throw new ApprovalGateError(
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

    assertApprovalGates(report, approval);

    console.log(JSON.stringify(buildSafePreflightSummary(report), null, 2));

    await requireBackfillConfirmation();

    const { data, error } = await invokeRefreshOnce(session.client);

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
      process.exitCode = 1;
      return;
    }

    const sanitized = sanitizeInvokeResponse(data);
    console.log(JSON.stringify(sanitized, null, 2));

    if (sanitized.status === "partial_failure") {
      console.error(
        "\nstatus = partial_failure. STOP — do not invoke again. Inspect remote state read-only first (see the V0.3_001B rollout review's partial-failure recovery model)."
      );
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
