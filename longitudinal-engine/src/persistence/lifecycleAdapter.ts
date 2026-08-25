/**
 * M5_006B — generic, detector-agnostic adapters over the two new lifecycle
 * RPCs (transition_pattern_evidence_lifecycle, persist_active_pattern_evidence).
 * Mirrors recommendationVsActualAdapter.ts's own conventions exactly:
 * unwrapped RPC error propagation (never parsed/wrapped/recreated), a thin
 * 1:1 mapping between the RPC's snake_case jsonb response and a typed TS
 * shape, no application-side SELECT-then-decide logic of any kind (the RPC
 * makes and acts on the entire decision under its own lock).
 *
 * Detector-specific composition (e.g. the sleep-energy adapter's mapping
 * from a NoEvidence.reason to p_reason_code/p_context) lives one layer up,
 * in the detector's own adapter module — this file knows nothing about any
 * specific detector's result shape.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PatternEvidenceLifecycleState,
  PersistActivePatternEvidenceResult,
  TransitionPatternEvidenceLifecycleResult,
} from "./lifecycleTypes.js";

export interface TransitionPatternEvidenceLifecycleParams {
  readonly athleteId: string;
  readonly detectorRuleId: string;
  readonly detectorRuleVersion: string;
  readonly evidenceKey: string;
  readonly targetState: PatternEvidenceLifecycleState;
  readonly reasonCode: string | null;
  readonly context: Record<string, unknown>;
}

interface TransitionPatternEvidenceLifecycleRpcResponse {
  readonly identity_id: string | null;
  readonly transition_id: string | null;
  readonly transition_number: number | null;
  readonly state: PatternEvidenceLifecycleState | null;
  readonly action: TransitionPatternEvidenceLifecycleResult["action"];
}

export async function transitionPatternEvidenceLifecycle(
  client: SupabaseClient,
  params: TransitionPatternEvidenceLifecycleParams
): Promise<TransitionPatternEvidenceLifecycleResult> {
  const { data, error } = await client.rpc("transition_pattern_evidence_lifecycle", {
    p_athlete_id: params.athleteId,
    p_detector_rule_id: params.detectorRuleId,
    p_detector_rule_version: params.detectorRuleVersion,
    p_evidence_key: params.evidenceKey,
    p_target_state: params.targetState,
    p_reason_code: params.reasonCode,
    p_context: params.context,
  });

  // Exact RPC error object propagates unwrapped — same locked contract as
  // every other adapter in this package.
  if (error) {
    throw error;
  }

  const response = data as TransitionPatternEvidenceLifecycleRpcResponse;
  return {
    identityId: response.identity_id,
    transitionId: response.transition_id,
    transitionNumber: response.transition_number,
    state: response.state,
    action: response.action,
  };
}

export interface PersistActivePatternEvidenceParams {
  readonly athleteId: string;
  readonly detectorRuleId: string;
  readonly detectorRuleVersion: string;
  readonly evaluationKey: string;
  readonly evidenceKey: string;
  readonly eventType: string;
  readonly eventDate: string;
  readonly observedValue: Record<string, unknown>;
  readonly provenance: ReadonlyArray<{ readonly role: string; readonly source_kind: string; readonly source_id: string }>;
}

interface PersistActivePatternEvidenceRpcResponse {
  readonly identity_id: string;
  readonly revision_id: string;
  readonly revision_number: number;
  readonly evidence_action: PersistActivePatternEvidenceResult["evidenceAction"];
  readonly lifecycle_action: PersistActivePatternEvidenceResult["lifecycleAction"];
  readonly lifecycle_transition_id: string | null;
  readonly lifecycle_transition_number: number | null;
}

export async function persistActivePatternEvidence(
  client: SupabaseClient,
  params: PersistActivePatternEvidenceParams
): Promise<PersistActivePatternEvidenceResult> {
  const { data, error } = await client.rpc("persist_active_pattern_evidence", {
    p_athlete_id: params.athleteId,
    p_detector_rule_id: params.detectorRuleId,
    p_detector_rule_version: params.detectorRuleVersion,
    p_evaluation_key: params.evaluationKey,
    p_evidence_key: params.evidenceKey,
    p_event_type: params.eventType,
    p_event_date: params.eventDate,
    p_observed_value: params.observedValue,
    p_provenance: params.provenance,
  });

  if (error) {
    throw error;
  }

  const response = data as PersistActivePatternEvidenceRpcResponse;
  return {
    identityId: response.identity_id,
    revisionId: response.revision_id,
    revisionNumber: response.revision_number,
    evidenceAction: response.evidence_action,
    lifecycleAction: response.lifecycle_action,
    lifecycleTransitionId: response.lifecycle_transition_id,
    lifecycleTransitionNumber: response.lifecycle_transition_number,
  };
}
