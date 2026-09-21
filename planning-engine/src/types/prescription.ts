/**
 * PlannedPrescription / FinalPrescription — the two-stage prescription
 * contract (M0 §3). PlannedPrescription is authored together with the plan,
 * immutable, belongs to exactly one GeneratedPlanSession. FinalPrescription
 * is produced daily, after Head Coach's KEEP/MODIFY/REPLACE/REST decision
 * (or a manual planned_sessions override — see `source`), by the shared
 * Prescription module — never a second independent decision-maker (M0 §11
 * ownership matrix: this module is invoked by, never a peer of, Planning
 * Engine and Head Coach).
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
 * Closed union, per M0 §3/§Issue3. Every value is a complete answer to
 * "why does this FinalPrescription look the way it does":
 *  - head_coach_keep/modify/replace: Head Coach's own DailyPlan.decision
 *    for a date that had a matching GeneratedPlanSession, kind unchanged
 *    (keep/modify) or changed (replace) by Head Coach itself.
 *  - manual_override_same_kind: the athlete edited planned_sessions but
 *    kept the same SessionKind as the originally generated session —
 *    reconciled like a MODIFY (bounded dose adaptation, same structure).
 *  - manual_override_new_kind: the athlete changed the SessionKind itself —
 *    reconciled like a REPLACE (fresh prescription, no compatible parent).
 *  - no_plan: no GeneratedPlanSession existed for this date at all (no
 *    accepted plan, or a manually-added day outside its coverage).
 */
export type FinalPrescriptionSource =
  | "head_coach_keep"
  | "head_coach_modify"
  | "head_coach_replace"
  | "manual_override_same_kind"
  | "manual_override_new_kind"
  | "no_plan";

export interface FinalPrescription {
  id: string;
  /** Always present — this IS the Head Coach decision this prescription reconciles against. */
  decisionId: string;
  /** Present whenever an accepted plan existed at decision time, REGARDLESS of whether it was followed — "a plan existed, athlete deviated" is retained provenance (M0 §Issue3 Q4), not collapsed to undefined. */
  planVersionId?: string;
  /** Undefined exactly when `source` is "manual_override_new_kind", "head_coach_replace", or "no_plan" — there is no compatible originating prescription to point at. */
  plannedPrescriptionId?: string;

  source: FinalPrescriptionSource;
  /** Which MODIFY/REPLACE-equivalent adaptation rule(s) fired — same auditability discipline as TriggeredRule. Empty for head_coach_keep/no_plan. */
  adaptationRuleIds: string[];

  schemaVersion: string;
  catalogVersion: string;
  structure?: PrescriptionStructure; // undefined only for a REST-equivalent day (no_plan is still possible to have a structure, e.g. a manually-added session with no plan; REST never does)
  generatedAt: string; // ISO datetime
}
