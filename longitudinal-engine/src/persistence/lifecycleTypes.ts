/**
 * M5_006B — lifecycle persistence-layer result shapes. Distinct from
 * types.ts's PersistPatternEvidenceAdapterResult (M5_006A, evidence-only,
 * unaware of lifecycle) — these mirror the exact machine-readable shapes
 * transition_pattern_evidence_lifecycle / persist_active_pattern_evidence
 * return, per their own migrations' doc comments.
 */
export type PatternEvidenceLifecycleState = "active" | "withdrawn";

export type TransitionPatternEvidenceLifecycleAction = "transitioned" | "unchanged" | "skipped_no_prior";

export interface TransitionPatternEvidenceLifecycleResult {
  readonly identityId: string | null;
  readonly transitionId: string | null;
  readonly transitionNumber: number | null;
  readonly state: PatternEvidenceLifecycleState | null;
  readonly action: TransitionPatternEvidenceLifecycleAction;
}

export type PersistActivePatternEvidenceEvidenceAction = "inserted" | "superseded" | "unchanged";
export type PersistActivePatternEvidenceLifecycleAction = "transitioned" | "unchanged";

export interface PersistActivePatternEvidenceResult {
  readonly identityId: string;
  readonly revisionId: string;
  readonly revisionNumber: number;
  readonly evidenceAction: PersistActivePatternEvidenceEvidenceAction;
  readonly lifecycleAction: PersistActivePatternEvidenceLifecycleAction;
  readonly lifecycleTransitionId: string | null;
  readonly lifecycleTransitionNumber: number | null;
}
