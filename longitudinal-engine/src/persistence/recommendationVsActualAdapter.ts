/**
 * M5_006A — the M5_005 recommendation_vs_actual_execution persistence
 * adapter. The only place in this package that maps a
 * RecommendationVsActualDetection onto the persist_pattern_evidence RPC —
 * no generic/speculative serializer, no plugin registry: exactly this one
 * detector's result shape, exactly two provenance rows.
 *
 * DB interaction is confined to this file (and its siblings under
 * `persistence/**`) — detectors/** and relations/** remain pure. The only
 * thing imported from detectors/** here is a type (RecommendationVsActualDetection),
 * never a runtime value — no cycle, no detector-side DB dependency.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecommendationVsActualDetection } from "../detectors/types.js";
import type { PersistPatternEvidenceAdapterResult, PersistPatternEvidenceAction } from "./types.js";

export interface PersistRecommendationVsActualEvidenceParams {
  readonly athleteId: string;
  readonly detection: RecommendationVsActualDetection;
}

interface PersistPatternEvidenceRpcResponse {
  readonly identity_id: string;
  readonly revision_id: string;
  readonly revision_number: number;
  readonly action: PersistPatternEvidenceAction;
}

/**
 * `no_evidence` never calls the RPC, never creates an identity, a revision,
 * or provenance — it is a purely local, zero-write short-circuit. `evidence`
 * maps to exactly two provenance entries: the decision itself
 * (role="evaluation_decision") and the linked completed session
 * (role="linked_completed_session") — the only two source facts M5_005's
 * detector ever consumes (see recommendationVsActualExecution.ts).
 */
export async function persistRecommendationVsActualEvidence(
  client: SupabaseClient,
  params: PersistRecommendationVsActualEvidenceParams
): Promise<PersistPatternEvidenceAdapterResult> {
  const { athleteId, detection } = params;

  if (detection.kind === "no_evidence") {
    return { action: "skipped_no_evidence" };
  }

  const { data, error } = await client.rpc("persist_pattern_evidence", {
    p_athlete_id: athleteId,
    p_detector_rule_id: detection.detectorRuleId,
    p_detector_rule_version: detection.detectorRuleVersion,
    p_evaluation_key: detection.evaluationKey,
    p_evidence_key: detection.evidenceKey,
    p_event_type: detection.eventType,
    p_event_date: detection.eventDate,
    p_observed_value: detection.observedValue,
    p_provenance: [
      { role: "evaluation_decision", source_kind: "decision", source_id: detection.sourceRefs.decisionId },
      { role: "linked_completed_session", source_kind: "completed_session", source_id: detection.sourceRefs.completedSessionId },
    ],
  });

  // The exact error object returned by the Supabase client propagates
  // unwrapped — never parsed, never reduced to code/message, never
  // rewrapped in a package-owned error. The locked adapter contract is
  // "RPC errors propagate UNWRAPPED"; a caller that wants to inspect
  // Supabase-specific fields (code, details, hint) must still be able to.
  if (error) {
    throw error;
  }

  const response = data as PersistPatternEvidenceRpcResponse;
  return {
    action: response.action,
    identityId: response.identity_id,
    revisionId: response.revision_id,
    revisionNumber: response.revision_number,
  };
}
