/**
 * TrainingPlanVersion — content-only, insert-once (M0 Issue 2). Never
 * mutated after creation, including no status field: lifecycle state lives
 * entirely in TrainingPlanVersionLifecycleTransition (planLifecycle.ts),
 * exactly mirroring the already-proven `pattern_evidence_identities` /
 * `pattern_evidence_lifecycle_transitions` split in the existing schema.
 *
 * Fields below are aligned exactly with `training_plan_versions` in the
 * locked M2 schema (supabase/migrations/..._v0_4_001a_training_plan_versions.sql)
 * — inputSnapshotSchemaVersion and generationRequestId were identified as
 * gaps during the M2 persistence closure and added here to close them.
 */
import type { PlanInputSnapshot } from "./planInputSnapshot.js";
import type { SessionDomain } from "../pipeline/weekSegmenter.js";

export type GenerationTrigger =
  | "initial"
  | "race_added"
  | "race_removed"
  | "availability_changed"
  | "equipment_changed"
  | "missed_session"
  | "manual_edit"
  | "ruleset_upgrade";

/**
 * Closed vocabulary of relaxable hard constraints (V0.4_112/112A — replaces
 * a previously-unvalidated free string; see the V0.4_112 audit conversation
 * for the full reasoning — not yet reflected in docs/11_DECISION_LOG.md as
 * of this change). Covers only the two sources already fully
 * designed (WeekSegmenter's placement shortfall, ConstraintResolver's
 * recovery-spacing correction — neither yet implemented). Deliberately does
 * NOT include an equipment/exercise member: that source belongs to the
 * future Prescription Engine, not yet designed — a real closed-vocabulary
 * member must never be guessed ahead of its owning module's own contract.
 * Extend by adding a member when that module is actually designed, never by
 * redefining an existing one (same permanent-id discipline as the
 * catalogues in catalog/).
 */
export type ConstraintId = "placement_shortfall" | "recovery_spacing";

export interface RelaxedConstraint {
  constraintId: ConstraintId;
  reason: string;
  /** Present when the constraint concerns one specific domain (both current sources do). */
  domain?: SessionDomain;
  /** Present when a specific date is concerned (recovery_spacing) — absent for placement_shortfall, which structurally has no date (an unplaced slot was never assigned one). */
  date?: string;
}

export interface TrainingPlanVersion {
  id: string;
  athleteId: string;
  /** Lineage pointer — the version this one supersedes, if any. Never null for a regeneration, always undefined for the very first version. */
  baseVersionId?: string;

  horizonStartDate: string; // ISO date
  horizonEndDate: string; // ISO date

  inputSnapshot: PlanInputSnapshot;
  /** PlanInputSnapshot's own shape can evolve independently of plannerVersion/rulesetVersion — without this, an old snapshot becomes ambiguous to parse once the shape changes. */
  inputSnapshotSchemaVersion: string;
  /** Cheap pre-check for "did anything meaningful change since the last version" — optimization/audit metadata only, never load-bearing for correctness or identity (see generationRequestId below). */
  inputSnapshotHash: string;

  plannerVersion: string;
  rulesetVersion: string;
  /** Single combined version covering both exercise and drill catalogues — released together, mirrors `engine_version`'s existing single-string precedent. */
  catalogVersion: string;
  prescriptionSchemaVersion: string;

  generationTrigger: GenerationTrigger;
  /**
   * Idempotency key for the generation RPC — one UUID per LOGICAL generation
   * request, supplied by the caller, never derived from input content.
   * inputSnapshotHash is NOT identity: a deliberate regeneration with
   * byte-identical inputs must still be allowed, which a hash-based identity
   * would incorrectly collapse. A retry reuses the same generationRequestId;
   * a genuinely new generation always gets a fresh one.
   */
  generationRequestId: string;
  generatedAt: string; // ISO datetime

  rationale: string;
  relaxedConstraints: RelaxedConstraint[];
}
