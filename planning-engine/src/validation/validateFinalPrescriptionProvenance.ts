/**
 * A tiny pure helper, not reconciliation logic — M1 explicitly stops short
 * of implementing reconciliation (M0 §3's KEEP/MODIFY/REPLACE/REST
 * behavior), but this package still needs SOMETHING that forces the
 * `FinalPrescriptionSource` union to be handled exhaustively at compile
 * time, so a future 7th source value can never be added without every
 * consumer noticing. This function only checks the provenance-nullability
 * invariant already locked in M0 §Issue3 Q3 — it makes no decision about
 * WHAT a FinalPrescription's structure should be.
 */
import { PlanningEngineValidationError } from "./errors.js";
import type { FinalPrescriptionSource } from "../types/prescription.js";

function assertNever(value: never): never {
  throw new PlanningEngineValidationError("FinalPrescriptionSource", `unhandled source "${String(value)}"`, value);
}

/** True when this source implies a compatible originating PlannedPrescription existed (M0 §Issue3 Q3). */
export function sourceRequiresPlannedPrescription(source: FinalPrescriptionSource): boolean {
  switch (source) {
    case "head_coach_keep":
    case "head_coach_modify":
    case "manual_override_same_kind":
      return true;
    case "head_coach_replace":
    case "manual_override_new_kind":
    case "no_plan":
      return false;
    default:
      return assertNever(source);
  }
}

export function validateFinalPrescriptionProvenance(prescription: {
  source: FinalPrescriptionSource;
  plannedPrescriptionId?: string;
}): void {
  const requiresPlanned = sourceRequiresPlannedPrescription(prescription.source);
  if (requiresPlanned && prescription.plannedPrescriptionId === undefined) {
    throw new PlanningEngineValidationError(
      "FinalPrescription",
      `source "${prescription.source}" requires plannedPrescriptionId, but none was given`,
      prescription
    );
  }
  if (!requiresPlanned && prescription.plannedPrescriptionId !== undefined) {
    throw new PlanningEngineValidationError(
      "FinalPrescription",
      `source "${prescription.source}" must not carry a plannedPrescriptionId`,
      prescription
    );
  }
}
