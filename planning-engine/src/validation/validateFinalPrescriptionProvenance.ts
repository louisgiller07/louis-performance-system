/**
 * A tiny pure helper, not reconciliation logic — M1 explicitly stops short
 * of implementing reconciliation (M0 §3's KEEP/MODIFY/REPLACE/REST
 * behavior), but this package still needs SOMETHING that forces both
 * ActiveSessionOrigin and ReconciliationAction to be handled exhaustively at
 * compile time, so a future value can never be added to either union
 * without every consumer noticing. This function only checks the
 * provenance-presence invariants locked in the M2 persistence closure — it
 * makes no decision about WHAT a FinalPrescription's structure should be.
 *
 * The three checks below exactly mirror `decision_final_prescriptions`'
 * three CHECK constraints in the M2 schema
 * (supabase/migrations/..._v0_4_001d_training_plan_prescriptions.sql):
 * plan_version_presence, planned_prescription_presence,
 * adaptation_rule_ids_matches_action.
 */
import { PlanningEngineValidationError } from "./errors.js";
import type { ActiveSessionOrigin, ReconciliationAction } from "../types/prescription.js";

function assertNeverOrigin(value: never): never {
  throw new PlanningEngineValidationError("ActiveSessionOrigin", `unhandled activeSessionOrigin "${String(value)}"`, value);
}

function assertNeverAction(value: never): never {
  throw new PlanningEngineValidationError("ReconciliationAction", `unhandled reconciliationAction "${String(value)}"`, value);
}

/** True when a canonical plan covered this date at all — governs planVersionId presence. */
function originImpliesCanonicalPlan(origin: ActiveSessionOrigin): boolean {
  switch (origin) {
    case "generated":
    case "manual_override_same_kind":
    case "manual_override_new_kind":
      return true;
    case "no_canonical_plan":
      return false;
    default:
      return assertNeverOrigin(origin);
  }
}

/** True when this origin carries same-kind lineage to a compatible PlannedPrescription — only meaningful together with actionPreservesLineage below. */
function originHasSameKindLineage(origin: ActiveSessionOrigin): boolean {
  switch (origin) {
    case "generated":
    case "manual_override_same_kind":
      return true;
    case "manual_override_new_kind":
    case "no_canonical_plan":
      return false;
    default:
      return assertNeverOrigin(origin);
  }
}

/** False for "replace": by definition the resulting content no longer derives from the compatible planned prescription even when one exists, regardless of origin. */
function actionPreservesLineage(action: ReconciliationAction): boolean {
  switch (action) {
    case "keep":
    case "modify":
      return true;
    case "replace":
      return false;
    default:
      return assertNeverAction(action);
  }
}

/** planVersionId is required exactly when a canonical plan existed for this date. */
export function requiresPlanVersion(origin: ActiveSessionOrigin): boolean {
  return originImpliesCanonicalPlan(origin);
}

/** plannedPrescriptionId is required exactly when the origin has same-kind lineage AND the action did not break it (M2 closure: all 12 origin x action combinations are valid; this is the only rule governing this field, and it depends on both axes). */
export function requiresPlannedPrescription(origin: ActiveSessionOrigin, action: ReconciliationAction): boolean {
  return originHasSameKindLineage(origin) && actionPreservesLineage(action);
}

/** True exactly when this action requires at least one cited adaptationRuleId — never silent about why something changed, regardless of activeSessionOrigin. */
export function requiresAdaptationRules(action: ReconciliationAction): boolean {
  switch (action) {
    case "keep":
      return false;
    case "modify":
    case "replace":
      return true;
    default:
      return assertNeverAction(action);
  }
}

export function validateFinalPrescriptionProvenance(prescription: {
  activeSessionOrigin: ActiveSessionOrigin;
  reconciliationAction: ReconciliationAction;
  planVersionId?: string;
  plannedPrescriptionId?: string;
  adaptationRuleIds: string[];
}): void {
  const needsPlanVersion = requiresPlanVersion(prescription.activeSessionOrigin);
  if (needsPlanVersion && prescription.planVersionId === undefined) {
    throw new PlanningEngineValidationError(
      "FinalPrescription",
      `activeSessionOrigin "${prescription.activeSessionOrigin}" requires planVersionId, but none was given`,
      prescription
    );
  }
  if (!needsPlanVersion && prescription.planVersionId !== undefined) {
    throw new PlanningEngineValidationError(
      "FinalPrescription",
      `activeSessionOrigin "${prescription.activeSessionOrigin}" must not carry a planVersionId`,
      prescription
    );
  }

  const needsPlannedPrescription = requiresPlannedPrescription(prescription.activeSessionOrigin, prescription.reconciliationAction);
  if (needsPlannedPrescription && prescription.plannedPrescriptionId === undefined) {
    throw new PlanningEngineValidationError(
      "FinalPrescription",
      `activeSessionOrigin "${prescription.activeSessionOrigin}" + reconciliationAction "${prescription.reconciliationAction}" requires plannedPrescriptionId, but none was given`,
      prescription
    );
  }
  if (!needsPlannedPrescription && prescription.plannedPrescriptionId !== undefined) {
    throw new PlanningEngineValidationError(
      "FinalPrescription",
      `activeSessionOrigin "${prescription.activeSessionOrigin}" + reconciliationAction "${prescription.reconciliationAction}" must not carry a plannedPrescriptionId`,
      prescription
    );
  }

  const needsAdaptationRules = requiresAdaptationRules(prescription.reconciliationAction);
  if (needsAdaptationRules && prescription.adaptationRuleIds.length === 0) {
    throw new PlanningEngineValidationError(
      "FinalPrescription",
      `reconciliationAction "${prescription.reconciliationAction}" requires at least one adaptationRuleId, but none was given`,
      prescription
    );
  }
  if (!needsAdaptationRules && prescription.adaptationRuleIds.length > 0) {
    throw new PlanningEngineValidationError(
      "FinalPrescription",
      `reconciliationAction "${prescription.reconciliationAction}" must not carry adaptationRuleIds`,
      prescription
    );
  }
}
