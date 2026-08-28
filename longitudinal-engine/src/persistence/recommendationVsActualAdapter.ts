/**
 * M5_006A/V0.3_001A — the M5_005 recommendation_vs_actual_execution
 * persistence adapter. The only place in this package that maps a
 * RecommendationVsActualDetection onto the lifecycle-aware evidence RPCs —
 * no generic/speculative serializer, no plugin registry: exactly this one
 * detector's result shape, exactly two provenance rows.
 *
 * V0.3_001A correction (see docs/11_DECISION_LOG.md): originally
 * `no_evidence` was a pure no-op (no RPC call at all), which left stale
 * `pattern_evidence_current_effective` rows behind whenever a previously
 * "explicit" execution relationship later became non-explicit (e.g. the
 * linked completed_session was edited/unlinked). `no_evidence` now mirrors
 * `sleepEnergyAdapter.ts`/`painPersistenceAdapter.ts` exactly: it withdraws
 * any prior active evidence via the existing, unmodified
 * `transition_pattern_evidence_lifecycle` RPC. Correspondingly, `evidence`
 * now writes through the composite `persist_active_pattern_evidence` RPC
 * (not the plain `persist_pattern_evidence` RPC) so that evidence
 * reappearing after a withdrawal correctly reactivates the SAME identity —
 * using the non-lifecycle-aware RPC here would leave a reactivated
 * identity's lifecycle state permanently withdrawn.
 *
 * DB interaction is confined to this file (and its siblings under
 * `persistence/**`) — detectors/** and relations/** remain pure. The only
 * thing imported from detectors/** here is a type (RecommendationVsActualDetection),
 * never a runtime value — no cycle, no detector-side DB dependency.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecommendationVsActualDetection } from "../detectors/types.js";
import { persistActivePatternEvidence, transitionPatternEvidenceLifecycle } from "./lifecycleAdapter.js";

export interface PersistRecommendationVsActualEvidenceParams {
  readonly athleteId: string;
  readonly detection: RecommendationVsActualDetection;
}

export type RecommendationVsActualNoEvidenceAction = "withdrawn" | "unchanged_withdrawal" | "skipped_no_evidence_no_prior";

export type PersistRecommendationVsActualEvidenceResult =
  | {
      readonly kind: "evidence";
      readonly identityId: string;
      readonly revisionId: string;
      readonly revisionNumber: number;
      readonly evidenceAction: "inserted" | "superseded" | "unchanged";
      readonly lifecycleAction: "transitioned" | "unchanged";
      readonly lifecycleTransitionId: string | null;
      readonly lifecycleTransitionNumber: number | null;
    }
  | {
      readonly kind: "no_evidence";
      readonly action: RecommendationVsActualNoEvidenceAction;
      readonly identityId: string | null;
      readonly transitionId: string | null;
      readonly transitionNumber: number | null;
    };

const NO_EVIDENCE_ACTION_MAP: Record<"transitioned" | "unchanged" | "skipped_no_prior", RecommendationVsActualNoEvidenceAction> = {
  transitioned: "withdrawn",
  unchanged: "unchanged_withdrawal",
  skipped_no_prior: "skipped_no_evidence_no_prior",
};

/**
 * `no_evidence` maps to exactly one provenance-free lifecycle withdrawal —
 * `context` is always `{}` (no additional breadcrumb is genuinely required:
 * `reason_code` plus the identity's own `evaluationKey`/`evidenceKey`
 * columns already capture everything meaningful about a recommendation
 * no_evidence state; unlike sleep-energy/pain-persistence there is no
 * "previous checkin" concept here worth duplicating into lifecycle
 * context). `evidence` maps to exactly two provenance rows: the decision
 * itself and the linked completed session, both unchanged from before —
 * the only two source facts M5_005's detector ever consumes (see
 * recommendationVsActualExecution.ts).
 */
export async function persistRecommendationVsActualEvidence(
  client: SupabaseClient,
  params: PersistRecommendationVsActualEvidenceParams
): Promise<PersistRecommendationVsActualEvidenceResult> {
  const { athleteId, detection } = params;

  if (detection.kind === "no_evidence") {
    const result = await transitionPatternEvidenceLifecycle(client, {
      athleteId,
      detectorRuleId: detection.detectorRuleId,
      detectorRuleVersion: detection.detectorRuleVersion,
      evidenceKey: detection.evidenceKey,
      targetState: "withdrawn",
      reasonCode: detection.reason,
      context: {},
    });
    return {
      kind: "no_evidence",
      action: NO_EVIDENCE_ACTION_MAP[result.action],
      identityId: result.identityId,
      transitionId: result.transitionId,
      transitionNumber: result.transitionNumber,
    };
  }

  const provenance = [
    { role: "evaluation_decision", source_kind: "decision", source_id: detection.sourceRefs.decisionId },
    { role: "linked_completed_session", source_kind: "completed_session", source_id: detection.sourceRefs.completedSessionId },
  ];

  const result = await persistActivePatternEvidence(client, {
    athleteId,
    detectorRuleId: detection.detectorRuleId,
    detectorRuleVersion: detection.detectorRuleVersion,
    evaluationKey: detection.evaluationKey,
    evidenceKey: detection.evidenceKey,
    eventType: detection.eventType,
    eventDate: detection.eventDate,
    observedValue: detection.observedValue as unknown as Record<string, unknown>,
    provenance,
  });

  return {
    kind: "evidence",
    identityId: result.identityId,
    revisionId: result.revisionId,
    revisionNumber: result.revisionNumber,
    evidenceAction: result.evidenceAction,
    lifecycleAction: result.lifecycleAction,
    lifecycleTransitionId: result.lifecycleTransitionId,
    lifecycleTransitionNumber: result.lifecycleTransitionNumber,
  };
}
