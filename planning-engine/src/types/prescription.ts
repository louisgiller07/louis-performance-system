/**
 * PlannedPrescription / FinalPrescription — the two-stage prescription
 * contract (M0 §3). PlannedPrescription is authored together with the plan,
 * immutable, belongs to exactly one GeneratedPlanSession. FinalPrescription
 * is produced daily, after Head Coach's KEEP/MODIFY/REPLACE/REST decision
 * (or a manual planned_sessions override), by the shared Prescription
 * module — never a second independent decision-maker (M0 §11 ownership
 * matrix: this module is invoked by, never a peer of, Planning Engine and
 * Head Coach).
 *
 * FinalPrescription's provenance is TWO orthogonal axes (M2 persistence —
 * "FinalPrescription Provenance Closure"), not a single `source` enum. A
 * single axis cannot represent a real, valid state: the athlete manually
 * overrides a session AND Head Coach subsequently modifies it further. See
 * ActiveSessionOrigin / ReconciliationAction below and
 * validation/validateFinalPrescriptionProvenance.ts for the full presence
 * matrix — this exactly mirrors `decision_final_prescriptions`' CHECK
 * constraints in the locked M2 schema
 * (supabase/migrations/..._v0_4_001d_training_plan_prescriptions.sql).
 */
import type { PrescriptionStructure } from "./prescriptionStructure.js";

export interface PlannedPrescription {
  id: string;
  generatedPlanSessionId: string;
  schemaVersion: string;
  catalogVersion: string;
  structure: PrescriptionStructure;
}

/**
 * Axis 1 — "where did today's active coarse session come from, relative to
 * the canonical generated plan?" Independent of what Head Coach then did to
 * it (see ReconciliationAction) — both axes vary independently.
 *  - generated: the active session matches the canonical GeneratedPlanSession
 *    exactly — no manual edit occurred.
 *  - manual_override_same_kind: the athlete edited planned_sessions (e.g.
 *    duration/load) but kept the same SessionKind as the generated session.
 *  - manual_override_new_kind: the athlete changed the SessionKind itself.
 *  - no_canonical_plan: no accepted plan version covered this date at all
 *    (no GeneratedPlanSession existed — no accepted plan, or a manually-added
 *    day outside its coverage), regardless of whether planned_sessions held
 *    a manual row or nothing at all.
 */
export type ActiveSessionOrigin =
  | "generated"
  | "manual_override_same_kind"
  | "manual_override_new_kind"
  | "no_canonical_plan";

/**
 * Axis 2 — "what did Head Coach do to the active session today?" The same
 * KEEP/MODIFY/REPLACE vocabulary as DailyPlan.decision (head-coach-engine),
 * now on its own axis instead of tangled with provenance. REST produces NO
 * FinalPrescription at all (see FinalPrescription.structure below), so REST
 * is not a member of this union.
 */
export type ReconciliationAction = "keep" | "modify" | "replace";

export interface FinalPrescription {
  id: string;
  /** Always present — this IS the Head Coach decision this prescription reconciles against. */
  decisionId: string;
  /** Present whenever a canonical plan existed for this date (activeSessionOrigin !== "no_canonical_plan") — "a plan existed, athlete deviated" is retained provenance, never collapsed to undefined. */
  planVersionId?: string;
  /** Present exactly when activeSessionOrigin carries same-kind lineage ("generated" or "manual_override_same_kind") AND reconciliationAction did not break it ("keep" or "modify") — "replace" always leaves this undefined, even when a compatible prescription exists, because the resulting content no longer derives from it. */
  plannedPrescriptionId?: string;

  activeSessionOrigin: ActiveSessionOrigin;
  reconciliationAction: ReconciliationAction;
  /** Which MODIFY/REPLACE adaptation rule(s) fired — same auditability discipline as TriggeredRule. Empty iff reconciliationAction is "keep"; non-empty for "modify"/"replace", regardless of activeSessionOrigin — never silent about why something changed. */
  adaptationRuleIds: string[];

  schemaVersion: string;
  catalogVersion: string;
  /** Always present — a FinalPrescription is only ever constructed when there is executable content to prescribe. A REST-equivalent day gets no FinalPrescription at all (the caller simply never constructs one), never an instance with structure left undefined. */
  structure: PrescriptionStructure;
  generatedAt: string; // ISO datetime
}
