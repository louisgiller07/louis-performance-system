/**
 * M5_006C — the pain-persistence detector's own persistence adapter. The
 * only place in this package that maps a PainPersistenceDetection onto the
 * two generic lifecycle RPCs (lifecycleAdapter.ts) — no generic/speculative
 * serializer, no plugin registry: exactly this one detector's result
 * shape, exactly two provenance roles. Mirrors sleepEnergyAdapter.ts's
 * conventions exactly.
 *
 * Evidence -> persistActivePatternEvidence (evidence write + lifecycle
 * activation in one composite RPC call). NoEvidence -> a withdrawal via
 * transitionPatternEvidenceLifecycle — no evidence write ever happens for
 * a NoEvidence result; withdrawal itself IS a real (lifecycle-only) write,
 * since a NoEvidence outcome for a previously-active identity must
 * actively withdraw it, not silently do nothing.
 *
 * DB interaction is confined to this file (and its siblings under
 * `persistence/**`) — detectors/** remains pure. The only thing imported
 * from detectors/** here is a type (PainPersistenceDetection), never a
 * runtime value.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PainPersistenceDetection } from "../detectors/painPersistenceTypes.js";
import { persistActivePatternEvidence, transitionPatternEvidenceLifecycle } from "./lifecycleAdapter.js";

export interface PersistPainPersistenceEvidenceParams {
  readonly athleteId: string;
  readonly detection: PainPersistenceDetection;
}

export type PainPersistenceNoEvidenceAction = "withdrawn" | "unchanged_withdrawal" | "skipped_no_evidence_no_prior";

export type PersistPainPersistenceEvidenceResult =
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
      readonly action: PainPersistenceNoEvidenceAction;
      readonly identityId: string | null;
      readonly transitionId: string | null;
      readonly transitionNumber: number | null;
    };

const NO_EVIDENCE_ACTION_MAP: Record<"transitioned" | "unchanged" | "skipped_no_prior", PainPersistenceNoEvidenceAction> = {
  transitioned: "withdrawn",
  unchanged: "unchanged_withdrawal",
  skipped_no_prior: "skipped_no_evidence_no_prior",
};

/**
 * `no_evidence` maps to exactly one provenance-free lifecycle withdrawal —
 * `context` carries the four fields the detector's own reason needs on
 * record: which checkin drove the withdrawal and its date, plus (when
 * present) which previous checkin the search resolved and its date (both
 * null for `no_recent_prior_checkin`). `evidence` maps to exactly two
 * provenance rows: the evaluation checkin and the previous checkin, both
 * `daily_checkin` — the only source fact this detector ever consumes (see
 * painPersistenceAcrossRecentCheckins.ts).
 */
export async function persistPainPersistenceEvidence(client: SupabaseClient, params: PersistPainPersistenceEvidenceParams): Promise<PersistPainPersistenceEvidenceResult> {
  const { athleteId, detection } = params;

  if (detection.kind === "no_evidence") {
    const result = await transitionPatternEvidenceLifecycle(client, {
      athleteId,
      detectorRuleId: detection.detectorRuleId,
      detectorRuleVersion: detection.detectorRuleVersion,
      evidenceKey: detection.evidenceKey,
      targetState: "withdrawn",
      reasonCode: detection.reason,
      context: {
        evaluation_checkin_id: detection.evaluationCheckinId,
        evaluation_date: detection.eventDate,
        previous_checkin_id: detection.previousCheckinId,
        previous_checkin_date: detection.previousCheckinDate,
      },
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
    { role: "evaluation_checkin", source_kind: "daily_checkin", source_id: detection.sourceRefs.evaluationCheckinId },
    { role: "previous_checkin", source_kind: "daily_checkin", source_id: detection.sourceRefs.previousCheckinId },
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
