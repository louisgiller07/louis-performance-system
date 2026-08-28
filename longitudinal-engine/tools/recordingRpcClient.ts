/**
 * V0.3_001B — operator-only preview tooling. NOT imported by
 * supabase/functions/**, web/**, or head-coach-engine/**, and never
 * altered production runtime behavior — see previewRemoteRefresh.ts's own
 * doc for the full design record.
 *
 * A minimal in-memory stand-in for the `service_role`-typed `supabaseAdmin`
 * client that `calculateAndPersistOutcomes`/`runDetectors` expect. It
 * implements ONLY `.rpc(fn, args)` (the only method either real
 * orchestrator ever calls on that client — confirmed by inspection: neither
 * touches `.from()`/`.insert()`/`.update()`/`.delete()` at all) and performs
 * ZERO network I/O. Any call to any other client method throws immediately
 * (there is nothing to fall through to) — a hard, structural guarantee that
 * this preview can never mutate remote state, not merely a promise kept by
 * convention.
 *
 * Response shapes are SYNTHETIC and valid ONLY under the proven
 * empty-ledger precondition (the caller — previewRemoteRefresh.ts — MUST
 * have already confirmed the target athlete's own
 * `pattern_evidence_identities` count is 0 before using this client; see
 * its own doc). Under that precondition, the real RPCs' server-side
 * decisions are fully predictable without a network round trip:
 *   - `persist_active_pattern_evidence` (Evidence): nothing exists yet to
 *     supersede or leave unchanged, so the real RPC would always return
 *     `evidence_action: "inserted"`, `lifecycle_action: "unchanged"`.
 *   - `transition_pattern_evidence_lifecycle` (NoEvidence): no prior
 *     identity can exist, so the real RPC would always return
 *     `action: "skipped_no_prior"`, every id field `null`.
 *   - `persist_decision_outcome`: the calculator only reaches this call for
 *     units already filtered as newly-attempted (never `alreadyExisted`,
 *     since `decision_outcomes` was independently confirmed empty) — the
 *     real RPC's own uniqueness constraint would always succeed on a fresh
 *     insert, so `error: null` is the only honest simulated response.
 *
 * Identity/revision ids returned are OBVIOUSLY synthetic
 * (`preview-synthetic-*`), never a plausible-looking UUID — see
 * buildPreviewReport.ts, which never surfaces them in the report anyway.
 *
 * Recorded call metadata is deliberately narrow — see each Recorded*Call
 * type below for exactly what is (and, in their doc comments, is NOT)
 * captured. No `observed_value`, no source UUIDs, no free-text notes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** horizon only — never decisionId (kept out of every recorded structure so it can never leak into a report by omission-of-redaction). */
export interface RecordedOutcomeCall {
  readonly horizon: string;
}

/** detectorRuleId/detectorRuleVersion/eventType/provenanceCount only — never observed_value, never a source id, never evaluationKey/evidenceKey (both are decision/checkin-id-derived). */
export interface RecordedEvidenceCall {
  readonly detectorRuleId: string;
  readonly detectorRuleVersion: string;
  readonly eventType: string;
  readonly provenanceCount: number;
}

/** detectorRuleId/detectorRuleVersion/reasonCode only — never evidenceKey. */
export interface RecordedLifecycleCall {
  readonly detectorRuleId: string;
  readonly detectorRuleVersion: string;
  readonly reasonCode: string | null;
}

export interface RecordingRpcClient {
  /** Cast to SupabaseClient for passing into calculateAndPersistOutcomes/runDetectors verbatim — only `.rpc` is implemented. */
  readonly client: SupabaseClient;
  readonly outcomeCalls: readonly RecordedOutcomeCall[];
  readonly evidenceCalls: readonly RecordedEvidenceCall[];
  readonly lifecycleCalls: readonly RecordedLifecycleCall[];
}

/** A `.rpc()` call this client did not expect — see class doc: only the 3 named RPCs are ever called by calculateAndPersistOutcomes/runDetectors under normal operation, so anything else signals a real code-path change that this preview tool has not been updated to match. */
export class UnexpectedRecordingRpcCallError extends Error {
  constructor(fn: string) {
    super(
      `RecordingRpcClient: unexpected RPC call "${fn}". This preview tool only simulates persist_decision_outcome/persist_active_pattern_evidence/transition_pattern_evidence_lifecycle under the proven-empty-ledger precondition — a call to any other RPC means production orchestration code changed in a way this tool must be updated to match before it can be trusted again.`
    );
    this.name = "UnexpectedRecordingRpcCallError";
  }
}

export function createRecordingRpcClient(): RecordingRpcClient {
  const outcomeCalls: RecordedOutcomeCall[] = [];
  const evidenceCalls: RecordedEvidenceCall[] = [];
  const lifecycleCalls: RecordedLifecycleCall[] = [];
  let syntheticSequence = 0;

  async function rpc(fn: string, args: Record<string, unknown> | undefined): Promise<{ data: unknown; error: null }> {
    const a = args ?? {};

    if (fn === "persist_decision_outcome") {
      const row = a.p_row as { horizon?: unknown } | undefined;
      outcomeCalls.push({ horizon: String(row?.horizon ?? "") });
      return { data: null, error: null };
    }

    if (fn === "persist_active_pattern_evidence") {
      syntheticSequence += 1;
      const provenance = a.p_provenance;
      evidenceCalls.push({
        detectorRuleId: String(a.p_detector_rule_id ?? ""),
        detectorRuleVersion: String(a.p_detector_rule_version ?? ""),
        eventType: String(a.p_event_type ?? ""),
        provenanceCount: Array.isArray(provenance) ? provenance.length : 0,
      });
      return {
        data: {
          identity_id: `preview-synthetic-identity-${syntheticSequence}`,
          revision_id: `preview-synthetic-revision-${syntheticSequence}`,
          revision_number: 1,
          evidence_action: "inserted",
          lifecycle_action: "unchanged",
          lifecycle_transition_id: null,
          lifecycle_transition_number: null,
        },
        error: null,
      };
    }

    if (fn === "transition_pattern_evidence_lifecycle") {
      lifecycleCalls.push({
        detectorRuleId: String(a.p_detector_rule_id ?? ""),
        detectorRuleVersion: String(a.p_detector_rule_version ?? ""),
        reasonCode: (a.p_reason_code as string | null | undefined) ?? null,
      });
      return {
        data: { identity_id: null, transition_id: null, transition_number: null, state: null, action: "skipped_no_prior" },
        error: null,
      };
    }

    throw new UnexpectedRecordingRpcCallError(fn);
  }

  const client = { rpc } as unknown as SupabaseClient;
  return { client, outcomeCalls, evidenceCalls, lifecycleCalls };
}
