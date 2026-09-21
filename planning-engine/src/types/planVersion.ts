/**
 * TrainingPlanVersion — content-only, insert-once (M0 Issue 2). Never
 * mutated after creation, including no status field: lifecycle state lives
 * entirely in TrainingPlanVersionLifecycleTransition (planLifecycle.ts),
 * exactly mirroring the already-proven `pattern_evidence_identities` /
 * `pattern_evidence_lifecycle_transitions` split in the existing schema.
 */
import type { PlanInputSnapshot } from "./planInputSnapshot.js";

export type GenerationTrigger =
  | "initial"
  | "race_added"
  | "race_removed"
  | "availability_changed"
  | "equipment_changed"
  | "missed_session"
  | "manual_edit"
  | "ruleset_upgrade";

export interface RelaxedConstraint {
  /** Stable id of the hard constraint that could not be fully satisfied — see validation/validatePlanVersion.ts's known-constraint-id list. */
  constraintId: string;
  reason: string;
}

export interface TrainingPlanVersion {
  id: string;
  athleteId: string;
  /** Lineage pointer — the version this one supersedes, if any. Never null for a regeneration, always undefined for the very first version. */
  baseVersionId?: string;

  horizonStartDate: string; // ISO date
  horizonEndDate: string; // ISO date

  inputSnapshot: PlanInputSnapshot;
  /** Cheap pre-check for "did anything meaningful change since the last version" — optimization only, never load-bearing for correctness (M0 §Metadata). */
  inputSnapshotHash: string;

  plannerVersion: string;
  rulesetVersion: string;
  /** Single combined version covering both exercise and drill catalogues — released together, mirrors `engine_version`'s existing single-string precedent. */
  catalogVersion: string;
  prescriptionSchemaVersion: string;

  generationTrigger: GenerationTrigger;
  generatedAt: string; // ISO datetime

  rationale: string;
  relaxedConstraints: RelaxedConstraint[];
}
